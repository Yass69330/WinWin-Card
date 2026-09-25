-- Migration 047 : workflow « avis Google » (chantier avis + ouverture Pro)
--
-- DEUX CHOSES, indissociables : la colonne de configuration et l'élargissement
-- du CHECK du registre. Le code refuserait de tracer un envoi 'avis' tant que
-- la contrainte ne l'accepte pas — et comme le registre ne bloque jamais un
-- envoi (migration 046), la notification partirait sans laisser de trace.
--
-- 1) marchands.lien_avis_google
--    C'EST L'INTERRUPTEUR, et le seul. Vide ou NULL → pas de lien au dos de la
--    carte ET pas de notification. Aucun booléen séparé : un réglage de moins
--    à désynchroniser. Saisi dans le formulaire admin, jamais par SQL brut.
--    Longueur bornée à 500 : une URL Google Maps de partage tient largement.
--    Forme contrôlée côté code (http/https) ; la base borne la longueur, elle
--    ne valide pas l'URL — une URL syntaxiquement correcte mais fausse resterait
--    acceptée, c'est au marchand de la vérifier.
--
-- 2) CHECK notification_envois.source élargi à 'avis'
--    Neuvième valeur. Même patron d'introspection que les migrations 040 et 043 :
--    on ne présume JAMAIS du nom de la contrainte, on retire par introspection
--    toute contrainte CHECK portant sur `source`. La 046 l'a créée en ligne,
--    donc son nom est auto-généré.
--
-- GARDE-FOU : si `source` contient une valeur hors des neuf attendues, la
-- migration lève et la transaction entière est annulée. Tout ou rien.
--
-- AUCUN GRANT nécessaire : une colonne ajoutée à une table existante et une
-- contrainte remplacée ; les droits de service_role sont inchangés.
--
-- À exécuter dans Supabase AVANT de déployer le code. Rejouable.

BEGIN;
SET lock_timeout = '3s';

-- 1) Interrupteur + destination de l'avis
ALTER TABLE public.marchands
  ADD COLUMN IF NOT EXISTS lien_avis_google text
  CHECK (lien_avis_google IS NULL OR length(lien_avis_google) <= 500);

COMMENT ON COLUMN public.marchands.lien_avis_google IS
  'Page d''avis Google du marchand. Vide = pas de lien sur la carte et pas de notification avis. C''est l''unique interrupteur de ce workflow.';

-- 2) Élargir le CHECK du registre à la source 'avis'
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
      JOIN pg_class rel     ON rel.oid = con.conrelid
      JOIN pg_namespace ns  ON ns.oid  = rel.relnamespace
    WHERE ns.nspname = 'public' AND rel.relname = 'notification_envois'
      AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE public.notification_envois DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.notification_envois
   WHERE source NOT IN ('inactive','near_reward','birthday','manuel',
                        'scan','welcome','ajustement','annulation','avis');
  IF n > 0 THEN
    RAISE EXCEPTION 'notification_envois.source contient % valeur(s) inattendue(s)', n;
  END IF;
END $$;

ALTER TABLE public.notification_envois
  ADD CONSTRAINT notification_envois_source_check
  CHECK (source IN ('inactive','near_reward','birthday','manuel',
                    'scan','welcome','ajustement','annulation','avis'));

-- 3) Clics sur les liens d'avis
--    Table dédiée : un clic n'est pas un envoi, il n'a rien à faire dans
--    notification_envois. Volume attendu très faible (un clic par client et par
--    récompense, au mieux) — PAS de purge : c'est un indicateur commercial que
--    le marchand voudra voir sur la durée, contrairement au registre d'envois
--    qui est un instrument de diagnostic à 90 jours.
CREATE TABLE IF NOT EXISTS public.avis_clics (
  id          bigserial   PRIMARY KEY,
  clique_le   timestamptz NOT NULL DEFAULT now(),
  marchand_id uuid        REFERENCES public.marchands (id) ON DELETE CASCADE,
  -- ON DELETE SET NULL : un client effacé (RGPD) ne doit pas faire disparaître
  -- le clic des statistiques du marchand.
  client_id   uuid        REFERENCES public.clients (id) ON DELETE SET NULL,
  serial_number text
);

CREATE INDEX IF NOT EXISTS idx_avis_clics_marchand_date
  ON public.avis_clics (marchand_id, clique_le DESC);

COMMENT ON TABLE public.avis_clics IS
  'Clics sur les liens /avis/<serial>. Non purgée : indicateur commercial, volume faible.';

ALTER TABLE public.avis_clics ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.avis_clics TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.avis_clics_id_seq TO service_role;

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Les trois colonnes doivent valoir true.
--
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='marchands'
--       AND column_name='lien_avis_google') = 1                       AS colonne_ok,
--   (SELECT count(*) FROM public.marchands
--     WHERE lien_avis_google IS NOT NULL) = 0                          AS aucun_marchand_configure,
--   EXISTS (SELECT 1 FROM pg_constraint
--            WHERE conrelid='public.notification_envois'::regclass
--              AND contype='c'
--              AND pg_get_constraintdef(oid) LIKE '%avis%')            AS check_avis_ok,
--   to_regclass('public.avis_clics') IS NOT NULL                        AS table_clics_ok,
--   has_table_privilege('service_role','public.avis_clics','INSERT')    AS grant_clics_ok,
--   has_sequence_privilege('service_role','public.avis_clics_id_seq','USAGE') AS grant_seq_clics_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- À n'exécuter QU'APRÈS avoir remis le code en arrière.
--
-- BEGIN;
-- SET lock_timeout = '3s';
-- ALTER TABLE public.marchands DROP COLUMN IF EXISTS lien_avis_google;
-- DROP TABLE IF EXISTS public.avis_clics;
-- DELETE FROM public.notification_envois WHERE source = 'avis';
-- ALTER TABLE public.notification_envois DROP CONSTRAINT IF EXISTS notification_envois_source_check;
-- ALTER TABLE public.notification_envois
--   ADD CONSTRAINT notification_envois_source_check
--   CHECK (source IN ('inactive','near_reward','birthday','manuel',
--                     'scan','welcome','ajustement','annulation'));
-- COMMIT;
