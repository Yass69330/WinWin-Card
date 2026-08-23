-- ============================================================
-- WinWin Card — Droit à l'effacement RGPD
-- Déclenché par le marchand depuis son dashboard
-- ============================================================
-- Soft delete : on efface les données personnelles mais on conserve
-- la ligne pour maintenir l'intégrité des logs de scans anonymisés.
-- ============================================================

create or replace function effacer_client(
  p_client_id   uuid,
  p_marchand_id uuid
)
returns void
language plpgsql
security definer
as $$
begin
  -- Vérifier que le client appartient bien au marchand demandeur
  if not exists (
    select 1 from clients
    where id = p_client_id
      and marchand_id = p_marchand_id
      and deleted_at is null
  ) then
    raise exception 'Client introuvable ou déjà effacé';
  end if;

  -- 1. Supprimer les device tokens (stop push notifications)
  delete from device_tokens
  where client_id = p_client_id
    and marchand_id = p_marchand_id;

  -- 2. Supprimer les passes
  delete from passes
  where client_id = p_client_id
    and marchand_id = p_marchand_id;

  -- 3. Supprimer les consentements
  delete from consentements
  where client_id = p_client_id
    and marchand_id = p_marchand_id;

  -- 4. Anonymiser les données personnelles du client (soft delete)
  --    On conserve la ligne pour garder les scans cohérents
  update clients set
    prenom              = '[effacé]',
    email               = null,
    telephone           = null,
    date_anniversaire   = null,
    pass_serial_number  = 'deleted-' || p_client_id::text,
    deleted_at          = now(),
    updated_at          = now()
  where id = p_client_id
    and marchand_id = p_marchand_id;

  -- 5. Les scans restent pour les statistiques anonymisées du marchand
  --    (stored_value_avant / stored_value_apres sans données perso)

end;
$$;
