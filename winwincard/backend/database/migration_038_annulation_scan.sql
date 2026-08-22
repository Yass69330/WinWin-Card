-- Migration 038 : annulation du dernier scan d'un client (étape 5)
--
-- Deux objets, indissociables (la fonction écrit la colonne) :
--   1. scans.annule_le (timestamptz, nullable) — marquage. NULL = scan actif ;
--      renseigné = scan annulé. On MARQUE, on ne supprime pas (trace conservée).
--   2. annuler_scan(uuid, uuid) — inversion ATOMIQUE du dernier scan d'un client.
--
-- Règles gravées :
--   • SIGNATURE UNIQUE ET DÉFINITIVE : annuler_scan(p_scan_id uuid, p_marchand_id
--     uuid) RETURNS jsonb. Jamais de variante de longueur différente (§3.3).
--   • NE TOUCHE PAS increment_stored_value. Fonction séparée, verrou par carte
--     propre (SELECT … FOR UPDATE sur clients), comme le RPC de scan mais en sens
--     inverse. L'argent des clients reste protégé par le même motif.
--
-- Sémantique de l'annulation :
--   • Cible le scan actif LE PLUS RÉCENT DU CLIENT (pas de la boutique) — le solde
--     est par client, seule sa chaîne compte. Répétable (déroule plusieurs scans).
--   • Restaure clients.stored_value à scan.stored_value_avant (inversion exacte,
--     vraie même sur un scan de récompense/reset car avant est stocké).
--   • Trois garde-fous → refus (ok=false) sans rien modifier :
--       - le scan n'est pas le plus récent actif du client  → 'pas_le_dernier'
--       - le solde courant ≠ scan.stored_value_apres          → 'solde_incoherent'
--       - déjà annulé / introuvable / mauvais marchand        → 'deja_annule' / 'introuvable'
--   • Renvoie le serial pour que le code rafraîchisse le pass après coup.
--
-- Colonne nullable, aucun GRANT requis (scans/clients déjà accordés ; GRANT
-- EXECUTE explicite sur la fonction, miroir de group_stats). Rejouable.
-- À exécuter dans Supabase. Le filtre group_stats (annule_le IS NULL) est une
-- migration séparée (039), à jouer après celle-ci.

ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS annule_le timestamptz;

CREATE OR REPLACE FUNCTION public.annuler_scan(p_scan_id uuid, p_marchand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_scan         scans%ROWTYPE;
  v_solde_actuel integer;
  v_serial       text;
  v_plus_recent  uuid;
BEGIN
  -- Charger le scan cible, scopé au marchand.
  SELECT * INTO v_scan FROM scans WHERE id = p_scan_id AND marchand_id = p_marchand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'introuvable');
  END IF;
  IF v_scan.annule_le IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'deja_annule');
  END IF;

  -- Verrou par carte : sérialise contre un scan concurrent sur le même client.
  SELECT stored_value, pass_serial_number INTO v_solde_actuel, v_serial
  FROM clients WHERE id = v_scan.client_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'client_introuvable');
  END IF;

  -- Doit être le scan actif le plus récent de CE client.
  SELECT id INTO v_plus_recent
  FROM scans
  WHERE client_id = v_scan.client_id AND annule_le IS NULL
  ORDER BY date_scan DESC, id DESC
  LIMIT 1;
  IF v_plus_recent IS DISTINCT FROM p_scan_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pas_le_dernier');
  END IF;

  -- Intégrité : le solde courant doit correspondre à l'après du scan (sinon
  -- quelque chose a bougé entre-temps → on refuse plutôt que d'inverser à l'aveugle).
  IF v_solde_actuel IS DISTINCT FROM v_scan.stored_value_apres THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'solde_incoherent');
  END IF;

  -- Inversion : restaurer le solde d'avant, marquer le scan annulé.
  UPDATE clients SET stored_value = v_scan.stored_value_avant WHERE id = v_scan.client_id;
  UPDATE scans   SET annule_le = now() WHERE id = p_scan_id;

  RETURN jsonb_build_object(
    'ok', true,
    'client_id',    v_scan.client_id,
    'serial',       v_serial,
    'stored_value', v_scan.stored_value_avant
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.annuler_scan(uuid, uuid) TO service_role;
