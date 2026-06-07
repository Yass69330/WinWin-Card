const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');

// Vérifie le token ApplePass envoyé par Apple sur le webservice
function verifyAppleToken(req, serialNumber) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('ApplePass ')) return false;
  const token = header.slice(10);
  const { computeAuthToken } = require('../services/apple-pass');
  const expected = computeAuthToken(serialNumber);
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

// ============================================================
// Endpoints standard Apple Wallet (WebService URL)
// Apple appelle ces routes automatiquement — ne pas modifier les chemins.
// Ref: https://developer.apple.com/library/archive/documentation/PassKit/Reference/PassKit_WebService/WebService.html
// ============================================================

// POST /v1/devices/:deviceId/registrations/:passTypeId/:serialNumber
// Apple envoie ce token quand le client installe son pass
router.post('/v1/devices/:deviceId/registrations/:passTypeId/:serialNumber', asyncHandler(async (req, res) => {
  const { deviceId, serialNumber } = req.params;
  const { pushToken } = req.body;

  if (!verifyAppleToken(req, serialNumber)) return res.status(401).send();
  if (!pushToken) return res.status(400).send();

  // Récupérer le pass et le client associé
  const { data: pass } = await supabase
    .from('passes')
    .select('id, client_id, marchand_id')
    .eq('serial_number', serialNumber)
    .single();

  if (!pass) return res.status(404).send();

  // Upsert du device token (un client peut réinstaller son pass)
  const { error } = await supabase
    .from('device_tokens')
    .upsert({
      pass_id: pass.id,
      client_id: pass.client_id,
      marchand_id: pass.marchand_id,
      serial_number: serialNumber,
      device_id: deviceId,
      push_token: pushToken
    }, { onConflict: 'device_id,serial_number' });

  if (error) return res.status(500).send();

  res.status(201).send();

  // Welcome push — fire and forget après la réponse 201
  sendWelcomePush(serialNumber, pushToken, pass.marchand_id)
    .catch(e => console.error('[apple-wallet] Welcome push:', e.message));
}));

// DELETE /v1/devices/:deviceId/registrations/:passTypeId/:serialNumber
// Apple envoie ce DELETE quand le client supprime son pass
router.delete('/v1/devices/:deviceId/registrations/:passTypeId/:serialNumber', asyncHandler(async (req, res) => {
  const { deviceId, serialNumber } = req.params;

  const { error } = await supabase
    .from('device_tokens')
    .delete()
    .eq('device_id', deviceId)
    .eq('serial_number', serialNumber);

  if (error) return res.status(500).send();
  res.status(200).send();
}));

// GET /v1/devices/:deviceId/registrations/:passTypeId
// Apple demande la liste des serials mis à jour depuis lastUpdated
router.get('/v1/devices/:deviceId/registrations/:passTypeId', asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const { passesUpdatedSince } = req.query;

  const query = supabase
    .from('device_tokens')
    .select('serial_number, passes(updated_at)')
    .eq('device_id', deviceId);

  if (passesUpdatedSince) {
    query.gt('passes.updated_at', passesUpdatedSince);
  }

  const { data } = await query;

  if (!data || data.length === 0) {
    return res.status(204).send();
  }

  const serialNumbers = data.map(d => d.serial_number);
  const lastUpdated = new Date().toISOString();

  res.json({ serialNumbers, lastUpdated });
}));

// GET /v1/passes/:passTypeId/:serialNumber
// Apple télécharge le pass mis à jour (appelé après push APNs)
router.get('/v1/passes/:passTypeId/:serialNumber', asyncHandler(async (req, res) => {
  const { serialNumber } = req.params;
  const ifModifiedSince = req.headers['if-modified-since'];

  if (!verifyAppleToken(req, serialNumber)) return res.status(401).send();

  const { data: pass, error: errPass } = await supabase
    .from('passes')
    .select('updated_at, client_id, marchand_id, notification_message')
    .eq('serial_number', serialNumber)
    .single();

  if (errPass) {
    console.error('[apple-wallet] Erreur SELECT pass:', errPass.message);
    return res.status(404).send();
  }
  if (!pass) return res.status(404).send();

  // Si pas de changement depuis la dernière synchro
  if (ifModifiedSince && new Date(pass.updated_at) <= new Date(ifModifiedSince)) {
    return res.status(304).send();
  }

  // Récupérer les données à jour pour régénérer le pass
  const { data: client } = await supabase
    .from('clients')
    .select('prenom, stored_value')
    .eq('id', pass.client_id)
    .single();

  const { data: marchand } = await supabase
    .from('marchands')
    .select('nom, slug, pass_display_name, couleur_fond, couleur_texte, couleur_label, logo_url, icon_url, image_strip_url, images_tiers, max_value, display_max_value, notification_titre, notification_message, referral_enabled, referral_bonus_points')
    .eq('id', pass.marchand_id)
    .single();

  if (!client || !marchand) return res.status(404).send();

  const { generateApplePass } = require('../services/apple-pass');

  try {
    const pkpassBuffer = await generateApplePass({ client, marchand, serialNumber, passNotification: pass.notification_message });

    res.removeHeader('Cross-Origin-Resource-Policy');
    res.removeHeader('Cross-Origin-Embedder-Policy');
    res.removeHeader('Cross-Origin-Opener-Policy');
    res.removeHeader('X-Download-Options');

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Length', pkpassBuffer.length);
    res.setHeader('Last-Modified', new Date(pass.updated_at).toUTCString());
    res.statusCode = 200;
    res.end(pkpassBuffer);
  } catch (err) {
    res.status(500).send();
  }
}));

// ── Welcome push ─────────────────────────────────────────────
// Envoyé à l'installation du pass — met à jour notification_message,
// puis envoie un push silencieux pour que iOS affiche le changeMessage.
async function sendWelcomePush(serialNumber, pushToken, marchandId) {
  const { data: marchand } = await supabase
    .from('marchands')
    .select('nom')
    .eq('id', marchandId)
    .single();

  if (!marchand) return;

  const msg = `Welcome to ${marchand.nom}! Collect points with every visit.`;

  await supabase.from('passes')
    .update({ notification_message: msg, updated_at: new Date().toISOString() })
    .eq('serial_number', serialNumber);

  const { isApnsConfigured, sendPushUpdate } = require('../services/apns');
  if (isApnsConfigured()) {
    await sendPushUpdate(pushToken);
    console.log(`[apple-wallet] Welcome push OK — serial=${serialNumber}`);
  }
}

// GET /v1/log — Apple envoie des logs d'erreur ici
router.post('/v1/log', (req, res) => {
  console.error('[Apple Wallet log]', JSON.stringify(req.body));
  res.status(200).send();
});

module.exports = router;
