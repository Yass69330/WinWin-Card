// Google Wallet Loyalty API
// Auth : JWT service account → OAuth2 access token (jsonwebtoken + fetch natif Node 18+)
// Aucune dépendance supplémentaire.
//
// Dimensions images Google Wallet :
//   programLogo  : 660 × 660 px  — carré, affiché en cercle (top-left)
//   wideLogo     : 1032 × 336 px — bannière top (remplace logo+nom si fourni)
//   heroImage    : 1032 × 336 px — image bas de carte (~3:1)
//
// Dimensions images Apple Wallet (pour comparaison) :
//   logo@2x.png  : 320 × 100 px  — rectangulaire, à côté du logoText
//   strip@2x.png : 750 × 246 px  — milieu de la carte

const jwt = require('jsonwebtoken');

const WALLET_API = 'https://walletobjects.googleapis.com/walletobjects/v1';

// ── Config ───────────────────────────────────────────────────

function isConfigured() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_WALLET_ISSUER_ID);
}

function getCredentials() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON non configuré');
  }
  return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

function issuerId() {
  return process.env.GOOGLE_WALLET_ISSUER_ID;
}

function classId(marchand) {
  // Slug : alphanumérique + underscores — seuls caractères acceptés par Google Wallet
  return `${issuerId()}.${marchand.slug.replace(/-/g, '_')}`;
}

function objectId(serialNumber) {
  return `${issuerId()}.${serialNumber}`;
}

// ── Sélection images avec fallback ───────────────────────────
// Google Wallet a ses propres dimensions — on supporte des URLs dédiées
// avec fallback sur les colonnes Apple/générales.

function googleLogoUrl(marchand) {
  // 660×660 px carré → cercle. Fallback : logo_url (peut être rogné)
  return marchand.google_logo_url || marchand.logo_url || 'https://raw.githubusercontent.com/Yass69330/WinWin-Card/claude/winwin-card-landing-ohS22/logo.png';
}

function googleHeroUrl(marchand) {
  // 1032×336 px (~3:1). Fallback : image_strip_url (sera redimensionné par Google)
  return marchand.google_hero_url || marchand.image_strip_url || null;
}

// ── Auth Google (OAuth2 via JWT service account) ─────────────
// Token mis en cache 45 min — évite N appels OAuth2 lors d'un envoi groupé.

let _gToken   = null;
let _gTokenTs = 0;

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_gToken && now - _gTokenTs < 2700) return _gToken; // 45 min

  const creds = getCredentials();
  const assertion = jwt.sign(
    {
      iss:   creds.client_email,
      scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
      aud:   'https://oauth2.googleapis.com/token',
      exp:   now + 3600,
      iat:   now,
    },
    creds.private_key,
    { algorithm: 'RS256' }
  );

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${assertion}`,
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Auth Google échouée : ${JSON.stringify(data)}`);
  }
  _gToken   = data.access_token;
  _gTokenTs = now;
  return _gToken;
}

// ── Appels REST Wallet API ───────────────────────────────────

async function walletRequest(method, endpoint, body, token) {
  const res = await fetch(`${WALLET_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

// ── Construction LoyaltyClass ────────────────────────────────

function buildLoyaltyClass(cId, marchand) {
  const logoUrl = googleLogoUrl(marchand);
  const heroUrl = googleHeroUrl(marchand);

  const obj = {
    id: cId,
    issuerName: 'WinWin Card',

    // Nom du programme — affiché en grand sur la carte
    programName: marchand.nom,

    // Titre de la catégorie — affiché sous le logo en petit
    cardTitle: {
      defaultValue: { language: 'fr', value: 'carte de fidélité' },
    },

    hexBackgroundColor: marchand.couleur_fond || '#1a1a2e',
    countryCode: 'FR',
    reviewStatus: 'UNDER_REVIEW',

    // Label affiché à côté du solde de points
    loyaltyPoints: {
      label: 'Progression',
      localizedLabel: {
        defaultValue: { language: 'fr', value: 'Progression' },
      },
    },
  };

  // Logo circulaire 660×660 px (top-left)
  if (logoUrl) {
    obj.programLogo = {
      sourceUri: { uri: logoUrl },
      contentDescription: {
        defaultValue: { language: 'fr', value: `Logo ${marchand.nom}` },
      },
    };
  }

  // Hero image 1032×336 px (bas de carte)
  if (heroUrl) {
    obj.heroImage = {
      sourceUri: { uri: heroUrl },
      contentDescription: {
        defaultValue: { language: 'fr', value: marchand.nom },
      },
    };
  }

  return obj;
}

// ── Construction LoyaltyObject ───────────────────────────────

function buildLoyaltyObject(oId, cId, client, marchand, serialNumber) {
  const isRecompense = client.stored_value > 0 && client.stored_value >= (marchand.max_value || 1);
  const displayMax = marchand.display_max_value || marchand.max_value;

  return {
    id: oId,
    classId: cId,
    state: 'ACTIVE',

    // Prénom affiché sur la carte
    accountName: client.prenom,
    accountId: serialNumber,

    // Solde de points
    loyaltyPoints: {
      balance: { int: client.stored_value },
      label: isRecompense ? 'Récompense !' : 'Progression',
    },

    // Infos au dos de la carte
    textModulesData: [
      {
        id: 'details',
        header: 'Comment ça marche ?',
        body: `Présentez votre pass à chaque visite.\nAprès ${displayMax} passages, votre récompense est débloquée automatiquement.`,
      },
      {
        id: 'rgpd',
        header: 'Vos données',
        body: 'Conformément au RGPD, vous pouvez demander la suppression de vos données directement en magasin.',
      },
    ],

    // QR code — contient le serial_number scanné en caisse
    barcode: {
      type: 'QR_CODE',
      value: serialNumber,
      alternateText: '',
    },
  };
}

// ── API publique ─────────────────────────────────────────────

// Appelé à la création / mise à jour d'un marchand (admin)
async function createOrUpdateLoyaltyClass(marchand) {
  if (!isConfigured()) return { action: 'skipped', reason: 'non configuré' };

  const cId   = classId(marchand);
  const token = await getAccessToken();
  const body  = buildLoyaltyClass(cId, marchand);

  const { status: getStatus, data: existing } = await walletRequest(
    'GET', `/loyaltyClass/${encodeURIComponent(cId)}`, null, token
  );

  if (getStatus === 404) {
    const { status, data } = await walletRequest('POST', '/loyaltyClass', body, token);
    if (status !== 200 && status !== 201) {
      throw new Error(`Création classe échouée (HTTP ${status}): ${data?.error?.message || JSON.stringify(data)}`);
    }
    return { action: 'created', classId: cId, reviewStatus: data?.reviewStatus };
  } else if (getStatus === 200) {
    // Préserve reviewStatus si la classe est déjà approuvée — la remettre à UNDER_REVIEW
    // déclencherait une nouvelle revue Google.
    if (existing?.reviewStatus === 'APPROVED') body.reviewStatus = 'APPROVED';
    const { status, data } = await walletRequest('PUT', `/loyaltyClass/${encodeURIComponent(cId)}`, body, token);
    if (status !== 200) {
      throw new Error(`Mise à jour classe échouée (HTTP ${status}): ${data?.error?.message || JSON.stringify(data)}`);
    }
    return { action: 'updated', classId: cId, reviewStatus: data?.reviewStatus };
  } else {
    throw new Error(`Vérification classe échouée (HTTP ${getStatus}): ${existing?.error?.message || JSON.stringify(existing)}`);
  }
}

// Infos sur la LoyaltyClass d'un marchand — lecture seule, pour diagnostic admin
async function getClassInfo(marchand) {
  const cId = classId(marchand);
  const token = await getAccessToken();
  const { status, data } = await walletRequest('GET', `/loyaltyClass/${encodeURIComponent(cId)}`, null, token);
  return {
    classId:      cId,
    httpStatus:   status,
    exists:       status === 200,
    reviewStatus: status === 200 ? (data?.reviewStatus ?? null) : null,
    error:        status !== 200 ? (data?.error?.message || `HTTP ${status}`) : null,
  };
}

// Génère l'URL "Ajouter à Google Wallet" — appelé à l'inscription client
async function generateGoogleWalletUrl({ client, marchand, serialNumber }) {
  if (!isConfigured()) {
    throw new Error('Google Wallet non configuré — GOOGLE_SERVICE_ACCOUNT_JSON manquant');
  }

  const cId = classId(marchand);
  const oId = objectId(serialNumber);
  const token = await getAccessToken();

  // Garantit que la LoyaltyClass existe — si le marchand a été créé avant que
  // Google Wallet soit configuré, la classe peut être absente.
  const { status: classStatus } = await walletRequest('GET', `/loyaltyClass/${encodeURIComponent(cId)}`, null, token);
  if (classStatus === 404) {
    await walletRequest('POST', '/loyaltyClass', buildLoyaltyClass(cId, marchand), token);
  }

  // Créer l'objet loyalty si inexistant
  const { status } = await walletRequest('GET', `/loyaltyObject/${encodeURIComponent(oId)}`, null, token);
  if (status === 404) {
    await walletRequest(
      'POST',
      '/loyaltyObject',
      buildLoyaltyObject(oId, cId, client, marchand, serialNumber),
      token
    );
  }

  // JWT "save to wallet" signé avec la clé du service account
  const creds = getCredentials();
  const saveJwt = jwt.sign(
    {
      iss: creds.client_email,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      payload: { loyaltyObjects: [{ id: oId }] },
    },
    creds.private_key,
    { algorithm: 'RS256' }
  );

  return `https://pay.google.com/gp/v/save/${saveJwt}`;
}

// Mise à jour des points après un scan — appelé en async depuis scan.js
async function updateLoyaltyObjectPoints(serialNumber, marchandId, storedValue, maxValue, displayMaxValue) {
  if (!isConfigured()) return;

  const oId = objectId(serialNumber);
  const token = await getAccessToken();
  const isRecompense = storedValue > 0 && storedValue >= (maxValue || 1);

  await walletRequest(
    'PATCH',
    `/loyaltyObject/${encodeURIComponent(oId)}`,
    {
      loyaltyPoints: {
        balance: { int: storedValue },
        label: isRecompense ? 'Récompense !' : 'Progression',
      },
    },
    token
  );
}

// Notification marketing — ajoute un message visible dans Google Wallet
// Appelé depuis notifications.js pour chaque porteur d'un pass Google Wallet.
async function addMessageToLoyaltyObject(serialNumber, titre, message) {
  if (!isConfigured()) throw new Error('Google Wallet non configuré');

  const oId   = objectId(serialNumber);
  const token = await getAccessToken();

  const { status, data } = await walletRequest(
    'POST',
    `/loyaltyObject/${encodeURIComponent(oId)}/addMessage`,
    {
      message: {
        header:      titre,
        body:        message,
        messageType: 'TEXT',
      },
    },
    token
  );

  if (status !== 200) {
    const detail = data?.error?.message || JSON.stringify(data);
    throw new Error(`Google addMessage ${status}: ${detail}`);
  }
}

module.exports = {
  isConfigured,
  createOrUpdateLoyaltyClass,
  getClassInfo,
  generateGoogleWalletUrl,
  updateLoyaltyObjectPoints,
  addMessageToLoyaltyObject,
};
