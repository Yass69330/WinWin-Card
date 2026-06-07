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

// Sélectionne l'URL d'image de tier selon les points du client.
// imagesTiers : tableau [{ min, max, url }] ou null/undefined.
// Retourne l'URL du tier correspondant, ou null si aucun ne correspond.
function selectTierImageUrl(imagesTiers, storedValue) {
  if (!Array.isArray(imagesTiers) || imagesTiers.length === 0) return null;
  const tier = imagesTiers.find(t => storedValue >= t.min && storedValue <= t.max);
  return tier ? tier.url : null;
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
    issuerName: marchand.nom,

    // Nom du programme — affiché en grand sur la carte
    programName: marchand.nom,

    hexBackgroundColor: marchand.couleur_fond || '#1a1a2e',
    countryCode: 'AE',
    reviewStatus: 'UNDER_REVIEW',

    // Label affiché à côté du solde de points
    loyaltyPoints: {
      label: 'Progress',
      localizedLabel: {
        defaultValue: { language: 'en', value: 'Progress' },
      },
    },
  };

  // Logo circulaire 660×660 px (top-left)
  if (logoUrl) {
    obj.programLogo = {
      sourceUri: { uri: logoUrl },
      contentDescription: {
        defaultValue: { language: 'en', value: `${marchand.nom} logo` },
      },
    };
  }

  // Hero image 1032×336 px (bas de carte)
  if (heroUrl) {
    obj.heroImage = {
      sourceUri: { uri: heroUrl },
      contentDescription: {
        defaultValue: { language: 'en', value: marchand.nom },
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

    // Solde de points
    loyaltyPoints: {
      balance: { int: client.stored_value },
      label: isRecompense ? 'Reward!' : 'Progress',
    },

    // Infos visibles sur la carte + au dos
    textModulesData: [
      {
        id: 'client_name',
        header: 'CLIENT',
        body: client.prenom,
      },
      {
        id: 'details',
        header: 'How it works',
        body: `Show your pass at every visit.\nAfter ${displayMax} visits, your reward is unlocked automatically.`,
      },
      ...(marchand.referral_enabled ? [{
        id: 'referral',
        header: 'Parrainez vos amis',
        body: `Partagez ce lien, gagnez ${marchand.referral_bonus_points || 1} point(s) quand ils passent en caisse.\n\nhttps://app.winwin-card.com/l/${marchand.slug}?ref=${serialNumber}`,
      }] : []),
      ...(marchand.telephone || marchand.adresse ? [{
        id:     'contact',
        header: 'Infos pratiques',
        body:   [marchand.telephone, marchand.adresse].filter(Boolean).join('\n'),
      }] : []),
      {
        id: 'privacy',
        header: 'Your data',
        body: 'You can request deletion of your data at any time directly in store.',
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
async function updateLoyaltyObjectPoints(serialNumber, marchandId, storedValue, maxValue, displayMaxValue, imagesTiers, prenom) {
  if (!isConfigured()) return;

  const oId = objectId(serialNumber);
  const token = await getAccessToken();
  const isRecompense = storedValue > 0 && storedValue >= (maxValue || 1);

  const patch = {
    loyaltyPoints: {
      balance: { int: storedValue },
      label: isRecompense ? 'Reward!' : 'Progress',
    },
  };

  if (prenom) patch.accountName = prenom;

  const tierUrl = selectTierImageUrl(imagesTiers, storedValue);
  if (tierUrl) {
    patch.heroImage = {
      sourceUri: { uri: tierUrl },
      contentDescription: { defaultValue: { language: 'en', value: 'loyalty progress' } },
    };
  }

  await walletRequest('PATCH', `/loyaltyObject/${encodeURIComponent(oId)}`, patch, token);
}

// Notification — ajoute un message sur le LoyaltyObject et envoie une
// notification push sur l'écran de verrouillage Android (max 3/24h par objet).
// messageType TEXT_AND_NOTIFY est requis pour le push ; TEXT = message passif.
async function addMessageToLoyaltyObject(serialNumber, titre, message) {
  if (!isConfigured()) throw new Error('Google Wallet non configuré');

  const oId   = objectId(serialNumber);
  const token = await getAccessToken();

  const { status, data } = await walletRequest(
    'POST',
    `/loyaltyObject/${encodeURIComponent(oId)}/addMessage`,
    {
      message: {
        id:          `msg_${Date.now()}`,
        ...(titre ? { header: titre } : {}),
        body:        message,
        messageType: 'TEXT_AND_NOTIFY',
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
