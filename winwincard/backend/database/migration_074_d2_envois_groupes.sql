-- Migration 074 : règle D2 sur les envois GROUPÉS seulement, définie UNE fois
-- (incident Pizz'Amore du 07/11, carte 3FCFE3 ; décisions du pilotage du 07/11)
--
-- POURQUOI. La règle D2 (étape 23, migration 057) retient l'envoi Google d'une
-- carte qui a un jeton Apple sans signal Google (passes.google_ouvert_le). Ce
-- signal n'est pas posé pour tous les porteurs qui ont AUSSI la carte Google
-- (lien direct d'avant le 13/10, ajout après la vérification unique) : leur
-- carte Google n'était plus mise à jour, même au scan. Décision : D2 ne
-- s'applique plus qu'aux envois groupés — campagnes du dashboard, cron (inactive,
-- near_reward, birthday), bascule de thème. Les envois unitaires (scan,
-- parrainage, ajustement, annulation, avis, API ventes et migrations) poussent
-- Google sans condition (code serveur, même livraison).
--
-- CE QUE FAIT LA MIGRATION.
--   1. google_utile(lien, signal, serial) : LA définition de D2, seule copie.
--   2. reserver_relances, campagne_lot_google, theme_lot_google : redéfinies à
--      l'identique de leur dernière version (059, 059, 063), la condition D2
--      remplacée par un appel à google_utile. Mêmes signatures, mêmes droits.
--   3. cartes_google_campagne : supprimée (plus appelée depuis t37 ; elle portait
--      une copie de D2).
--   4. Contrôle en fin de migration : les trois fonctions appellent google_utile
--      et aucune ne porte plus le critère en dur ; sinon arrêt, rien n'est changé.
--
-- COÛT. Aucune table touchée ; quatre fonctions redéfinies, une supprimée.
-- COMPATIBILITÉ. Le code en production n'appelle plus cartes_google_campagne
-- (vérifié : aucun appel dans src/) ; les trois fonctions gardent signature et
-- résultat. À exécuter AVANT le code de cette livraison (le code serveur ne
-- dépend pas de la migration, mais l'ordre « base d'abord » est la règle).
-- Rejouable.
--
-- AVANT D'EXÉCUTER : la requête « empreintes » du bloc VÉRIFICATION, version
-- AVANT, doit rendre les mêmes empreintes que le dépôt (la production n'a pas
-- divergé du dépôt sur ces trois fonctions, passation §3.10).

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 1. La règle D2, une seule fois ──────────────────────────────────────────
-- Une carte reçoit les envois Google GROUPÉS si elle a un lien Google ET (le
-- client a ouvert ce lien ou Google a confirmé la carte — google_ouvert_le —
-- OU aucune carte Apple n'est installée — aucun jeton). Prend les colonnes de la
-- carte déjà lues par l'appelant : aucune relecture de passes.
CREATE OR REPLACE FUNCTION public.google_utile(p_google_pass_url text, p_google_ouvert_le timestamptz, p_serial text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_google_pass_url IS NOT NULL
     AND (p_google_ouvert_le IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM device_tokens d WHERE d.serial_number = p_serial))
$$;
REVOKE ALL ON FUNCTION public.google_utile(text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_utile(text, timestamptz, text) TO service_role;

-- ── 2. Les trois surfaces groupées ──────────────────────────────────────────
-- reserver_relances (dernière version : 059) — cron inactive, near_reward, birthday.
CREATE OR REPLACE FUNCTION public.reserver_relances(
  p_marchand_id uuid, p_type text, p_lot uuid, p_modeles jsonb, p_limite integer,
  p_jours integer DEFAULT NULL, p_min integer DEFAULT NULL, p_max integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_maintenant timestamptz := now();
  v_jour       timestamptz := date_trunc('day',  now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_annee      timestamptz := date_trunc('year', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_mmjj       text        := to_char(now() AT TIME ZONE 'UTC', 'MM-DD');
  v_resultat   jsonb;
BEGIN
  IF p_type IS NULL OR p_type NOT IN ('inactive', 'near_reward', 'birthday') THEN
    RAISE EXCEPTION 'reserver_relances : type inconnu (%)', p_type;
  END IF;
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 1000 THEN
    RAISE EXCEPTION 'reserver_relances : limite hors de [1, 1000] (%)', p_limite;
  END IF;
  IF p_type = 'inactive' AND (p_jours IS NULL OR p_jours < 1) THEN
    RAISE EXCEPTION 'reserver_relances : délai d''inactivité absent';
  END IF;
  IF p_type = 'near_reward' AND (p_min IS NULL OR p_max IS NULL) THEN
    RAISE EXCEPTION 'reserver_relances : zone near_reward absente';
  END IF;

  -- Un seul appel à la fois par marchand, tous types confondus (règle « une par
  -- jour » entre types). L'instruction suivante prend son instantané APRÈS le
  -- verrou : elle voit les réservations de l'appel précédent.
  PERFORM pg_advisory_xact_lock(hashtextextended('relances:' || p_marchand_id::text, 0));

  WITH base AS MATERIALIZED (
    SELECT c.id, c.prenom, c.pass_serial_number AS serial, c.stored_value, c.updated_at,
           -- Règle D2, définition unique (migration 074) : google_utile.
           public.google_utile(p.google_pass_url, p.google_ouvert_le, c.pass_serial_number) AS google
      FROM clients c
      LEFT JOIN passes p ON p.serial_number = c.pass_serial_number AND p.marchand_id = c.marchand_id
     WHERE c.marchand_id = p_marchand_id
       AND c.deleted_at IS NULL
       AND c.visible                      -- vrais clients seulement (migration 059)
       AND c.pass_serial_number IS NOT NULL
       AND (p.google_pass_url IS NOT NULL
            OR EXISTS (SELECT 1 FROM device_tokens d WHERE d.serial_number = c.pass_serial_number))
       AND NOT EXISTS (SELECT 1 FROM workflow_executions w
                        WHERE w.marchand_id = p_marchand_id AND w.client_id = c.id AND w.executed_at >= v_jour)
       AND (p_type <> 'birthday'    OR to_char(c.date_anniversaire, 'MM-DD') = v_mmjj)
       AND (p_type <> 'near_reward' OR (c.stored_value >= p_min AND c.stored_value < p_max))
       AND (p_type <> 'inactive'    OR NOT EXISTS (
             SELECT 1 FROM scans s
              WHERE s.marchand_id = p_marchand_id AND s.client_id = c.id AND s.annule_le IS NULL
                AND s.date_scan >= v_maintenant - make_interval(days => p_jours)))
  ), cand AS MATERIALIZED (
    SELECT b.* FROM base b
     WHERE CASE p_type
       WHEN 'birthday' THEN NOT EXISTS (
         SELECT 1 FROM workflow_executions w
          WHERE w.workflow_type = 'birthday' AND w.client_id = b.id AND w.executed_at >= v_annee)
       WHEN 'near_reward' THEN NOT EXISTS (
         SELECT 1 FROM workflow_executions w
          WHERE w.workflow_type = 'near_reward' AND w.client_id = b.id AND w.executed_at >= b.updated_at)
       ELSE EXISTS (
         -- Dernier scan non annulé : il doit exister (jamais scanné = exclu) et
         -- aucune relance ne doit l'avoir suivi.
         SELECT 1 FROM (SELECT max(s.date_scan) AS dernier FROM scans s
                         WHERE s.client_id = b.id AND s.annule_le IS NULL) l
          WHERE l.dernier IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM workflow_executions w
                             WHERE w.workflow_type = 'inactive' AND w.client_id = b.id AND w.executed_at > l.dernier))
     END
  ), elus AS MATERIALIZED (
    SELECT * FROM cand ORDER BY id LIMIT p_limite
  ), textes AS MATERIALIZED (
    SELECT e.*,
           replace(COALESCE(
             CASE WHEN p_type = 'near_reward' THEN p_modeles ->> (p_max - e.stored_value)::text END,
             p_modeles ->> '*'), '{prenom}', COALESCE(e.prenom, '')) AS message
      FROM elus e
  ), inscription AS (
    INSERT INTO workflow_executions (workflow_type, client_id, marchand_id, lot)
    SELECT p_type, id, p_marchand_id, p_lot FROM elus
  ), carte AS (
    UPDATE passes p SET notification_message = t.message
      FROM textes t
     WHERE p.serial_number = t.serial AND p.marchand_id = p_marchand_id
  )
  SELECT jsonb_build_object(
    'eligibles', (SELECT count(*) FROM cand),
    'clients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'client_id', t.id, 'serial', t.serial, 'message', t.message, 'google', t.google,
               'jetons', COALESCE((SELECT jsonb_agg(d.push_token ORDER BY d.id)
                                     FROM device_tokens d WHERE d.serial_number = t.serial), '[]'::jsonb))
             ORDER BY t.id)
        FROM textes t), '[]'::jsonb))
  INTO v_resultat;

  RETURN v_resultat;
END;
$$;

-- campagne_lot_google (dernière version : 059) — campagnes du dashboard.
CREATE OR REPLACE FUNCTION public.campagne_lot_google(p_campagne_id uuid, p_apres uuid, p_limite integer)
RETURNS TABLE (id uuid, serial_number text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.id, p.serial_number
    FROM campagnes k
    JOIN passes p ON p.marchand_id = k.marchand_id
    JOIN clients c ON c.pass_serial_number = p.serial_number AND c.visible AND c.deleted_at IS NULL
   WHERE k.id = p_campagne_id
     AND (p_apres IS NULL OR p.id > p_apres)
     -- Règle D2, définition unique (migration 074) : google_utile.
     AND public.google_utile(p.google_pass_url, p.google_ouvert_le, p.serial_number)
     AND client_dans_segment(c.id, k.marchand_id, k.segment, k.cree_le)
   ORDER BY p.id
   LIMIT LEAST(GREATEST(p_limite, 1), 1000);
$$;

-- theme_lot_google (dernière version : 063) — bascule de thème.
CREATE OR REPLACE FUNCTION public.theme_lot_google(p_marchand_id uuid, p_apres uuid, p_limite integer)
RETURNS TABLE (id uuid, serial_number text, prenom text, stored_value integer)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.id, p.serial_number, c.prenom, c.stored_value
    FROM passes p
    JOIN clients c ON c.pass_serial_number = p.serial_number AND c.visible AND c.deleted_at IS NULL
   WHERE p.marchand_id = p_marchand_id
     AND (p_apres IS NULL OR p.id > p_apres)
     -- Règle D2, définition unique (migration 074) : google_utile.
     AND public.google_utile(p.google_pass_url, p.google_ouvert_le, p.serial_number)
   ORDER BY p.id
   LIMIT LEAST(GREATEST(p_limite, 1), 1000);
$$;

REVOKE ALL ON FUNCTION public.reserver_relances(uuid, text, uuid, jsonb, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserver_relances(uuid, text, uuid, jsonb, integer, integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.campagne_lot_google(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campagne_lot_google(uuid, uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.theme_lot_google(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.theme_lot_google(uuid, uuid, integer) TO service_role;

-- ── 3. La fonction morte, et sa copie de D2 ─────────────────────────────────
DROP FUNCTION IF EXISTS public.cartes_google_campagne(uuid, uuid, integer);

COMMENT ON COLUMN public.passes.google_ouvert_le IS
  'Le client a ouvert le lien Google Wallet (ou la vérification unique a trouvé une carte Google). Règle D2 (google_utile, migration 074) : ne sert qu''aux envois GROUPÉS ; les envois unitaires poussent Google sans condition.';

-- ── 4. Contrôle : une seule définition ──────────────────────────────────────
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('reserver_relances', 'campagne_lot_google', 'theme_lot_google')
     AND prosrc LIKE '%google_utile(%' AND prosrc NOT LIKE '%google_ouvert_le IS NOT NULL%';
  IF n <> 3 THEN
    RAISE EXCEPTION 'migration 074 arrêtée : % fonction(s) groupée(s) sur 3 appellent google_utile sans copie du critère', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'cartes_google_campagne') THEN
    RAISE EXCEPTION 'migration 074 arrêtée : cartes_google_campagne existe encore';
  END IF;
END $$;

COMMIT;

-- ── VÉRIFICATION ─────────────────────────────────────────────────────────
-- AVANT (lecture seule) : empreintes des trois fonctions, à comparer à celles du
-- dépôt données avec la livraison ; et la fonction morte existe.
-- SELECT proname, md5(prosrc) FROM pg_proc
--  WHERE pronamespace = 'public'::regnamespace
--    AND proname IN ('reserver_relances', 'campagne_lot_google', 'theme_lot_google', 'cartes_google_campagne')
--  ORDER BY proname;
--
-- APRÈS : une ligne, attendu true | true | true
-- SELECT
--   (SELECT count(*) = 1 FROM pg_proc WHERE proname = 'google_utile')                         AS regle_ok,
--   (SELECT count(*) = 3 FROM pg_proc WHERE proname IN ('reserver_relances', 'campagne_lot_google', 'theme_lot_google')
--       AND prosrc LIKE '%google_utile(%' AND prosrc NOT LIKE '%google_ouvert_le IS NOT NULL%') AS surfaces_ok,
--   (SELECT count(*) = 0 FROM pg_proc WHERE proname = 'cartes_google_campagne')               AS morte_supprimee;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- Code d'abord si besoin, puis rejouer les définitions de 059 (reserver_relances,
-- campagne_lot_google, cartes_google_campagne) et 063 (theme_lot_google) : elles
-- portent le critère en dur, sans google_utile.
