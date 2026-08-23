-- Migration 017 : couleur de fond personnalisée à l'état récompense
ALTER TABLE marchands ADD COLUMN IF NOT EXISTS couleur_fond_reward text;
