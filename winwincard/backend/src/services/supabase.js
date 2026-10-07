const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL et SUPABASE_SERVICE_KEY sont requis');
}

// Délai maximal par appel à la base (étape 16). Sans lui, une base lente tient
// la requête jusqu'à ce que la caisse abandonne (15 s, DELAI_SCAN_MS).
//   - 5 s par appel, client de tous les jours. Pas de budget par scan : un scan
//     fait au plus 3 appels en série (15 s), 4 si le cache marchand de
//     l'authentification est vide (20 s) ; la caisse coupe alors à 15 s.
//   - 30 s, client long : travaux par lot (cron, export CSV, statistiques
//     admin, effacement RGPD, campagnes de notifications).
const DELAI_BASE_MS = 5000;
const DELAI_BASE_LONG_MS = 30000;

// Seuls les appels PostgREST (/rest/v1/) sont bornés ; le stockage reste tel
// quel. La coupure est relancée en AbortError : postgrest-js ne reconnaît que
// ce nom et RÉESSAIERAIT sinon une lecture 3 fois (attentes 1, 2, 4 s), soit
// 4 requêtes et 11 s au lieu d'une requête et 1 s (mesuré, passation §15
// duovicies). Un signal posé par l'appelant (.abortSignal) est conservé.
function fetchAvecDelai(delaiMs) {
  return async (url, options = {}) => {
    if (!String(url).includes('/rest/v1/')) return fetch(url, options);
    const delai = AbortSignal.timeout(delaiMs);
    const signal = options.signal ? AbortSignal.any([options.signal, delai]) : delai;
    try {
      return await fetch(url, { ...options, signal });
    } catch (e) {
      if (e && e.name === 'TimeoutError') {
        const coupure = new Error(`base : délai de ${delaiMs} ms dépassé`);
        coupure.name = 'AbortError';
        throw coupure;
      }
      throw e;
    }
  };
}

function creerClient(delaiMs) {
  // Service role key — bypass RLS, isolation enforced au niveau applicatif
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchAvecDelai(delaiMs) },
    }
  );
}

const supabase = creerClient(DELAI_BASE_MS);

module.exports = supabase;
module.exports.clientLong = creerClient(DELAI_BASE_LONG_MS);
