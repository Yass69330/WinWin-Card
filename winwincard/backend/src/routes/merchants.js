const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { authMarchand } = require('../middleware/auth');

// POST /merchants/login — connexion marchand (email ou slug + password)
// remember_device: true → JWT 1 an (scanner PWA installée), false → 7j (dashboard)
router.post('/login', asyncHandler(async (req, res) => {
  const { email, slug, password, remember_device } = req.body;
  const identifier = slug || email;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'slug (or email) and password required' });
  }

  const field = slug ? 'slug' : 'email_contact';
  const { data: marchand, error } = await supabase
    .from('marchands')
    .select('id, nom, slug, langue, type_programme, email_contact, password_hash, actif, token_version')
    .eq(field, identifier)
    .single();
  // Étape 17 : lecture en erreur (base lente, coupée à 5 s, ou en panne) → 503,
  // jamais 401 à un bon mot de passe ; non compté par le limiteur (5xx).
  // PGRST116 : aucune ligne pour .single() → identifiants inconnus, 401.
  if (error && error.code !== 'PGRST116') {
    console.error('[merchants] connexion, lecture impossible :', error.message);
    return res.status(503).json({ error: 'database_unavailable' });
  }

  if (!marchand) return res.status(401).json({ error: 'Invalid credentials' });
  if (!marchand.actif) return res.status(403).json({ error: 'Account suspended' });

  const { comparePassword } = require('../services/auth-utils');
  const valid = await comparePassword(password, marchand.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const expiresIn = remember_device ? '365d' : '7d';
  const token = jwt.sign(
    // tv : version de jeton au moment de l'émission (migration 045). Un jeton
    // sans ce champ vaut tv = 1 côté middleware — c'est ce qui garantit qu'aucune
    // session en cours n'est coupée par le déploiement.
    { role: 'marchand', marchand_id: marchand.id, nom: marchand.nom, tv: marchand.token_version ?? 1 },
    process.env.JWT_SECRET,
    { expiresIn }
  );

  res.json({ token, marchand_id: marchand.id, nom: marchand.nom, slug: marchand.slug, langue: marchand.langue, type_programme: marchand.type_programme });
}));

// GET /merchants/me — profil du marchand connecté
router.get('/me', authMarchand, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('marchands')
    .select('id, nom, slug, logo_url, couleur_fond, couleur_texte, couleur_label, image_strip_url, texte_landing, max_value, display_max_value, forfait, langue, type_programme, email_contact, landing_premium')
    .eq('id', req.marchandId)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  // `coordonnees` : le dashboard montre le bouton d'export CSV sur cette seule
  // information (services/forfaits.js) — il ne recalcule pas la règle.
  const { droitCoordonnees } = require('../services/forfaits');
  res.json({ ...data, coordonnees: droitCoordonnees(data) });
}));

// Statistiques indisponibles (base en panne, délai de 5 s dépassé) : une erreur
// franche, comme le scan (étape 16), jamais des zéros. L'écran affiche
// « Statistiques indisponibles » et un bouton Réessayer (étape 26).
function statsIndisponibles(res, route, error) {
  console.error(`[stats] ${route} indisponible :`, error.message);
  return res.set('Retry-After', '30').status(503).json({ error: 'database_unavailable' });
}

// Bloc « Mes smart notifications » de l'onglet Notifications (14/10).
// Les relances sont activées par l'admin ; le marchand les découvre ici et, depuis
// f15 (migration 060), règle lui-même le délai d'inactivité, le message de cette
// relance et le seuil du boost. Il n'active ni ne désactive rien, et ne change ni
// le texte du boost ni celui de l'anniversaire. Valeur utilisée = la sienne s'il
// en a mis une, sinon celle de l'admin (« réglage WinWin »).
// Mêmes règles que le cron (src/workers/cron.js) : forfaits Pro et Pro+ ;
// anniversaire seulement avec la landing premium ; boost seulement si le seuil
// laisse une zone (seuil < récompense). La demande d'avis Google (services/avis.js)
// figure aussi : active dès que le lien d'avis est rempli, sans réglage.
const FORFAITS_SMART = ['pro', 'pro_plus'];
const COLONNES_SMART = 'forfait, landing_premium, type_programme, max_value, lien_avis_google, langue, nom, '
  + 'workflow_inactive_enabled, workflow_inactive_days, workflow_inactive_message, '
  + 'workflow_near_reward_enabled, workflow_near_reward_threshold, workflow_birthday_enabled, '
  + 'marchand_inactive_days, marchand_inactive_message, marchand_near_reward_threshold, '
  + 'workflow_near_reward_message, marchand_near_reward_message, geo_actif, geo_lieux';

function resumeSmart(m, envoyees7j) {
  if (!FORFAITS_SMART.includes(m.forfait)) return { eligible: false };
  const { notif } = require('../i18n/messages');
  const { lienValide } = require('../services/avis');
  const max = m.max_value || 10;
  const seuilWinwin = m.workflow_near_reward_threshold || 2;
  const seuil = m.marchand_near_reward_threshold || seuilWinwin;
  // Texte par défaut affiché au marchand : le message de l'admin, sinon le texte
  // standard ; « {prenom} » reste tel quel (remplacé à l'envoi).
  const messageWinwin = m.workflow_inactive_message
    || notif('inactive', m.langue, { prenom: '{prenom}', nom: m.nom });
  const messageBoostWinwin = m.workflow_near_reward_message
    || require('../services/smart-messages').modeleBoostWinwin(m.langue);
  return {
    eligible: true,
    inactivite: m.workflow_inactive_enabled ? {
      jours: m.marchand_inactive_days || m.workflow_inactive_days || 30,
      message: m.marchand_inactive_message || messageWinwin,
      winwin: { jours: m.workflow_inactive_days || 30, message: messageWinwin },
    } : null,
    boost: m.workflow_near_reward_enabled && max - seuil > 0 ? {
      seuil, unite: m.type_programme === 'points' ? 'points' : 'tampons', max: max - 1, winwin: seuilWinwin,
      // Message (f18) : celui du marchand, sinon celui de l'admin, sinon le texte
      // WinWin ; {reste}, {prenom} et {nom} laissés tels quels pour l'édition.
      message: m.marchand_near_reward_message || messageBoostWinwin,
      message_winwin: messageBoostWinwin,
    } : null,
    anniversaire: !!(m.workflow_birthday_enabled && m.landing_premium),
    avis: !!lienValide(m.lien_avis_google),
    personnalise: m.marchand_inactive_days != null || m.marchand_inactive_message != null
      || m.marchand_near_reward_threshold != null || m.marchand_near_reward_message != null,
    // Notification « À proximité » (f10, migration 062) : mentionnée, sans
    // compteur (décision du 14/10).
    proximite: m.geo_actif === true && Array.isArray(m.geo_lieux) && m.geo_lieux.length > 0,
    envoyees_7j: envoyees7j,
  };
}

// GET /merchants/me/smart-notifications — une requête du dashboard, à l'ouverture
// de l'onglet : la ligne du marchand et le compte des 7 jours (migration 060 ;
// index existants), lus en parallèle.
router.get('/me/smart-notifications', authMarchand, asyncHandler(async (req, res) => {
  const [{ data: m, error: errM }, { data: n, error: errC }] = await Promise.all([
    supabase.from('marchands').select(COLONNES_SMART).eq('id', req.marchandId).single(),
    supabase.rpc('smart_notifications_7j', { p_marchand_id: req.marchandId }),
  ]);
  if (errM || errC) return statsIndisponibles(res, 'smart-notifications', errM || errC);
  res.json(resumeSmart(m, n || 0));
}));

// PATCH /merchants/me/smart-notifications — le marchand règle ses relances (f15).
// Corps : { inactivite_jours?, inactivite_message?, boost_seuil?, boost_message? } ou { winwin: true }
// (« revenir au réglage WinWin » : tous les réglages du marchand effacés).
// Un réglage d'une relance que l'admin n'a pas activée est refusé.
const { validerMessage } = require('../services/smart-messages');   // lien interdit, 150 caractères, {reste}
router.patch('/me/smart-notifications', authMarchand, asyncHandler(async (req, res) => {
  const { data: m, error } = await supabase.from('marchands').select(COLONNES_SMART).eq('id', req.marchandId).single();
  if (error) return statsIndisponibles(res, 'smart-notifications (réglage)', error);
  if (!FORFAITS_SMART.includes(m.forfait)) return res.status(403).json({ error: 'plan_not_eligible' });

  const corps = req.body || {};
  const maj = {};
  if (corps.winwin === true) {
    Object.assign(maj, { marchand_inactive_days: null, marchand_inactive_message: null, marchand_near_reward_threshold: null,
      marchand_near_reward_message: null });
  } else {
    if (corps.inactivite_jours !== undefined || corps.inactivite_message !== undefined) {
      if (!m.workflow_inactive_enabled) return res.status(400).json({ error: 'relance_inactive_desactivee' });
    }
    if (corps.inactivite_jours !== undefined) {
      const j = Number(corps.inactivite_jours);
      if (!Number.isInteger(j) || j < 7 || j > 90) return res.status(400).json({ error: 'jours_hors_limites', min: 7, max: 90 });
      maj.marchand_inactive_days = j;
    }
    if (corps.inactivite_message !== undefined) {
      const v = validerMessage(corps.inactivite_message);
      if (v.erreur) return res.status(400).json({ error: v.erreur, max: 150 });
      maj.marchand_inactive_message = v.texte;
    }
    if (corps.boost_seuil !== undefined || corps.boost_message !== undefined) {
      // Boost absent du bloc (désactivé par l'admin, ou seuil admin qui ne laisse
      // aucune zone) : le régler reviendrait à l'activer, ce que seul l'admin fait.
      if (!resumeSmart(m, 0).boost) return res.status(400).json({ error: 'boost_desactive' });
    }
    if (corps.boost_message !== undefined) {
      const v = validerMessage(corps.boost_message, { reserve: '{reste}' });
      if (v.erreur) return res.status(400).json({ error: v.erreur, max: 150 });
      maj.marchand_near_reward_message = v.texte;
    }
    if (corps.boost_seuil !== undefined) {
      const s = Number(corps.boost_seuil), max = (m.max_value || 10) - 1;
      if (!Number.isInteger(s) || s < 1 || s > max) return res.status(400).json({ error: 'seuil_hors_limites', min: 1, max });
      maj.marchand_near_reward_threshold = s;
    }
  }
  if (Object.keys(maj).length === 0) return res.status(400).json({ error: 'aucun_reglage' });

  const { data: apres, error: errMaj } = await supabase.from('marchands').update(maj)
    .eq('id', req.marchandId).select(COLONNES_SMART).single();
  if (errMaj) return statsIndisponibles(res, 'smart-notifications (écriture)', errMaj);
  const { data: n } = await supabase.rpc('smart_notifications_7j', { p_marchand_id: req.marchandId });
  res.json(resumeSmart(apres, n || 0));
}));

// GET /merchants/me/stats — l'Aperçu du dashboard, calculé en base (étape 26,
// migration 056) : le même pour une mono-boutique et pour un réseau, sans rien
// par boutique. Une seule lecture, sans plafond de lignes.
router.get('/me/stats', authMarchand, asyncHandler(async (req, res) => {
  const { data, error } = await supabase.rpc('apercu_stats', { p_marchand_id: req.marchandId });
  if (error) return statsIndisponibles(res, 'apercu_stats', error);
  res.json(data || {});
}));

// GET /merchants/me/group-stats — onglet Réseau. Délègue tout à group_stats, qui
// prend ses chiffres communs dans apercu_stats (mêmes chiffres que l'Aperçu) et
// ajoute mobilité, boutiques et scans non attribués.
router.get('/me/group-stats', authMarchand, asyncHandler(async (req, res) => {
  const { data, error } = await supabase.rpc('group_stats', { p_marchand_id: req.marchandId });
  if (error) return statsIndisponibles(res, 'group_stats', error);
  res.json(data || {});
}));

// GET /merchants/qrcode — QR code de la landing page du marchand
router.get('/me/qrcode', authMarchand, asyncHandler(async (req, res) => {
  const { data: marchand } = await supabase
    .from('marchands')
    .select('slug')
    .eq('id', req.marchandId)
    .single();

  if (!marchand) return res.status(404).json({ error: 'Merchant not found' });

  const QRCode = require('qrcode');
  const url = `${process.env.API_BASE_URL || 'https://app.winwin-card.com'}/l/${marchand.slug}`;
  const qr = await QRCode.toDataURL(url, { width: 400, margin: 2 });

  res.json({ url, qrcode: qr });
}));

// ── Points de vente (boutiques du réseau) — lecture + renommage (OWNER) ──────
// Multi-boutiques, étape 2. Le franchiseur LIT ses boutiques et peut les
// RENOMMER (neutre pour la facturation). Création et archivage = admin (ils
// changent le nombre facturé). Un mono-site n'a aucune ligne → liste vide,
// l'UI reste masquée côté dashboard.

// GET /merchants/me/points-de-vente — boutiques actives du réseau
router.get('/me/points-de-vente', authMarchand, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('points_de_vente')
    .select('id, nom, created_at, actif')
    .eq('marchand_id', req.marchandId)
    .is('deleted_at', null)
    .order('nom');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
}));

// PATCH /merchants/me/points-de-vente/:id — renommer une de SES boutiques
router.patch('/me/points-de-vente/:id', authMarchand, asyncHandler(async (req, res) => {
  const nom = typeof req.body.nom === 'string' ? req.body.nom.trim().slice(0, 80) : '';
  if (!nom) return res.status(400).json({ error: 'nom is required' });

  // Scope marchand_id : le propriétaire ne renomme QUE ses propres boutiques
  // actives. 23505 = l'index unique (marchand_id, lower(nom)) rejette un doublon.
  const { data, error } = await supabase
    .from('points_de_vente')
    .update({ nom })
    .eq('id', req.params.id)
    .eq('marchand_id', req.marchandId)
    .is('deleted_at', null)
    .select('id, nom')
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Une boutique active porte déjà ce nom' });
    return res.status(404).json({ error: 'Boutique introuvable' });
  }
  res.json(data);
}));

// PATCH /merchants/me/points-de-vente/:id/actif — couper / rétablir l'accès
// scanner d'une boutique. Levier FRANCHISEUR, réversible, NEUTRE pour la
// facturation (≠ archivage). Effet immédiat : le scan relit `actif` en base à
// chaque passage → le scan suivant de la boutique coupée est refusé.
router.patch('/me/points-de-vente/:id/actif', authMarchand, asyncHandler(async (req, res) => {
  const actif = req.body.actif === true || req.body.actif === false ? req.body.actif : null;
  if (actif === null) return res.status(400).json({ error: 'actif (boolean) is required' });

  const { data, error } = await supabase
    .from('points_de_vente')
    .update({ actif })
    .eq('id', req.params.id)
    .eq('marchand_id', req.marchandId) // le propriétaire ne touche QUE ses boutiques
    .is('deleted_at', null)
    .select('id, nom, actif')
    .single();

  if (error) return res.status(404).json({ error: 'Boutique introuvable' });
  res.json(data);
}));

// ── f17 : onglet « Ma carte » (Pro+, migration 063) ───────────────────────
// Le marchand voit sa carte standard et chacun des thèmes préparés pour lui,
// en choisit un avec ses dates, ou arrête le thème en cours. Les dates sont des
// jours UTC : ouverture au passage du cron (08:00 UTC) du jour de début, ou tout
// de suite si le début est aujourd'hui ; fin au passage qui suit le jour de fin.
const FORFAITS_THEMES = ['pro_plus'];
const COLONNES_THEME_MARCHAND = 'id, nom, couleur_fond, couleur_texte, couleur_label, logo_url, google_logo_url, texte_case, message_ouverture';

async function ficheCarte(marchandId) {
  const { COLONNES_MARCHAND_CARTE } = require('../services/colonnes-carte');
  return supabase.from('marchands').select(`${COLONNES_MARCHAND_CARTE}, theme_bascule`).eq('id', marchandId).single();
}

let _qr = null;
async function qrExemple() {
  if (!_qr) _qr = await require('qrcode').toDataURL('https://app.winwin-card.com', { margin: 1, width: 220 }).catch(() => null);
  return _qr;
}

// GET /merchants/me/themes — LECTURE SEULE : les bannières d'aperçu viennent du
// cache, préparées en admin (services/themes.js, « la caisse prime »).
// GET /merchants/me/themes
router.get('/me/themes', authMarchand, asyncHandler(async (req, res) => {
  const themes = require('../services/themes');
  const { data: m, error } = await ficheCarte(req.marchandId);
  if (error || !m) return statsIndisponibles(res, 'themes', error || new Error('marchand introuvable'));
  if (!FORFAITS_THEMES.includes(m.forfait)) return res.json({ eligible: false });
  const { data: liste, error: errT } = await supabase.from('themes_marchand')
    .select(COLONNES_THEME_MARCHAND).eq('marchand_id', req.marchandId).order('cree_le');
  if (errT) return statsIndisponibles(res, 'themes', errT);
  // Carte standard : la fiche SANS le thème en cours.
  const standard = { ...m, theme_actif: null };
  const [apercuStandard, ...apercus] = await Promise.all([
    themes.apercu(standard), ...liste.map(t => themes.apercu(themes.avecTheme(standard, t)))]);
  // QR d'exemple (le vrai est propre à chaque client) : la carte entière, comme en
  // Wallet. Calculé une fois par serveur, puis gardé en mémoire.
  const qr = await qrExemple();
  res.json({
    eligible: true,
    aujourdhui: themes.aujourdhui(),
    qr,
    standard: apercuStandard,
    themes: liste.map((t, i) => ({ id: t.id, nom: t.nom, message_ouverture: t.message_ouverture, apercu: apercus[i] })),
    actif: m.theme_actif ? { id: m.theme_actif.id, nom: m.theme_actif.nom, debut: m.theme_actif.debut, fin: m.theme_actif.fin, etat: m.theme_actif.etat } : null,
    bascule: m.theme_bascule ? m.theme_bascule.sens : null,
  });
}));

// POST /merchants/me/theme { theme_id, debut, fin } — choisir un thème
router.post('/me/theme', authMarchand, asyncHandler(async (req, res) => {
  const themes = require('../services/themes');
  const { theme_id: themeId, debut, fin } = req.body || {};
  const { data: m, error } = await supabase.from('marchands').select('forfait, theme_actif').eq('id', req.marchandId).single();
  if (error || !m) return statsIndisponibles(res, 'theme', error || new Error('marchand introuvable'));
  if (!FORFAITS_THEMES.includes(m.forfait)) return res.status(403).json({ error: 'plan_not_eligible' });
  const erreurDates = themes.validerDates(debut, fin);
  if (erreurDates) return res.status(400).json({ error: erreurDates });
  // Un seul thème à la fois : celui en cours s'arrête d'abord (retour à la carte
  // standard). Un thème seulement programmé est remplacé.
  if (m.theme_actif && m.theme_actif.etat === 'en_cours') return res.status(409).json({ error: 'theme_en_cours' });
  if (typeof themeId !== 'string') return res.status(400).json({ error: 'theme_id requis' });
  const { data: t, error: errT } = await supabase.from('themes_marchand').select(COLONNES_THEME_MARCHAND)
    .eq('id', themeId).eq('marchand_id', req.marchandId).maybeSingle();
  if (errT) return statsIndisponibles(res, 'theme', errT);
  if (!t) return res.status(404).json({ error: 'theme_introuvable' });
  const choisi = { ...t, debut, fin, etat: 'programme', choisi_le: new Date().toISOString() };
  let q = supabase.from('marchands').update({ theme_actif: choisi }).eq('id', req.marchandId);
  q = m.theme_actif ? q.eq('theme_actif->>id', m.theme_actif.id).eq('theme_actif->>etat', 'programme') : q.is('theme_actif', null);
  const { data: maj, error: errMaj } = await q.select('id');
  if (errMaj) return statsIndisponibles(res, 'theme', errMaj);
  if (!maj.length) return res.status(409).json({ error: 'theme_modifie_entre_temps' });
  let etat = 'programme';
  if (debut <= themes.aujourdhui()) {
    try { if (await themes.ouvrir(req.marchandId, choisi)) etat = 'en_cours'; } catch (e) {
      // Ouverture ratée : le thème reste programmé, le passage du cron l'ouvrira.
      console.error('[theme] ouverture immédiate :', e.message);
    }
  }
  res.json({ id: t.id, nom: t.nom, debut, fin, etat });
}));

// DELETE /merchants/me/theme — arrêter (en cours) ou annuler (programmé) : retour
// silencieux à la carte standard.
router.delete('/me/theme', authMarchand, asyncHandler(async (req, res) => {
  const themes = require('../services/themes');
  const { data: m, error } = await supabase.from('marchands').select('forfait, theme_actif').eq('id', req.marchandId).single();
  if (error || !m) return statsIndisponibles(res, 'theme', error || new Error('marchand introuvable'));
  if (!m.theme_actif) return res.json({ ok: true, etat: null });
  const ok = await themes.fermer(req.marchandId, m.theme_actif);
  if (!ok) return res.status(409).json({ error: 'theme_modifie_entre_temps' });
  res.json({ ok: true, etat: null });
}));

// GET /merchants/:slug/public — infos publiques pour la landing page
router.get('/:slug/public', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('marchands')
    .select('id, nom, slug, logo_url, icon_url, image_strip_url, texte_landing, couleur_fond, couleur_texte, max_value, actif, forfait, langue, type_programme, landing_premium, referral_enabled, referral_bonus_points')
    .eq('slug', req.params.slug)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Merchant not found' });
  if (!data.actif) return res.status(403).json({ error: 'Program suspended' });

  // La landing affiche les champs premium sur `landing_premium_actif` seul
  // (services/forfaits.js) — elle ne recalcule pas la règle.
  const { landingPremiumActive } = require('../services/forfaits');
  res.json({ ...data, landing_premium_actif: landingPremiumActive(data) });
}));

module.exports = router;
