const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const { authMarchand } = require('../middleware/auth');

// POST /notifications — envoi push manuel depuis le dashboard marchand
// Corps : { titre, message }
router.post('/', authMarchand, async (req, res) => {
  const { titre, message } = req.body;

  if (!titre || !message) {
    return res.status(400).json({ error: 'titre et message sont requis' });
  }
  if (titre.length > 100 || message.length > 500) {
    return res.status(400).json({ error: 'titre max 100 chars, message max 500 chars' });
  }

  // Récupérer tous les device tokens actifs du marchand
  const { data: tokens, error } = await supabase
    .from('device_tokens')
    .select('push_token, clients(prenom)')
    .eq('marchand_id', req.marchandId);

  if (error) return res.status(500).json({ error: error.message });
  if (!tokens || tokens.length === 0) {
    return res.json({ envoyes: 0, message: 'Aucun appareil enregistré' });
  }

  const { sendPushNotification } = require('../services/apns');

  let envoyes = 0;
  let echecs = 0;

  for (const { push_token } of tokens) {
    try {
      await sendPushNotification(push_token, { titre, message });
      envoyes++;
    } catch {
      echecs++;
    }
  }

  res.json({ envoyes, echecs, total: tokens.length });
});

module.exports = router;
