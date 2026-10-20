-- Migration 066 : API des caisses, étape 1 — le socle d'accès
-- (contrat docs/api/03-contrat-api-v1.md v1.0, validé par le pilotage le 20/10)
--
-- POURQUOI. Les caisses des commerçants (Black Tulip d'abord) appelleront
-- /api/v1 avec une clé propre au commerçant. Cette étape pose la clé, les
-- réglages de conversion et les colonnes de journal ; aucune route de crédit
-- n'existe encore (étape 2).
--
-- CE QUE FAIT LA MIGRATION.
--   - api_cles : clés d'API, une ou plusieurs par commerçant (rotation : on en
--     crée une nouvelle, puis on révoque l'ancienne). Seule l'EMPREINTE (sha256)
--     est gardée, jamais la clé ; le préfixe sert au support.
--   - verifier_cle_api : la vérification en un aller (clé valable, non révoquée,
--     commerçant actif) ; note la dernière utilisation au plus une fois par minute.
--   - marchands.fils_par_point (défaut 100 = 1 point par AED) et
--     marchands.plafond_vente_fils (défaut 5 000 000 = 50 000 AED) ;
--   - scans.canal ('comptoir' pour tout l'existant, 'caisse' pour l'API),
--     scans.reference_externe, scans.montant_fils, scans.vendu_le (remplis par
--     l'API à l'étape 2 ; rien ne les écrit encore).
--
-- COÛT. Colonnes ajoutées sans réécriture (valeur par défaut constante,
-- PostgreSQL 11+) ; le contrôle de `canal` est posé NOT VALID puis validé, ce
-- qui ne bloque pas les écritures pendant la vérification. La table clients
-- n'est pas touchée.
-- COMPATIBILITÉ. L'ancien code ignore table, colonnes et fonction ; le scan
-- écrit 'comptoir' par défaut. À exécuter AVANT le code. Rejouable.
--
-- NUMÉRO. La migration « téléphone » (branche briques/f04-telephone, qui portait
-- le n° 066 sans avoir été exécutée) prendra le n° suivant à son étape.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 1. Clés d'API ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_cles (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  marchand_id             uuid        NOT NULL REFERENCES public.marchands(id) ON DELETE CASCADE,
  environnement           text        NOT NULL CHECK (environnement IN ('live', 'test')),
  prefixe                 text        NOT NULL,
  empreinte               text        NOT NULL UNIQUE CHECK (empreinte ~ '^[0-9a-f]{64}$'),
  cree_le                 timestamptz NOT NULL DEFAULT now(),
  revoquee_le             timestamptz,
  derniere_utilisation_le timestamptz
);
CREATE INDEX IF NOT EXISTS idx_api_cles_marchand ON public.api_cles (marchand_id);
ALTER TABLE public.api_cles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_cles TO service_role;

-- Vérification d'une clé présentée (son empreinte). Un seul aller : clé connue,
-- non révoquée, commerçant actif. La date de dernière utilisation n'est écrite
-- qu'une fois par minute au plus (le serveur garde la réponse 60 s en cache).
CREATE OR REPLACE FUNCTION public.verifier_cle_api(p_empreinte text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT k.id, k.marchand_id, k.environnement, k.revoquee_le, m.actif
    INTO r
    FROM public.api_cles k JOIN public.marchands m ON m.id = k.marchand_id
   WHERE k.empreinte = p_empreinte;
  IF r.id IS NULL OR r.revoquee_le IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cle_invalide');
  END IF;
  IF NOT r.actif THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'commercant_suspendu');
  END IF;
  UPDATE public.api_cles SET derniere_utilisation_le = now()
   WHERE id = r.id AND (derniere_utilisation_le IS NULL OR derniere_utilisation_le < now() - interval '1 minute');
  RETURN jsonb_build_object('ok', true, 'cle_id', r.id, 'marchand_id', r.marchand_id, 'environnement', r.environnement);
END $$;
GRANT EXECUTE ON FUNCTION public.verifier_cle_api(text) TO service_role;

-- ── 2. Réglages de conversion, par commerçant ────────────────────────────────
-- points = arrondi_inférieur(montant en fils ÷ fils_par_point). 100 = 1 point par
-- AED ; 50 = 2 points par AED ; 1000 = 1 point pour 10 AED.
ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS fils_par_point integer NOT NULL DEFAULT 100;
ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS plafond_vente_fils integer NOT NULL DEFAULT 5000000;
ALTER TABLE public.marchands DROP CONSTRAINT IF EXISTS marchands_fils_par_point_check;
ALTER TABLE public.marchands ADD CONSTRAINT marchands_fils_par_point_check
  CHECK (fils_par_point BETWEEN 1 AND 10000000);
ALTER TABLE public.marchands DROP CONSTRAINT IF EXISTS marchands_plafond_vente_fils_check;
ALTER TABLE public.marchands ADD CONSTRAINT marchands_plafond_vente_fils_check
  CHECK (plafond_vente_fils BETWEEN 100 AND 1000000000);

-- ── 3. Journal des scans : canal, référence de vente, montant ────────────────
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT 'comptoir';
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS reference_externe text;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS montant_fils integer;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS vendu_le timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scans_canal_check' AND conrelid = 'public.scans'::regclass) THEN
    ALTER TABLE public.scans ADD CONSTRAINT scans_canal_check CHECK (canal IN ('comptoir', 'caisse')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scans_montant_fils_check' AND conrelid = 'public.scans'::regclass) THEN
    ALTER TABLE public.scans ADD CONSTRAINT scans_montant_fils_check CHECK (montant_fils IS NULL OR montant_fils > 0) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.scans VALIDATE CONSTRAINT scans_canal_check;
ALTER TABLE public.scans VALIDATE CONSTRAINT scans_montant_fils_check;

COMMIT;

-- Contrôle après exécution (une ligne, attendu : t | t | t | 0) :
-- SELECT
--   (SELECT to_regclass('public.api_cles') IS NOT NULL)                                AS table_ok,
--   (SELECT count(*) = 1 FROM pg_proc WHERE proname = 'verifier_cle_api')              AS fonction_ok,
--   (SELECT count(*) = 2 FROM information_schema.columns
--     WHERE table_name = 'marchands' AND column_name IN ('fils_par_point', 'plafond_vente_fils')) AS reglages_ok,
--   (SELECT count(*) FROM scans WHERE canal <> 'comptoir')                             AS scans_hors_comptoir;
