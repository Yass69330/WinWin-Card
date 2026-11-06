-- Migration 075 : connexion d'un marchand à Hubrise (H1, go du pilotage du 06/11 ;
-- cadrage docs/hubrise/02-h1-connexion.md)
--
-- POURQUOI. Un marchand français relie sa location Hubrise à WinWin (OAuth). On
-- garde son jeton Hubrise CHIFFRÉ (AES-256-GCM, clé dans Railway, jamais en base)
-- pour, ensuite, recevoir ses ventes (H1b) puis créditer (H2).
--
-- CE QUE FAIT LA MIGRATION.
--   1. hubrise_connexions : une ligne par connexion (marchand ↔ location Hubrise),
--      jeton chiffré, coupure tracée. Une location ACTIVE n'appartient qu'à un seul
--      marchand (index unique partiel).
--   2. hubrise_liens_utilises : usage unique des liens de connexion (anti-rejeu).
--   3. hubrise_evenements : journal des callbacks reçus, SANS donnée personnelle
--      (rempli à partir de H1b).
--   4. hubrise_enregistrer_connexion, hubrise_couper_connexion : écriture atomique.
-- Les trois tables : RLS active sans politique, droits à service_role seul (le
-- serveur). Rien de personnel : identifiants techniques Hubrise, dates, statuts.
--
-- NUMÉRO. 075 : écrite sous le n° 074 le 06/11, renumérotée le 07/11 (décision du
-- pilotage) car le correctif D2 de l'incident Pizz'Amore a pris le 074 (exécutée le
-- 07/11). La migration H0 « téléphone selon le pays », gelée sur la branche
-- briques/h0-telephone-pays sous le n° 074 sans
-- avoir été exécutée, prendra le numéro suivant à sa reprise.
-- COÛT. Trois tables neuves ; aucune table existante n'est touchée.
-- COMPATIBILITÉ. L'ancien code ignore ces tables. À exécuter AVANT le code de H1.
-- Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 1. Les connexions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hubrise_connexions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  marchand_id          uuid        NOT NULL REFERENCES public.marchands(id) ON DELETE CASCADE,
  point_de_vente_id    uuid        REFERENCES public.points_de_vente(id) ON DELETE SET NULL,
  account_id           text        NOT NULL CHECK (length(account_id) BETWEEN 1 AND 64),
  location_id          text        NOT NULL CHECK (length(location_id) BETWEEN 1 AND 64),
  customer_list_id     text        CHECK (customer_list_id IS NULL OR length(customer_list_id) <= 64),
  nom_location         text        CHECK (nom_location IS NULL OR length(nom_location) <= 200),
  scope                text        NOT NULL CHECK (length(scope) <= 200),
  -- 'v1:<iv>:<étiquette>:<texte chiffré>' (base64) ; NULL une fois la connexion coupée.
  jeton_chiffre        text        CHECK (jeton_chiffre IS NULL OR jeton_chiffre ~ '^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'),
  callback_id          text,
  cree_le              timestamptz NOT NULL DEFAULT now(),
  coupee_le            timestamptz,
  coupee_par           text        CHECK (coupee_par IN ('winwin', 'hubrise')),
  dernier_evenement_le timestamptz,
  CONSTRAINT hubrise_connexions_coupure_coherente CHECK ((coupee_le IS NULL) = (coupee_par IS NULL)),
  CONSTRAINT hubrise_connexions_active_a_un_jeton CHECK (coupee_le IS NOT NULL OR jeton_chiffre IS NOT NULL)
);
-- Une location Hubrise = un seul marchand, tant que la connexion est active.
CREATE UNIQUE INDEX IF NOT EXISTS hubrise_connexions_location_active
  ON public.hubrise_connexions (location_id) WHERE coupee_le IS NULL;
CREATE INDEX IF NOT EXISTS idx_hubrise_connexions_marchand ON public.hubrise_connexions (marchand_id);
ALTER TABLE public.hubrise_connexions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hubrise_connexions TO service_role;

-- ── 2. Usage unique des liens de connexion ───────────────────────────────────
-- Le lien vit 30 minutes ; une ligne de plus d'un jour ne sert plus à rien
-- (purge possible, non automatisée en H1).
CREATE TABLE IF NOT EXISTS public.hubrise_liens_utilises (
  nonce       uuid        PRIMARY KEY,
  marchand_id uuid        NOT NULL REFERENCES public.marchands(id) ON DELETE CASCADE,
  utilise_le  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hubrise_liens_utilises ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hubrise_liens_utilises TO service_role;

-- ── 3. Journal des callbacks (H1b), sans donnée personnelle ──────────────────
CREATE TABLE IF NOT EXISTS public.hubrise_evenements (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  connexion_id    uuid        REFERENCES public.hubrise_connexions(id) ON DELETE SET NULL,
  marchand_id     uuid        REFERENCES public.marchands(id) ON DELETE SET NULL,
  location_id     text,
  order_id        text,
  evenement       text,
  statut_commande text,
  decision        text        NOT NULL,
  recu_le         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hubrise_evenements_marchand ON public.hubrise_evenements (marchand_id, recu_le DESC);
ALTER TABLE public.hubrise_evenements ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hubrise_evenements TO service_role;

-- ── 4. Enregistrer une connexion (retour OAuth) ──────────────────────────────
-- Atomique, sous un verrou par location. Refus « location_prise » si la location
-- est active chez un AUTRE marchand (rien écrit). Même marchand, même location :
-- l'ancienne connexion est coupée (jeton effacé), la nouvelle la remplace.
CREATE OR REPLACE FUNCTION public.hubrise_enregistrer_connexion(
  p_marchand_id uuid, p_account_id text, p_location_id text, p_customer_list_id text,
  p_nom_location text, p_scope text, p_jeton_chiffre text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_autre  uuid;
  v_id     uuid;
  v_remplace boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('hubrise_location:' || p_location_id));
  IF NOT EXISTS (SELECT 1 FROM public.marchands WHERE id = p_marchand_id AND actif) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'marchand_introuvable');
  END IF;
  SELECT marchand_id INTO v_autre FROM public.hubrise_connexions
   WHERE location_id = p_location_id AND coupee_le IS NULL;
  IF FOUND AND v_autre <> p_marchand_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'location_prise');
  END IF;
  IF FOUND THEN
    UPDATE public.hubrise_connexions
       SET coupee_le = now(), coupee_par = 'winwin', jeton_chiffre = NULL
     WHERE location_id = p_location_id AND coupee_le IS NULL;
    v_remplace := true;
  END IF;
  INSERT INTO public.hubrise_connexions (marchand_id, account_id, location_id, customer_list_id,
                                         nom_location, scope, jeton_chiffre)
  VALUES (p_marchand_id, p_account_id, p_location_id, p_customer_list_id,
          left(p_nom_location, 200), p_scope, p_jeton_chiffre)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'connexion_id', v_id, 'remplace', v_remplace);
END $$;
REVOKE ALL ON FUNCTION public.hubrise_enregistrer_connexion(uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hubrise_enregistrer_connexion(uuid, text, text, text, text, text, text) TO service_role;

-- ── 5. Couper une connexion ─────────────────────────────────────────────────
-- Efface le jeton et rend, UNE fois, son texte chiffré (pour la révocation chez
-- Hubrise, au mieux). Déjà coupée : « deja_coupee », rien rendu.
CREATE OR REPLACE FUNCTION public.hubrise_couper_connexion(p_connexion_id uuid, p_par text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  IF p_par NOT IN ('winwin', 'hubrise') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'par_invalide');
  END IF;
  SELECT id, marchand_id, location_id, jeton_chiffre, coupee_le INTO r
    FROM public.hubrise_connexions WHERE id = p_connexion_id FOR UPDATE;
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'introuvable');
  END IF;
  IF r.coupee_le IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'deja_coupee', true);
  END IF;
  UPDATE public.hubrise_connexions
     SET coupee_le = now(), coupee_par = p_par, jeton_chiffre = NULL
   WHERE id = p_connexion_id;
  RETURN jsonb_build_object('ok', true, 'deja_coupee', false, 'marchand_id', r.marchand_id,
                            'location_id', r.location_id, 'jeton_chiffre', r.jeton_chiffre);
END $$;
REVOKE ALL ON FUNCTION public.hubrise_couper_connexion(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hubrise_couper_connexion(uuid, text) TO service_role;

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Une ligne. Attendu : true | true | true | true | 0
--
-- SELECT
--   (SELECT to_regclass('public.hubrise_connexions') IS NOT NULL
--       AND to_regclass('public.hubrise_liens_utilises') IS NOT NULL
--       AND to_regclass('public.hubrise_evenements') IS NOT NULL)                       AS tables_ok,
--   (SELECT count(*) = 1 FROM pg_indexes WHERE indexname = 'hubrise_connexions_location_active') AS index_ok,
--   (SELECT bool_and(relrowsecurity) FROM pg_class
--     WHERE oid IN ('public.hubrise_connexions'::regclass, 'public.hubrise_liens_utilises'::regclass,
--                   'public.hubrise_evenements'::regclass))                             AS rls_ok,
--   (SELECT count(*) = 2 FROM pg_proc WHERE proname IN ('hubrise_enregistrer_connexion', 'hubrise_couper_connexion')) AS fonctions_ok,
--   (SELECT count(*) FROM hubrise_connexions)                                           AS connexions;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- Code d'abord. Puis, si aucune connexion ne doit être gardée :
-- DROP FUNCTION public.hubrise_couper_connexion(uuid, text);
-- DROP FUNCTION public.hubrise_enregistrer_connexion(uuid, text, text, text, text, text, text);
-- DROP TABLE public.hubrise_evenements, public.hubrise_liens_utilises, public.hubrise_connexions;
