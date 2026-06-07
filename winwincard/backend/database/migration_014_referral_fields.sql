-- Migration 014 : champs parrainage sur marchands
-- Permet d'activer le parrainage par marchand et de configurer le bonus de points.
-- Le reste du système (referred_by_client_id, referral_credits, credit_referral RPC)
-- sera ajouté dans la migration 015 lors de l'implémentation complète.

ALTER TABLE marchands
  ADD COLUMN IF NOT EXISTS referral_enabled      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS referral_bonus_points integer NOT NULL DEFAULT 1
    CONSTRAINT referral_bonus_points_positive CHECK (referral_bonus_points >= 1);
