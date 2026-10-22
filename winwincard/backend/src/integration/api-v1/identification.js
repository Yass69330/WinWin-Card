// ════════════════════════════════════════════════════════════════════════════
// Désigner la carte du client dans un appel (contrat v1 §3, §3.1)
//
// Partagé par POST /ventes et POST /migrations (étape 4, 22/10) : `carte` =
// contenu du QR (numéro de série, 36 caractères) ou code court (6 derniers
// caractères), résolus comme au comptoir ; sans `carte`, `telephone` désigne la
// carte rattachée à ce numéro (migration 068). Jamais de carte devinée : code
// court partagé → 409 ; inconnue → 404 avec le lien d'installation.
// ════════════════════════════════════════════════════════════════════════════
const supabase = require('../../services/supabase');
const { trouverParTelephone } = require('./telephone');

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RE_CODE_COURT = /^[0-9a-f]{6}$/;

// Lecture du corps. → { carte, parTelephone } | { champ } (400 corps_invalide)
function lireIdentifiant(b) {
  if (b.telephone != null && (typeof b.telephone !== 'string' || !b.telephone.trim() || b.telephone.length > 40)) return { champ: 'telephone' };
  if (b.carte == null && b.telephone != null) return { carte: null, parTelephone: true };
  if (typeof b.carte !== 'string') return { champ: 'carte' };
  const carte = b.carte.trim().toLowerCase();
  if (!RE_UUID.test(carte) && !RE_CODE_COURT.test(carte)) return { champ: 'carte' };
  return { carte, parTelephone: false };
}

const lienInstallation = slug => `${process.env.API_BASE_URL || 'https://app.winwin-card.com'}/l/${slug}`;

// → { client: { id, prenom, stored_value, pass_serial_number } }
//   | { statut, corps } (404 carte_inconnue + lien, 409 carte_ambigue) | { erreur }
async function trouverCarte(marchandId, slug, { carte, parTelephone }, telephone) {
  const inconnue = { statut: 404, corps: { error: 'carte_inconnue', lien_installation: lienInstallation(slug) } };
  if (parTelephone) {
    const t = await trouverParTelephone(marchandId, telephone);
    if (t.erreur) return { erreur: t.erreur };
    return t.client ? { client: t.client } : inconnue;   // jamais de crédit sans carte
  }
  let requete = supabase.from('clients').select('id, prenom, stored_value, pass_serial_number')
    .eq('marchand_id', marchandId).is('deleted_at', null);
  requete = RE_UUID.test(carte) ? requete.eq('pass_serial_number', carte) : requete.ilike('pass_serial_number', '%' + carte);
  const { data: trouves, error } = await requete.limit(2);
  if (error) return { erreur: error };
  if (trouves.length > 1) return { statut: 409, corps: { error: 'carte_ambigue' } };
  if (trouves.length === 0) return inconnue;
  return { client: trouves[0] };
}

module.exports = { lireIdentifiant, trouverCarte };
