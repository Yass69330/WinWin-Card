const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { authMarchand } = require('../middleware/auth');
const campagnes = require('../services/campagnes');   // envoi par lots (t37)
// Quota mensuel : Basic 0 / Pro 5 / Pro+ 20, quota manuel de l'admin prioritaire.
const { limiteMensuelle } = require('../services/forfaits');

function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

// GET /api/notifications — historique + quota du mois
// Chaque ligne porte `etat` : 'en_cours' tant que sa campagne n'est pas finie
// (une campagne interrompue reprend seule), sinon 'envoyee'. Lu dans la MÊME
// requête (jointure campagnes, migration 054). Plus de compteur « x/N reçues »
// à l'écran (décision du 09/10) ; les compteurs restent dans la réponse.
router.get('/', authMarchand, asyncHandler(async (req, res) => {
  const [logsResult, meResult, countResult] = await Promise.all([
    supabase
      .from('notification_logs')
      .select('id, message, envoyes_apple, envoyes_google, total_apple, total_google, created_at, campagnes(statut)')
      .eq('marchand_id', req.marchandId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('marchands').select('forfait, notification_quota_override').eq('id', req.marchandId).single(),
    supabase.from('notification_logs')
      .select('*', { count: 'exact', head: true })
      .eq('marchand_id', req.marchandId)
      .gte('created_at', startOfMonth()),
  ]);

  if (logsResult.error) return res.status(500).json({ error: logsResult.error.message });

  const forfait = meResult.data?.forfait || 'pro';
  const limit   = limiteMensuelle(meResult.data);
  const logs = (logsResult.data || []).map(({ campagnes: c, ...log }) => ({
    ...log,
    etat: (c || []).some(x => x.statut !== 'terminee') ? 'en_cours' : 'envoyee',
  }));
  res.json({
    logs,
    quota: { used: countResult.count || 0, limit, forfait },
  });
}));

// POST /api/notifications — campagne depuis le dashboard marchand (étape t37)
// Corps : { message }
// Crée la campagne et répond TOUT DE SUITE (202) ; l'envoi part ensuite par
// lots, en arrière-plan (services/campagnes.js). En UNE transaction
// (lancer_campagne, migration 054) : quota du mois, ligne notification_logs
// (le quota est compté au clic), ligne campagnes. Une seule campagne en cours
// par marchand : un second clic reçoit 409. Plus de plafond de 1 000
// destinataires : la campagne parcourt tous les appareils et toutes les cartes.
// Réponse : { statut: 'en_cours', campagne_id }
router.post('/', authMarchand, asyncHandler(async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (message.length > 500) {
    return res.status(400).json({ error: 'message max 500 chars' });
  }

  // Vérification quota selon forfait (ou override admin si défini)
  const { data: me } = await supabase.from('marchands').select('forfait, notification_quota_override').eq('id', req.marchandId).single();
  const limit = limiteMensuelle(me);

  if (limit === 0) {
    return res.status(403).json({ error: 'Push notifications are not available on the Basic plan.', upgrade: true });
  }

  const { data: lancement, error } = await supabase.rpc('lancer_campagne', {
    p_marchand_id: req.marchandId, p_message: message, p_limite: limit, p_debut_mois: startOfMonth(),
  });
  if (error) return res.status(500).json({ error: error.message });

  if (!lancement.ok && lancement.reason === 'quota') {
    return res.status(429).json({
      error: `Monthly limit reached — ${lancement.used}/${limit} notifications used this month.`,
      used: lancement.used, limit, upgrade: true,
    });
  }
  if (!lancement.ok) {
    return res.status(409).json({ error: 'A campaign is already being sent. Please wait until it is finished.' });
  }

  campagnes.demarrer({ id: lancement.campagne_id, marchand_id: req.marchandId, message, cree_le: new Date().toISOString(),
    curseur_apple: null, curseur_google: null, apple_fini: false, google_fini: false });
  res.status(202).json({ statut: 'en_cours', campagne_id: lancement.campagne_id });
}));

module.exports = router;
