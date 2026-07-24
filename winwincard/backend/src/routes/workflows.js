const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { authAdmin } = require('../middleware/auth');

const WORKFLOW_FIELDS = [
  'workflow_inactive_enabled',
  'workflow_inactive_days',
  'workflow_inactive_message',
  'workflow_near_reward_enabled',
  'workflow_near_reward_threshold',
  'workflow_birthday_enabled',
  'workflow_birthday_message',
];

// GET /api/admin/workflows/:marchandId — config workflow d'un marchand
router.get('/:marchandId', authAdmin, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('marchands')
    .select('id, nom, forfait, ' + WORKFLOW_FIELDS.join(', '))
    .eq('id', req.params.marchandId)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Marchand introuvable' });
  res.json(data);
}));

// PATCH /api/admin/workflows/:marchandId — modifier la config workflow
router.patch('/:marchandId', authAdmin, asyncHandler(async (req, res) => {
  const updates = {};
  for (const field of WORKFLOW_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Aucun champ valide' });
  }

  const { data, error } = await supabase
    .from('marchands')
    .update(updates)
    .eq('id', req.params.marchandId)
    .select('id, ' + WORKFLOW_FIELDS.join(', '))
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

// POST /api/admin/workflows/trigger — déclencher manuellement les workflows
// Body (optionnel) : { marchand_id, force }
//   marchand_id : limiter à un seul marchand
//   force       : ignorer les flags workflow_*_enabled
router.post('/trigger', authAdmin, asyncHandler(async (req, res) => {
  const { marchand_id, force } = req.body || {};
  const opts = {};
  if (marchand_id) opts.marchandId = marchand_id;
  if (force)       opts.force      = true;

  const { runInactiveWorkflow, runNearRewardWorkflow } = require('../workers/cron');

  const [inactive, near_reward] = await Promise.all([
    runInactiveWorkflow(opts).catch(e => ({ error: e.message })),
    runNearRewardWorkflow(opts).catch(e => ({ error: e.message })),
  ]);

  res.json({ triggered_at: new Date().toISOString(), inactive, near_reward });
}));

module.exports = router;
