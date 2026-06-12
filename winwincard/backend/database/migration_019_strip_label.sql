-- Migration 019 — Champ strip_label pour le label "LOYALTY CARD" sur le strip
-- Valeur par défaut 'on' : tous les marchands existants affichent le label (pas de régression).
ALTER TABLE marchands
  ADD COLUMN IF NOT EXISTS strip_label text DEFAULT 'on'
    CHECK (strip_label IN ('on', 'off'));
