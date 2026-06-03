const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { authAdmin } = require('../middleware/auth');

const WORKFLOW_FIELDS = [
  'workflow_inactive_enabled',
  'workflow_inactive_days',
  'workflow_near_reward_enabled',
  'workflow_near_reward_threshold',
];

// GET /api/admin/workflows/:marchandId — config workflow d'un marchand
router.get('/:marchandId', authAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('marchands')
    .select('id, nom, forfait, ' + WORKFLOW_FIELDS.join(', '))
    .eq('id', req.params.marchandId)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Marchand introuvable' });
  res.json(data);
});

// PATCH /api/admin/workflows/:marchandId — modifier la config workflow
router.patch('/:marchandId', authAdmin, async (req, res) => {
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
});

module.exports = router;
