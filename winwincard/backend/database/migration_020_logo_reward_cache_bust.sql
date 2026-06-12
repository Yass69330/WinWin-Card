-- Migration 020
-- 1. Champ logo_reward_url : logo doré affiché dans le pass quand filled = max_value.
--    Si absent, fallback sur logo_url (aucune régression pour les marchands existants).
ALTER TABLE marchands
  ADD COLUMN IF NOT EXISTS logo_reward_url text;

-- 2. Invalidation du cache de strips générés.
--    Raisons cumulées : refonte icônes Phosphor, fond plat (sans dégradé),
--    correction couleur reward (fallback gold #c9a84c).
--    Un bump de version force la regénération des images en Storage au prochain accès.
UPDATE marchands
   SET strip_config_version = COALESCE(strip_config_version, 1) + 1
 WHERE strip_mode IS NOT NULL;
