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
  // Fond personnalisé de la bannière (Pro+, « strip custom ») : la bannière du
  // marchand reste TELLE QUELLE sous un thème, même si elle ne va pas avec le
  // fond du thème (décision du pilotage, 03/11). strip-cache dessine alors la
  // bannière de la fiche standard (même fichier que hors thème, aucun calcul).
  const banniereStandard = aBanniereCustom(marchand);
  if (!banniereStandard) for (const c of COULEURS_BANNIERE) m[c] = null;
  // Le doré de la récompense garde la priorité (décision 2) : couleur_fond_reward,
  // couleur_texte_reward et logo_reward_url ne sont pas touchés.
  m._theme = { id: t.id, nom: t.nom, texte_case: t.texte_case || null, empreinte: empreinte(t),
    ...(banniereStandard ? { ficheStandard: marchand } : {}) };
  return m;
}

// Même condition que la lecture du fond personnalisé (strip-cache, _fetchCustomBg).
const aBanniereCustom = m => !!m.strip_custom_background_url && m.forfait === 'pro_plus';

// Fiche dont la bannière doit être dessinée : celle du thème, sauf « strip
// custom » (fiche standard). Appelée par strip-cache après appliquerTheme.
function ficheBanniere(m) {
  return m && m._theme && m._theme.ficheStandard ? m._theme.ficheStandard : m;
}

// ── Gabarits partagés (migration 071) ──────────────────────────────────────
// {nom} = le nom affiché sur la carte (pass_display_name, sinon nom), remplacé
// à l'écriture (copie d'un gabarit, création ou modification d'un thème) : le
// thème du marchand porte le texte final, envoyé tel quel.
function remplacerNom(texte, marchand) {
  if (typeof texte !== 'string') return texte;
  const nom = (marchand && (marchand.pass_display_name || marchand.nom)) || '';
  return texte.split('{nom}').join(nom);
}

// Thème (champs de themes_marchand, à valider par validerTheme) tiré d'un
// gabarit, dans la langue du marchand (fr, sinon en).
function depuisGabarit(g, marchand) {
  const fr = marchand && marchand.langue === 'fr';
  return {
    nom: g.nom,
    couleur_fond: g.couleur_fond, couleur_texte: g.couleur_texte || null, couleur_label: g.couleur_label || null,
    texte_case: remplacerNom((fr ? g.texte_case_fr : g.texte_case_en) || null, marchand),
    message_ouverture: remplacerNom(fr ? g.message_fr : g.message_en, marchand),
  };
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

// Dossier Storage des bannières d'un thème pour la configuration ACTUELLE du
// marchand (version de bannière + empreinte du thème). Tout le reste du dossier
// du thème est périmé.
function dossierCourant(marchand, theme) {
  const m = avecTheme(marchand, theme);
  if (!banniereGeneree(m)) return null;
  const cle = require('./strip-cache').storageKey(m, 0, 'strip2x');
  return cle.slice(0, cle.lastIndexOf('/') + 1);
}

// Soldes à précalculer pour les vraies cartes d'un thème :
//   - tampons : TOUS les états, 0 à seuil (le solde ne dépasse jamais le seuil) ;
//   - points : la bannière dépend du solde EXACT (valeurAffichee, une image par
//     valeur) : pas de liste finie. On précalcule les soldes détenus par les
//     clients au moment de la préparation (1 000 lignes lues au plus) + 0. Un
//     solde apparu depuis sera dessiné à la demande, comme pour la carte
//     standard à chaque scan aujourd'hui.
async function soldesAPreparer(supabase, m) {
  if (m.type_programme !== 'points') return Array.from({ length: (m.max_value || 10) + 1 }, (_, k) => k);
  const { data, error } = await supabase.from('clients').select('stored_value')
    .eq('marchand_id', m.id).is('deleted_at', null).limit(1000);
  if (error) throw new Error(`soldes : ${error.message}`);
  const { valeurAffichee } = require('./strip-generator');
  return [...new Set([0, ...(data || []).map(c => valeurAffichee(c.stored_value))])].sort((a, b) => a - b);
}

// Préparation en admin (« la caisse prime », décisions du pilotage du 14/10) :
//   1. l'aperçu « Ma carte » de la carte standard et de chaque thème ;
//   2. puis, pour chaque thème, les bannières de TOUS les états des vraies cartes
//      (3 variantes : Apple 2x, 3x, Google) : à l'activation, la bascule et le
//      retour des iPhone ne font que lire le cache ;
//   3. et les bannières périmées du thème (ancienne version, ancienne empreinte)
//      sont purgées.
// L'un après l'autre, jamais en rafale, une pause entre deux rendus. Appelée à la
// création ou modification d'un thème, à l'envoi d'un logo, à l'enregistrement de
// la fiche, et à l'ouverture des thèmes dans la fiche admin. Une préparation à la
// fois par marchand (une demande pendant une préparation la relance à la fin).
// Ne lève jamais.
const preparations = new Map();   // marchand_id → { relancer, promesse }
const pause = () => new Promise(r => setImmediate(r));

function preparerApercus(marchandId) {
  const enCoursP = preparations.get(marchandId);
  if (enCoursP) { enCoursP.relancer = true; return enCoursP.promesse; }
  const e = { relancer: false };
  preparations.set(marchandId, e);
  e.promesse = (async () => {
    let bilan;
    try {
      do { e.relancer = false; bilan = await preparer(marchandId); } while (e.relancer);
    } catch (err) {
      console.error(`[theme] préparation, marchand ${marchandId} :`, err.message);
      bilan = { erreur: err.message };
    } finally { preparations.delete(marchandId); }
    return bilan;
  })();
  return e.promesse;
}

async function preparer(marchandId) {
  const supabase = require('./supabase');
  const cache = require('./strip-cache');
  const [{ data: m, error }, { data: liste, error: errT }] = await Promise.all([
    supabase.from('marchands').select('*').eq('id', marchandId).single(),
    supabase.from('themes_marchand').select('*').eq('marchand_id', marchandId).order('cree_le'),
  ]);
  if (error) throw new Error(error.message);
  if (errT) throw new Error(errT.message);
  const bilan = { apercus: 0, bannieres: 0, themes: (liste || []).length };
  if (!m || !liste || !liste.length) return bilan;
  const standard = { ...m, theme_actif: null };
  // 1. Aperçus d'abord : le marchand les voit au plus tôt.
  await apercu(standard, { generer: true }); bilan.apercus++;
  for (const t of liste) { await apercu(avecTheme(standard, t), { generer: true }); bilan.apercus++; }
  // 2. Tous les états des vraies cartes, thème par thème.
  const soldes = await soldesAPreparer(supabase, m);
  for (const t of liste) {
    const mt = avecTheme(standard, t);
    if (!banniereGeneree(mt)) continue;
    for (const v of soldes) {
      await pause();
      // getOrGenerate dessine les 3 variantes d'un coup ; déjà en cache → rien.
      await cache.getOrGenerate({ marchand: mt, filledCount: v, variant: 'strip2x' });
      bilan.bannieres++;
    }
    // 3. Purge de ce qui est périmé dans le dossier du thème.
    await cache.purgerTheme(m.slug, t.id, { garderPrefixe: dossierCourant(standard, t) })
      .catch(err => console.error(`[theme] purge des bannières périmées (${t.nom}) :`, err.message));
  }
  console.log(`[theme] préparation marchand ${marchandId} : ${bilan.apercus} aperçu(s), ${bilan.bannieres} état(s) de bannière, ${bilan.themes} thème(s)`);
  return bilan;
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
const config = { iphoneParLot: 30, googleParLot: 50, googleSimultanes: 5, lotMs: 10000, repriseDelaiMs: 60000,
  // Morceau 4 (migration 072) : une bascule sans avancement depuis inactifMs est
  // reprise par un autre serveur ; au démarrage, reprises retentées repriseEssais
  // fois (toutes les inactifMs) tant qu'une bascule est tenue ailleurs.
  inactifMs: 10 * 60e3, repriseEssais: 6,
  // 24 h au moins entre deux ouvertures (message à toutes les cartes). L'arrêt reste libre.
  delaiOuvertureMs: 24 * 3600e3 };
const INSTANCE = process.env.RAILWAY_REPLICA_ID || require('os').hostname();
const intervalle = ms => `${Math.round(ms / 1000)} seconds`;
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

// Écrit l'avancement, seulement si la bascule n'a pas été remplacée entre-temps
// ET si ce serveur la tient toujours (migration 072) ; chaque écriture renouvelle
// maj_le (un autre serveur ne la reprend qu'après inactifMs sans avancement).
async function avancer(supabase, marchandId, b, champs) {
  const suivant = champs === null ? null : { ...b, ...champs, instance: INSTANCE, maj_le: new Date().toISOString() };
  const { data, error } = await supabase.from('marchands').update({ theme_bascule: suivant })
    .eq('id', marchandId).eq('theme_bascule->>cree_le', b.cree_le).eq('theme_bascule->>instance', INSTANCE).select('id');
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
  // Propriétaire en base (migration 072) : un seul serveur fait avancer la bascule.
  const { data: prise, error: errPrise } = await supabase.rpc('prendre_bascule_theme', {
    p_marchand_id: marchandId, p_instance: INSTANCE, p_inactif: intervalle(config.inactifMs) });
  if (errPrise) throw new Error(`prise : ${errPrise.message}`);
  if (!prise) return { occupe: true };   // tenue par un autre serveur qui avance encore
  const b = prise;
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

  // Fin de bascule. Les bannières d'un thème terminé RESTENT en cache : le
  // marchand peut le reprendre sans aucun calcul. Elles ne partent qu'à la
  // suppression du thème (admin) ou, périmées, à la préparation suivante.
  if (!await avancer(supabase, marchandId, b, null)) return bilan;
  console.log(`[theme] bascule ${b.sens} marchand ${marchandId} : ${bilan.iphones} iPhone, ${bilan.google} Google, ${bilan.erreurs} erreur(s)`);
  return bilan;
}

function nouvelleBascule(sens, theme) {
  return { sens, theme_id: theme.id, message: sens === 'ouverture' ? theme.message_ouverture : null,
    cree_le: new Date().toISOString(), apple_apres: null, apple_fini: false,
    google_apres: null, google_fini: false, classe_ok: false };
}

// Ouverture : le thème programmé passe « en cours », puis bascule avec message.
// Rend true si c'est cet appel qui a ouvert. En base, d'un seul coup
// (ouvrir_theme, migration 072) : thème toujours programmé ET dernière
// ouverture il y a plus de 24 h ; sinon rien ne change (le thème reste
// programmé : le passage suivant du cron réessaie).
async function ouvrir(marchandId, theme) {
  const supabase = require('./supabase');
  const { data, error } = await supabase.rpc('ouvrir_theme', {
    p_marchand_id: marchandId, p_theme_id: theme.id, p_theme: { ...theme, etat: 'en_cours' },
    p_bascule: nouvelleBascule('ouverture', theme), p_delai: intervalle(config.delaiOuvertureMs) });
  if (error) throw new Error(error.message);
  if (data === 'trop_tot') console.log(`[theme] ouverture reportée, marchand ${marchandId} : dernière ouverture il y a moins de 24 h`);
  if (data !== 'ok') return false;
  lancer(marchandId);
  return true;
}

// Date à laquelle un thème choisi maintenant s'ouvrirait : tout de suite si le
// début est aujourd'hui (ou passé), sinon au passage du cron (08:00 UTC) du jour
// de début. Rend la date à partir de laquelle une ouverture est possible si
// celle-ci tombe moins de 24 h après la dernière ouverture, sinon null.
const HEURE_PASSAGE = 'T08:00:00Z';
function ouvertureTropProche(dernierOuvert, debut, maintenant = new Date()) {
  if (!dernierOuvert) return null;
  const possible = Date.parse(dernierOuvert) + config.delaiOuvertureMs;
  const prevue = debut <= aujourdhui(maintenant) ? maintenant.getTime() : Date.parse(`${debut}${HEURE_PASSAGE}`);
  return prevue < possible ? new Date(possible).toISOString() : null;
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
  const { data, error } = await supabase.from('marchands').select('id, theme_actif, theme_bascule, themes_actifs')
    .or('theme_actif.not.is.null,theme_bascule.not.is.null');
  if (error) throw new Error(error.message);
  const jour = aujourdhui(maintenant);
  const bilan = { ouverts: 0, fermes: 0, reprises: 0, occupees: 0 };
  for (const m of data || []) {
    const t = m.theme_actif;
    try {
      // Fin passée, ou cartes à thème refermées par l'admin : retour au standard.
      if (t && (t.fin < jour || m.themes_actifs !== true)) { if (await fermer(m.id, t)) bilan.fermes++; continue; }
      // Ouverture reportée (24 h, migration 072) : on passe quand même à la reprise
      // d'une bascule inachevée (une fin de thème précédente, par exemple).
      if (t && t.etat === 'programme' && t.debut <= jour && await ouvrir(m.id, t)) { bilan.ouverts++; continue; }
      if (m.theme_bascule && !enCours.has(m.id)) {
        // Tenue par un autre serveur qui avance encore : on la laisse (morceau 4).
        if (m.theme_bascule.instance && m.theme_bascule.instance !== INSTANCE && m.theme_bascule.maj_le
            && Date.parse(m.theme_bascule.maj_le) > maintenant.getTime() - config.inactifMs) { bilan.occupees++; continue; }
        lancer(m.id); bilan.reprises++;
      }
    } catch (e) {
      console.error(`[theme] passage marchand ${m.id} :`, e.message);
    }
  }
  if (bilan.ouverts || bilan.fermes || bilan.reprises || bilan.occupees) console.log('[theme] passage :', JSON.stringify(bilan));
  return bilan;
}

// Au démarrage du serveur : une reprise différée (l'ancien serveur finit son
// lot pendant un redéploiement). Si une bascule est encore tenue par un autre
// serveur, nouvel essai toutes les inactifMs (repriseEssais fois au plus) : si
// l'ancien serveur s'est arrêté en route, ce serveur-ci la reprend sans
// attendre le cron du lendemain.
function planifierReprise(essai = 1, delai = config.repriseDelaiMs) {
  const t = setTimeout(() => {
    require('./arret').suivre(passage()
      .then(b => { if (b.occupees && essai < config.repriseEssais) planifierReprise(essai + 1, config.inactifMs); })
      .catch(e => console.error('[theme] reprise :', e.message)));
  }, delai);
  t.unref();
}

function _pourTests({ envoyeurs: e, config: c, attendre: a } = {}) {
  if (e) envoyeurs = { ...envoyeurs, ...e };
  if (c) Object.assign(config, c);
  if (a) attendre = a;
  return { enCours, config };
}

module.exports = {
  appliquerTheme, avecTheme, ficheBanniere, remplacerNom, depuisGabarit, apercu, preparerApercus, dossierCourant, validerTheme, validerDates, aujourdhui,
  lancer, ouvrir, fermer, passage, planifierReprise, ouvertureTropProche, INSTANCE, _pourTests,
};
