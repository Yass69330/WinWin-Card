-- Migration 054 : campagnes envoyées par lots (étape t37, rythme d'envoi)
--
-- POURQUOI. Une campagne envoyait tous ses pushes d'un coup, dans la requête du
-- marchand (écran bloqué 52 s), plafonnée à 1 000 appareils par la lecture, et
-- sans trace avant la fin : un redéploiement perdait le reste, sans quota
-- compté. Vers 1 000 iPhone, leurs retours créaient une file dans l'API de
-- données de Supabase (scans jusqu'à 154 s, étape 15).
--
-- CE QUE FAIT LA MIGRATION.
--   - Table `campagnes` : une ligne par campagne, avec son avancement (dernier
--     appareil Apple et dernière carte Google traités). Le serveur envoie lot par
--     lot et reprend au curseur après un redémarrage.
--   - Une seule campagne EN COURS par marchand : index unique partiel. Un second
--     clic est refusé.
--   - `lancer_campagne` : en UNE transaction, contrôle du quota du mois, ligne
--     `notification_logs` (le quota est compté au clic) et ligne `campagnes`.
--   - `avancer_campagne` : en UNE requête, curseurs, fin de voie, compteurs de
--     `notification_logs` (ce que lit déjà l'historique du dashboard).
--   - `reprendre_campagnes` : au démarrage du serveur (une fois, après un délai),
--     prend les campagnes en cours que plus personne ne fait avancer.
--
-- VOLUME : une ligne par campagne (quota de 5 à 20 par mois et par marchand).
-- Aucune purge.
--
-- DROITS. Table : RLS active sans policy, GRANT à service_role seulement.
-- Fonctions : REVOKE à PUBLIC, anon, authenticated ; EXECUTE à service_role.
--
-- À exécuter dans Supabase AVANT de déployer le code t37. Sans elle, le clic
-- « envoyer » répond 500 (fonction absente) et rien ne part. Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.campagnes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  marchand_id         uuid        NOT NULL REFERENCES public.marchands (id) ON DELETE CASCADE,
  notification_log_id uuid        REFERENCES public.notification_logs (id) ON DELETE SET NULL,
  message             text        NOT NULL,
  statut              text        NOT NULL DEFAULT 'en_cours'
                      CONSTRAINT campagnes_statut_check CHECK (statut IN ('en_cours', 'terminee', 'interrompue')),
  cree_le             timestamptz NOT NULL DEFAULT now(),
  -- Dernière écriture d'avancement : une campagne « en cours » dont maj_le est
  -- ancien n'est plus suivie par personne (serveur arrêté ou planté).
  maj_le              timestamptz NOT NULL DEFAULT now(),
  fin_le              timestamptz,
  -- Curseurs : dernier device_tokens.id et dernier passes.id traités (parcours
  -- par identifiant croissant). NULL = rien de traité.
  curseur_apple       uuid,
  curseur_google      uuid,
  apple_fini          boolean     NOT NULL DEFAULT false,
  google_fini         boolean     NOT NULL DEFAULT false,
  instance            text
);

CREATE UNIQUE INDEX IF NOT EXISTS campagnes_une_en_cours
  ON public.campagnes (marchand_id) WHERE statut = 'en_cours';

COMMENT ON TABLE public.campagnes IS
  'Campagnes de notifications envoyées par lots (t37) : avancement, reprise après redémarrage, une seule en cours par marchand.';

ALTER TABLE public.campagnes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.campagnes TO service_role;

-- ── lancer_campagne ─────────────────────────────────────────────────────────
-- Rend { ok: true, campagne_id, used } ; ou { ok: false, reason: 'quota', used }
-- ; ou { ok: false, reason: 'en_cours' }. Le début du mois est fourni par le
-- serveur (même calcul qu'avant, notifications.js).
CREATE OR REPLACE FUNCTION public.lancer_campagne(
  p_marchand_id uuid, p_message text, p_limite integer, p_debut_mois timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_used   integer;
  v_log_id uuid;
  v_id     uuid;
BEGIN
  SELECT count(*) INTO v_used
    FROM notification_logs
   WHERE marchand_id = p_marchand_id AND created_at >= p_debut_mois;
  IF v_used >= p_limite THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quota', 'used', v_used);
  END IF;

  BEGIN
    INSERT INTO notification_logs (marchand_id, message)
    VALUES (p_marchand_id, p_message)
    RETURNING id INTO v_log_id;

    INSERT INTO campagnes (marchand_id, notification_log_id, message)
    VALUES (p_marchand_id, v_log_id, p_message)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Une campagne est déjà en cours pour ce marchand : rien n'est écrit (les
    -- deux insertions du bloc sont annulées), le quota n'est pas compté.
    RETURN jsonb_build_object('ok', false, 'reason', 'en_cours');
  END;

  RETURN jsonb_build_object('ok', true, 'campagne_id', v_id, 'used', v_used + 1);
END;
$$;

-- ── avancer_campagne ────────────────────────────────────────────────────────
-- Curseur NULL = inchangé. Les compteurs s'AJOUTENT à ceux de notification_logs.
-- La campagne passe à 'terminee' quand ses deux voies sont finies. Rend le statut.
CREATE OR REPLACE FUNCTION public.avancer_campagne(
  p_campagne_id uuid,
  p_curseur_apple uuid, p_curseur_google uuid,
  p_apple_fini boolean, p_google_fini boolean,
  p_envoyes_apple integer, p_total_apple integer,
  p_envoyes_google integer, p_total_google integer
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_statut text;
  v_log_id uuid;
BEGIN
  UPDATE campagnes SET
    curseur_apple  = COALESCE(p_curseur_apple, curseur_apple),
    curseur_google = COALESCE(p_curseur_google, curseur_google),
    apple_fini     = apple_fini  OR COALESCE(p_apple_fini, false),
    google_fini    = google_fini OR COALESCE(p_google_fini, false),
    maj_le         = now()
  WHERE id = p_campagne_id
  RETURNING notification_log_id INTO v_log_id;

  UPDATE campagnes SET statut = 'terminee', fin_le = now()
   WHERE id = p_campagne_id AND statut = 'en_cours' AND apple_fini AND google_fini;

  IF COALESCE(p_envoyes_apple, 0) <> 0 OR COALESCE(p_total_apple, 0) <> 0
     OR COALESCE(p_envoyes_google, 0) <> 0 OR COALESCE(p_total_google, 0) <> 0 THEN
    UPDATE notification_logs SET
      envoyes_apple  = envoyes_apple  + COALESCE(p_envoyes_apple, 0),
      total_apple    = total_apple    + COALESCE(p_total_apple, 0),
      envoyes_google = envoyes_google + COALESCE(p_envoyes_google, 0),
      total_google   = total_google   + COALESCE(p_total_google, 0)
    WHERE id = v_log_id;
  END IF;

  SELECT statut INTO v_statut FROM campagnes WHERE id = p_campagne_id;
  RETURN v_statut;
END;
$$;

-- ── reprendre_campagnes ─────────────────────────────────────────────────────
-- Prend (instance, maj_le) les campagnes en cours sans avancement depuis
-- p_inactif_depuis, et les rend. Atomique : deux serveurs ne prennent jamais la
-- même campagne.
CREATE OR REPLACE FUNCTION public.reprendre_campagnes(p_instance text, p_inactif_depuis interval)
RETURNS SETOF public.campagnes
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE campagnes SET instance = p_instance, maj_le = now()
   WHERE statut = 'en_cours' AND maj_le < now() - p_inactif_depuis
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.lancer_campagne(uuid, text, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lancer_campagne(uuid, text, integer, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.avancer_campagne(uuid, uuid, uuid, boolean, boolean, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avancer_campagne(uuid, uuid, uuid, boolean, boolean, integer, integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.reprendre_campagnes(text, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reprendre_campagnes(text, interval) TO service_role;

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Les cinq colonnes doivent valoir true.
--
-- SELECT
--   to_regclass('public.campagnes') IS NOT NULL                                   AS table_ok,
--   has_table_privilege('service_role', 'public.campagnes', 'INSERT')
--     AND has_table_privilege('service_role', 'public.campagnes', 'UPDATE')        AS droits_ok,
--   to_regclass('public.campagnes_une_en_cours') IS NOT NULL                       AS index_ok,
--   has_function_privilege('service_role', 'public.lancer_campagne(uuid,text,integer,timestamptz)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.lancer_campagne(uuid,text,integer,timestamptz)', 'EXECUTE') AS fonctions_ok,
--   (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.campagnes'::regclass) AS rls_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- À n'exécuter QU'APRÈS avoir remis le code en arrière.
--
-- DROP FUNCTION IF EXISTS public.reprendre_campagnes(text, interval);
-- DROP FUNCTION IF EXISTS public.avancer_campagne(uuid, uuid, uuid, boolean, boolean, integer, integer, integer, integer);
-- DROP FUNCTION IF EXISTS public.lancer_campagne(uuid, text, integer, timestamptz);
-- DROP TABLE IF EXISTS public.campagnes;
