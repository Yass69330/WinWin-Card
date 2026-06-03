-- Migration 010 : Workflows Pro+ — config sur marchands + table de déduplication

-- Colonnes de config workflow sur les marchands
ALTER TABLE marchands
  ADD COLUMN IF NOT EXISTS workflow_inactive_enabled     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS workflow_inactive_days        integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS workflow_near_reward_enabled  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS workflow_near_reward_threshold integer DEFAULT 2;

-- Table de déduplication des exécutions (empêche le re-envoi dans les 7 jours)
CREATE TABLE IF NOT EXISTS workflow_executions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type text        NOT NULL,  -- 'inactive' | 'near_reward'
  client_id     uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  marchand_id   uuid        NOT NULL,
  executed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wf_exec_lookup
  ON workflow_executions (workflow_type, client_id, marchand_id, executed_at);

COMMENT ON TABLE workflow_executions IS
  'Déduplication des envois de workflow — purgée automatiquement après 90 jours.';
