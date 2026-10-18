// ════════════════════════════════════════════════════════════════════════════
// ONGLET « RÉSEAU » (t42, découpage du dashboard, onglet 2/6)
//
// Fichier à part, sur le modèle de notifs.js : une erreur ici n'arrête que cet
// onglet. Il utilise les outils du cœur (api, esc, t, _lang) et le bloc de
// chiffres PARTAGÉ avec l'Aperçu (statsBlocHtml, statsPanneHtml : mêmes cartes
// des deux côtés, un seul code). Il n'écrit rien en dehors de #tab-reseau et de
// window.Reseau. La gestion des boutiques (renommer, couper) vit dans l'Aperçu.
//
// Contenu : chiffres du réseau (group_stats), mobilité entre boutiques, scans non
// attribués, tableau des boutiques triable. Une lecture à la première ouverture,
// gardée ensuite (comme avant le découpage) ; oubliée à la déconnexion.
// Fichier servi depuis le cache par le service worker : changer ?v= dans
// index.html à chaque modification.
// ════════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const TXT = {
    fr: {
      rsMobilite: 'Porteurs fréquentant plusieurs boutiques',
      rsBoutiquesTitle: 'Boutiques',
      rsNonAttribues: 'Scans non attribués',
      rsColBoutique: 'Boutique',
      rsColScans: 'Scans',
      rsColEvol: 'vs mois préc.',
      rsColClients: 'Clients servis',
      rsColRecomp: 'Récompenses',
      rsArchived: 'archivée',
      rsNoBoutique: 'Aucune boutique.',
    },
    en: {
      rsMobilite: 'Carriers visiting more than one store',
      rsBoutiquesTitle: 'Stores',
      rsNonAttribues: 'Unattributed scans',
      rsColBoutique: 'Store',
      rsColScans: 'Scans',
      rsColEvol: 'vs last month',
      rsColClients: 'Clients served',
      rsColRecomp: 'Rewards',
      rsArchived: 'archived',
      rsNoBoutique: 'No store.',
    },
  };

  // Même règle que t() du cœur ; une clé absente d'ici est lue dans le cœur.
  function tx(cle, vars) {
    const d = TXT[_lang === 'fr' ? 'fr' : 'en'];
    const s = d[cle] != null ? d[cle] : TXT.en[cle];
    return s == null ? t(cle, vars) : s;
  }

  const CSS = `
    #tab-reseau .rs-table { width:100%; border-collapse:collapse; font-size:13px; }
    #tab-reseau .rs-table th, #tab-reseau .rs-table td { padding:8px 10px; text-align:right; border-bottom:1px solid rgba(0,0,0,.06); font-variant-numeric:tabular-nums; }
    #tab-reseau .rs-table th:first-child, #tab-reseau .rs-table td:first-child { text-align:left; }
    #tab-reseau .rs-table th { cursor:pointer; user-select:none; color:var(--muted); font-weight:600; white-space:nowrap; }
    #tab-reseau .rs-table th:hover { color:var(--accent); }
  `;

  // ── Mémoire de l'onglet ────────────────────────────────────────────────
  let donnees = null;                          // réponse de group_stats (null = à relire)
  let tri = { col: 'scans', dir: -1 };         // tri du tableau des boutiques

  const panneau = () => document.getElementById('tab-reseau');

  function style() {
    if (document.getElementById('reseau-css')) return;
    const st = document.createElement('style');
    st.id = 'reseau-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  async function loadReseau(force = false) {
    if (!force && donnees) { renderReseau(); return; }
    const el = panneau();
    el.innerHTML = '<div class="skeleton skeleton-card"></div>';
    // En panne (503) ou injoignable : rien n'est gardé, message + Réessayer (étape 26).
    let res = null;
    try { res = await api('/api/merchants/me/group-stats'); } catch { /* traité ci-dessous */ }
    const corps = res && res.ok ? await res.json().catch(() => null) : null;
    if (!corps) {
      donnees = null;
      el.innerHTML = `<div class="stats-grid">${statsPanneHtml('btn-reseau-retry')}</div>`;
      document.getElementById('btn-reseau-retry').addEventListener('click', () => loadReseau(true));
      return;
    }
    donnees = corps;
    renderReseau();
  }

  function rsEvolCell(v) {
    if (v == null) return '<span style="opacity:.45">—</span>';
    const c = v > 0 ? '#4ea672' : v < 0 ? '#ef4444' : 'inherit';
    return `<span style="color:${c};font-weight:600">${v > 0 ? '+' : ''}${v}%</span>`;
  }

  function renderReseau() {
    const d = donnees; if (!d) return;
    const el = panneau();
    const r = d.reseau || {};
    const sort = tri;
    const boutiques = (d.boutiques || []).slice().sort((a, b) => {
      let va = a[sort.col], vb = b[sort.col];
      if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); }
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
    el.innerHTML = `
      <div class="stats-grid">${statsBlocHtml(d.apercu || {})}</div>
      <div class="field-hint" style="margin:6px 2px 0">${tx('rsMobilite')} : <strong>${r.mobilite ?? 0}</strong></div>

      <p class="section-title">${tx('rsBoutiquesTitle')} <span class="field-hint" style="font-weight:400">· ${tx('rsNonAttribues')} : <strong>${d.scans_non_attribues ?? 0}</strong></span></p>
      <div style="overflow-x:auto">
        <table class="rs-table">
          <thead><tr>
            <th data-sort="nom">${tx('rsColBoutique')}</th>
            <th data-sort="scans">${tx('rsColScans')}</th>
            <th data-sort="evolution_pct">${tx('rsColEvol')}</th>
            <th data-sort="clients_distincts">${tx('rsColClients')}</th>
            <th data-sort="recompenses">${tx('rsColRecomp')}</th>
          </tr></thead>
          <tbody>
            ${boutiques.map(b => `<tr>
              <td>${esc(b.nom)}${b.archivee ? ` <span style="color:var(--error);font-size:11px">(${tx('rsArchived')})</span>` : ''}</td>
              <td>${b.scans}</td>
              <td>${rsEvolCell(b.evolution_pct)}</td>
              <td>${b.clients_distincts}</td>
              <td>${b.recompenses}</td>
            </tr>`).join('') || `<tr><td colspan="5" class="field-hint">${tx('rsNoBoutique')}</td></tr>`}
          </tbody>
        </table>
      </div>`;
    el.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
      const col = th.dataset.sort;
      tri = { col, dir: (sort.col === col ? -sort.dir : (col === 'nom' ? 1 : -1)) };
      renderReseau();
    }));
  }

  // Langue changée (signal « ww-langue » de setLang) : onglet affiché → textes
  // refaits depuis la mémoire, sans requête.
  document.addEventListener('ww-langue', () => {
    if (donnees && panneau().classList.contains('active')) renderReseau();
  });

  // ── Points d'entrée (appelés par le cœur) ──────────────────────────────
  function charger() { style(); loadReseau(); }
  // Déconnexion : les chiffres d'un réseau ne doivent jamais s'afficher au
  // compte suivant (défaut corrigé au découpage, 18/10).
  function oublier() { donnees = null; tri = { col: 'scans', dir: -1 }; }

  window.Reseau = { charger, oublier };
})();
