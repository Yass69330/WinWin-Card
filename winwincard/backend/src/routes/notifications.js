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
      .select('id, message, envoyes_apple, envoyes_google, total_apple, total_google, created_at, campagnes(statut, segment)')
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
    segment: ((c || []).find(x => x.segment) || {}).segment || null,
  }));
  res.json({
    logs,
    quota: { used: countResult.count || 0, limit, forfait },
  });
}));

// Segment demandé par le dashboard (migration 059). Absent ou « tous » : null,
// tous les clients. La base vérifie le reste (jours permis, boutique du marchand).
function lireSegment(brut) {
  if (brut == null || brut === '' || brut === 'tous') return null;
  if (typeof brut === 'string') { try { brut = JSON.parse(brut); } catch { return undefined; } }
  if (typeof brut !== 'object' || Array.isArray(brut) || typeof brut.type !== 'string') return undefined;
  return { type: brut.type, ...(brut.jours != null ? { jours: brut.jours } : {}), ...(brut.boutique != null ? { boutique: String(brut.boutique) } : {}) };
}

function baseIndisponible(res, route, error) {
  console.error(`[notifications] ${route} indisponible :`, error.message);
  return res.set('Retry-After', '30').status(503).json({ error: 'database_unavailable' });
}

// GET /api/notifications/destinataires?segment=<json> — nombre de personnes qui
// recevraient la campagne (jeton Apple ou carte Google), avant l'envoi. Une
// lecture, à la demande (choix du segment) ; aucun appel à Apple ni à Google.
router.get('/destinataires', authMarchand, asyncHandler(async (req, res) => {
  const segment = lireSegment(req.query.segment);
  if (segment === undefined) return res.status(400).json({ error: 'invalid_segment' });
  const { data, error } = await supabase.rpc('compter_segment', { p_marchand_id: req.marchandId, p_segment: segment });
  if (error) return baseIndisponible(res, 'destinataires', error);
  if (!data.ok) return res.status(400).json({ error: 'invalid_segment' });
  res.json({ destinataires: data.destinataires });
}));

// POST /api/notifications — campagne depuis le dashboard marchand (étape t37)
// Corps : { message, segment? } — segment : voir lireSegment (migration 059).
// Crée la campagne et répond TOUT DE SUITE (202) ; l'envoi part ensuite par
// lots, en arrière-plan (services/campagnes.js). En UNE transaction
// (lancer_campagne, migration 054) : quota du mois, ligne notification_logs
// (le quota est compté au clic), ligne campagnes. Une seule campagne en cours
// par marchand : un second clic reçoit 409. Plus de plafond de 1 000
// destinataires : la campagne parcourt tous les appareils et toutes les cartes.
// Réponse : { statut: 'en_cours', campagne_id }
router.post('/', authMarchand, asyncHandler(async (req, res) => {
  const { message } = req.body;
  const segment = lireSegment(req.body.segment);
  if (segment === undefined) return res.status(400).json({ error: 'invalid_segment' });

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
    p_marchand_id: req.marchandId, p_message: message, p_limite: limit, p_debut_mois: startOfMonth(), p_segment: segment,
  });
  if (error) return res.status(500).json({ error: error.message });

  if (!lancement.ok && lancement.reason === 'segment') return res.status(400).json({ error: 'invalid_segment' });

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
