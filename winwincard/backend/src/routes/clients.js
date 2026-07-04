const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { authMarchand, authAdmin } = require('../middleware/auth');
const { limiterInscription } = require('../middleware/rateLimiters');
const { notif } = require('../i18n/messages');

// POST /api/clients — inscription client depuis la landing page
// Corps : { prenom, marchand_slug, email?, telephone?, date_anniversaire? }
// Rate limit appliqué ici uniquement (anti-spam inscription), pas sur tout le routeur.
router.post('/', limiterInscription, asyncHandler(async (req, res) => {
  const { prenom, marchand_slug, email, telephone, date_anniversaire, ref } = req.body;

  if (!prenom || !marchand_slug) {
    return res.status(400).json({ error: 'prenom and marchand_slug are required' });
  }
  const prenomPropre = prenom.trim().slice(0, 50);
  if (!prenomPropre) return res.status(400).json({ error: 'Invalid first name' });

  // Récupérer le marchand complet (nécessaire pour Google Wallet + forfait)
  const { data: marchand, error: errMarchand } = await supabase
    .from('marchands')
    .select('id, nom, slug, forfait, langue, max_value, display_max_value, actif, couleur_fond, couleur_fond_reward, couleur_texte, couleur_label, logo_url, image_strip_url, google_logo_url, google_hero_url, images_tiers, how_it_works, referral_enabled, referral_bonus_points, telephone, adresse, strip_mode, strip_theme, stamp_icon, strip_custom_background_url, strip_config_version')
    .eq('slug', marchand_slug)
    .single();

  if (errMarchand || !marchand) return res.status(404).json({ error: 'Merchant not found' });
  if (!marchand.actif) return res.status(403).json({ error: 'This loyalty program is suspended' });

  const serialNumber = uuidv4();
  const clientData = { prenom: prenomPropre, stored_value: 0 };

  // Champs premium (Pro+ uniquement)
  const extraFields = {};
  if (marchand.forfait === 'pro_plus') {
    if (email)             extraFields.email             = String(email).trim().slice(0, 200) || null;
    if (telephone)         extraFields.telephone         = String(telephone).trim().slice(0, 30) || null;
    if (date_anniversaire) extraFields.date_anniversaire = date_anniversaire;
  }

  // Créer le client
  const { data: client, error: errClient } = await supabase
    .from('clients')
    .insert({ marchand_id: marchand.id, prenom: prenomPropre, pass_serial_number: serialNumber, stored_value: 0, ...extraFields })
    .select()
    .single();

  if (errClient) return res.status(500).json({ error: 'Error creating client', detail: errClient.message });

  // Créer l'entrée passes
  await supabase.from('passes').insert({ client_id: client.id, marchand_id: marchand.id, serial_number: serialNumber });

  // RGPD : enregistrer la preuve de consentement horodatée pour chaque champ Pro+ fourni
  if (marchand.forfait === 'pro_plus') {
    const consentements = [];
    if (extraFields.email)             consentements.push({ client_id: client.id, marchand_id: marchand.id, type: 'email',             valeur: true });
    if (extraFields.telephone)         consentements.push({ client_id: client.id, marchand_id: marchand.id, type: 'telephone',         valeur: true });
    if (extraFields.date_anniversaire) consentements.push({ client_id: client.id, marchand_id: marchand.id, type: 'date_anniversaire', valeur: true });
    if (consentements.length > 0) {
      supabase.from('consentements').insert(consentements)
        .then()
        .catch(e => console.error('[clients] consentements insert:', e.message));
    }
  }

  // Parrainage — lier le filleul au parrain si le ref est valide (fire-and-forget)
  if (ref && typeof ref === 'string' && ref.length === 36) {
    linkReferral(client.id, marchand.id, ref)
      .catch(e => console.error('[clients] referral link:', e.message));
  }

  const apiBase = process.env.API_BASE_URL || 'https://app.winwin-card.com';
  const applePassUrl = `${apiBase}/api/passes/${serialNumber}/apple`;

  // Générer l'URL Google Wallet directement (retourner null si non configuré ou erreur)
  let googleWalletUrl = null;
  try {
    const { generateGoogleWalletUrl } = require('../services/google-pass');
    googleWalletUrl = await generateGoogleWalletUrl({ client: clientData, marchand, serialNumber });
    // Persister l'URL Google en base
    await supabase.from('passes').update({ google_pass_url: googleWalletUrl }).eq('serial_number', serialNumber);
  } catch {
    // Google Wallet non configuré ou erreur — on continue sans bloquer l'inscription
  }

  res.status(201).json({
    client_id:        client.id,
    serial_number:    serialNumber,
    prenom:           client.prenom,
    stored_value:     0,
    apple_pass_url:   applePassUrl,
    google_wallet_url: googleWalletUrl,
  });
}));

// GET /api/clients — liste des clients du marchand connecté
router.get('/', authMarchand, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('id, prenom, stored_value, created_at, pass_serial_number, email, telephone, date_anniversaire')
    .eq('marchand_id', req.marchandId)
    .is('deleted_at', null)
    .order('stored_value', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

// GET /api/clients/export — export CSV (Pro+ uniquement)
router.get('/export', authMarchand, asyncHandler(async (req, res) => {
  const { data: marchand } = await supabase
    .from('marchands')
    .select('nom, forfait')
    .eq('id', req.marchandId)
    .single();

  if (marchand?.forfait !== 'pro_plus') {
    return res.status(403).json({ error: 'CSV export is available on the Pro+ plan only.' });
  }

  const { data: clients, error } = await supabase
    .from('clients')
    .select('prenom, stored_value, email, telephone, date_anniversaire, created_at')
    .eq('marchand_id', req.marchandId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  function cell(v) {
    if (v == null || v === '') return '';
    let s = String(v);
    // Neutralise les préfixes de formule CSV (=, +, -, @) pour prévenir l'injection
    // dans Excel / LibreOffice — préfixe l'apostrophe qui force le type texte.
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const header = 'Prénom,Points,Email,Téléphone,Date anniversaire,Inscrit le';
  const rows = (clients || []).map(c => [
    cell(c.prenom),
    cell(c.stored_value),
    cell(c.email),
    cell(c.telephone),
    cell(c.date_anniversaire),
    cell(new Date(c.created_at).toLocaleDateString('fr-FR')),
  ].join(','));

  const csv  = '﻿' + [header, ...rows].join('\r\n'); // BOM pour Excel
  const slug = (marchand.nom || 'clients').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const date = new Date().toISOString().split('T')[0];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="clients-${slug}-${date}.csv"`);
  res.send(csv);
}));

// DELETE /api/clients/:id — droit à l'effacement RGPD
router.delete('/:id', authMarchand, asyncHandler(async (req, res) => {
  const { error } = await supabase.rpc('effacer_client', {
    p_client_id: req.params.id,
    p_marchand_id: req.marchandId
  });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
}));

// GET /api/clients/:id — fiche client + derniers scans
router.get('/:id([0-9a-f\\-]{36})', authMarchand, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: client, error: errClient } = await supabase
    .from('clients')
    .select('id, prenom, stored_value, created_at, pass_serial_number, email, telephone, date_anniversaire')
    .eq('id', id)
    .eq('marchand_id', req.marchandId)
    .is('deleted_at', null)
    .single();

  if (errClient || !client) return res.status(404).json({ error: 'Client introuvable' });

  const { data: scans, error: errScans } = await supabase
    .from('scans')
    .select('id, date_scan, stored_value_avant, stored_value_apres')
    .eq('client_id', id)
    .order('date_scan', { ascending: false })
    .limit(10);

  if (errScans) return res.status(500).json({ error: errScans.message });

  res.json({ client, scans: scans || [] });
}));

// PATCH /api/clients/:id — modifier prénom et/ou points
router.patch('/:id([0-9a-f\\-]{36})', authMarchand, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { prenom, stored_value } = req.body;

  const updates = {};
  if (prenom !== undefined) {
    const prenomPropre = String(prenom).trim().slice(0, 50);
    if (!prenomPropre) return res.status(400).json({ error: 'Invalid first name' });
    updates.prenom = prenomPropre;
  }
  if (stored_value !== undefined) {
    const val = parseInt(stored_value, 10);
    if (isNaN(val) || val < 0 || val > 99) return res.status(400).json({ error: 'stored_value must be an integer between 0 and 99' });
    updates.stored_value = val;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'At least one field required: prenom or stored_value' });
  }

  // UPDATE atomique : la vérification d'appartenance est dans le WHERE (id +
  // marchand_id + deleted_at). Plus de read-then-write : une seule requête.
  const { data: updated, error: errUpdate } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', id)
    .eq('marchand_id', req.marchandId)
    .is('deleted_at', null)
    .select('id, prenom, stored_value, created_at, pass_serial_number')
    .single();

  if (errUpdate || !updated) return res.status(404).json({ error: 'Client not found' });

  // Si stored_value modifié : mettre à jour le pass Apple en arrière-plan
  if (updates.stored_value !== undefined && updated.pass_serial_number) {
    syncPassAfterAdjustment(updated.pass_serial_number, req.marchandId, updated.prenom, updates.stored_value)
      .catch(e => console.error('[clients] sync pass:', e.message));
  }

  res.json({ id: updated.id, prenom: updated.prenom, stored_value: updated.stored_value, created_at: updated.created_at });
}));

async function syncPassAfterAdjustment(serialNumber, marchandId, prenom, newValue) {
  console.log(`[clients] syncPass START serial=${serialNumber} prenom=${prenom} newValue=${newValue}`);

  const { data: marchand } = await supabase
    .from('marchands')
    .select('id, nom, slug, forfait, langue, max_value, display_max_value, images_tiers, couleur_fond, couleur_fond_reward, logo_url, strip_mode, strip_theme, stamp_icon, strip_custom_background_url, strip_config_version')
    .eq('id', marchandId)
    .single();

  if (!marchand) {
    console.warn('[clients] syncPass: marchand introuvable, abandon');
    return;
  }

  const displayMax = marchand.display_max_value || marchand.max_value || '?';
  const msg = notif('pointsAdjusted', marchand.langue, { prenom, value: newValue, max: displayMax });

  // Toujours mettre à jour passes.notification_message (et updated_at via trigger).
  // Cela permet à Apple Wallet de récupérer le pass lors de son prochain check
  // périodique, même sans push APNs.
  const { error: passErr } = await supabase.from('passes')
    .update({ notification_message: msg, updated_at: new Date().toISOString() })
    .eq('serial_number', serialNumber)
    .eq('marchand_id', marchandId);
  if (passErr) console.error('[clients] syncPass: passes update error:', passErr.message);
  else console.log('[clients] syncPass: passes.notification_message + updated_at mis à jour');

  // Apple Wallet — silent APNs push si configuré
  const { isApnsConfigured, sendPushUpdate } = require('../services/apns');
  if (!isApnsConfigured()) {
    console.warn('[clients] syncPass: APNs non configuré (APPLE_APN_KEY_ID ou clé manquante) — push ignoré');
  } else {
    const { data: tokens } = await supabase
      .from('device_tokens')
      .select('push_token')
      .eq('serial_number', serialNumber);

    console.log(`[clients] syncPass: ${(tokens || []).length} device token(s) trouvé(s) pour serial=${serialNumber}`);

    for (const { push_token } of (tokens || [])) {
      await sendPushUpdate(push_token)
        .then(() => console.log(`[clients] syncPass: push OK token=…${push_token.slice(-8)}`))
        .catch(e => console.error(`[clients] syncPass: push FAILED token=…${push_token.slice(-8)}:`, e.message));
    }
  }

  // Google Wallet — update points, tier hero image, and push notification
  const { updateLoyaltyObjectPoints, addMessageToLoyaltyObject, isConfigured: isGoogleConfigured } = require('../services/google-pass');
  if (isGoogleConfigured()) {
    await updateLoyaltyObjectPoints(serialNumber, marchandId, newValue, marchand.max_value, marchand.display_max_value || marchand.max_value, marchand.images_tiers, prenom, marchand.couleur_fond, marchand.couleur_fond_reward, marchand)
      .catch(e => console.error('[clients] Google update:', e.message));
    addMessageToLoyaltyObject(serialNumber, null, msg)
      .catch(e => console.error('[clients] Google notify:', e.message));
  }
}

async function linkReferral(filleulId, marchandId, refSerial) {
  const { data: parrain } = await supabase
    .from('clients')
    .select('id')
    .eq('pass_serial_number', refSerial)
    .eq('marchand_id', marchandId)
    .is('deleted_at', null)
    .single();

  if (!parrain || parrain.id === filleulId) return; // serial invalide ou auto-parrainage

  await supabase
    .from('clients')
    .update({ referred_by_client_id: parrain.id })
    .eq('id', filleulId);

  console.log(`[clients] referral linked: filleul=${filleulId} parrain=${parrain.id}`);
}

// GET /api/clients/admin/all — vision globale admin
router.get('/admin/all', authAdmin, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('id, prenom, stored_value, created_at, marchand_id, marchands(nom)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

module.exports = router;
