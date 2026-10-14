'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CARTES À THÈME (f17, migration 063)
//
// Un marchand Pro+ choisit un thème préparé par WinWin (couleurs, logo
// préfabriqué, texte court sous le prénom), avec des dates de début et de fin.
// Décisions du pilotage (14/10) :
//   1. la bannière (strip) est redessinée sur le fond du thème, mise en cache ;
//   2. le doré de la récompense garde la priorité pendant un thème ;
//   3. la notification d'ouverture ne compte pas dans le quota ; son texte est
//      préparé par nous avec le thème. Fin : retour silencieux.
// Progression et solde ne changent jamais. Un seul thème à la fois.
//
// ── UNE SEULE FONCTION APPLIQUE LE THÈME : appliquerTheme ──────────────────
// Elle rend une copie de la fiche marchand aux couleurs du thème quand
// theme_actif.etat = 'en_cours', la fiche telle quelle sinon. Chacun des points
// d'entrée qui fabriquent une carte l'appelle (le filet vérifie chacun) :
//   1. apple-pass.js       generateApplePass (et buildPassJson, qu'il appelle) ;
//   2. strip-cache.js      getOrGenerate / getPublicUrl (bannières Apple et Google) ;
//   3. google-pass.js      buildLoyaltyClass (classe Google : fond, logo, texte) ;
//   4. google-pass.js      buildLoyaltyObject (carte Google à l'inscription) ;
//   5. google-pass.js      updateLoyaltyObjectPoints (scan, ajustement, bascule) ;
//   6. apercu() ci-dessous (onglet « Ma carte » du dashboard).
// Elle est idempotente (une fiche déjà habillée porte `_theme` et n'est pas
// rhabillée) : un point d'entrée qui en appelle un autre ne double rien.
//
// ── BASCULE (ouverture, fin) ───────────────────────────────────────────────
// La fiche change d'abord (theme_actif) : toute carte fabriquée ensuite (scan,
// inscription, retour d'un iPhone) a le bon visuel. Puis toutes les cartes
// déjà installées sont mises à jour, par lots :
//   - iPhone : cartes du lot marquées modifiées (passes.updated_at, sinon 304),
//     message d'ouverture posé sur la carte (passes.notification_message) à
//     l'ouverture seulement, puis un push par iPhone au débit partagé (t37) ;
//   - Google : la classe une fois (fond, logo, texte de la case), puis chaque
//     carte Google réelle (règle D2) : fond et bannière, plus le message
//     d'ouverture à l'ouverture seulement ;
//   - registre : chaque envoi dans notification_envois, source 'theme'.
// Avancement écrit après chaque lot (marchands.theme_bascule) : après un
// redémarrage, la bascule reprend au curseur (au démarrage du serveur, puis au
// passage quotidien du cron). Une bascule à la fois par marchand ; une demande
// arrivée pendant une bascule la remplace (la plus récente gagne).
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

// Couleurs manuelles de la bannière, choisies pour le fond STANDARD : sur le fond
// du thème, elles seraient illisibles. Pendant un thème, la bannière reprend le
// calcul automatique (contraste WCAG du générateur), comme un marchand sans
// réglage. Décision hors pilotage (14/10), notée dans la passation.
const COULEURS_BANNIERE = ['couleur_label_strip', 'couleur_pastille_fond', 'couleur_pastille_contour',
  'couleur_pastille_icone', 'couleur_barre_principale', 'couleur_barre_secondaire'];

const HEX = /^#[0-9a-fA-F]{6}$/;
const JOUR = /^\d{4}-\d{2}-\d{2}$/;

function empreinte(t) {
  return crypto.createHash('sha1')
    .update([t.couleur_fond, t.couleur_texte, t.couleur_label, t.logo_url].map(v => v || '').join('|'))
    .digest('hex').slice(0, 8);
}

// ── LA fonction ────────────────────────────────────────────────────────────
function appliquerTheme(marchand) {
  if (!marchand || marchand._theme) return marchand;
  const t = marchand.theme_actif;
  if (!t || t.etat !== 'en_cours' || !HEX.test(t.couleur_fond || '')) return marchand;
  const m = { ...marchand };
  m.couleur_fond = t.couleur_fond;
  if (t.couleur_texte) m.couleur_texte = t.couleur_texte;
  if (t.couleur_label) m.couleur_label = t.couleur_label;
  if (t.logo_url) m.logo_url = t.logo_url;
  if (t.google_logo_url || t.logo_url) m.google_logo_url = t.google_logo_url || t.logo_url;
  for (const c of COULEURS_BANNIERE) m[c] = null;
  // Fond personnalisé de la bannière (Pro+) : il recouvrirait le fond du thème.
  m.strip_custom_background_url = null;
  // Le doré de la récompense garde la priorité (décision 2) : couleur_fond_reward,
  // couleur_texte_reward et logo_reward_url ne sont pas touchés.
  m._theme = { id: t.id, nom: t.nom, texte_case: t.texte_case || null, empreinte: empreinte(t) };
  return m;
}

// Fiche habillée d'un thème donné (aperçu « Ma carte », avant activation).
function avecTheme(marchand, theme) {
  return appliquerTheme({ ...marchand, _theme: undefined, theme_actif: { ...theme, etat: 'en_cours' } });
}

// ── Aperçu d'une carte (6e point d'entrée) ────────────────────────────────
// La vraie carte, montée avec les vrais éléments : la bannière est CELLE des
// cartes (même cache, même générateur, même progression d'exemple), le logo est
// celui que la carte Apple affiche, les couleurs et le texte de la case sont
// ceux du thème. La bannière part dans la réponse (data:) : l'aperçu ne dépend
// pas de la lecture publique de Storage.
//
// « La caisse prime » (décision du pilotage, 14/10) : les bannières d'aperçu se
// CALCULENT en admin, quand Yass prépare les thèmes (generer: true). Côté
// marchand, l'aperçu ne fait que LIRE le cache (LRU, puis Storage) : aucune
// génération déclenchée par une action du marchand. Bannière absente du cache
// → `banniere_en_preparation`, l'écran le dit.
function exempleProgression(m) {
  const max = m.max_value || 10;
  return m.type_programme === 'points' ? Math.round(max * 0.4) : Math.min(3, max - 1);
}
const banniereGeneree = m => m.strip_mode === 'points_bar' || (m.strip_mode && m.type_programme !== 'points');

async function apercu(marchand, { generer = false } = {}) {
  const m = appliquerTheme(marchand);
  const rempli = exempleProgression(m);
  let banniere = null;
  let enPreparation = false;
  // Même précédence que la carte Apple : image fixe, puis bannière générée.
  const tier = Array.isArray(m.images_tiers) ? m.images_tiers.find(t => rempli >= t.min && rempli <= t.max) : null;
  if (tier && tier.url) banniere = tier.url;
  else if (m.image_strip_url) banniere = m.image_strip_url;
  else if (banniereGeneree(m)) {
    const cache = require('./strip-cache');
    const buf = generer
      ? await cache.getOrGenerate({ marchand: m, filledCount: rempli, variant: 'strip2x' })
        .catch(e => { console.error('[theme] aperçu, bannière :', e.message); return null; })
      : await cache.lireCache({ marchand: m, filledCount: rempli, variant: 'strip2x' });
    if (buf) banniere = `data:image/png;base64,${buf.toString('base64')}`;
    else enPreparation = true;
  }
  return {
    couleur_fond: m.couleur_fond || '#1a1a2e',
    couleur_texte: m.couleur_texte || '#ffffff',
    couleur_label: m.couleur_label || '#a0a0b0',
    logo_url: m.logo_url || null,
    texte_case: m._theme ? m._theme.texte_case : null,
    nom: m.pass_display_name || m.nom,
    banniere,
    banniere_en_preparation: enPreparation,
    rempli,
    max: m.display_max_value || m.max_value || 10,
  };
}

// Chemin Storage de la bannière d'aperçu d'un thème : gardé à la purge de fin de
// thème (le marchand peut le reprendre plus tard sans recalcul).
function cheminApercu(marchand, theme) {
  const m = avecTheme(marchand, theme);
  if (!banniereGeneree(m)) return null;
  return require('./strip-cache').storageKey(m, exempleProgression(m), 'strip2x');
}

// Préparation en admin : carte standard + chaque thème du marchand, l'un après
// l'autre (jamais en rafale). Appelée à la création ou modification d'un thème,
// à l'envoi d'un logo, à la modification de la fiche (la version de bannière
// change) et à l'ouverture des thèmes dans la fiche admin. Ne lève jamais.
async function preparerApercus(marchandId) {
  try {
    const supabase = require('./supabase');
    const [{ data: m, error }, { data: liste, error: errT }] = await Promise.all([
      supabase.from('marchands').select('*').eq('id', marchandId).single(),
      supabase.from('themes_marchand').select('*').eq('marchand_id', marchandId).order('cree_le'),
    ]);
    if (error || errT || !m || !liste || !liste.length) return 0;
    const standard = { ...m, theme_actif: null };
    await apercu(standard, { generer: true });
    for (const t of liste) await apercu(avecTheme(standard, t), { generer: true });
    return liste.length + 1;
  } catch (e) {
    console.error(`[theme] préparation des aperçus, marchand ${marchandId} :`, e.message);
    return 0;
  }
}

// ── Contrôle d'un thème saisi par l'admin ─────────────────────────────────
function validerTheme(brut, { partiel = false } = {}) {
  const t = {};
  const texte = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : v == null ? null : undefined);
  const champ = (cle, v) => { if (v !== undefined || !partiel) t[cle] = v; };
  const nom = texte(brut.nom, 40);
  if (!partiel || brut.nom !== undefined) {
    if (!nom) return { erreur: 'nom requis (40 caractères au plus)' };
    t.nom = nom;
  }
  for (const c of ['couleur_fond', 'couleur_texte', 'couleur_label']) {
    if (partiel && brut[c] === undefined) continue;
    const v = brut[c] == null || brut[c] === '' ? null : String(brut[c]).trim();
    if (c === 'couleur_fond' && !v) return { erreur: 'couleur_fond requise' };
    if (v && !HEX.test(v)) return { erreur: `${c} : format #RRGGBB attendu` };
    t[c] = v;
  }
  for (const c of ['logo_url', 'google_logo_url']) {
    if (partiel && brut[c] === undefined) continue;
    const v = brut[c] == null || brut[c] === '' ? null : String(brut[c]).trim();
    if (v && !/^https:\/\/\S+$/.test(v)) return { erreur: `${c} : adresse https attendue` };
    t[c] = v;
  }
  if (!partiel || brut.texte_case !== undefined) {
    const v = typeof brut.texte_case === 'string' ? brut.texte_case.trim() : '';
    if (v.length > 40) return { erreur: 'texte_case : 40 caractères au plus' };
    champ('texte_case', v || null);
  }
  if (!partiel || brut.message_ouverture !== undefined) {
    const v = typeof brut.message_ouverture === 'string' ? brut.message_ouverture.trim() : '';
    if (!v || v.length > 150) return { erreur: 'message_ouverture requis (150 caractères au plus)' };
    t.message_ouverture = v;
  }
  return { theme: t };
}

// ── Dates (jours UTC, AAAA-MM-JJ) ─────────────────────────────────────────
const aujourdhui = (maintenant = new Date()) => maintenant.toISOString().slice(0, 10);
const plusJours = (jour, n) => new Date(Date.parse(`${jour}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

function validerDates(debut, fin, maintenant = new Date()) {
  const ok = j => typeof j === 'string' && JOUR.test(j) && !Number.isNaN(Date.parse(`${j}T00:00:00Z`))
    && new Date(`${j}T00:00:00Z`).toISOString().slice(0, 10) === j;
  if (!ok(debut) || !ok(fin)) return 'dates_invalides';
  const jour = aujourdhui(maintenant);
  if (debut < jour) return 'debut_passe';
  if (fin < debut) return 'fin_avant_debut';
  if (debut > plusJours(jour, 365)) return 'debut_trop_loin';
  if (fin > plusJours(debut, 92)) return 'duree_trop_longue';
  return null;
}

// ── Bascule ────────────────────────────────────────────────────────────────
const config = { iphoneParLot: 30, googleParLot: 50, googleSimultanes: 5, lotMs: 10000, repriseDelaiMs: 60000 };
let envoyeurs = {
  appleActif:  () => require('./apns').isApnsConfigured(),
  apple:       jeton => require('./apns').sendPushUpdate(jeton),
  googleActif: () => require('./google-pass').isConfigured(),
  classe:      marchand => require('./google-pass').createOrUpdateLoyaltyClass(marchand),
  objet:       (carte, m) => require('./google-pass').updateLoyaltyObjectPoints(carte.serial_number, m.id,
    carte.stored_value, m.max_value, m.display_max_value || m.max_value, m.images_tiers, carte.prenom,
    m.couleur_fond, m.couleur_fond_reward, m),
  message:     (serial, texte) => require('./google-pass').addMessageToLoyaltyObject(serial, null, texte),
};
let attendre = ms => new Promise(r => { const t = setTimeout(r, ms); t.unref && t.unref(); });

const enCours = new Map();   // marchand_id → { relancer: bool }

// Lance (ou relance) la bascule d'un marchand. Ne lève jamais.
function lancer(marchandId) {
  const etat = enCours.get(marchandId);
  if (etat) { etat.relancer = true; return etat.promesse; }
  const e = { relancer: false };
  enCours.set(marchandId, e);
  e.promesse = (async () => {
    let bilan;
    try {
      do { e.relancer = false; bilan = await executer(marchandId); } while (e.relancer);
    } catch (err) {
      bilan = { arret: err.message };
      console.error(`[theme] bascule marchand ${marchandId} :`, err.message);
    } finally { enCours.delete(marchandId); }
    return bilan;
  })();
  require('./arret').suivre(e.promesse);
  return e.promesse;
}

// Écrit l'avancement, seulement si la bascule n'a pas été remplacée entre-temps.
async function avancer(supabase, marchandId, b, champs) {
  const suivant = champs === null ? null : { ...b, ...champs };
  const { data, error } = await supabase.from('marchands').update({ theme_bascule: suivant })
    .eq('id', marchandId).eq('theme_bascule->>cree_le', b.cree_le).select('id');
  if (error) throw new Error(`avancement : ${error.message}`);
  if (!data || !data.length) return false;   // remplacée : la plus récente reprendra
  if (suivant) Object.assign(b, champs);
  return true;
}

async function executer(marchandId) {
  const supabase = require('./supabase').clientLong;
  const debit = require('./debit');
  const registre = require('./notif-registre');
  const { COLONNES_BASCULE } = require('./colonnes-carte');
  const { data: m, error } = await supabase.from('marchands')
    .select(`${COLONNES_BASCULE}, theme_bascule`).eq('id', marchandId).maybeSingle();
  if (error) throw new Error(`lecture : ${error.message}`);
  if (!m || !m.theme_bascule) return { rien: true };
  const b = m.theme_bascule;
  const message = b.sens === 'ouverture' ? b.message || null : null;
  const bilan = { sens: b.sens, iphones: 0, google: 0, erreurs: 0 };

  // Voie Apple
  if (!b.apple_fini) {
    if (!envoyeurs.appleActif()) { if (!await avancer(supabase, marchandId, b, { apple_fini: true })) return bilan; }
    while (!b.apple_fini) {
      let q = supabase.from('device_tokens').select('id, push_token, serial_number')
        .eq('marchand_id', marchandId).order('id', { ascending: true }).limit(config.iphoneParLot);
      if (b.apple_apres) q = q.gt('id', b.apple_apres);
      const { data: lot, error: errLot } = await q;
      if (errLot) throw new Error(`lecture des iPhone : ${errLot.message}`);
      if (!lot.length) { if (!await avancer(supabase, marchandId, b, { apple_fini: true })) return bilan; break; }
      const serials = [...new Set(lot.map(l => l.serial_number))];
      const maj = { updated_at: new Date().toISOString(), ...(message ? { notification_message: message } : {}) };
      const { error: errMaj } = await supabase.from('passes').update(maj)
        .eq('marchand_id', marchandId).in('serial_number', serials);
      if (errMaj) throw new Error(`cartes : ${errMaj.message}`);
      const reg = registre.creerLot('theme', marchandId, { long: true });
      for (const l of lot) {
        await debit.prendre();
        let erreur = null;
        try { await envoyeurs.apple(l.push_token); } catch (e) { erreur = e; bilan.erreurs++; }
        reg.ajouter({ plateforme: 'apple', serialNumber: l.serial_number, pushToken: l.push_token, erreur });
        bilan.iphones++;
      }
      await reg.ecrire();
      if (!await avancer(supabase, marchandId, b, { apple_apres: lot[lot.length - 1].id })) return bilan;
    }
  }

  // Voie Google : la classe une fois, puis les cartes réelles par lots.
  if (!b.google_fini) {
    if (!envoyeurs.googleActif()) { if (!await avancer(supabase, marchandId, b, { google_fini: true })) return bilan; }
    else {
      if (!b.classe_ok) {
        await envoyeurs.classe(m);   // la classe lit le thème de la fiche (point d'entrée 3)
        if (!await avancer(supabase, marchandId, b, { classe_ok: true })) return bilan;
      }
      while (!b.google_fini) {
        const debutLot = Date.now();
        const { data: lot, error: errLot } = await supabase.rpc('theme_lot_google', {
          p_marchand_id: marchandId, p_apres: b.google_apres || null, p_limite: config.googleParLot });
        if (errLot) throw new Error(`lecture des cartes Google : ${errLot.message}`);
        if (!lot.length) { if (!await avancer(supabase, marchandId, b, { google_fini: true })) return bilan; break; }
        // Curseur AVANT l'envoi (comme les campagnes) : jamais de message en double.
        if (!await avancer(supabase, marchandId, b, { google_apres: lot[lot.length - 1].id })) return bilan;
        const reg = registre.creerLot('theme', marchandId, { long: true });
        const file = [...lot];
        await Promise.all(Array.from({ length: Math.min(config.googleSimultanes, file.length) }, async () => {
          while (file.length) {
            const carte = file.shift();
            let erreur = null;
            try {
              await envoyeurs.objet(carte, m);
              if (message) await envoyeurs.message(carte.serial_number, message);
            } catch (e) { erreur = e; bilan.erreurs++; }
            reg.ajouter({ plateforme: 'google', serialNumber: carte.serial_number, erreur });
            bilan.google++;
          }
        }));
        await reg.ecrire();
        const reste = config.lotMs - (Date.now() - debutLot);
        if (reste > 0) await attendre(reste);
      }
    }
  }

  // Fin de bascule. Thème terminé : ses bannières sont purgées (par lots).
  if (!await avancer(supabase, marchandId, b, null)) return bilan;
  if (b.sens === 'fin' && b.theme_id) {
    const { data: t } = await supabase.from('themes_marchand').select('*').eq('id', b.theme_id).maybeSingle();
    const garder = t ? [cheminApercu({ ...m, theme_actif: null }, t)].filter(Boolean) : [];
    await require('./strip-cache').purgerTheme(m.slug, b.theme_id, garder)
      .catch(e => console.error('[theme] purge des bannières :', e.message));
  }
  console.log(`[theme] bascule ${b.sens} marchand ${marchandId} : ${bilan.iphones} iPhone, ${bilan.google} Google, ${bilan.erreurs} erreur(s)`);
  return bilan;
}

function nouvelleBascule(sens, theme) {
  return { sens, theme_id: theme.id, message: sens === 'ouverture' ? theme.message_ouverture : null,
    cree_le: new Date().toISOString(), apple_apres: null, apple_fini: false,
    google_apres: null, google_fini: false, classe_ok: false };
}

// Ouverture : le thème programmé passe « en cours », puis bascule avec message.
// Rend true si c'est cet appel qui a ouvert.
async function ouvrir(marchandId, theme) {
  const supabase = require('./supabase');
  const { data, error } = await supabase.from('marchands')
    .update({ theme_actif: { ...theme, etat: 'en_cours' }, theme_bascule: nouvelleBascule('ouverture', theme) })
    .eq('id', marchandId).eq('theme_actif->>id', theme.id).eq('theme_actif->>etat', 'programme')
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || !data.length) return false;
  lancer(marchandId);
  return true;
}

// Fin (date passée ou arrêt par le marchand) : retour à la carte standard,
// bascule SILENCIEUSE si le thème était en cours ; rien à faire s'il n'était que
// programmé (aucune carte ne l'a jamais porté).
async function fermer(marchandId, theme) {
  const supabase = require('./supabase');
  const enCoursAvant = theme.etat === 'en_cours';
  const { data, error } = await supabase.from('marchands')
    .update({ theme_actif: null, ...(enCoursAvant ? { theme_bascule: nouvelleBascule('fin', theme) } : {}) })
    .eq('id', marchandId).eq('theme_actif->>id', theme.id).eq('theme_actif->>etat', theme.etat)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || !data.length) return false;
  if (enCoursAvant) lancer(marchandId);
  return true;
}

// Passage quotidien du cron (et reprise au démarrage) : ouvre les thèmes dont le
// début est arrivé, ferme ceux dont la fin est passée, reprend les bascules
// inachevées. Rend 'ok' ; lève si la lecture est impossible.
async function passage(maintenant = new Date()) {
  const supabase = require('./supabase').clientLong;
  const { data, error } = await supabase.from('marchands').select('id, theme_actif, theme_bascule')
    .or('theme_actif.not.is.null,theme_bascule.not.is.null');
  if (error) throw new Error(error.message);
  const jour = aujourdhui(maintenant);
  const bilan = { ouverts: 0, fermes: 0, reprises: 0 };
  for (const m of data || []) {
    const t = m.theme_actif;
    try {
      if (t && t.fin < jour) { if (await fermer(m.id, t)) bilan.fermes++; continue; }
      if (t && t.etat === 'programme' && t.debut <= jour) { if (await ouvrir(m.id, t)) bilan.ouverts++; continue; }
      if (m.theme_bascule && !enCours.has(m.id)) { lancer(m.id); bilan.reprises++; }
    } catch (e) {
      console.error(`[theme] passage marchand ${m.id} :`, e.message);
    }
  }
  if (bilan.ouverts || bilan.fermes || bilan.reprises) console.log('[theme] passage :', JSON.stringify(bilan));
  return bilan;
}

// Au démarrage du serveur : une reprise différée (l'ancien serveur finit son
// lot pendant un redéploiement), puis plus rien jusqu'au cron.
function planifierReprise() {
  const t = setTimeout(() => {
    require('./arret').suivre(passage().catch(e => console.error('[theme] reprise :', e.message)));
  }, config.repriseDelaiMs);
  t.unref();
}

function _pourTests({ envoyeurs: e, config: c, attendre: a } = {}) {
  if (e) envoyeurs = { ...envoyeurs, ...e };
  if (c) Object.assign(config, c);
  if (a) attendre = a;
  return { enCours, config };
}

module.exports = {
  appliquerTheme, avecTheme, apercu, preparerApercus, cheminApercu, validerTheme, validerDates, aujourdhui,
  lancer, ouvrir, fermer, passage, planifierReprise, _pourTests,
};
