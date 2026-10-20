-- Migration 066 : numéro de téléphone attaché à la carte, récupération au comptoir
-- (f04 côté comptoir, plan validé par le pilotage le 20/10, docs/api/02-f04-comptoir-plan.md)
--
-- POURQUOI. Un client qui change de téléphone n'a aujourd'hui aucun moyen de
-- retrouver sa carte : il se réinscrit et repart à 0. Le caissier attache un
-- numéro à la carte (le client ne tape rien) ; plus tard, au comptoir, le numéro
-- retrouve la carte et un QR de 10 minutes la réinstalle sur le nouveau téléphone.
--
-- CE QUE FAIT LA MIGRATION (patron d'attribut client, docs/api/README.md) :
--   - normaliser_telephone : LA règle de format (Émirats par défaut), une seule
--     fois, en base ;
--   - garde-fou : deux clients d'un même marchand avec le même numéro UNE FOIS
--     NORMALISÉ → la migration s'arrête, rien n'est changé ;
--   - clients.telephone_normalise (colonne générée), telephone_source,
--     telephone_lie_le ; index unique : un numéro = une carte par marchand ;
--   - consentements.source ;
--   - recuperations_carte : chaque QR de récupération, tracé (jeton haché) ;
--   - attacher_telephone, trouver_carte_par_telephone, creer_recuperation,
--     ouvrir_recuperation : contrôle et écriture en un seul aller ;
--   - effacer_client : supprime aussi les récupérations (même texte que
--     rgpd_effacement.sql, mis à jour avec).
--
-- COÛT. La colonne générée réécrit la table clients une fois (verrou : les scans
-- attendent le temps de la réécriture, moins d'une seconde à quelques milliers de
-- lignes). Aucun index sur le chemin du scan.
-- ÉVOLUTION. Changer la règle de format = une migration qui recalcule la colonne
-- (UPDATE clients SET telephone = telephone) : une fonction IMMUTABLE redéfinie ne
-- recalcule pas les valeurs déjà stockées.
-- COMPATIBILITÉ. L'ancien code ignore tables, colonnes et fonctions. À exécuter
-- AVANT le code. Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 1. La règle de format ────────────────────────────────────────────────────
-- On retire espaces, tirets, points, barres et parenthèses ; « 00 » devant
-- devient « + ». Émirats par défaut : 05XXXXXXXX, 5XXXXXXXX, 971…, +971 0…, et
-- les fixes 0X XXX XXXX. Un « + » suivi de 8 à 15 chiffres est gardé (étranger).
-- Tout le reste → null : la valeur brute reste, inutilisable pour la récupération.
CREATE OR REPLACE FUNCTION public.normaliser_telephone(brut text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN s ~ '^05[0-9]{8}$'          THEN '+971' || substr(s, 2)
    WHEN s ~ '^0[2-9][0-9]{7}$'      THEN '+971' || substr(s, 2)
    WHEN s ~ '^5[0-9]{8}$'           THEN '+971' || s
    WHEN s ~ '^971[0-9]{8,9}$'       THEN '+' || s
    WHEN s ~ '^\+9710[0-9]{8,9}$'    THEN '+971' || substr(s, 6)
    WHEN s ~ '^\+[1-9][0-9]{7,14}$'  THEN s
    ELSE NULL
  END
  FROM (SELECT CASE WHEN t LIKE '00%' THEN '+' || substr(t, 3) ELSE t END AS s
          FROM (SELECT regexp_replace(coalesce(brut, ''), '[[:space:]./()-]', '', 'g') AS t) a) b
$$;
GRANT EXECUTE ON FUNCTION public.normaliser_telephone(text) TO service_role;

-- ── 2. Garde-fou : aucun numéro en double une fois normalisé ─────────────────
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.clients
     WHERE deleted_at IS NULL AND public.normaliser_telephone(telephone) IS NOT NULL
     GROUP BY marchand_id, public.normaliser_telephone(telephone) HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'migration 066 arrêtée : % numéro(s) en double une fois normalisé(s), rien n''a été changé', n;
  END IF;
END $$;

-- ── 3. Colonnes du patron d'attribut ─────────────────────────────────────────
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS telephone_normalise text
  GENERATED ALWAYS AS (public.normaliser_telephone(telephone)) STORED;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS telephone_source text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS telephone_lie_le timestamptz;
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_telephone_source_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_telephone_source_check
  CHECK (telephone_source IS NULL OR telephone_source IN ('inscription', 'comptoir', 'caisse', 'import'));

-- Les numéros déjà en base viennent tous de l'inscription (landing premium).
UPDATE public.clients SET telephone_source = 'inscription', telephone_lie_le = created_at
 WHERE telephone_normalise IS NOT NULL AND telephone_source IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clients_telephone_unique
  ON public.clients (marchand_id, telephone_normalise)
  WHERE telephone_normalise IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.consentements ADD COLUMN IF NOT EXISTS source text;

-- ── 4. Trace des récupérations ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recuperations_carte (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  marchand_id       uuid        NOT NULL REFERENCES public.marchands(id) ON DELETE CASCADE,
  client_id         uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  point_de_vente_id uuid        REFERENCES public.points_de_vente(id) ON DELETE SET NULL,
  role              text        NOT NULL CHECK (role IN ('scanner', 'marchand')),
  jeton_hash        text        NOT NULL UNIQUE,   -- sha256 du jeton, jamais le jeton
  cree_le           timestamptz NOT NULL DEFAULT now(),
  expire_le         timestamptz NOT NULL,
  ouvert_le         timestamptz,
  ouvertures        integer     NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_recuperations_client ON public.recuperations_carte (client_id);
ALTER TABLE public.recuperations_carte ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recuperations_carte TO service_role;

-- ── 5. Attacher un numéro (caissier) ─────────────────────────────────────────
-- p_ecrire = false : aperçu pour la confirmation (« Attacher le … à la carte de
-- … ? »), rien n'est écrit ; true : écriture, après la confirmation du caissier.
-- Un numéro déjà attaché ne se remplace jamais d'ici (décision du 20/10).
CREATE OR REPLACE FUNCTION public.attacher_telephone(
  p_marchand_id uuid, p_serial text, p_brut text, p_source text, p_ecrire boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_norm  text := public.normaliser_telephone(p_brut);
  v_id    uuid;
  v_prenom text;
  v_actuel text;
  v_autre text;
BEGIN
  IF v_norm IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'numero_invalide');
  END IF;
  IF p_ecrire THEN
    SELECT id, prenom, telephone_normalise INTO v_id, v_prenom, v_actuel FROM public.clients
     WHERE marchand_id = p_marchand_id AND pass_serial_number = p_serial AND deleted_at IS NULL
     FOR UPDATE;
  ELSE
    SELECT id, prenom, telephone_normalise INTO v_id, v_prenom, v_actuel FROM public.clients
     WHERE marchand_id = p_marchand_id AND pass_serial_number = p_serial AND deleted_at IS NULL;
  END IF;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'carte_introuvable');
  END IF;
  IF v_actuel = v_norm THEN
    RETURN jsonb_build_object('ok', true, 'inchange', true, 'telephone', v_norm, 'prenom', v_prenom);
  END IF;
  IF v_actuel IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'deja_un_numero', 'fin', right(v_actuel, 4));
  END IF;
  SELECT prenom INTO v_autre FROM public.clients
   WHERE marchand_id = p_marchand_id AND telephone_normalise = v_norm AND deleted_at IS NULL AND id <> v_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'numero_pris', 'prenom_autre', v_autre);
  END IF;
  IF NOT p_ecrire THEN
    RETURN jsonb_build_object('ok', true, 'apercu', true, 'telephone', v_norm, 'prenom', v_prenom);
  END IF;
  BEGIN
    UPDATE public.clients
       SET telephone = v_norm, telephone_source = p_source, telephone_lie_le = now()
     WHERE id = v_id;
  EXCEPTION WHEN unique_violation THEN   -- même numéro attaché au même instant ailleurs
    RETURN jsonb_build_object('ok', false, 'reason', 'numero_pris');
  END;
  INSERT INTO public.consentements (client_id, marchand_id, type, valeur, source)
  VALUES (v_id, p_marchand_id, 'telephone', true, p_source);
  RETURN jsonb_build_object('ok', true, 'telephone', v_norm, 'prenom', v_prenom);
END $$;
GRANT EXECUTE ON FUNCTION public.attacher_telephone(uuid, text, text, text, boolean) TO service_role;

-- ── 6. Retrouver une carte par son numéro (caissier) ─────────────────────────
CREATE OR REPLACE FUNCTION public.trouver_carte_par_telephone(p_marchand_id uuid, p_brut text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN public.normaliser_telephone(p_brut) IS NULL THEN jsonb_build_object('ok', false, 'reason', 'numero_invalide')
    ELSE coalesce((
      SELECT jsonb_build_object('ok', true, 'client_id', c.id, 'prenom', c.prenom, 'solde', c.stored_value)
        FROM public.clients c
       WHERE c.marchand_id = p_marchand_id AND c.deleted_at IS NULL
         AND c.telephone_normalise = public.normaliser_telephone(p_brut)),
      jsonb_build_object('ok', false, 'reason', 'introuvable'))
  END
$$;
GRANT EXECUTE ON FUNCTION public.trouver_carte_par_telephone(uuid, text) TO service_role;

-- ── 7. Créer un QR de récupération (caissier), valable 10 minutes ───────────
CREATE OR REPLACE FUNCTION public.creer_recuperation(
  p_marchand_id uuid, p_client_id uuid, p_point_de_vente_id uuid, p_role text, p_jeton_hash text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_expire timestamptz := now() + interval '10 minutes';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clients
                  WHERE id = p_client_id AND marchand_id = p_marchand_id AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'carte_introuvable');
  END IF;
  INSERT INTO public.recuperations_carte (marchand_id, client_id, point_de_vente_id, role, jeton_hash, expire_le)
  VALUES (p_marchand_id, p_client_id, p_point_de_vente_id, p_role, p_jeton_hash, v_expire);
  RETURN jsonb_build_object('ok', true, 'expire_le', v_expire);
END $$;
GRANT EXECUTE ON FUNCTION public.creer_recuperation(uuid, uuid, uuid, text, text) TO service_role;

-- ── 8. Ouvrir le QR (page publique du client) ────────────────────────────────
-- Chaque ouverture valable est comptée ; expirée ou inconnue : rien d'écrit.
CREATE OR REPLACE FUNCTION public.ouvrir_recuperation(p_jeton_hash text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT rc.id, rc.expire_le, c.prenom, c.pass_serial_number, m.nom AS marchand, m.langue,
         (p.google_pass_url IS NOT NULL) AS google
    INTO r
    FROM public.recuperations_carte rc
    JOIN public.clients c   ON c.id = rc.client_id AND c.deleted_at IS NULL
    JOIN public.marchands m ON m.id = rc.marchand_id AND m.actif
    LEFT JOIN public.passes p ON p.serial_number = c.pass_serial_number
   WHERE rc.jeton_hash = p_jeton_hash;
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'introuvable');
  END IF;
  IF r.expire_le < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expire');
  END IF;
  UPDATE public.recuperations_carte
     SET ouvertures = ouvertures + 1, ouvert_le = coalesce(ouvert_le, now())
   WHERE id = r.id;
  RETURN jsonb_build_object('ok', true, 'prenom', r.prenom, 'serial', r.pass_serial_number,
                            'marchand', r.marchand, 'langue', r.langue, 'google', r.google);
END $$;
GRANT EXECUTE ON FUNCTION public.ouvrir_recuperation(text) TO service_role;

-- ── 9. Effacement RGPD : les récupérations partent aussi ────────────────────
-- (texte identique à database/rgpd_effacement.sql)
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

  -- 3 bis. Supprimer les récupérations de carte (migration 066)
  delete from recuperations_carte
  where client_id = p_client_id
    and marchand_id = p_marchand_id;

  -- 4. Anonymiser les données personnelles du client (soft delete)
  --    On conserve la ligne pour garder les scans cohérents
  update clients set
    prenom              = '[effacé]',
    email               = null,
    telephone           = null,
    telephone_source    = null,
    telephone_lie_le    = null,
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

COMMIT;

-- Contrôle après exécution (une ligne, attendu : t | t | t, et les deux nombres font 11 à eux deux) :
-- SELECT
--   (SELECT count(*) = 1 FROM pg_proc WHERE proname = 'attacher_telephone')            AS fonctions_ok,
--   (SELECT count(*) = 1 FROM pg_indexes WHERE indexname = 'clients_telephone_unique')  AS index_ok,
--   (SELECT to_regclass('public.recuperations_carte') IS NOT NULL)                      AS table_ok,
--   (SELECT count(*) FROM clients WHERE telephone_normalise IS NOT NULL)                AS numeros_utilisables,
--   (SELECT count(*) FROM clients WHERE coalesce(trim(telephone), '') <> '' AND telephone_normalise IS NULL) AS numeros_illisibles;
