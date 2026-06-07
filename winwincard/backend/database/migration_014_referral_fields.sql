-- Migration 014 : parrainage + infos pratiques marchand
-- Regroupe toutes les modifications liées au parrainage (marchand + clients + audit)
-- et les données de contact du marchand affichées au dos du pass.

-- ── Marchands : parrainage ────────────────────────────────────
ALTER TABLE marchands
  ADD COLUMN IF NOT EXISTS referral_enabled      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS referral_bonus_points integer NOT NULL DEFAULT 1
    CONSTRAINT referral_bonus_points_positive CHECK (referral_bonus_points >= 1),
  ADD COLUMN IF NOT EXISTS telephone text,
  ADD COLUMN IF NOT EXISTS adresse   text;

-- ── Clients : lien de parrainage ─────────────────────────────
-- SET NULL si le parrain supprime son compte (droit à l'effacement RGPD).
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS referred_by_client_id uuid
    REFERENCES clients(id) ON DELETE SET NULL;

-- ── referral_credits : audit des parrainages réussis ─────────
-- Un enregistrement = un point de parrainage crédité au parrain.
-- Utilisé pour les rapports mensuels Pro+.
CREATE TABLE IF NOT EXISTS referral_credits (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  marchand_id       uuid        NOT NULL REFERENCES marchands(id) ON DELETE CASCADE,
  parrain_client_id uuid        NOT NULL REFERENCES clients(id)   ON DELETE CASCADE,
  filleul_client_id uuid        NOT NULL REFERENCES clients(id)   ON DELETE CASCADE,
  points_credited   integer     NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Index pour les rapports mensuels par marchand et par parrain
CREATE INDEX IF NOT EXISTS referral_credits_marchand_created_at
  ON referral_credits (marchand_id, created_at DESC);

CREATE INDEX IF NOT EXISTS referral_credits_parrain
  ON referral_credits (parrain_client_id);
