'use strict';

// ════════════════════════════════════════════════════════════════════════════
// LECTURE DES CANAUX D'UNE CARTE : jetons Apple
//
// Sert aux envois UNITAIRES (scan, parrainage, ajustement, annulation, avis, API)
// pour le push iPhone : une lecture des jetons Apple de la carte.
//
// RÈGLE D2 (étape 23) : depuis la migration 074 (incident Pizz'Amore du 07/11),
// elle ne s'applique plus qu'aux envois GROUPÉS (campagnes, cron, thème), et vit
// UNIQUEMENT en base : public.google_utile(lien, signal, serial). Les envois
// unitaires poussent Google sans condition. Ne pas réintroduire de copie de D2
// côté serveur (le filet le vérifie, section 31).
// ════════════════════════════════════════════════════════════════════════════

const supabase = require('./supabase');

// { jetons: [push_token…], erreur? }. Ne rejette jamais.
async function lireCanaux(serialNumber) {
  try {
    const { data, error } = await supabase
      .from('device_tokens')
      .select('push_token')
      .eq('serial_number', serialNumber);
    if (error) return { jetons: [], erreur: error };
    return { jetons: (data || []).map(l => l.push_token) };
  } catch (e) {
    return { jetons: [], erreur: e };
  }
}

module.exports = { lireCanaux };
