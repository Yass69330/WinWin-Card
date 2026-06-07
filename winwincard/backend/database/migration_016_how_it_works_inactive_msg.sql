-- Migration 016 : how_it_works + workflow_inactive_message

-- Texte "How it works" personnalisable par marchand (dos du pass Apple + Google)
-- NULL → texte générique généré automatiquement
ALTER TABLE marchands
  ADD COLUMN IF NOT EXISTS how_it_works text;

-- Message personnalisé pour le workflow relance clients inactifs
-- NULL → message par défaut "Hi {prenom}! We miss you at {nom}..."
-- Supporte les variables {prenom} et {nom}
ALTER TABLE marchands
  ADD COLUMN IF NOT EXISTS workflow_inactive_message text;
