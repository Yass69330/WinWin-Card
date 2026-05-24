// Google Wallet Loyalty API
// Auth : JWT service account → OAuth2 access token (jsonwebtoken + fetch natif Node 18+)
// Aucune dépendance supplémentaire.

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

// Slug stable pour l'ID de classe — Google n'accepte que alphanum, underscore, tiret
function classId(marchandId) {
  return `${issuerId()}.merchant_${marchandId.replace(/-/g, '_')}`;
}

function objectId(serialNumber) {
  return `${issuerId()}.${serialNumber}`;
}

// ── Auth Google (OAuth2 via JWT service account) ─────────────

async function getAccessToken() {
  const creds = getCredentials();
  const now = Math.floor(Date.now() / 1000);

  const assertion = jwt.sign(
    {
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
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
  return data.access_token;
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

// ── Construction des objets ──────────────────────────────────

function buildLoyaltyClass(cId, marchand) {
  const obj = {
    id: cId,
    issuerName: 'WinWin Card',
    programName: marchand.nom,
    hexBackgroundColor: marchand.couleur_fond || '#1a1a2e',
    countryCode: 'FR',
    reviewStatus: 'UNDER_REVIEW',
    loyaltyPoints: {
      label: 'PROGRESSION',
      localizedLabel: {
        defaultValue: { language: 'fr', value: 'PROGRESSION' },
      },
    },
  };

  if (marchand.logo_url) {
    obj.programLogo = {
      sourceUri: { uri: marchand.logo_url },
      contentDescription: {
        defaultValue: { language: 'fr', value: `Logo ${marchand.nom}` },
      },
    };
  }

  if (marchand.image_strip_url) {
    obj.heroImage = {
      sourceUri: { uri: marchand.image_strip_url },
      contentDescription: {
        defaultValue: { language: 'fr', value: marchand.nom },
      },
    };
  }

  return obj;
}

function buildLoyaltyObject(oId, cId, client, marchand, serialNumber) {
  const isRecompense = client.stored_value >= marchand.max_value;

  return {
    id: oId,
    classId: cId,
    state: 'ACTIVE',
    accountName: client.prenom,
    accountId: serialNumber,
    loyaltyPoints: {
      balance: { int: client.stored_value },
      label: isRecompense ? 'RÉCOMPENSE !' : 'PROGRESSION',
    },
    textModulesData: [
      {
        id: 'details',
        header: 'Programme de fidélité',
        body: `${client.stored_value} / ${marchand.max_value} points — ${marchand.nom}`,
      },
      {
        id: 'rgpd',
        header: 'Vos données',
        body: 'Conformément au RGPD, vous pouvez demander la suppression de vos données directement en magasin.',
      },
    ],
    barcode: {
      type: 'QR_CODE',
      value: serialNumber,
      alternateText: serialNumber.slice(0, 8).toUpperCase(),
    },
  };
}

// ── API publique ─────────────────────────────────────────────

// Appelé à la création / mise à jour d'un marchand (admin)
async function createOrUpdateLoyaltyClass(marchand) {
  if (!isConfigured()) return;

  const cId = classId(marchand.id);
  const token = await getAccessToken();
  const body = buildLoyaltyClass(cId, marchand);

  const { status } = await walletRequest('GET', `/loyaltyClass/${encodeURIComponent(cId)}`, null, token);

  if (status === 404) {
    await walletRequest('POST', '/loyaltyClass', body, token);
  } else if (status === 200) {
    await walletRequest('PUT', `/loyaltyClass/${encodeURIComponent(cId)}`, body, token);
  }
}

// Génère l'URL "Ajouter à Google Wallet" — appelé à l'inscription client
async function generateGoogleWalletUrl({ client, marchand, serialNumber }) {
  if (!isConfigured()) {
    throw new Error('Google Wallet non configuré — GOOGLE_SERVICE_ACCOUNT_JSON manquant');
  }

  const cId = classId(marchand.id);
  const oId = objectId(serialNumber);
  const token = await getAccessToken();

  // Créer l'objet loyalty si inexistant
  const { status } = await walletRequest('GET', `/loyaltyObject/${encodeURIComponent(oId)}`, null, token);
  if (status === 404) {
    await walletRequest('POST', '/loyaltyObject', buildLoyaltyObject(oId, cId, client, marchand, serialNumber), token);
  }

  // JWT signé "save to wallet"
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

// Mise à jour des points après un scan — appelé de façon asynchrone depuis scan.js
async function updateLoyaltyObjectPoints(serialNumber, marchandId, storedValue, maxValue) {
  if (!isConfigured()) return;

  const oId = objectId(serialNumber);
  const token = await getAccessToken();
  const isRecompense = storedValue >= maxValue;

  await walletRequest(
    'PATCH',
    `/loyaltyObject/${encodeURIComponent(oId)}`,
    {
      loyaltyPoints: {
        balance: { int: storedValue },
        label: isRecompense ? 'RÉCOMPENSE !' : 'PROGRESSION',
      },
    },
    token
  );
}

module.exports = {
  isConfigured,
  createOrUpdateLoyaltyClass,
  generateGoogleWalletUrl,
  updateLoyaltyObjectPoints,
};
