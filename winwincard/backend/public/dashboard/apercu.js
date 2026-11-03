// ════════════════════════════════════════════════════════════════════════════
// ONGLET « APERÇU » (t42, découpage du dashboard, onglet 5/6)
//
// Fichier à part, sur le modèle de notifs.js / reseau.js / scans.js / clients.js :
// une erreur ici n'arrête que cet onglet. Il utilise les outils du cœur (api,
// esc, t, _lang, S, statsBlocHtml, statsPanneHtml, lireContexte,
// appliquerContexte) et n'écrit que dans #tab-overview et window.Apercu.
//
// Contenu, déplacé TEL QUEL depuis index.html : les chiffres (GET /me/stats),
// le QR code de la page d'accueil (copier, partager) et la gestion des boutiques
// (renommer, couper, rétablir l'accès scanner).
// Restent au cœur, parce que d'autres onglets en dépendent (un Aperçu en panne
// ne doit faire tomber que lui) :
//   - la lecture de /me et des boutiques (lireContexte / appliquerContexte) :
//     langue, forfait, seuil, S.pdv (aussi lu par Notifications), onglet Réseau
//     visible pour un réseau seulement (majNavReseau) ;
//   - le bloc de chiffres partagé avec l'onglet Réseau (statsBlocHtml,
//     statsPanneHtml) et le style des cartes de chiffres.
// L'état reste dans S (S.stats, S.qr, S.pdv) : la déconnexion le remet à null
// comme avant.
// Fichier servi depuis le cache par le service worker : changer ?v= dans
// index.html à chaque modification.
// ════════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const TXT = {
    en: {
      qrSectionTitle:'QR code landing page',
      pdvSectionTitle:'Points of sale', pdvRename:'Rename',
      pdvAddHint:'To add a point of sale, contact us.',
      pdvRenamePrompt:'New name for this point of sale:',
      pdvCut:'Cut access', pdvRestore:'Restore', pdvCutStatus:'cut off',
      pdvConfirmCut:'Cut scanner access for "{nom}"? Scanning stops immediately at this store.',
      pdvConfirmRestore:'Restore scanner access for "{nom}"?',
      copyLink:'📋 Copy link', copied:'✓ Copied', share:'↗ Share', qrShareTitle:'Loyalty program',
    },
    fr: {
      qrSectionTitle:"QR code de la page d'accueil",
      pdvSectionTitle:'Points de vente', pdvRename:'Renommer',
      pdvAddHint:'Pour ajouter un point de vente, contactez-nous.',
      pdvRenamePrompt:'Nouveau nom de ce point de vente :',
      pdvCut:"Couper l'accès", pdvRestore:'Rétablir', pdvCutStatus:'coupée',
      pdvConfirmCut:"Couper l'accès scanner de « {nom} » ? Le scan s'arrête immédiatement dans cette boutique.",
      pdvConfirmRestore:"Rétablir l'accès scanner de « {nom} » ?",
      copyLink:'📋 Copier le lien', copied:'✓ Copié', share:'↗ Partager', qrShareTitle:'Programme de fidélité',
    },
  };

  // Une clé absente d'ici (chiffres, statsUnavailable, reessayer : partagés avec
  // l'onglet Réseau) est lue dans le dictionnaire du cœur.
  function tx(cle, vars) {
    const d = TXT[_lang === 'fr' ? 'fr' : 'en'];
    let s = d[cle] != null ? d[cle] : TXT.en[cle];
    if (s == null) return t(cle, vars);
    if (typeof s === 'function') return s(vars || {});
    if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
    return s;
  }

  const CSS = `
    #tab-overview .qr-card img { width: 180px; height: 180px; border-radius: 10px; background: #fff; }
    #tab-overview .qr-url { font-size: 12px; color: var(--muted); word-break: break-all; text-align: center; }
    #tab-overview .qr-actions { display: flex; gap: 8px; width: 100%; }
    #tab-overview .qr-actions .btn { flex: 1; }
  `;

  let construitEn = null;   // langue des textes construits ; null = pas encore construit
  const $ = id => document.getElementById(id);

  // Le squelette de l'onglet (avant : balisage statique d'index.html).
  function construire() {
    if (!$('apercu-css')) {
      const st = document.createElement('style');
      st.id = 'apercu-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    $('tab-overview').innerHTML = `
      <div class="stats-grid" id="stats-grid">
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card"></div>
        <div class="skeleton skeleton-card" style="grid-column:1/-1"></div>
      </div>
      <p class="section-title">${esc(tx('qrSectionTitle'))}</p>
      <div class="qr-card" id="qr-section">
        <div class="skeleton" style="width:180px;height:180px;border-radius:10px"></div>
        <div class="skeleton" style="width:60%;height:12px;border-radius:6px"></div>
      </div>
      <div id="pdv-section" style="display:none">
        <p class="section-title">${esc(tx('pdvSectionTitle'))}</p>
        <div class="qr-card" id="pdv-card" style="align-items:stretch;gap:6px"></div>
      </div>`;
    construitEn = _lang;
  }

  async function loadOverview(force = false) {
    if (!force && S.stats && S.qr) { renderOverview(); return; }
    // /me et les boutiques sont relus à chaque chargement, en parallèle des
    // chiffres et du QR (mêmes 4 requêtes qu'avant, au même moment), par le cœur.
    const [statsRes, qrRes, contexte] = await Promise.all([
      api('/api/merchants/me/stats').catch(() => null),
      api('/api/merchants/me/qrcode'),
      lireContexte(),
    ]);
    // Statistiques en panne (503) ou injoignables : rien n'est gardé, l'écran le
    // dit et le prochain affichage redemande (étape 26).
    S.stats = statsRes && statsRes.ok ? await statsRes.json().catch(() => null) : null;
    S.qr    = await qrRes.json();
    await appliquerContexte(contexte);
    renderOverview();
  }

  // Points de vente — visible uniquement si le réseau a ≥ 1 boutique (mono-site : masqué)
  function renderPdv() {
    const section = document.getElementById('pdv-section');
    const card    = document.getElementById('pdv-card');
    const list = Array.isArray(S.pdv) ? S.pdv : [];
    // (L'onglet Réseau, visible pour un réseau seulement, est réglé par le cœur : majNavReseau.)
    if (!section || !card) return;
    if (list.length === 0) { section.style.display = 'none'; return; }
    section.style.display = '';
    card.innerHTML = list.map(b => {
      const cut = b.actif === false;
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid rgba(0,0,0,.06)">
        <span style="font-weight:600">${esc(b.nom)}${cut ? ` <span style="color:var(--error,#ef4444);font-size:12px;font-weight:600">• ${tx('pdvCutStatus')}</span>` : ''}</span>
        <span style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-outline btn-sm btn-pdv-rename" data-id="${esc(b.id)}" data-nom="${esc(b.nom)}">${tx('pdvRename')}</button>
          <button class="btn btn-outline btn-sm btn-pdv-actif" data-id="${esc(b.id)}" data-nom="${esc(b.nom)}" data-actif="${b.actif !== false}">${cut ? tx('pdvRestore') : tx('pdvCut')}</button>
        </span>
      </div>`;
    }).join('') +
      `<div class="field-hint" style="margin-top:10px;opacity:.75">${tx('pdvAddHint')}</div>`;
    card.querySelectorAll('.btn-pdv-rename').forEach(btn =>
      btn.addEventListener('click', () => renamePdv(btn.dataset.id, btn.dataset.nom)));
    card.querySelectorAll('.btn-pdv-actif').forEach(btn =>
      btn.addEventListener('click', () => toggleActif(btn.dataset.id, btn.dataset.nom, btn.dataset.actif === 'true')));
  }

  // Couper / rétablir l'accès scanner d'une boutique (levier franchiseur, 3d).
  async function toggleActif(id, nom, currentlyActif) {
    const msg = (currentlyActif ? tx('pdvConfirmCut') : tx('pdvConfirmRestore')).replace('{nom}', nom);
    if (!confirm(msg)) return;
    const res  = await api(`/api/merchants/me/points-de-vente/${id}/actif`, {
      method: 'PATCH', body: JSON.stringify({ actif: !currentlyActif }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Erreur'); return; }
    const b = (S.pdv || []).find(x => x.id === id);
    if (b) b.actif = data.actif;
    renderPdv();
  }

  async function renamePdv(id, currentNom) {
    const saisi = prompt(tx('pdvRenamePrompt'), currentNom);
    if (saisi === null) return;
    const nom = saisi.trim();
    if (!nom || nom === currentNom) return;
    const res  = await api(`/api/merchants/me/points-de-vente/${id}`, {
      method: 'PATCH', body: JSON.stringify({ nom }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Erreur'); return; }
    const b = (S.pdv || []).find(x => x.id === id);
    if (b) b.nom = data.nom;
    renderPdv();
  }

  function renderOverview() {
    const grille = document.getElementById('stats-grid');
    if (S.stats) {
      grille.innerHTML = statsBlocHtml(S.stats);
    } else {
      grille.innerHTML = statsPanneHtml('btn-stats-retry');
      document.getElementById('btn-stats-retry').addEventListener('click', () => loadOverview(true));
    }
    renderPdv();
    const qrSection = document.getElementById('qr-section');
    qrSection.innerHTML = `
      <img src="${S.qr.qrcode}" alt="QR code">
      <div class="qr-url">${S.qr.url}</div>
      <div class="qr-actions">
        <button class="btn btn-outline btn-sm" id="btn-copy-url">${tx('copyLink')}</button>
        ${navigator.share ? `<button class="btn btn-outline btn-sm" id="btn-share-url">${tx('share')}</button>` : ''}
      </div>`;
    document.getElementById('btn-copy-url')?.addEventListener('click', () => {
      navigator.clipboard.writeText(S.qr.url).then(() => {
        const b = document.getElementById('btn-copy-url');
        b.textContent = tx('copied'); setTimeout(() => b.textContent = tx('copyLink'), 2000);
      });
    });
    document.getElementById('btn-share-url')?.addEventListener('click', () => {
      navigator.share({ url: S.qr.url, title: tx('qrShareTitle') }).catch(() => {});
    });
  }

  // Langue changée après la construction (signal « ww-langue » de setLang) :
  // textes refaits depuis la mémoire, sans requête.
  document.addEventListener('ww-langue', () => {
    if (!construitEn || construitEn === _lang) return;
    construire();
    if (S.qr) renderOverview();
  });

  // ── Points d'entrée (appelés par le cœur et par clients.js) ────────────
  function charger() {
    if (!construitEn || construitEn !== _lang) construire();
    loadOverview();
  }
  // Redessiner de mémoire (après la suppression d'un client depuis la fiche).
  function afficher() { if (construitEn && S.qr) renderOverview(); }

  window.Apercu = { charger, afficher };
})();
