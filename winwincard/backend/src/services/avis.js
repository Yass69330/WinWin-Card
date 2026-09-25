'use strict';

// ════════════════════════════════════════════════════════════════════════════
// DEMANDE D'AVIS GOOGLE (migration 047)
//
// Déclencheur : la RÉCOMPENSE REMISE, pas le franchissement du seuil. Côté scan
// c'est `is_reset` — le seul moment où la boutique donne effectivement le
// cadeau, dans les deux modes (tampons et points). Demander un avis à un client
// qui n'a encore rien reçu serait à contretemps.
//
// ── POURQUOI UN MINUTEUR DE 30 MINUTES ─────────────────────────────────────
// Le client est encore en caisse au moment du scan : lui demander un avis dans
// la seconde, c'est lui demander d'écrire devant le commerçant. 30 minutes plus
// tard il est parti, l'expérience est fraîche.
//
// ── LE MINUTEUR VIT EN MÉMOIRE D'UNE SEULE INSTANCE ────────────────────────
// LIMITE CONNUE ET ASSUMÉE : un redémarrage Railway (déploiement, crash, mise à
// l'échelle) dans la fenêtre de 30 min perd les demandes en attente. Aucune
// notification n'est envoyée deux fois pour autant — la perte est silencieuse,
// jamais un doublon. Ce qui la rendrait fiable (une table de rendez-vous relue
// par le cron) coûte une table, un planificateur et des requêtes à chaque
// passage : hors périmètre, la perte étant sans conséquence commerciale (le
// client aura une autre récompense).
//
// ── ZÉRO REQUÊTE AJOUTÉE AU SCAN ───────────────────────────────────────────
// `planifier()` ne lit rien : le lien, la langue, le prénom et le serial sont
// déjà en main, chargés par le SELECT du scan. Tout le coût est reporté à T+30,
// et il n'existe que si une récompense a réellement été remise.
// ════════════════════════════════════════════════════════════════════════════

const supabase = require('./supabase');
const { notif } = require('../i18n/messages');
const registre  = require('./notif-registre');

const BASE_PUBLIQUE = () => process.env.API_BASE_URL || 'https://app.winwin-card.com';

// 30 min par défaut. Surchargeable par AVIS_DELAI_MS uniquement pour le test de
// bout en bout (borné à 1 s – 2 h : une valeur absurde en variable
// d'environnement ne doit pas pouvoir geler ou noyer la plateforme).
const DELAI_MS = (() => {
  const v = parseInt(process.env.AVIS_DELAI_MS, 10);
  if (Number.isInteger(v) && v >= 1000 && v <= 7200000) return v;
  return 30 * 60 * 1000;
})();

// Garde-fou mémoire. 48 marchands, ~1 330 clients : le nombre de récompenses
// remises dans une même demi-heure se compte sur les doigts. Ce plafond n'est
// pas un réglage de capacité, c'est un butoir contre une boucle imprévue.
const MAX_EN_ATTENTE = 2000;

// serial → Timeout. Sert aussi de dédoublonnage : deux récompenses pour la même
// carte dans la même demi-heure ne produisent qu'UNE demande d'avis.
const enAttente = new Map();

// Forme du lien marchand. La base borne la longueur (CHECK 500) ; ici on exige
// le schéma. Deux raisons : un `value` non-URL au dos du pass Apple ne serait
// pas cliquable, et surtout un lien sans schéma ouvrirait une redirection vers
// un chemin relatif de notre propre domaine. Rendre l'URL nettoyée plutôt qu'un
// booléen : l'appelant redirige vers CE qu'on a validé, jamais vers l'entrée brute.
function lienValide(brut) {
  if (typeof brut !== 'string') return null;
  const u = brut.trim();
  if (!u || u.length > 500) return null;
  if (!/^https?:\/\/[^\s]+$/i.test(u)) return null;
  try { new URL(u); } catch { return null; }
  return u;
}

// Le lien imprimé sur la carte n'est JAMAIS celui du marchand : il passe par
// nous pour que le clic soit mesurable. Un serial par carte → un lien par carte,
// d'où sa place sur l'OBJET Google et non sur la classe.
function urlAvis(serialNumber) {
  return `${BASE_PUBLIQUE()}/avis/${serialNumber}`;
}

// Libellé du lien au dos de la carte. La langue est celle du marchand (figée à
// sa création), cohérente avec le texte de la notification.
function libelleLien(langue) {
  return langue === 'fr' ? 'Laisser un avis Google' : 'Leave a Google review';
}

// ── Planification ─────────────────────────────────────────────────────────
// Synchrone, NE LÈVE JAMAIS, ne lit rien. Appelée après res.json() : rien de ce
// qui se passe ici ne peut retarder ni faire échouer un scan.
// Rend true si une demande a été armée (utile au test de bout en bout).
function planifier({ marchand, prenom, serial }) {
  try {
    if (!marchand || !serial) return false;
    // L'INTERRUPTEUR, et le seul : pas de lien → pas de notification.
    if (!lienValide(marchand.lien_avis_google)) return false;
    if (enAttente.has(serial)) return false;
    if (enAttente.size >= MAX_EN_ATTENTE) {
      console.warn(`[avis] ${MAX_EN_ATTENTE} demandes déjà en attente — celle de ${serial} est abandonnée`);
      return false;
    }

    const minuteur = setTimeout(() => {
      enAttente.delete(serial);
      envoyer({ marchandId: marchand.id, langue: marchand.langue, prenom, serial })
        .catch(e => console.error('[avis] envoi:', e.message));
    }, DELAI_MS);

    // unref : le minuteur ne doit pas être ce qui maintient le process en vie.
    // Le serveur HTTP écoute de toute façon, donc en production le délai est bien
    // attendu ; en revanche un script qui ne fait que charger ce module ne reste
    // pas bloqué une demi-heure.
    if (typeof minuteur.unref === 'function') minuteur.unref();
    enAttente.set(serial, minuteur);
    return true;
  } catch (e) {
    console.error('[avis] planifier:', e.message);
    return false;
  }
}

// ── Envoi effectif, à T+30 ────────────────────────────────────────────────
// Option (a) retenue en pilotage : les jetons sont RELUS ici, pas mémorisés à
// l'instant du scan. Coût : une lecture device_tokens par récompense remise.
// Bénéfice : un client qui désinstalle sa carte entre-temps n'est pas poussé sur
// un jeton mort, et un appareil ajouté entre-temps la reçoit.
async function envoyer({ marchandId, langue, prenom, serial }) {
  const msg = notif('avisGoogle', langue, { prenom });

  // Apple : le push APNs ne transporte aucun texte, il dit seulement « reviens
  // chercher ton pass ». Le texte visible est celui du backField notification_txt,
  // donc de passes.notification_message — cette écriture est obligatoire, ce n'est
  // pas une trace.
  //
  // B3 (tranché en pilotage) : pas de suffixe, pas d'horodatage. Entre deux
  // récompenses il y a forcément des scans, qui écrivent chacun une valeur
  // différente dans ce même champ ; la comparaison old/new d'iOS voit donc
  // toujours un changement et affiche la demande d'avis.
  const { error: errPass } = await supabase.from('passes')
    .update({ notification_message: msg, updated_at: new Date().toISOString() })
    .eq('serial_number', serial)
    .eq('marchand_id', marchandId);
  if (errPass) console.error('[avis] passes update:', errPass.message);

  const lot = registre.creerLot('avis', marchandId);

  const { isApnsConfigured, sendPushUpdate } = require('./apns');
  if (isApnsConfigured()) {
    const { data: tokens, error: errTok } = await supabase
      .from('device_tokens').select('push_token').eq('serial_number', serial);
    if (errTok) console.error('[avis] device_tokens:', errTok.message);
    for (const { push_token } of (tokens || [])) {
      let erreur = null;
      await sendPushUpdate(push_token)
        .catch(e => { erreur = e; console.error(`[avis] APNs (…${push_token.slice(-8)}):`, e.message); });
      lot.ajouter({ plateforme: 'apple', serialNumber: serial, pushToken: push_token, erreur });
    }
  }

  const { addMessageToLoyaltyObject, isConfigured: googleConfigure } = require('./google-pass');
  if (googleConfigure()) {
    let errG = null;
    await addMessageToLoyaltyObject(serial, null, msg)
      .catch(e => { errG = e; console.error('[avis] Google addMessage:', e.message); });
    lot.ajouter({ plateforme: 'google', serialNumber: serial, erreur: errG });
  }

  // Après les envois, jamais avant (règle du registre, migration 046).
  await lot.ecrire();
  console.log(`[avis] demande envoyée serial=${serial} marchand=${marchandId}`);
}

// Pour le diagnostic et les tests : combien de demandes sont armées.
function enAttenteCount() { return enAttente.size; }

module.exports = {
  planifier, envoyer, lienValide, urlAvis, libelleLien, enAttenteCount,
  DELAI_MS, MAX_EN_ATTENTE,
};
