// ════════════════════════════════════════════════════════════════════════════
// ONGLET « CLIENTS » ET FICHE CLIENT (t42, découpage du dashboard, onglet 4/6)
//
// Fichier à part, sur le modèle de notifs.js / reseau.js / scans.js : une erreur
// ici n'arrête que cet onglet (et la fiche, qui ne s'ouvre que depuis lui). Il
// utilise les outils du cœur (api, esc, t, _lang, colorFrom, dateLocale, S,
// window.Apercu, window.Scans) et n'écrit que dans #tab-clients, dans la fiche
// et ses trois fenêtres (#modal-client, #modal-rename, #modal-adjust,
// #modal-delete, dont le balisage reste au cœur avec ses textes data-i18n) et
// dans window.Clients.
//
// Contenu, déplacé TEL QUEL depuis index.html : liste par pages et recherche
// faite par le serveur (étape 21), export CSV, fiche client (historique scans +
// ajustements, annulation du dernier mouvement, prénom, points, suppression).
// L'état reste dans S (S.clients, S.clientsTotal, S.clientsQ, S.clientId,
// S.clientData, S.deleteTargetId) : le cœur et scans.js le lisent ou le
// remettent à null comme avant.
// Fichier servi depuis le cache par le service worker : changer ?v= dans
// index.html à chaque modification.
// ════════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const TXT = {
    en: {
      clientsTitle:'Clients', csvBtn:'⬇ CSV', exportCsv:'Export CSV', showMore:'Show more',
      searchClients:'Search by first name…',
      clientsCount:({n,found})=>`${n} client${n>1?'s':''}${found?' found':''}`,
      noResults:'No results', noClients:'No clients', tryAnotherName:'Try another name',
      clientsWillAppear:'Clients will appear here after sign-up',
      exportFailed:'Export failed', exportError:({msg})=>'Export error: '+msg,
      deleteBody:({nom})=>`Delete <strong>${nom}</strong>? This action is <strong>irreversible</strong> — the pass will become invalid.`,
      memberSince:({date})=>'Member since '+date, noScansClient:'No scans recorded for this client.',
      firstNameRequired:'First name required',
      ajustementLibelle:'adjustment',
      annulAjustementConfirm:({avant})=>`Undo this adjustment? The balance goes back to ${avant}.`,
      soldeChange:({val})=>`A scan just went through: the balance is now ${val}. Check and try again.`,
      newBalancePoints:({max})=>`New balance (threshold ${max} pts, can be exceeded)`,
      ajustAuDessusSeuil:({val, max})=>`The balance (${val}) will be above the threshold (${max}): the reward will be due on the next visit. Confirm?`,
      newBalance:({max})=>`New balance (0 – ${max} pts)`,
      valueBetween:({max})=>`Value between 0 and ${max}`,
    },
    fr: {
      clientsTitle:'Clients', csvBtn:'⬇ CSV', exportCsv:'Exporter CSV', showMore:'Afficher plus',
      searchClients:'Rechercher par prénom…',
      clientsCount:({n,found})=>`${n} client${n>1?'s':''}${found?' trouvé'+(n>1?'s':''):''}`,
      noResults:'Aucun résultat', noClients:'Aucun client', tryAnotherName:'Essayez un autre nom',
      clientsWillAppear:'Les clients apparaîtront ici après leur inscription',
      exportFailed:"Échec de l'export", exportError:({msg})=>'Erreur export : '+msg,
      deleteBody:({nom})=>`Supprimer <strong>${nom}</strong> ? Cette action est <strong>irréversible</strong> — le pass deviendra invalide.`,
      memberSince:({date})=>'Membre depuis le '+date, noScansClient:'Aucun scan enregistré pour ce client.',
      firstNameRequired:'Prénom requis',
      ajustementLibelle:'ajustement',
      annulAjustementConfirm:({avant})=>`Annuler cet ajustement ? Le solde revient à ${avant}.`,
      soldeChange:({val})=>`Un scan vient de passer : le solde est maintenant de ${val}. Vérifiez et recommencez.`,
      newBalancePoints:({max})=>`Nouveau solde (seuil ${max} pts, dépassable)`,
      ajustAuDessusSeuil:({val, max})=>`Le solde (${val}) dépassera le seuil (${max}) : la récompense sera à remettre au prochain passage. Confirmer ?`,
      newBalance:({max})=>`Nouveau solde (0 – ${max} pts)`,
      valueBetween:({max})=>`Valeur entre 0 et ${max}`,
    },
  };

  // Une clé absente d'ici (refresh, errorGeneric, save, confirm, annulerPassage,
  // scanAnnule, annulPassageConfirm, annulRefus*, deletePermanently : partagées
  // ou utilisées par le balisage du cœur) est lue dans le dictionnaire du cœur.
  function tx(cle, vars) {
    const d = TXT[_lang === 'fr' ? 'fr' : 'en'];
    let s = d[cle] != null ? d[cle] : TXT.en[cle];
    if (s == null) return t(cle, vars);
    if (typeof s === 'function') return s(vars || {});
    if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
    return s;
  }

  const CSS = `
    #tab-clients .search-wrap { position: relative; margin-bottom: 12px; }
    #tab-clients .search-input { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 11px; color: var(--text); font-size: 15px; padding: 11px 14px 11px 38px; outline: none; -webkit-appearance: none; }
    #tab-clients .search-input:focus { border-color: var(--accent); }
    #tab-clients .search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; font-size: 16px; }
    #tab-clients .list-meta { font-size: 12px; color: var(--muted); margin-bottom: 10px; }

    #tab-clients .client-card { background: var(--surface); border-radius: var(--radius); padding: 14px; display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    #tab-clients .client-avatar { width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; flex-shrink: 0; color: #fff; }
    #tab-clients .client-info { flex: 1; min-width: 0; }
    #tab-clients .client-name { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #tab-clients .client-progress { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
    #tab-clients .mini-bar-wrap { flex: 1; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
    #tab-clients .mini-bar { height: 100%; background: var(--accent); border-radius: 2px; transition: width .3s; }
    #tab-clients .client-pts { font-size: 11px; color: var(--muted); white-space: nowrap; }
    #tab-clients .client-full { color: var(--warning); font-weight: 600; }
  `;

  let construitEn = null;   // langue des textes construits ; null = pas encore construit
  let minuteurRecherche = null;
  const $ = id => document.getElementById(id);

  // L'en-tête, la recherche et la liste (avant : balisage statique d'index.html).
  // Bouton CSV : même règle que le cœur (applyForfaitGating, qui le met aussi à
  // jour s'il existe déjà) : droit calculé par le serveur (S.coordonnees), sinon
  // repli sur le forfait.
  function construire() {
    if (!$('clients-css')) {
      const st = document.createElement('style');
      st.id = 'clients-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const exportVisible = S.coordonnees ?? (S.forfait || 'pro') === 'pro_plus';
    $('tab-clients').innerHTML = `
      <div class="tab-header">
        <h2>${esc(tx('clientsTitle'))}</h2>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-outline btn-sm" id="btn-export-csv" style="display:${exportVisible ? '' : 'none'}" title="${esc(tx('exportCsv'))}">${esc(tx('csvBtn'))}</button>
          <button class="btn-refresh" id="btn-refresh-clients" title="${esc(tx('refresh'))}">↺</button>
        </div>
      </div>
      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input class="search-input" id="search-clients" type="search" placeholder="${esc(tx('searchClients'))}" value="${esc(S.clientsQ || '')}">
      </div>
      <div id="clients-meta" class="list-meta"></div>
      <div id="clients-list"></div>`;
    brancher();
    construitEn = _lang;
  }

  // ════════════════════════════════════════════════
  // LISTE (étape 21)
  // ════════════════════════════════════════════════
  // Liste par pages, recherche faite par le serveur (étape 21) : plus de plafond de
  // 1 000 clients. S.clients = pages déjà chargées ; S.clientsTotal = total des
  // clients qui correspondent (en-tête X-Total-Count) ; S.clientsQ = recherche.
  const PAGE_CLIENTS = 100;

  async function pageClients(debut) {
    const q = S.clientsQ ? `&q=${encodeURIComponent(S.clientsQ)}` : '';
    const res = await api(`/api/clients?debut=${debut}&limite=${PAGE_CLIENTS}${q}`);
    if (!res.ok) throw new Error(tx('errorGeneric'));
    const page = await res.json();
    return { page, total: parseInt(res.headers.get('X-Total-Count'), 10) };
  }

  async function loadClients(force = false) {
    if (!force && S.clients) { renderClients(); return; }
    document.getElementById('clients-list').innerHTML = Array(4).fill('<div class="skeleton skeleton-card"></div>').join('');
    document.getElementById('clients-meta').textContent = '';
    const demande = S.clientsDemande = Symbol();   // une recherche plus récente l'emporte
    try {
      const { page, total } = await pageClients(0);
      if (demande !== S.clientsDemande) return;
      S.clients = page;
      S.clientsTotal = Number.isFinite(total) ? total : page.length;
      renderClients();
    } catch (e) {
      if (demande !== S.clientsDemande) return;
      S.clients = null;
      document.getElementById('clients-list').innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
    }
  }

  async function plusDeClients(btn) {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const { page, total } = await pageClients(S.clients.length);
      const deja = new Set(S.clients.map(c => c.id));
      S.clients = S.clients.concat(page.filter(c => !deja.has(c.id)));
      if (Number.isFinite(total)) S.clientsTotal = total;
      if (!page.length) S.clientsTotal = S.clients.length;
      renderClients();
    } catch (e) {
      btn.disabled = false; btn.textContent = tx('showMore');
      alert(e.message);
    }
  }

  function renderClients() {
    const list = document.getElementById('clients-list');
    const meta = document.getElementById('clients-meta');
    if (!S.clients) return;
    const q = S.clientsQ || '';
    const shown = S.clients;
    if (shown.length === 0) {
      meta.textContent = '';
      list.innerHTML = `<div class="empty"><div class="empty-icon">👤</div><div class="empty-title">${q ? tx('noResults') : tx('noClients')}</div><div class="empty-sub">${q ? tx('tryAnotherName') : tx('clientsWillAppear')}</div></div>`;
      return;
    }
    meta.textContent = tx('clientsCount', { n: Math.max(S.clientsTotal || 0, shown.length), found: !!q });
    list.innerHTML = shown.map(c => {
      const pct = Math.min(c.stored_value / S.displayMax * 100, 100);
      const full = c.stored_value >= S.maxValue;
      return `<div class="client-card" data-id="${c.id}" style="cursor:pointer">
        <div class="client-avatar" style="background:${colorFrom(c.prenom)}">${esc(c.prenom.charAt(0).toUpperCase())}</div>
        <div class="client-info">
          <div class="client-name">${esc(c.prenom)}</div>
          <div class="client-progress">
            <div class="mini-bar-wrap"><div class="mini-bar" style="width:${pct}%"></div></div>
            <span class="client-pts ${full ? 'client-full' : ''}">${c.stored_value}/${S.displayMax}${full ? ' 🎉' : ''}</span>
          </div>
        </div>
        <span style="color:var(--muted);font-size:20px;flex-shrink:0">›</span>
      </div>`;
    }).join('') + (shown.length < (S.clientsTotal || 0)
      ? `<button class="btn btn-outline" id="btn-more-clients" style="width:100%;margin-top:8px">${tx('showMore')}</button>` : '');
    list.querySelectorAll('.client-card').forEach(card => {
      card.addEventListener('click', () => openClientSheet(card.dataset.id));
    });
    document.getElementById('btn-more-clients')?.addEventListener('click', e => plusDeClients(e.currentTarget));
  }

  function brancher() {
    // Recherche par le serveur, 300 ms après la dernière frappe.
    document.getElementById('search-clients').addEventListener('input', e => {
      clearTimeout(minuteurRecherche);
      minuteurRecherche = setTimeout(() => { S.clientsQ = e.target.value.trim(); loadClients(true); }, 300);
    });
    document.getElementById('btn-refresh-clients').addEventListener('click', () => { S.clients = null; loadClients(true); });

    document.getElementById('btn-export-csv').addEventListener('click', async () => {
      const btn = document.getElementById('btn-export-csv');
      btn.disabled = true; btn.textContent = '⏳';
      try {
        const res = await api('/api/clients/export');
        if (!res.ok) {
          const d = await res.json();
          alert(d.error || tx('exportFailed'));
          return;
        }
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.download = `clients-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        alert(tx('exportError', { msg: e.message }));
      } finally {
        btn.disabled = false; btn.textContent = tx('csvBtn');
      }
    });
  }

  // ════════════════════════════════════════════════
  // FICHE CLIENT (balisage au cœur ; écouteurs posés une fois, au chargement)
  // ════════════════════════════════════════════════
  function openClientSheet(id) {
    S.clientId   = id;
    S.clientData = null;
    document.getElementById('modal-client').classList.add('open');
    document.getElementById('cs-name').textContent  = '…';
    document.getElementById('cs-since').textContent = '';
    document.getElementById('cs-pts').textContent   = '–';
    document.getElementById('cs-pts-max').textContent = '';
    document.getElementById('cs-reward-badge').style.display = 'none';
    document.getElementById('cs-prog-bar').style.width = '0%';
    document.getElementById('cs-prog-dots').innerHTML  = '';
    document.getElementById('cs-scans-list').innerHTML = Array(3).fill('<div class="skeleton skeleton-card"></div>').join('');
    api(`/api/clients/${id}`).then(r => r.json()).then(data => {
      S.clientData = data;
      renderClientSheet(data);
    }).catch(e => {
      document.getElementById('cs-scans-list').innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    });
  }

  function closeClientSheet() {
    document.getElementById('modal-client').classList.remove('open');
    S.clientId = null; S.clientData = null;
  }

  function renderClientSheet({ client, scans, ajustements }) {
    const displayMax = S.displayMax;
    const full       = client.stored_value >= S.maxValue;
    const pct        = Math.min(client.stored_value / Math.max(displayMax, 1) * 100, 100);
    const av = document.getElementById('cs-avatar');
    av.textContent      = client.prenom.charAt(0).toUpperCase();
    av.style.background = colorFrom(client.prenom);
    document.getElementById('cs-name').textContent  = client.prenom;
    document.getElementById('cs-since').textContent = tx('memberSince', { date: new Date(client.created_at).toLocaleDateString(dateLocale(), { day:'numeric', month:'long', year:'numeric' }) });
    document.getElementById('cs-pts').textContent   = client.stored_value;
    document.getElementById('cs-pts-max').textContent = `/ ${displayMax}`;
    document.getElementById('cs-reward-badge').style.display = full ? '' : 'none';
    document.getElementById('cs-prog-bar').style.width = pct + '%';
    // Pastilles — n'a de sens qu'en mode tampons (peu d'unités). En mode points
    // le seuil peut être élevé (ex. 500) ; le compteur "X/max" + la barre suffisent
    // (compteur numérique, cohérent avec les autres surfaces). Bypass identique au
    // scanner. Mode tampons : strictement inchangé.
    const dotsEl = document.getElementById('cs-prog-dots');
    dotsEl.innerHTML = '';
    if (S.typeProgramme !== 'points') {
      dotsEl.innerHTML = Array.from({ length: S.maxValue }, (_, i) =>
        `<div class="cs-dot2${i < client.stored_value ? ' on' : ''}"></div>`
      ).join('');
    }

    // Données contact — le serveur ne les envoie qu'aux marchands qui y ont droit
    // (Pro+, ou landing premium active : services/forfaits.js). Rien à recalculer ici.
    const contactEl = document.getElementById('cs-contact');
    if (contactEl) {
      const hasContact = client.email || client.telephone || client.date_anniversaire;
      if (hasContact) {
        const rows = [];
        if (client.email)             rows.push(`<div class="cs-contact-row"><span class="cs-contact-icon">✉️</span><a class="cs-contact-link" href="mailto:${esc(client.email)}">${esc(client.email)}</a></div>`);
        if (client.telephone)         rows.push(`<div class="cs-contact-row"><span class="cs-contact-icon">📞</span><a class="cs-contact-link" href="tel:${esc(client.telephone)}">${esc(client.telephone)}</a></div>`);
        if (client.date_anniversaire) rows.push(`<div class="cs-contact-row"><span class="cs-contact-icon">🎂</span><span>${new Date(client.date_anniversaire + 'T00:00:00').toLocaleDateString(dateLocale(), { day:'numeric', month:'long' })}</span></div>`);
        contactEl.innerHTML = `<div class="cs-contact-box">${rows.join('')}</div>`;
      } else {
        contactEl.innerHTML = '';
      }
    }

    const sl = document.getElementById('cs-scans-list');
    // Historique de la fiche : scans ET ajustements (étape 13b), mêlés par date,
    // du plus récent au plus ancien. Les ajustements ne sont pas des visites :
    // ils viennent de leur propre journal et ne sont mêlés aux scans qu'ici.
    const mouvements = [
      ...(scans || []).map(s => ({ ...s, type: 'scan', date: s.date_scan })),
      ...(ajustements || []).map(a => ({ ...a, type: 'ajustement', date: a.date_ajustement })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (mouvements.length === 0) {
      sl.innerHTML = `<div class="cs-no-scans">${tx('noScansClient')}</div>`;
      return;
    }
    // « Annuler » sur le mouvement actif le plus récent du client — scan ou
    // ajustement — : on annule toujours dans l'ordre inverse (migration 052). Le
    // serveur revalide de toute façon.
    const dernierActif = mouvements.find(m => !m.annule_le);
    sl.innerHTML = mouvements.map(s => {
      const annule = !!s.annule_le;
      const dateStr = new Date(s.date).toLocaleDateString(dateLocale(), { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
      const bouton = s === dernierActif
        ? `<button class="cs-undo" data-type="${s.type}" data-id="${s.id}" data-avant="${s.stored_value_avant}">${tx('annulerPassage')}</button>` : '';
      if (s.type === 'ajustement') {
        return `<div class="cs-scan-row"${annule ? ' style="opacity:.5"' : ''}>
        <span class="cs-scan-icon">${annule ? '↩️' : '✎'}</span>
        <div style="flex:1">
          <span class="cs-scan-delta"${annule ? ' style="text-decoration:line-through"' : ''}>${s.stored_value_avant} → ${s.stored_value_apres} pts</span>
          <span class="cs-scan-date">${dateStr} · ${tx('ajustementLibelle')}${annule ? ' · ' + tx('scanAnnule') : ''}</span>
        </div>
        ${bouton}
      </div>`;
      }
      const isReset  = s.stored_value_apres === 0 && s.stored_value_avant > 0;
      const isReward = !isReset && s.stored_value_apres >= S.maxValue;
      const icon = isReset ? '↩️' : isReward ? '🎉' : '✅';
      const lieu = s.points_de_vente && s.points_de_vente.nom;  // null pour un scan mono-site
      return `<div class="cs-scan-row"${annule ? ' style="opacity:.5"' : ''}>
        <span class="cs-scan-icon">${annule ? '↩️' : icon}</span>
        <div style="flex:1">
          <span class="cs-scan-delta"${annule ? ' style="text-decoration:line-through"' : ''}>${s.stored_value_avant} → ${s.stored_value_apres} pts</span>
          <span class="cs-scan-date">${dateStr}${lieu ? ' · ' + esc(lieu) : ''}${annule ? ' · ' + tx('scanAnnule') : ''}</span>
        </div>
        ${bouton}
      </div>`;
    }).join('');
  }

  // Annuler le dernier mouvement depuis la fiche (étapes 13a et 13b). Un scan :
  // même route que le scanner (POST /api/scan/:id/annuler, qui accepte la session
  // du marchand). Un ajustement : POST /api/clients/ajustements/:id/annuler.
  // Une seule requête, au tap ; puis la fiche est rechargée.
  document.getElementById('cs-scans-list').addEventListener('click', async e => {
    const b = e.target.closest('.cs-undo');
    if (!b || !S.clientId) return;
    const ajustement = b.dataset.type === 'ajustement';
    if (!confirm(tx(ajustement ? 'annulAjustementConfirm' : 'annulPassageConfirm', { avant: b.dataset.avant }))) return;
    const id = S.clientId;
    b.disabled = true;
    try {
      const res = await api(ajustement ? `/api/clients/ajustements/${b.dataset.id}/annuler` : `/api/scan/${b.dataset.id}/annuler`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        alert({ pas_le_dernier: tx('annulRefusDernier'), solde_incoherent: tx('annulRefusSolde'),
                deja_annule: tx('annulRefusDeja') }[data.reason] || data.error || tx('errorGeneric'));
      } else if (S.clients) {
        const idx = S.clients.findIndex(c => c.id === id);
        if (idx >= 0) { S.clients[idx].stored_value = data.stored_value; renderClients(); }
      }
    } catch (err) {
      alert(err.message);
    }
    if (window.Scans) window.Scans.oublier();   // historique de l'onglet Scans à relire
    if (S.clientId === id) openClientSheet(id);
  });

  document.getElementById('cs-close').addEventListener('click', closeClientSheet);
  document.getElementById('modal-client').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-client')) closeClientSheet();
  });

  // ── Supprimer depuis la fiche ──
  document.getElementById('cs-btn-delete').addEventListener('click', () => {
    if (!S.clientData) return;
    const id  = S.clientId;
    const nom = S.clientData.client.prenom;
    closeClientSheet();
    openDeleteModal(id, nom);
  });

  // ── Modifier le prénom ──
  document.getElementById('cs-btn-rename').addEventListener('click', () => {
    if (!S.clientData) return;
    document.getElementById('rename-input').value = S.clientData.client.prenom;
    document.getElementById('rename-err').style.display = 'none';
    document.getElementById('modal-rename').classList.add('open');
    setTimeout(() => document.getElementById('rename-input').focus(), 100);
  });
  document.getElementById('rename-cancel').addEventListener('click', () => {
    document.getElementById('modal-rename').classList.remove('open');
  });
  document.getElementById('modal-rename').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-rename')) document.getElementById('modal-rename').classList.remove('open');
  });
  document.getElementById('rename-confirm').addEventListener('click', async () => {
    const prenom = document.getElementById('rename-input').value.trim();
    const errEl  = document.getElementById('rename-err');
    errEl.style.display = 'none';
    if (!prenom) { errEl.textContent = tx('firstNameRequired'); errEl.style.display = 'block'; return; }
    const btn = document.getElementById('rename-confirm');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const res  = await api(`/api/clients/${S.clientId}`, { method: 'PATCH', body: JSON.stringify({ prenom }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || tx('errorGeneric'));
      if (S.clientData) S.clientData.client = { ...S.clientData.client, ...data };
      if (S.clients) { const idx = S.clients.findIndex(c => c.id === S.clientId); if (idx >= 0) S.clients[idx].prenom = data.prenom; }
      document.getElementById('modal-rename').classList.remove('open');
      renderClientSheet(S.clientData);
      renderClients();
    } catch (e) {
      errEl.textContent = e.message; errEl.style.display = 'block';
    } finally {
      btn.disabled = false; btn.textContent = tx('save');
    }
  });

  // ── Ajuster les points ──
  document.getElementById('cs-btn-adjust').addEventListener('click', () => {
    if (!S.clientData) return;
    document.getElementById('adjust-input').value = S.clientData.client.stored_value;
    // tx('newBalance') rend le libellé complet (valeur du seuil incluse). On écrit
    // dans adjust-label (élément stable sans enfant) — plus de <span id="adjust-max">
    // à détruire puis relire (cause du bug « le bouton Points ne répond plus »).
    // Points : plus de plafond au seuil (étape 13b), confirmation au-delà. Tampons :
    // plafond au seuil inchangé.
    document.getElementById('adjust-label').textContent =
      tx(S.typeProgramme === 'points' ? 'newBalancePoints' : 'newBalance', { max: S.maxValue });
    document.getElementById('adjust-err').style.display = 'none';
    document.getElementById('modal-adjust').classList.add('open');
    setTimeout(() => document.getElementById('adjust-input').focus(), 100);
  });
  document.getElementById('adjust-cancel').addEventListener('click', () => {
    document.getElementById('modal-adjust').classList.remove('open');
  });
  document.getElementById('modal-adjust').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-adjust')) document.getElementById('modal-adjust').classList.remove('open');
  });
  document.getElementById('adjust-confirm').addEventListener('click', async () => {
    const val   = parseInt(document.getElementById('adjust-input').value);
    const errEl = document.getElementById('adjust-err');
    errEl.style.display = 'none';
    if (!S.clientData) return;
    const points = S.typeProgramme === 'points';
    const plafond = points ? 1000000 : S.maxValue;
    if (isNaN(val) || val < 0 || val > plafond) {
      errEl.textContent = tx('valueBetween', { max: plafond }); errEl.style.display = 'block'; return;
    }
    if (points && val > S.maxValue && !confirm(tx('ajustAuDessusSeuil', { val, max: S.maxValue }))) return;
    // Le solde affiché à l'ouverture de la fiche : si un scan est passé depuis,
    // le serveur refuse (étape 13b) au lieu d'effacer ce scan.
    const attendu = S.clientData.client.stored_value;
    const btn = document.getElementById('adjust-confirm');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const res  = await api(`/api/clients/${S.clientId}`, { method: 'PATCH', body: JSON.stringify({ stored_value: val, stored_value_attendu: attendu }) });
      const data = await res.json();
      if (res.status === 409 && data.error === 'solde_change') {
        // Rien n'a été écrit : on montre le nouveau solde et on relit la fiche.
        document.getElementById('adjust-input').value = data.stored_value;
        errEl.textContent = tx('soldeChange', { val: data.stored_value }); errEl.style.display = 'block';
        openClientSheet(S.clientId);
        return;
      }
      if (!res.ok) throw new Error(data.error || tx('errorGeneric'));
      // Ligne du journal ajoutée sur place (aucune relecture de la fiche).
      if (S.clientData && data.ajustement_id) {
        S.clientData.ajustements = [{ id: data.ajustement_id, date_ajustement: new Date().toISOString(),
          stored_value_avant: attendu, stored_value_apres: data.stored_value, annule_le: null },
          ...(S.clientData.ajustements || [])];
      }
      if (S.clientData) S.clientData.client = { ...S.clientData.client, ...data };
      if (S.clients) { const idx = S.clients.findIndex(c => c.id === S.clientId); if (idx >= 0) S.clients[idx].stored_value = data.stored_value; }
      document.getElementById('modal-adjust').classList.remove('open');
      renderClientSheet(S.clientData);
      renderClients();
    } catch (e) {
      errEl.textContent = e.message; errEl.style.display = 'block';
    } finally {
      btn.disabled = false; btn.textContent = tx('confirm');
    }
  });

  // ════════════════════════════════════════════════
  // MODAL: DELETE CLIENT
  // ════════════════════════════════════════════════
  function openDeleteModal(id, nom) {
    S.deleteTargetId = id; S.deleteTargetNom = nom;
    document.getElementById('modal-delete-body').innerHTML = tx('deleteBody', { nom: esc(nom) });
    document.getElementById('modal-delete').classList.add('open');
  }

  document.getElementById('btn-cancel-delete').addEventListener('click', () => {
    document.getElementById('modal-delete').classList.remove('open');
  });
  document.getElementById('modal-delete').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-delete')) document.getElementById('modal-delete').classList.remove('open');
  });

  document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
    const id = S.deleteTargetId;
    const btn = document.getElementById('btn-confirm-delete');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const res = await api(`/api/clients/${id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || tx('errorGeneric')); }
      document.getElementById('modal-delete').classList.remove('open');
      if (S.clients) { S.clients = S.clients.filter(c => c.id !== id); S.clientsTotal = Math.max(0, (S.clientsTotal || 1) - 1); }
      renderClients();
      if (S.stats) { S.stats.porteurs = Math.max(0, (S.stats.porteurs || 1) - 1); if (window.Apercu) window.Apercu.afficher(); }
    } catch (e) {
      alert(e.message);
    } finally {
      btn.disabled = false; btn.textContent = tx('deletePermanently');
    }
  });

  // Langue changée après la construction (signal « ww-langue » de setLang) :
  // textes refaits depuis la mémoire, sans requête.
  document.addEventListener('ww-langue', () => {
    if (!construitEn || construitEn === _lang) return;
    construire();
    if (S.clients) renderClients();
  });

  // ── Points d'entrée (appelés par le cœur) ──────────────────────────────
  function charger() {
    if (!construitEn || construitEn !== _lang) construire();
    loadClients();
  }
  // Déconnexion : recherche effacée (la liste, S.clients, est remise à null par le cœur).
  function oublier() {
    clearTimeout(minuteurRecherche);
    S.clientsQ = '';
    if ($('search-clients')) $('search-clients').value = '';
  }

  // ouvrirFiche : la fiche d'un client (appelée par la liste ; exposée pour les
  // tests navigateur, qui l'ouvraient avant par openClientSheet, global du cœur).
  window.Clients = { charger, oublier, ouvrirFiche: openClientSheet };
})();
