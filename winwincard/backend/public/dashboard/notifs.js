// ════════════════════════════════════════════════════════════════════════════
// ONGLET « NOTIFICATIONS » (t42, découpage du dashboard, premier onglet sorti)
//
// Fichier à part, sur le modèle de ma-carte.js : une erreur ici n'arrête que cet
// onglet. Il n'utilise que les outils du cœur (api, esc, t, timeAgo, _lang, S.pdv)
// et n'écrit rien en dehors de #tab-notifs et de window.Notifs.
//
// Contenu : envoi d'une campagne (message, destinataires par segment, quota du
// mois), historique des campagnes, bloc « Mes smart notifications » (f15).
// Mêmes requêtes qu'avant le découpage, aux mêmes moments : à l'ouverture,
// l'historique, le comptage des destinataires et les smart notifications.
//
// Le contenu est construit à la première ouverture puis gardé (un message en
// cours de saisie survit à un changement d'onglet). La langue vient de /me
// (Aperçu) : si elle change après la construction (signal « ww-langue » de
// setLang), les textes sont refaits sans requête, saisie et choix gardés.
// Fichier servi depuis le cache par le service worker : changer ?v= dans
// index.html à chaque modification.
// ════════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const TXT = {
    fr: {
      pushNotifs: 'Notifications push',
      notifInfo: '📱 Envoyées via Apple & Google Wallet aux appareils enregistrés.',
      message: 'Message',
      notifPlaceholder: 'Ex. : Profitez de -20% sur toute la carte ce week-end !',
      segmentLabel: 'Destinataires',
      sendNotif: 'Envoyer la notification',
      msgRequired: 'Le message est requis',
      sending: 'Envoi…',
      sendError: "Erreur d'envoi",
      campagneEnCours: "Campagne en cours d'envoi.",
      segTous: 'Tous les clients',
      segInactifs: ({ n }) => `Inactifs depuis ${n} jours`,
      segFideles: 'Les plus fidèles',
      segBoutique: ({ nom }) => `Clients de ${nom}`,
      destLoading: 'Comptage des destinataires…',
      destNone: 'Aucun client dans cette sélection : rien ne serait envoyé.',
      destCount: ({ n }) => `${n} client${n > 1 ? 's' : ''} recevr${n > 1 ? 'ont' : 'a'} ce message`,
      destError: 'Impossible de compter les destinataires.',
      errLoadHistory: "Erreur de chargement de l'historique",
      quotaText: ({ used, limit }) => `${used} / ${limit} notifications ce mois-ci`,
      noNotifsSent: 'Aucune notification envoyée pour le moment',
      etatEnCours: "En cours d'envoi",
      etatEnvoyee: 'Envoyée',
      smartTitre: 'Mes smart notifications',
      smartIntro: 'Envoyées automatiquement à vos clients.',
      smartRelance: 'Relance',
      smartRelanceVal: ({ n }) => `après ${n} j`,
      smartBoostNom: 'Boost',
      smartBoostVal: ({ n, unite }) => `à ${n} ${unite === 'points' ? 'point' : 'tampon'}${n > 1 ? 's' : ''}`,
      smartAnniv: 'Anniversaire',
      smartAvis: 'Avis Google',
      smartProximite: 'À proximité',
      smart7j: ({ n }) => `Rapport des 7 derniers jours : ${n} smart notification${n > 1 ? 's' : ''} envoyée${n > 1 ? 's' : ''}`,
      smartModifier: 'Modifier',
      smartFermer: 'Fermer',
      smartJoursAvant: 'Relance après',
      smartJoursApres: 'jours sans visite (7 à 90)',
      smartMessage: 'Message de la relance',
      smartMessageAide: '150 caractères maximum, sans lien. « {prenom} » = prénom du client.',
      smartSeuilAvant: 'Boost à',
      smartSeuilApres: ({ unite, max }) => `${unite === 'points' ? 'points' : 'tampons'} de la récompense (1 à ${max})`,
      smartMessageBoost: 'Message du boost',
      smartMessageBoostAide: '« {reste} » obligatoire : il devient « 2 points » ou « 1 tampon ». 150 caractères maximum, sans lien.',
      smartEnregistrer: 'Enregistrer',
      smartWinwin: 'Revenir au réglage WinWin',
      smartEnregistre: 'Enregistré.',
      smartErrGen: 'Enregistrement impossible. Réessayez.',
      smartErr: {
        jours_hors_limites: 'Choisissez entre 7 et 90 jours.', message_vide: 'Le message ne peut pas être vide.',
        message_trop_long: '150 caractères maximum.', message_avec_lien: 'Les liens ne sont pas autorisés dans le message.',
        message_sans_reste: 'Le mot {reste} est obligatoire : il est remplacé par le nombre restant.',
        seuil_hors_limites: 'Seuil hors limites.', aucun_reglage: 'Rien à enregistrer.',
      },
    },
    en: {
      pushNotifs: 'Push notifications',
      notifInfo: '📱 Sent via Apple & Google Wallet to registered devices.',
      message: 'Message',
      notifPlaceholder: 'E.g.: Come enjoy 20% off all menu items this weekend!',
      segmentLabel: 'Recipients',
      sendNotif: 'Send notification',
      msgRequired: 'Message is required',
      sending: 'Sending…',
      sendError: 'Send error',
      campagneEnCours: 'Campaign being sent.',
      segTous: 'All customers',
      segInactifs: ({ n }) => `Inactive for ${n} days`,
      segFideles: 'Most loyal customers',
      segBoutique: ({ nom }) => `Customers of ${nom}`,
      destLoading: 'Counting recipients…',
      destNone: 'No customer in this selection: nothing would be sent.',
      destCount: ({ n }) => `${n} customer${n === 1 ? '' : 's'} will receive this message`,
      destError: 'Recipients could not be counted.',
      errLoadHistory: 'Error loading history',
      quotaText: ({ used, limit }) => `${used} / ${limit} notifications this month`,
      noNotifsSent: 'No notifications sent yet',
      etatEnCours: 'Sending',
      etatEnvoyee: 'Sent',
      smartTitre: 'My smart notifications',
      smartIntro: 'Sent automatically to your customers.',
      smartRelance: 'Reminder',
      smartRelanceVal: ({ n }) => `after ${n} d`,
      smartBoostNom: 'Boost',
      smartBoostVal: ({ n, unite }) => `at ${n} ${unite === 'points' ? 'point' : 'stamp'}${n > 1 ? 's' : ''}`,
      smartAnniv: 'Birthday',
      smartAvis: 'Google review',
      smartProximite: 'Nearby',
      smart7j: ({ n }) => `Last 7 days report: ${n} smart notification${n === 1 ? '' : 's'} sent`,
      smartModifier: 'Edit',
      smartFermer: 'Close',
      smartJoursAvant: 'Reminder after',
      smartJoursApres: 'days without a visit (7 to 90)',
      smartMessage: 'Reminder message',
      smartMessageAide: '150 characters max, no link. « {prenom} » = the customer\'s first name.',
      smartSeuilAvant: 'Boost at',
      smartSeuilApres: ({ unite, max }) => `${unite === 'points' ? 'points' : 'stamps'} from the reward (1 to ${max})`,
      smartMessageBoost: 'Boost message',
      smartMessageBoostAide: '« {reste} » is required: it becomes « 2 points » or « 1 stamp ». 150 characters max, no link.',
      smartEnregistrer: 'Save',
      smartWinwin: 'Back to WinWin settings',
      smartEnregistre: 'Saved.',
      smartErrGen: 'Could not save. Please try again.',
      smartErr: {
        jours_hors_limites: 'Choose between 7 and 90 days.', message_vide: 'The message cannot be empty.',
        message_trop_long: '150 characters maximum.', message_avec_lien: 'Links are not allowed in the message.',
        message_sans_reste: 'The word {reste} is required: it is replaced by the number left.',
        seuil_hors_limites: 'Threshold out of range.', aucun_reglage: 'Nothing to save.',
      },
    },
  };

  // Même règle que t() du cœur ; une clé absente d'ici (historyTitle, partagée
  // avec l'onglet Scans) est lue dans le dictionnaire du cœur.
  function tx(cle, vars) {
    const d = TXT[_lang === 'fr' ? 'fr' : 'en'];
    let s = d[cle] != null ? d[cle] : TXT.en[cle];
    if (s == null) return t(cle, vars);
    if (typeof s === 'function') return s(vars || {});
    if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
    return s;
  }

  const CSS = `
    #tab-notifs .notif-dest { font-size: 12px; color: var(--muted); margin-top: 6px; min-height: 16px; }
    #tab-notifs .smart-notifs { margin-top: 18px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 18px; }
    #tab-notifs .smart-notifs h3 { font-size: 15px; margin: 0 0 4px; }
    #tab-notifs .smart-notifs .smart-intro { font-size: 13px; color: var(--muted); margin: 0 0 12px; }
    #tab-notifs .smart-liste { list-style: none; margin: 0 0 12px; padding: 0; }
    #tab-notifs .smart-liste li { display: flex; align-items: baseline; gap: 6px; padding: 9px 0; border-top: 1px solid var(--border); font-size: 14px; }
    #tab-notifs .smart-liste li:first-child { border-top: none; }
    #tab-notifs .smart-liste .nom { font-weight: 600; }
    #tab-notifs .smart-liste .val { color: var(--muted); }
    #tab-notifs .smart-pied { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
    #tab-notifs .smart-notifs .smart-7j { font-size: 12px; color: var(--muted); margin: 0; }
    #tab-notifs .smart-form { display: flex; flex-direction: column; gap: 14px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); }
    #tab-notifs .smart-form .ligne { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14px; }
    #tab-notifs .smart-form input[type=number] { width: 76px; background: var(--bg); border: 1px solid var(--border); border-radius: 9px; color: var(--text); font-size: 16px; padding: 8px 10px; font-family: inherit; }
    #tab-notifs .smart-form textarea { width: 100%; box-sizing: border-box; min-height: 64px; background: var(--bg); border: 1px solid var(--border); border-radius: 9px; color: var(--text); font-size: 16px; padding: 10px 12px; font-family: inherit; resize: vertical; }
    #tab-notifs .smart-form .aide { font-size: 12px; color: var(--muted); }
    #tab-notifs .smart-form .titre { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }
    #tab-notifs .smart-form .boutons { display: flex; gap: 8px; flex-wrap: wrap; }
    #tab-notifs .notif-quota-bar { font-size: 13px; color: var(--muted); margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
    #tab-notifs .notif-quota-bar.warning { color: var(--warning); }
    #tab-notifs .notif-quota-bar.overlimit { color: var(--error); }
    #tab-notifs .notif-form { display: flex; flex-direction: column; gap: 14px; }
    #tab-notifs .notif-log-entry { background: var(--surface); border-radius: var(--radius); padding: 12px 14px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 5px; }
    #tab-notifs .notif-log-msg  { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #tab-notifs .notif-log-meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); }
  `;

  // ── Mémoire de l'onglet ────────────────────────────────────────────────
  let construitEn = null;      // langue des textes construits ; null = pas encore construit
  let logs = null;             // historique déjà lu (null = à relire)
  let quota = null;            // quota du mois, avec l'historique
  let smart = null, smartOuvert = false;
  let comptage = 0, dernierComptage = null;   // { n } ou { erreur: true }

  const $ = id => document.getElementById(id);

  function construire() {
    if (!$('notifs-css')) {
      const st = document.createElement('style');
      st.id = 'notifs-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    $('tab-notifs').innerHTML = `
      <div class="tab-header"><h2>${esc(tx('pushNotifs'))}</h2></div>
      <div class="alert alert-info" style="margin-bottom:16px">${esc(tx('notifInfo'))}</div>
      <div class="notif-quota-bar" id="notif-quota" style="display:none">
        <span id="notif-quota-text"></span>
      </div>
      <form class="notif-form" id="notif-form" onsubmit="return false">
        <div class="field">
          <label for="notif-msg">${esc(tx('message'))}</label>
          <textarea id="notif-msg" maxlength="500" placeholder="${esc(tx('notifPlaceholder'))}"></textarea>
          <div class="char-count" id="cc-msg">0 / 500</div>
        </div>
        <div class="field">
          <label for="notif-segment">${esc(tx('segmentLabel'))}</label>
          <select id="notif-segment"></select>
          <div class="notif-dest" id="notif-dest"></div>
        </div>
        <button type="submit" class="btn btn-primary" id="btn-send-notif">${esc(tx('sendNotif'))}</button>
        <div id="notif-result" class="send-result"></div>
      </form>

      <div class="divider" style="margin-top:8px"></div>
      <div class="tab-header" style="margin-bottom:10px">
        <h2 style="font-size:15px;color:var(--muted)">${esc(tx('historyTitle'))}</h2>
      </div>
      <div id="notif-history-list"></div>

      <div id="smart-notifs" class="smart-notifs" style="display:none"></div>`;
    $('notif-msg').addEventListener('input', compterCaracteres);
    $('notif-form').addEventListener('submit', envoyer);
    $('notif-segment').addEventListener('change', compterDestinataires);
    construitEn = _lang;
  }

  // Langue changée après la construction : textes refaits, sans requête ;
  // message, choix du segment et bloc smart (ouvert ou non) gardés.
  function retraduire() {
    const msg = $('notif-msg').value, seg = $('notif-segment').value;
    construire();
    $('notif-msg').value = msg;
    compterCaracteres();
    remplirSegments(false);
    if ([...$('notif-segment').options].some(o => o.value === seg)) $('notif-segment').value = seg;
    afficherComptage();
    if (logs) { afficherQuota(); renderNotifHistory(); }
    rendreSmartNotifs();
  }
  document.addEventListener('ww-langue', () => { if (construitEn && construitEn !== _lang) retraduire(); });

  function compterCaracteres() {
    const n = $('notif-msg').value.length;
    const cc = $('cc-msg');
    cc.textContent = `${n} / 500`;
    cc.classList.toggle('over', n >= 500);
  }

  async function envoyer() {
    const msg    = $('notif-msg').value.trim();
    const result = $('notif-result');
    const btn    = $('btn-send-notif');
    result.innerHTML = '';
    if (!msg) { result.innerHTML = `<div class="alert alert-error">${tx('msgRequired')}</div>`; return; }
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${tx('sending')}`;
    try {
      const res  = await api('/api/notifications', { method: 'POST', body: JSON.stringify({ message: msg, segment: segmentChoisi() }) });
      const data = await res.json();
      if (!res.ok) {
        result.innerHTML = `<div class="alert alert-error">${data.error || tx('sendError')}</div>`;
        logs = null; setTimeout(() => loadNotifHistory(true), 400);
        return;
      }
      // Étape t37 : le serveur répond tout de suite, l'envoi part par lots.
      result.innerHTML = `<div class="alert alert-success">${tx('campagneEnCours')}</div>`;
      $('notif-msg').value = '';
      $('cc-msg').textContent = '0 / 500';
      logs = null;
      setTimeout(() => loadNotifHistory(true), 600);
    } catch (e) {
      result.innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = tx('sendNotif');
    }
  }

  // Segments (migration 059) : un seul à la fois. Inactifs : 60 jours seulement
  // (migration 065 ; en dessous, les relances automatiques s'en chargent). « Clients d'une boutique » pour
  // les réseaux seulement (S.pdv non vide). Le nombre de destinataires est lu à la
  // demande, à chaque choix — jamais en boucle.
  function libelleSegment(seg) {
    if (!seg) return tx('segTous');
    if (seg.type === 'inactifs') return tx('segInactifs', { n: seg.jours });
    if (seg.type === 'fideles')  return tx('segFideles');
    if (seg.type === 'boutique') return tx('segBoutique', { nom: seg.nom || '' });
    return '';
  }
  function remplirSegments(compter = true) {
    const sel = $('notif-segment');
    if (!sel) return;
    const avant = sel.value;
    const options = [null, { type: 'inactifs', jours: 60 }, { type: 'fideles' }]
      .concat((Array.isArray(S.pdv) ? S.pdv : []).map(b => ({ type: 'boutique', boutique: b.id, nom: b.nom })));
    sel.innerHTML = options.map(o => `<option value="${esc(o ? JSON.stringify(o) : '')}">${esc(libelleSegment(o))}</option>`).join('');
    if ([...sel.options].some(o => o.value === avant)) sel.value = avant;
    if (compter) compterDestinataires();
  }
  function segmentChoisi() {
    const v = ($('notif-segment') || {}).value;
    if (!v) return null;
    const o = JSON.parse(v);
    return o.type === 'boutique' ? { type: 'boutique', boutique: o.boutique } : o;
  }
  function afficherComptage() {
    const el = $('notif-dest');
    if (!el || !dernierComptage) return;
    el.textContent = dernierComptage.erreur ? tx('destError')
      : dernierComptage.n === 0 ? tx('destNone') : tx('destCount', { n: dernierComptage.n });
  }
  async function compterDestinataires() {
    const el = $('notif-dest');
    if (!el) return;
    const n = ++comptage;
    dernierComptage = null;
    el.textContent = tx('destLoading');
    try {
      const seg = segmentChoisi();
      const res = await api('/api/notifications/destinataires' + (seg ? '?segment=' + encodeURIComponent(JSON.stringify(seg)) : ''));
      const d = await res.json();
      if (n !== comptage) return;   // un autre choix entre-temps
      if (!res.ok) throw new Error();
      dernierComptage = { n: d.destinataires };
    } catch { if (n === comptage) dernierComptage = { erreur: true }; }
    if (n === comptage) afficherComptage();
  }

  // Bloc « Mes smart notifications » (14/10) : une lecture à l'ouverture de
  // l'onglet. Rien n'est affiché si le forfait n'y a pas droit, si aucune n'est
  // active, ou si la lecture échoue (le bloc n'est qu'informatif).
  // f15 : « Régler mes relances » ouvre un petit formulaire (délai d'inactivité,
  // message, seuil du boost) — seulement pour les relances activées par l'admin.
  // Une écriture par enregistrement ; aucune lecture régulière.
  async function chargerSmartNotifs() {
    const el = $('smart-notifs');
    if (!el) return;
    try {
      const res = await api('/api/merchants/me/smart-notifications');
      if (!res.ok) throw new Error();
      smart = await res.json();
      rendreSmartNotifs();
    } catch { el.style.display = 'none'; }
  }
  function rendreSmartNotifs(info) {
    const el = $('smart-notifs');
    const d = smart;
    if (!el || !d || !d.eligible) { if (el) el.style.display = 'none'; return; }
    // Une ligne courte par smart notification active (f18).
    const lignes = [];
    if (d.inactivite)   lignes.push([tx('smartRelance'), tx('smartRelanceVal', { n: d.inactivite.jours })]);
    if (d.boost)        lignes.push([tx('smartBoostNom'), tx('smartBoostVal', { n: d.boost.seuil, unite: d.boost.unite })]);
    if (d.anniversaire) lignes.push([tx('smartAnniv'), '']);
    if (d.avis)         lignes.push([tx('smartAvis'), '']);
    if (d.proximite)    lignes.push([tx('smartProximite'), '']);
    if (!lignes.length) { el.style.display = 'none'; return; }
    const reglable = d.inactivite || d.boost;
    let form = '';
    if (reglable && smartOuvert) {
      form = `<div class="smart-form" id="smart-form">
        ${d.inactivite ? `<div class="ligne">${esc(tx('smartJoursAvant'))} <input type="number" id="smart-jours" min="7" max="90" value="${d.inactivite.jours}"> ${esc(tx('smartJoursApres'))}</div>
        <div><div class="titre">${esc(tx('smartMessage'))}</div>
          <textarea id="smart-message" maxlength="150">${esc(d.inactivite.message)}</textarea>
          <div class="aide">${esc(tx('smartMessageAide'))}</div></div>` : ''}
        ${d.boost ? `<div class="ligne">${esc(tx('smartSeuilAvant'))} <input type="number" id="smart-seuil" min="1" max="${d.boost.max}" value="${d.boost.seuil}"> ${esc(tx('smartSeuilApres', { unite: d.boost.unite, max: d.boost.max }))}</div>
        <div><div class="titre">${esc(tx('smartMessageBoost'))}</div>
          <textarea id="smart-message-boost" maxlength="150">${esc(d.boost.message)}</textarea>
          <div class="aide">${esc(tx('smartMessageBoostAide'))}</div></div>` : ''}
        <div class="boutons" style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary btn-sm" id="smart-enregistrer">${esc(tx('smartEnregistrer'))}</button>
          ${d.personnalise ? `<button type="button" class="btn btn-ghost btn-sm" id="smart-winwin">${esc(tx('smartWinwin'))}</button>` : ''}
        </div>
        <div class="aide" id="smart-info">${info ? esc(info) : ''}</div>
      </div>`;
    }
    el.innerHTML = `<h3>${esc(tx('smartTitre'))}</h3><p class="smart-intro">${esc(tx('smartIntro'))}</p>
      <ul class="smart-liste">${lignes.map(([nom, val]) => `<li><span class="nom">${esc(nom)}</span>${val ? ` <span class="val">· ${esc(val)}</span>` : ''}</li>`).join('')}</ul>
      <div class="smart-pied"><p class="smart-7j">${esc(tx('smart7j', { n: d.envoyees_7j }))}</p>
        ${reglable ? `<button type="button" class="btn btn-outline btn-sm" id="smart-regler">${esc(tx(smartOuvert ? 'smartFermer' : 'smartModifier'))}</button>` : ''}</div>
      ${form}`;
    el.style.display = '';
    if ($('smart-regler')) $('smart-regler').onclick = () => { smartOuvert = !smartOuvert; rendreSmartNotifs(); };
    if ($('smart-enregistrer')) $('smart-enregistrer').onclick = () => {
      const corps = {};
      if ($('smart-jours'))         corps.inactivite_jours = Number($('smart-jours').value);
      if ($('smart-message'))       corps.inactivite_message = $('smart-message').value;
      if ($('smart-seuil'))         corps.boost_seuil = Number($('smart-seuil').value);
      if ($('smart-message-boost')) corps.boost_message = $('smart-message-boost').value;
      enregistrerSmart(corps);
    };
    if ($('smart-winwin')) $('smart-winwin').onclick = () => enregistrerSmart({ winwin: true });
  }
  async function enregistrerSmart(corps) {
    const info = $('smart-info');
    try {
      const res = await api('/api/merchants/me/smart-notifications', { method: 'PATCH', body: JSON.stringify(corps) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { if (info) info.textContent = (tx('smartErr') || {})[d.error] || tx('smartErrGen'); return; }
      smart = d;
      rendreSmartNotifs(tx('smartEnregistre'));
    } catch { if (info) info.textContent = tx('smartErrGen'); }
  }

  // ── Historique et quota ────────────────────────────────────────────────
  function afficherQuota() {
    const quotaEl = $('notif-quota'), quotaText = $('notif-quota-text');
    if (!quota || !quotaEl || !quotaText) return;
    const pct = quota.limit > 0 ? quota.used / quota.limit : 0;
    quotaText.textContent = tx('quotaText', { used: quota.used, limit: quota.limit });
    quotaEl.style.display = '';
    quotaEl.className = 'notif-quota-bar' + (pct >= 1 ? ' overlimit' : pct >= 0.8 ? ' warning' : '');
  }

  async function loadNotifHistory(force = false) {
    if (!force && logs) { renderNotifHistory(); return; }
    const el = $('notif-history-list');
    el.innerHTML = Array(3).fill('<div class="skeleton skeleton-card" style="height:56px"></div>').join('');
    try {
      const res  = await api('/api/notifications');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || tx('errLoadHistory'));
      // Response: { logs: [...], quota: { used, limit, forfait } }
      logs = Array.isArray(data.logs) ? data.logs : (Array.isArray(data) ? data : []);
      quota = data.quota || null;
      afficherQuota();
    } catch (e) {
      logs = [];
      el.innerHTML = `<div class="alert alert-error" style="font-size:12px">${e.message}</div>`;
      return;
    }
    renderNotifHistory();
  }

  function renderNotifHistory() {
    const el = $('notif-history-list');
    if (!logs || logs.length === 0) {
      el.innerHTML = `<div class="empty" style="padding:20px 0"><div class="empty-icon">📭</div><div class="empty-sub">${tx('noNotifsSent')}</div></div>`;
      return;
    }
    el.innerHTML = logs.map(n => {
      // Étape t37 : plus de chiffre, l'état seulement.
      const dest = n.etat === 'en_cours' ? tx('etatEnCours') : tx('etatEnvoyee');
      const cible = n.segment ? ' · ' + esc(libelleSegment(n.segment)) : '';
      return `<div class="notif-log-entry">
        <div class="notif-log-msg">${esc(n.message)}</div>
        <div class="notif-log-meta"><span>${timeAgo(n.created_at)}${cible}</span><span>${dest}</span></div>
      </div>`;
    }).join('');
  }

  // ── Points d'entrée (appelés par le cœur) ──────────────────────────────
  // À chaque ouverture de l'onglet : les mêmes lectures qu'avant le découpage.
  function charger() {
    if (!construitEn) construire();
    else if (construitEn !== _lang) retraduire();
    loadNotifHistory();
    remplirSegments();
    chargerSmartNotifs();
  }
  // Déconnexion : l'historique sera relu pour le prochain compte.
  function oublier() { logs = null; quota = null; }

  // tx : les textes de l'onglet (tests navigateur : pluriels du rapport des 7 jours).
  window.Notifs = { charger, oublier, tx };
})();
