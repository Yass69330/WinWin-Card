// ════════════════════════════════════════════════════════════════════════════
// ONGLET « SCANS » (historique, t42, découpage du dashboard, onglet 3/6)
//
// Fichier à part, sur le modèle de notifs.js : une erreur ici n'arrête que cet
// onglet. Il utilise les outils du cœur (api, esc, t, timeAgo, colorFrom, _lang,
// S.maxValue) et n'écrit rien en dehors de #tab-scans et de window.Scans.
//
// Contenu : les derniers scans (GET /api/scan?lieu=1), lus à la première
// ouverture et gardés ; ↺ relit. Deux endroits du cœur demandent une relecture
// (Scans.oublier) : un scan fait depuis l'onglet Scanner, une annulation ou un
// ajustement depuis la fiche client ; et la déconnexion.
//
// Lieu et annulation (18/10, après le découpage) :
//   - la boutique de chaque scan (réseau) s'affiche après l'heure ; rien pour un
//     mono-site (lieu vide). La caisse lit la même route SANS ?lieu=1 : sa
//     réponse ne change pas ;
//   - « Annuler » : EXACTEMENT l'annulation de la fiche client. Même route
//     (POST /api/scan/:id/annuler), même confirmation, mêmes messages de refus.
//     Le bouton n'apparaît que sur le dernier scan actif de chaque client (la
//     liste va du plus récent au plus ancien). La base revalide tout, verrouillée :
//     déjà annulé, plus le dernier mouvement du client (ajustement compris),
//     solde changé depuis (migration 052, annuler_scan).
// Fichier servi depuis le cache par le service worker : changer ?v= dans
// index.html à chaque modification.
// ════════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const TXT = {
    fr: {
      noScans: 'Aucun scan',
      scansWillAppear: "L'historique des scans apparaîtra ici après les premières transactions",
      rewardBadge: '🎉 Récompense',
      resetBadge: '↩️ Remise à zéro',
    },
    en: {
      noScans: 'No scans',
      scansWillAppear: 'Scan history will appear here after the first transactions',
      rewardBadge: '🎉 Reward',
      resetBadge: '↩️ Reset',
    },
  };

  // Une clé absente d'ici (historyTitle, refresh, scanAnnule : partagées) est lue
  // dans le dictionnaire du cœur.
  function tx(cle, vars) {
    const d = TXT[_lang === 'fr' ? 'fr' : 'en'];
    const s = d[cle] != null ? d[cle] : TXT.en[cle];
    return s == null ? t(cle, vars) : s;
  }

  const CSS = `
    #tab-scans .scan-entry { background: var(--surface); border-radius: var(--radius); padding: 12px 14px; display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    #tab-scans .scan-avatar { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; flex-shrink: 0; color: #fff; }
    #tab-scans .scan-info { flex: 1; min-width: 0; }
    #tab-scans .scan-name { font-size: 14px; font-weight: 600; }
    #tab-scans .scan-time { font-size: 11px; color: var(--muted); }
    #tab-scans .scan-delta { flex-shrink: 0; text-align: right; }
    #tab-scans .scan-pts { font-size: 14px; font-weight: 700; }
    #tab-scans .scan-undo { flex-shrink:0; background:none; border:1px solid var(--border); color:var(--muted); border-radius:8px; padding:6px 10px; font-size:12px; cursor:pointer; }
  `;

  // ── Mémoire de l'onglet ────────────────────────────────────────────────
  let construitEn = null;   // langue des textes construits ; null = pas encore construit
  let scans = null;         // derniers scans déjà lus (null = à relire)

  const $ = id => document.getElementById(id);

  function construire() {
    if (!$('scans-css')) {
      const st = document.createElement('style');
      st.id = 'scans-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    $('tab-scans').innerHTML = `
      <div class="tab-header">
        <h2>${esc(tx('historyTitle'))}</h2>
        <button class="btn-refresh" id="btn-refresh-scans" title="${esc(tx('refresh'))}">↺</button>
      </div>
      <div id="scans-list"></div>`;
    $('btn-refresh-scans').addEventListener('click', () => { scans = null; loadScans(true); });
    $('scans-list').addEventListener('click', annuler);
    construitEn = _lang;
  }

  async function loadScans(force = false) {
    if (!force && scans) { renderScans(); return; }
    $('scans-list').innerHTML = Array(5).fill('<div class="skeleton skeleton-card"></div>').join('');
    try {
      const res = await api('/api/scan?lieu=1');
      const data = await res.json();
      scans = Array.isArray(data) ? data : [];
      renderScans();
    } catch (e) {
      $('scans-list').innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    }
  }

  function renderScans() {
    const el = $('scans-list');
    if (!Array.isArray(scans) || scans.length === 0) {
      el.innerHTML = `<div class="empty"><div class="empty-icon">📋</div><div class="empty-title">${tx('noScans')}</div><div class="empty-sub">${tx('scansWillAppear')}</div></div>`;
      return;
    }
    // « Annuler » sur le dernier scan actif de chaque client : le premier qu'on
    // rencontre en descendant la liste.
    const vus = new Set();
    el.innerHTML = scans.map(s => {
      const prenom = s.clients?.prenom || '?';
      const avant  = s.stored_value_avant;
      const apres  = s.stored_value_apres;
      const reward = apres >= S.maxValue;
      const reset  = apres === 0 && avant > 0;
      const delta  = reward
        ? `<div class="scan-pts" style="color:var(--warning)">${tx('rewardBadge')}</div><div style="font-size:11px;color:var(--muted)">${avant} → ${apres}</div>`
        : reset
          ? `<div class="scan-pts" style="color:var(--accent)">${tx('resetBadge')}</div><div style="font-size:11px;color:var(--muted)">${avant} → 0</div>`
          : `<div class="scan-pts">${avant} → ${apres}</div>`;
      const annule = !!s.annule_le;
      const lieu = s.points_de_vente && s.points_de_vente.nom;   // null pour un mono-site
      const clientId = s.clients?.id;
      const dernier = !annule && clientId && !vus.has(clientId);
      if (!annule && clientId) vus.add(clientId);
      const bouton = dernier
        ? `<button class="scan-undo" data-id="${esc(s.id)}" data-avant="${esc(avant)}">${esc(tx('annulerPassage'))}</button>` : '';
      return `<div class="scan-entry"${annule ? ' style="opacity:.5"' : ''}>
        <div class="scan-avatar" style="background:${colorFrom(prenom)}">${prenom.charAt(0).toUpperCase()}</div>
        <div class="scan-info"><div class="scan-name"${annule ? ' style="text-decoration:line-through"' : ''}>${esc(prenom)}</div><div class="scan-time">${timeAgo(s.date_scan)}${lieu ? ' · ' + esc(lieu) : ''}${annule ? ' · ' + tx('scanAnnule') : ''}</div></div>
        <div class="scan-delta">${delta}</div>
        ${bouton}
      </div>`;
    }).join('');
  }

  // Annuler un passage depuis la liste : même geste et mêmes garde-fous que la
  // fiche client (index.html, « Annuler le dernier mouvement depuis la fiche »).
  // Une seule requête, au tap, bouton désactivé pendant ; puis la liste est relue
  // et la liste des clients sera relue (solde changé).
  async function annuler(e) {
    const b = e.target.closest('.scan-undo');
    if (!b) return;
    if (!confirm(tx('annulPassageConfirm', { avant: b.dataset.avant }))) return;
    b.disabled = true;
    try {
      const res = await api(`/api/scan/${b.dataset.id}/annuler`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        alert({ pas_le_dernier: tx('annulRefusDernier'), solde_incoherent: tx('annulRefusSolde'),
                deja_annule: tx('annulRefusDeja') }[data.reason] || data.error || tx('errorGeneric'));
      }
    } catch (err) {
      alert(err.message);
    }
    S.clients = null;   // soldes de l'onglet Clients à relire
    scans = null;
    loadScans(true);
  }

  // Langue changée après la construction (signal « ww-langue » de setLang) :
  // textes refaits depuis la mémoire, sans requête.
  document.addEventListener('ww-langue', () => {
    if (!construitEn || construitEn === _lang) return;
    construire();
    if (scans) renderScans();
  });

  // ── Points d'entrée (appelés par le cœur) ──────────────────────────────
  function charger() {
    if (!construitEn) construire();
    else if (construitEn !== _lang) construire();
    loadScans();
  }
  // Relecture demandée (scan depuis l'onglet Scanner, annulation ou ajustement
  // depuis la fiche client, déconnexion) : la prochaine ouverture relit.
  function oublier() { scans = null; }

  window.Scans = { charger, oublier };
})();
