-- Migration 062 : notification « À proximité » sur iPhone (f10, décisions du 14/10)
--
-- POURQUOI. La carte Apple d'un marchand qui a f10 activé porte ses adresses
-- (locations, 10 au plus) et des créneaux (relevantDates, iOS 18) : près de la
-- boutique, PENDANT les horaires, iOS affiche la carte sur l'écran verrouillé
-- avec un texte (prénom + solde, façon boost). Test réussi sur l'iPhone de Yass
-- le 14/10 (carte s'affiche dans le créneau, se retire à la fin).
--
-- CE QUE FAIT LA MIGRATION.
--   - marchands.geo_actif : interrupteur par marchand, réglé par l'admin, aucune
--     restriction de forfait ;
--   - marchands.geo_lieux : 0 à 10 lieux [{nom, lat, lng, horaires}], horaires
--     en UTC par jour ISO ("1" = lundi … "7" = dimanche), plages "HH:MM-HH:MM".
--     Le serveur vérifie le détail ; la base garde la forme (tableau, 10 au plus).
--     Lus avec la carte (même requête qu'aujourd'hui) : aucune requête de plus.
--   - notification_envois.source += 'geo' : les mises à jour silencieuses des
--     cartes (activation, changement d'adresses ou d'horaires, et une fois par
--     mois) sont tracées comme tout envoi (CLAUDE.md).
--
-- ÉVOLUTION. Deux colonnes. Le registre reçoit une ligne par iPhone et par mise
-- à jour (au plus une par mois en régime normal).
-- COMPATIBILITÉ. L'ancien code ignore les colonnes. À exécuter AVANT le code.
-- Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS geo_actif boolean NOT NULL DEFAULT false;
ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS geo_lieux jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.marchands DROP CONSTRAINT IF EXISTS marchands_geo_lieux_check;
ALTER TABLE public.marchands ADD CONSTRAINT marchands_geo_lieux_check
  CHECK (jsonb_typeof(geo_lieux) = 'array' AND jsonb_array_length(geo_lieux) <= 10);

COMMENT ON COLUMN public.marchands.geo_actif IS
  'Notification « À proximité » (iPhone) activée par l''admin (migration 062).';
COMMENT ON COLUMN public.marchands.geo_lieux IS
  'Lieux de la notification à proximité : [{nom, lat, lng, horaires: {"1".."7": ["HH:MM-HH:MM"]}}], horaires en UTC, 10 au plus (migration 062).';

-- Registre des envois : nouvelle source 'geo' (même méthode que la migration 047).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT con.conname FROM pg_constraint con
            WHERE con.conrelid = 'public.notification_envois'::regclass
              AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE '%source%' LOOP
    EXECUTE format('ALTER TABLE public.notification_envois DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.notification_envois
  ADD CONSTRAINT notification_envois_source_check
  CHECK (source IN ('inactive','near_reward','birthday','manuel',
                    'scan','welcome','ajustement','annulation','avis','geo'));

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Les trois colonnes doivent valoir true.
--
-- SELECT
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'marchands'
--     AND column_name IN ('geo_actif', 'geo_lieux')) = 2 AS colonnes_ok,
--   EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marchands_geo_lieux_check') AS garde_fou_ok,
--   pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'notification_envois_source_check')) LIKE '%geo%' AS registre_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- Après avoir remis le code en arrière (l'ancien code ignore les colonnes) :
--   les colonnes et la source 'geo' peuvent rester. Pour retirer les adresses des
--   cartes déjà mises à jour : UPDATE marchands SET geo_actif = false, puis une
--   mise à jour des cartes (ou attendre le prochain scan de chaque client).
