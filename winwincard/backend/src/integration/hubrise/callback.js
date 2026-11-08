// ════════════════════════════════════════════════════════════════════════════
// Réception des ventes Hubrise, SANS crédit (H1b — cadrage
// docs/hubrise/03-h1b-reception.md §2, décisions du 08/11)
//
//   POST /integrations/hubrise/callback
//   1. Signature : HMAC-SHA256 du CORPS BRUT, clé = client secret, en hexa,
//      comparé à X-HubRise-Hmac-SHA256 à temps constant. Différence → ignoré,
//      401 (décision D1), rien n'est écrit en base, une ligne de journal sans le
//      corps.
//   2. Lecture tolérante de la location, de la commande, de l'événement et du
//      statut (forme exacte du corps à confirmer sur la commande de test).
//   3. Connexion active de la location : sinon 200 et journal (Hubrise ne
//      renvoie pas).
//   4. hubrise_evenements : une ligne SANS donnée personnelle ; la connexion
//      note la date du dernier événement. 200. AUCUN crédit, aucune carte.
//   Base en panne : 503 (Hubrise renvoie jusqu'à 6 fois).
//   Diagnostic (D2) : pour les locations de HUBRISE_DIAGNOSTIC_LOCATIONS, le
//   relevé de structure (structure.js) va dans les journaux — jamais une valeur.
//
// Corps brut : src/index.js le garde pour cette route (option verify du parseur
// JSON). Si Hubrise envoyait un autre Content-Type, express.raw le lit ici.
// Hors du limiteur global (src/index.js) ; limiteur propre, par adresse.
// ════════════════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const supabase = require('../../services/supabase');
const asyncHandler = require('../../utils/asyncHandler');
const config = require('./config');
const { relever } = require('./structure');

const CHEMIN = '/integrations/hubrise/callback';
const texte = (v, max = 64) => (typeof v === 'string' || typeof v === 'number') && String(v).length <= max ? String(v) : null;

function signatureValide(brut, recue) {
  const secret = process.env.HUBRISE_CLIENT_SECRET;
  if (!secret || !brut || typeof recue !== 'string') return false;
  const attendue = crypto.createHmac('sha256', secret).update(brut).digest('hex');
  const a = Buffer.from(attendue, 'utf8'), b = Buffer.from(recue.trim().toLowerCase(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Lecture tolérante : à la racine d'abord, puis dans new_state.
function lire(c) {
  const s = (c && typeof c.new_state === 'object' && c.new_state) || {};
  const type = texte(c.event_type) || texte(c.type);
  const ressource = texte(c.resource_type) || 'order';
  return {
    location: texte(c.location_id) || texte(s.location_id),
    commande: texte(c.order_id) || texte(c.resource_id) || texte(s.id),
    evenement: type ? `${ressource}.${type}`.slice(0, 64) : null,
    statut: texte(s.status) || texte(c.status),
  };
}

const limiteur = rateLimit({ windowMs: 60 * 1000, max: Number(process.env.HUBRISE_CALLBACK_MAX_PAR_MINUTE) || 1200,
  standardHeaders: true, legacyHeaders: false, message: { error: 'trop_de_requetes' } });

router.post(CHEMIN, limiteur, express.raw({ type: () => true, limit: '2mb' }), asyncHandler(async (req, res) => {
  const brut = req.corpsBrut || (Buffer.isBuffer(req.body) ? req.body : null);
  if (!signatureValide(brut, req.get('X-HubRise-Hmac-SHA256'))) {
    console.warn('[hubrise] callback ignoré : signature invalide ou absente');
    return res.status(401).json({ error: 'signature_invalide' });
  }
  let corps;
  try { corps = req.corpsBrut ? req.body : JSON.parse(brut.toString('utf8')); } catch { corps = null; }
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return res.status(400).json({ error: 'corps_illisible' });

  const e = lire(corps);
  if (e.location && config.locationsDiagnostic().has(e.location)) {
    console.log(`[hubrise] structure location=${e.location} commande=${e.commande || '-'} evenement=${e.evenement || '-'} ${JSON.stringify(relever(corps))}`);
  }

  let decision = 'recu', connexion = null;
  if (!e.location) {
    decision = 'structure_inattendue';
  } else {
    const { data, error } = await supabase.from('hubrise_connexions').select('id, marchand_id, coupee_le')
      .eq('location_id', e.location).order('cree_le', { ascending: false }).limit(1).maybeSingle();
    if (error) {
      console.error('[hubrise] callback : lecture de la connexion impossible :', error.message);
      return res.set('Retry-After', '60').status(503).json({ error: 'service_indisponible' });
    }
    connexion = data;
    if (!connexion) decision = 'connexion_inconnue';
    else if (connexion.coupee_le) decision = 'connexion_coupee';
  }

  const { error: errJ } = await supabase.from('hubrise_evenements').insert({
    connexion_id: connexion ? connexion.id : null, marchand_id: connexion ? connexion.marchand_id : null,
    location_id: e.location, order_id: e.commande, evenement: e.evenement, statut_commande: e.statut, decision,
  });
  if (errJ) {
    console.error('[hubrise] callback : journal impossible :', errJ.message);
    return res.set('Retry-After', '60').status(503).json({ error: 'service_indisponible' });
  }
  if (decision === 'recu') {
    const { error: errC } = await supabase.from('hubrise_connexions').update({ dernier_evenement_le: new Date().toISOString() })
      .eq('id', connexion.id);
    if (errC) console.error('[hubrise] callback : date du dernier événement non notée :', errC.message);
  }
  res.json({ ok: true, decision });
}));

module.exports = router;
