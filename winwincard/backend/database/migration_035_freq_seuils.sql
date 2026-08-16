-- Migration 035 : seuils de distribution de fréquence sur marchands (étape 4)
--
-- Contexte. Le dashboard groupe affiche la répartition des porteurs par nombre
-- de passages mensuels en 3 tranches : moins de `freq_seuil_bas`, entre les deux,
-- plus de `freq_seuil_haut`. Les seuils sont PAR MARCHAND (10 passages/mois est
-- normal en boulangerie, impossible chez un coiffeur) — réglables en ADMIN.
--
-- Additif pur : deux colonnes NOT NULL DEFAULT (les lignes existantes prennent
-- 5 et 10). Aucune fonction touchée, aucun grant requis (marchands déjà accordé).
-- Garde-fou CHECK : seuils cohérents (bas ≥ 1, haut ≥ bas) — la distribution
-- n'a de sens que si bas ≤ haut. Le DROP IF EXISTS rend la migration rejouable.
--
-- À exécuter dans Supabase. Rejouable sans risque.

ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS freq_seuil_bas  integer NOT NULL DEFAULT 5;
ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS freq_seuil_haut integer NOT NULL DEFAULT 10;

ALTER TABLE public.marchands DROP CONSTRAINT IF EXISTS marchands_freq_seuils_check;
ALTER TABLE public.marchands ADD CONSTRAINT marchands_freq_seuils_check
  CHECK (freq_seuil_bas >= 1 AND freq_seuil_haut >= freq_seuil_bas);
