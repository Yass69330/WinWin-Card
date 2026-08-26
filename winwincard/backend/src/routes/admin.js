const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { authAdmin } = require('../middleware/auth');

// POST /api/admin/login — authentification admin par mot de passe global
router.post('/login', asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD non configuré côté serveur' });
  }
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
  res.json({ token });
}));

// GET /api/admin/marchands — liste complète avec stats par marchand
router.get('/marchands', authAdmin, asyncHandler(async (req, res) => {
  const [
    { data: marchands, error },
    { data: clientRows },
    { data: scanRows },
    { data: boutiqueRows },
  ] = await Promise.all([
    supabase
      .from('marchands')
      .select('id, nom, slug, forfait, actif, email_contact, couleur_fond, logo_url, max_value, type_programme, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('clients').select('marchand_id').is('deleted_at', null),
    supabase.from('scans').select('marchand_id').gte('date_scan', new Date().toISOString().split('T')[0]).is('annule_le', null),
    // Boutiques ACTIVES par marchand = base de facturation (multi-boutiques).
    supabase.from('points_de_vente').select('marchand_id').is('deleted_at', null),
  ]);

  if (error) return res.status(500).json({ error: error.message });

  const clientsParMarchand   = {};
  const scansParMarchand     = {};
  const boutiquesParMarchand = {};
  (clientRows   || []).forEach(c => { clientsParMarchand[c.marchand_id]   = (clientsParMarchand[c.marchand_id]   || 0) + 1; });
  (scanRows     || []).forEach(s => { scansParMarchand[s.marchand_id]     = (scansParMarchand[s.marchand_id]     || 0) + 1; });
  (boutiqueRows || []).forEach(b => { boutiquesParMarchand[b.marchand_id] = (boutiquesParMarchand[b.marchand_id] || 0) + 1; });

  res.json(marchands.map(m => ({
    ...m,
    total_clients:     clientsParMarchand[m.id]   || 0,
    scans_aujourdhui:  scansParMarchand[m.id]     || 0,
    boutiques_actives: boutiquesParMarchand[m.id] || 0,
  })));
}));

// GET /api/admin/marchands/:id — détail complet d'un marchand
router.get('/marchands/:id', authAdmin, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('marchands')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Marchand introuvable' });
  res.json(data);
}));

// ── Points de vente (boutiques) — création / liste / archivage (ADMIN) ──────
// Multi-boutiques, étape 2. Création et archivage RÉSERVÉS À L'ADMIN car ils
// changent le nombre de boutiques actives = la base de facturation. Le
// franchiseur, lui, ne peut que lister et renommer (merchants.js /me/...).

// GET /api/admin/marchands/:id/points-de-vente — boutiques actives d'un réseau
// Expose scanner_login + actif (jamais scanner_password_hash — règle d'hygiène).
router.get('/marchands/:id/points-de-vente', authAdmin, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('points_de_vente')
    .select('id, nom, created_at, scanner_login, actif')
    .eq('marchand_id', req.params.id)
    .is('deleted_at', null)
    .order('nom');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
}));

// POST /api/admin/marchands/:id/points-de-vente — créer une boutique (facturable)
router.post('/marchands/:id/points-de-vente', authAdmin, asyncHandler(async (req, res) => {
  const nom = typeof req.body.nom === 'string' ? req.body.nom.trim().slice(0, 80) : '';
  if (!nom) return res.status(400).json({ error: 'nom est requis' });

  const { data: marchand } = await supabase.from('marchands').select('id').eq('id', req.params.id).single();
  if (!marchand) return res.status(404).json({ error: 'Marchand introuvable' });

  const { data, error } = await supabase
    .from('points_de_vente')
    .insert({ marchand_id: req.params.id, nom })
    .select('id, nom, created_at')
    .single();

  // 23505 = violation de l'index unique (marchand_id, lower(nom)) où deleted_at is null.
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Une boutique active porte déjà ce nom' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
}));

// DELETE /api/admin/points-de-vente/:id — archiver une boutique (réduit la facturation)
// Soft-delete : deleted_at renseigné, l'historique des scans reste intact et le
// nom redevient réutilisable (l'index unique n'exclut que les boutiques actives).
router.delete('/points-de-vente/:id', authAdmin, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('points_de_vente')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .is('deleted_at', null)
    .select('id, nom')
    .single();

  if (error) return res.status(404).json({ error: 'Boutique introuvable ou déjà archivée' });
  res.json({ archived: true, ...data });
}));

// PATCH /api/admin/points-de-vente/:id/scanner — définir/réinitialiser les
// identifiants scanner d'une boutique (provisioning, étape 3b — ADMIN).
// Hash via hashPassword (identique à l'auth marchand). Ne renvoie JAMAIS le
// hash. Collision de login (index unique lower(scanner_login)) → 409 propre.
// Lot INERTE : rien ne lit encore ces identifiants (l'enforcement est en 3c).
router.patch('/points-de-vente/:id/scanner', authAdmin, asyncHandler(async (req, res) => {
  const login    = typeof req.body.scanner_login === 'string' ? req.body.scanner_login.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (login.length < 3)    return res.status(400).json({ error: 'scanner_login requis (min 3 caractères)' });
  if (password.length < 6) return res.status(400).json({ error: 'password requis (min 6 caractères)' });

  const { hashPassword } = require('../services/auth-utils');
  const scanner_password_hash = await hashPassword(password);

  const { data, error } = await supabase
    .from('points_de_vente')
    // Stocké en minuscules → match de login sûr et insensible à la casse
    // (le login PWA compare en minuscules ; cohérent avec l'index unique lower()).
    .update({ scanner_login: login.toLowerCase(), scanner_password_hash })
    .eq('id', req.params.id)
    .is('deleted_at', null)
    .select('id, nom, scanner_login, actif') // jamais le hash
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ce login scanner est déjà utilisé' });
    return res.status(404).json({ error: 'Boutique introuvable ou archivée' });
  }
  res.json(data);
}));

// POST /api/admin/marchands — créer un marchand
router.post('/marchands', authAdmin, asyncHandler(async (req, res) => {
  const {
    nom, slug, email_contact, password, forfait, langue, type_programme,
    couleur_fond, couleur_texte, couleur_label,
    logo_url, icon_url, image_strip_url, google_logo_url, google_hero_url,
    texte_landing, pass_display_name, max_value, display_max_value, images_tiers,
  } = req.body;

  if (!nom || !slug || !email_contact || !password) {
    return res.status(400).json({ error: 'nom, slug, email_contact et password sont requis' });
  }

  const { data: existing } = await supabase.from('marchands').select('id').eq('slug', slug).single();
  if (existing) return res.status(409).json({ error: 'Ce slug est déjà utilisé' });

  const { hashPassword } = require('../services/auth-utils');
  const password_hash = await hashPassword(password);

  const { data, error } = await supabase
    .from('marchands')
    .insert({
      nom, slug, email_contact, password_hash,
      forfait:       ['basic', 'pro', 'pro_plus'].includes(forfait) ? forfait : 'pro',
      langue:        ['fr', 'en'].includes(langue) ? langue : 'en',
      type_programme: ['stamps', 'points'].includes(type_programme) ? type_programme : 'stamps',
      couleur_fond:  couleur_fond  || '#ffffff',
      couleur_texte: couleur_texte || '#000000',
      couleur_label: couleur_label || '#888888',
      logo_url, icon_url, image_strip_url, google_logo_url, google_hero_url,
      texte_landing, pass_display_name: pass_display_name || null, images_tiers,
      max_value: max_value || 10,
      display_max_value: display_max_value || null,
      actif: true,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const { createOrUpdateLoyaltyClass } = require('../services/google-pass');
  createOrUpdateLoyaltyClass(data).catch(e => console.error('[Google Wallet] classe:', e.message));

  res.status(201).json(data);
}));

// PATCH /api/admin/marchands/:id — modifier un marchand
router.patch('/marchands/:id', authAdmin, asyncHandler(async (req, res) => {
  // Champs visuels qui déclenchent un bump de strip_config_version
  const VISUAL_FIELDS = new Set([
    'couleur_fond', 'couleur_fond_reward', 'logo_url', 'nom', 'pass_display_name',
    'strip_mode', 'strip_theme', 'stamp_icon', 'strip_custom_background_url', 'max_value', 'strip_label',
    'type_programme',
    'couleur_pastille_fond', 'couleur_pastille_contour', 'couleur_pastille_icone',
    'couleur_label_strip',
    'couleur_barre_principale', 'couleur_barre_secondaire',
  ]);

  const ALLOWED = [
    'nom', 'email_contact', 'notification_quota_override', 'langue', 'type_programme',
    'couleur_fond', 'couleur_texte', 'couleur_texte_reward', 'couleur_label',
    'logo_url', 'logo_reward_url', 'icon_url', 'image_strip_url', 'images_tiers',
    'google_logo_url', 'google_hero_url',
    'texte_landing', 'pass_display_name', 'max_value', 'display_max_value', 'forfait',
    'workflow_inactive_enabled', 'workflow_inactive_days',
    'workflow_near_reward_enabled', 'workflow_near_reward_threshold',
    'workflow_birthday_enabled', 'workflow_birthday_message',
    'landing_premium',
    'telephone', 'adresse',
    'referral_enabled', 'referral_bonus_points',
    'how_it_works', 'workflow_inactive_message',
    'couleur_fond_reward',
    'couleur_pastille_fond', 'couleur_pastille_contour', 'couleur_pastille_icone',
    'couleur_barre_principale', 'couleur_barre_secondaire',
    'couleur_label_strip',
    // Champs générateur de strip (aucun gating forfait côté admin)
    'strip_mode', 'strip_theme', 'stamp_icon', 'strip_custom_background_url', 'strip_label',
    'freq_seuil_bas', 'freq_seuil_haut',
  ];

  const updates = {};
  for (const field of ALLOWED) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  // Seuils de fréquence : entiers cohérents. Le formulaire admin envoie toujours
  // les deux ensemble → la comparaison bas ≤ haut est fiable ici (le CHECK DB
  // reste le filet en cas d'appel partiel). On renvoie un 400 propre.
  for (const k of ['freq_seuil_bas', 'freq_seuil_haut']) {
    if (updates[k] !== undefined) {
      const v = parseInt(updates[k], 10);
      if (!Number.isInteger(v) || v < 1 || v > 1000) {
        return res.status(400).json({ error: `${k} doit être un entier entre 1 et 1000` });
      }
      updates[k] = v;
    }
  }
  if (updates.freq_seuil_bas !== undefined && updates.freq_seuil_haut !== undefined
      && updates.freq_seuil_bas > updates.freq_seuil_haut) {
    return res.status(400).json({ error: 'freq_seuil_bas doit être ≤ freq_seuil_haut' });
  }

  // Bump strip_config_version si un champ visuel a changé
  const hasVisualChange = Object.keys(updates).some(f => VISUAL_FIELDS.has(f));
  if (hasVisualChange) {
    const { data: cur } = await supabase.from('marchands').select('strip_config_version').eq('id', req.params.id).single();
    updates.strip_config_version = (cur?.strip_config_version || 1) + 1;
  }

  // Réinitialisation du mot de passe (optionnel)
  if (req.body.new_password) {
    const { hashPassword } = require('../services/auth-utils');
    updates.password_hash = await hashPassword(req.body.new_password);
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Aucun champ valide à modifier' });
  }

  const { data, error } = await supabase
    .from('marchands').update(updates).eq('id', req.params.id).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const { createOrUpdateLoyaltyClass } = require('../services/google-pass');
  createOrUpdateLoyaltyClass(data).catch(e => console.error('[Google Wallet] classe:', e.message));

  res.json(data);
}));

// PATCH /api/admin/marchands/:id/suspension — bloquer ou débloquer
router.patch('/marchands/:id/suspension', authAdmin, asyncHandler(async (req, res) => {
  const { actif } = req.body;
  if (typeof actif !== 'boolean') return res.status(400).json({ error: 'actif (boolean) requis' });

  const { data, error } = await supabase
    .from('marchands').update({ actif }).eq('id', req.params.id).select('id, nom, actif').single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

// GET /api/admin/marchands/:id/strip-preview — rendu PNG du strip sans cache Storage
// Query: filled (0..max_value), theme (override), icon (override), variant (strip2x|strip3x|hero)
router.get('/marchands/:id/strip-preview', authAdmin, asyncHandler(async (req, res) => {
  const { data: marchand, error } = await supabase
    .from('marchands')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error || !marchand) return res.status(404).json({ error: 'Marchand introuvable' });

  // Overrides depuis la query string (pour tester les thèmes sans persister)
  const maxValue  = parseInt(req.query.max_value) || marchand.max_value || 10;
  const filled    = Math.min(Math.max(parseInt(req.query.filled  ?? 0), 0), maxValue);
  const variant   = ['strip2x', 'strip3x', 'hero'].includes(req.query.variant) ? req.query.variant : 'strip2x';

  const previewMarchand = {
    ...marchand,
    max_value:   maxValue,
    strip_mode:  req.query.mode   || marchand.strip_mode  || 'stamps',
    strip_theme: req.query.theme  || marchand.strip_theme || 'icon_metier',
    stamp_icon:  req.query.icon   || marchand.stamp_icon  || 'coffee',
    strip_label: req.query.label  || 'on',
  };

  const { render } = require('../services/strip-generator');
  const { fetchImage } = require('../services/apple-pass');

  const logoBuffer = previewMarchand.logo_url
    ? await fetchImage(previewMarchand.logo_url).catch(() => null)
    : null;
  const customBgBuffer = previewMarchand.strip_custom_background_url && previewMarchand.forfait === 'pro_plus'
    ? await fetchImage(previewMarchand.strip_custom_background_url).catch(() => null)
    : null;

  const buffers = await render({ marchand: previewMarchand, filledCount: filled, logoBuffer, customBgBuffer });
  const buf = buffers[variant];

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `inline; filename="preview-${marchand.slug}-${filled}.png"`);
  res.end(buf);
}));

// GET /api/admin/stats — statistiques globales
router.get('/stats', authAdmin, asyncHandler(async (req, res) => {
  const [
    { count: marchandsActifs },
    { count: totalClients },
    { count: totalScans },
  ] = await Promise.all([
    supabase.from('marchands').select('*', { count: 'exact', head: true }).eq('actif', true),
    supabase.from('clients').select('*',   { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('scans').select('*',     { count: 'exact', head: true }).is('annule_le', null),
  ]);

  res.json({ marchands_actifs: marchandsActifs, total_clients: totalClients, total_scans: totalScans });
}));

// GET /api/admin/debug/pass/:serialNumber — état complet d'un pass (device tokens, passes row, APNs)
router.get('/debug/pass/:serialNumber', authAdmin, asyncHandler(async (req, res) => {
  const { serialNumber } = req.params;
  const { isApnsConfigured } = require('../services/apns');

  const [
    { data: pass,   error: errPass },
    { data: tokens, error: errTokens },
    { data: client, error: errClient },
  ] = await Promise.all([
    supabase.from('passes')
      .select('id, client_id, marchand_id, serial_number, notification_message, updated_at, created_at')
      .eq('serial_number', serialNumber)
      .single(),
    supabase.from('device_tokens')
      .select('id, device_id, push_token, created_at')
      .eq('serial_number', serialNumber),
    supabase.from('clients')
      .select('id, prenom, stored_value, pass_serial_number, deleted_at')
      .eq('pass_serial_number', serialNumber)
      .single(),
  ]);

  res.json({
    apns: {
      configured:  isApnsConfigured(),
      key_id_set:  !!process.env.APPLE_APN_KEY_ID,
      key_set:     !!(process.env.APPLE_APN_KEY_B64 || process.env.APPLE_APN_KEY),
      node_env:    process.env.NODE_ENV || '(non défini)',
      endpoint:    process.env.NODE_ENV === 'production' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com',
    },
    pass: errPass ? { error: errPass.message } : pass,
    client: errClient ? { error: errClient.message } : client,
    device_tokens: {
      count: (tokens || []).length,
      error: errTokens?.message || null,
      tokens: (tokens || []).map(t => ({
        ...t,
        push_token: `…${t.push_token.slice(-12)}`,  // tronqué pour sécurité
      })),
    },
  });
}));

// GET /api/admin/debug/certs — diagnostic certificats Apple Wallet (admin requis)
// Inspecte les certs chargés en mémoire sans exposer les clés privées.
router.get('/debug/certs', authAdmin, (req, res) => {
  const crypto = require('crypto');
  const fs     = require('fs');
  const path   = require('path');

  function loadRaw(b64Key, fileKey, defaultPath) {
    if (process.env[b64Key]) return { buf: Buffer.from(process.env[b64Key], 'base64'), src: 'base64' };
    const p = process.env[fileKey] || defaultPath;
    return { buf: fs.readFileSync(path.resolve(p)), src: p };
  }

  function extractPemInfo(raw) {
    const str = raw.toString('utf8');
    const hasBagAttributes = str.includes('Bag Attributes');
    const matches = [...str.matchAll(/(-----BEGIN [\w ]+-----[\s\S]+?-----END [\w ]+-----)/g)];
    return {
      rawLength:         raw.length,
      hasBagAttributes,
      pemBlocksFound:    matches.length,
      pemTypes:          matches.map(m => m[1].match(/-----BEGIN ([\w ]+)-----/)?.[1] ?? '?'),
      firstBlockLength:  matches[0]?.[1].length ?? 0,
      firstLine:         matches[0]?.[1].split('\n')[0] ?? '(aucun)',
      sha256:            crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16) + '…',
    };
  }

  try {
    const rawSigner = loadRaw('APPLE_SIGNER_CERT_B64', 'APPLE_SIGNER_CERT', './certs/signerCert.pem');
    const rawWwdr   = loadRaw('APPLE_WWDR_CERT_B64',   'APPLE_WWDR_CERT',   './certs/wwdr.pem');
    const rawKey    = loadRaw('APPLE_SIGNER_KEY_B64',  'APPLE_SIGNER_KEY',  './certs/signerKey.pem');

    const { loadCerts } = require('../services/apple-pass');
    const certs = loadCerts();

    const signerX509 = new crypto.X509Certificate(certs.signerCert);
    const wwdrX509   = new crypto.X509Certificate(certs.wwdr);
    const now        = new Date();

    // Vérification chaîne : issuer du signerCert doit correspondre au subject du WWDR
    const chainValid = signerX509.issuer === wwdrX509.subject;

    res.json({
      env: {
        APPLE_PASS_TYPE_IDENTIFIER: process.env.APPLE_PASS_TYPE_IDENTIFIER || '(non défini)',
        APPLE_TEAM_ID:              process.env.APPLE_TEAM_ID              || '(non défini)',
        APPLE_PASS_PHRASE:          process.env.APPLE_PASS_PHRASE ? '(défini)' : '(manquant)',
        source_signer: rawSigner.src,
        source_wwdr:   rawWwdr.src,
        source_key:    rawKey.src,
      },
      chainValid,
      signerCert: {
        subject:      signerX509.subject,
        issuer:       signerX509.issuer,
        validFrom:    signerX509.validFrom,
        validTo:      signerX509.validTo,
        expired:      now > new Date(signerX509.validTo),
        fingerprint256: signerX509.fingerprint256,  // SHA256 du DER — comparaison canonique
        cleanedSize:  certs.signerCert.length,
        raw:          extractPemInfo(rawSigner.buf),
      },
      signerKey: {
        cleanedSize:        certs.signerKey.length,
        hasBlock:           certs.signerKey.toString().includes('PRIVATE KEY'),
        encrypted:          certs.signerKey.toString().includes('ENCRYPTED PRIVATE KEY') ||
                            certs.signerKey.toString().includes('Proc-Type: 4,ENCRYPTED'),
        passphraseProvided: !!process.env.APPLE_PASS_PHRASE,
        raw:                extractPemInfo(rawKey.buf),
      },
      wwdr: {
        subject:      wwdrX509.subject,
        issuer:       wwdrX509.issuer,
        validFrom:    wwdrX509.validFrom,
        validTo:      wwdrX509.validTo,
        expired:      now > new Date(wwdrX509.validTo),
        fingerprint256: wwdrX509.fingerprint256,
        cleanedSize:  certs.wwdr.length,
        raw:          extractPemInfo(rawWwdr.buf),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack?.split('\n').slice(0, 5) });
  }
});

// ── Google Wallet Admin ──────────────────────────────────────

// GET /api/admin/google-wallet/diagnostic — état de toutes les LoyaltyClasses
router.get('/google-wallet/diagnostic', authAdmin, asyncHandler(async (req, res) => {
  const gp = require('../services/google-pass');
  if (!gp.isConfigured()) {
    return res.json({
      configured: false,
      missing: [
        !process.env.GOOGLE_SERVICE_ACCOUNT_JSON && 'GOOGLE_SERVICE_ACCOUNT_JSON',
        !process.env.GOOGLE_WALLET_ISSUER_ID     && 'GOOGLE_WALLET_ISSUER_ID',
      ].filter(Boolean),
    });
  }

  const { data: marchands } = await supabase
    .from('marchands').select('id, nom, slug, actif').order('created_at');

  const classes = await Promise.all(
    (marchands || []).map(async (m) => {
      try {
        const info = await gp.getClassInfo(m);
        return { marchand_id: m.id, nom: m.nom, slug: m.slug, actif: m.actif, ...info };
      } catch (e) {
        return { marchand_id: m.id, nom: m.nom, slug: m.slug, actif: m.actif, exists: false, error: e.message };
      }
    })
  );

  res.json({
    configured:      true,
    issuer_id:       process.env.GOOGLE_WALLET_ISSUER_ID,
    total:           classes.length,
    missing_classes: classes.filter(c => !c.exists).length,
    classes,
  });
}));

// POST /api/admin/google-wallet/class/:marchandId — créer/mettre à jour une LoyaltyClass
router.post('/google-wallet/class/:marchandId', authAdmin, asyncHandler(async (req, res) => {
  const { isConfigured, createOrUpdateLoyaltyClass } = require('../services/google-pass');
  if (!isConfigured()) return res.status(503).json({ error: 'Google Wallet non configuré' });

  const { data: marchand } = await supabase.from('marchands').select('*').eq('id', req.params.marchandId).single();
  if (!marchand) return res.status(404).json({ error: 'Marchand introuvable' });

  try {
    const result = await createOrUpdateLoyaltyClass(marchand);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// POST /api/admin/google-wallet/classes/sync — synchronise toutes les classes actives
router.post('/google-wallet/classes/sync', authAdmin, asyncHandler(async (req, res) => {
  const { isConfigured, createOrUpdateLoyaltyClass } = require('../services/google-pass');
  if (!isConfigured()) return res.status(503).json({ error: 'Google Wallet non configuré' });

  const { data: marchands } = await supabase.from('marchands').select('*').eq('actif', true);
  const results = [];

  for (const m of marchands || []) {
    try {
      const r = await createOrUpdateLoyaltyClass(m);
      results.push({ marchand_id: m.id, nom: m.nom, ...r });
    } catch (e) {
      results.push({ marchand_id: m.id, nom: m.nom, error: e.message });
    }
  }

  const errors = results.filter(r => r.error).length;
  res.json({ synced: results.length, errors, results });
}));

// ── Upload strip images par tier ────────────────────────────────

const multer    = require('multer');
const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Fichier image requis (PNG, JPEG, WebP…)'));
    }
    cb(null, true);
  },
});

// POST /api/admin/marchands/:id/assets — upload d'une strip image pour un tier exact
router.post('/marchands/:id/assets', authAdmin, (req, res, next) => {
  uploadMem.single('image')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, asyncHandler(async (req, res) => {
  const tier = parseInt(req.body.tier);
  if (isNaN(tier) || tier < 0 || tier > 99) {
    return res.status(400).json({ error: 'tier doit être un entier entre 0 et 99' });
  }
  if (!req.file) return res.status(400).json({ error: 'image requise' });

  const { data: marchand, error: errM } = await supabase
    .from('marchands').select('id, slug, images_tiers').eq('id', req.params.id).single();
  if (errM || !marchand) return res.status(404).json({ error: 'Marchand introuvable' });

  // Crée le bucket si inexistant (idempotent — échoue silencieusement si déjà présent)
  await supabase.storage.createBucket('passes', { public: true }).catch(() => {});

  const filePath = `marchands/${marchand.slug}/strip_tier_${tier}.png`;
  const { error: upErr } = await supabase.storage
    .from('passes')
    .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
  if (upErr) return res.status(500).json({ error: `Upload Storage: ${upErr.message}` });

  const { data: { publicUrl } } = supabase.storage.from('passes').getPublicUrl(filePath);

  // Upsert dans images_tiers — remplace l'entrée exacte si elle existe déjà
  const tiers = Array.isArray(marchand.images_tiers) ? [...marchand.images_tiers] : [];
  const idx   = tiers.findIndex(t => t.min === tier && t.max === tier);
  const entry = { min: tier, max: tier, url: publicUrl };
  if (idx >= 0) tiers[idx] = entry;
  else tiers.push(entry);
  tiers.sort((a, b) => a.min - b.min);

  const { data: updated, error: errU } = await supabase
    .from('marchands').update({ images_tiers: tiers }).eq('id', req.params.id)
    .select('id, images_tiers').single();
  if (errU) return res.status(500).json({ error: errU.message });

  res.json({ tier, url: publicUrl, images_tiers: updated.images_tiers });
}));

// DELETE /api/admin/marchands/:id/assets/:tier — supprime la strip image du tier exact
router.delete('/marchands/:id/assets/:tier', authAdmin, asyncHandler(async (req, res) => {
  const tier = parseInt(req.params.tier);
  if (isNaN(tier)) return res.status(400).json({ error: 'tier invalide' });

  const { data: marchand, error: errM } = await supabase
    .from('marchands').select('id, slug, images_tiers').eq('id', req.params.id).single();
  if (errM || !marchand) return res.status(404).json({ error: 'Marchand introuvable' });

  // Suppression fichier Storage — fire-and-forget (ne bloque pas si déjà absent)
  supabase.storage.from('passes')
    .remove([`marchands/${marchand.slug}/strip_tier_${tier}.png`])
    .catch(() => {});

  const tiers = Array.isArray(marchand.images_tiers)
    ? marchand.images_tiers.filter(t => !(t.min === tier && t.max === tier))
    : [];

  const { data: updated, error: errU } = await supabase
    .from('marchands').update({ images_tiers: tiers.length ? tiers : null })
    .eq('id', req.params.id).select('id, images_tiers').single();
  if (errU) return res.status(500).json({ error: errU.message });

  res.json({ tier, images_tiers: updated.images_tiers });
}));

// POST /api/admin/marchands/:id/strip-static — upload image statique universelle
router.post('/marchands/:id/strip-static', authAdmin, (req, res, next) => {
  uploadMem.single('image')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'image requise' });

  const { data: marchand, error: errM } = await supabase
    .from('marchands').select('id, slug').eq('id', req.params.id).single();
  if (errM || !marchand) return res.status(404).json({ error: 'Marchand introuvable' });

  await supabase.storage.createBucket('passes', { public: true }).catch(() => {});

  const filePath = `marchands/${marchand.slug}/strip_static.png`;
  const { error: upErr } = await supabase.storage
    .from('passes')
    .upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
  if (upErr) return res.status(500).json({ error: `Upload Storage: ${upErr.message}` });

  const { data: { publicUrl } } = supabase.storage.from('passes').getPublicUrl(filePath);

  const { error: errU } = await supabase
    .from('marchands').update({ image_strip_url: publicUrl }).eq('id', req.params.id);
  if (errU) return res.status(500).json({ error: errU.message });

  res.json({ url: publicUrl });
}));

// DELETE /api/admin/marchands/:id/strip-static — supprime l'image statique universelle
router.delete('/marchands/:id/strip-static', authAdmin, asyncHandler(async (req, res) => {
  const { data: marchand, error: errM } = await supabase
    .from('marchands').select('id, slug').eq('id', req.params.id).single();
  if (errM || !marchand) return res.status(404).json({ error: 'Marchand introuvable' });

  supabase.storage.from('passes')
    .remove([`marchands/${marchand.slug}/strip_static.png`])
    .catch(() => {});

  const { error: errU } = await supabase
    .from('marchands').update({ image_strip_url: null }).eq('id', req.params.id);
  if (errU) return res.status(500).json({ error: errU.message });

  res.json({ ok: true });
}));

module.exports = router;
