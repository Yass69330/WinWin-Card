// ════════════════════════════════════════════════════════════════════════════
// ONGLET « MA CARTE » (f17, cartes à thème, Pro+)
//
// Fichier à part (décision du pilotage) : une erreur ici n'arrête que cet
// onglet. Il ne fait qu'utiliser les outils du dashboard (api, esc, _lang) et
// n'écrit rien en dehors de #tab-carte et de window.MaCarte.
//
// Le marchand voit sa carte standard et chacun des thèmes préparés pour lui
// (aperçu dessiné par le serveur : couleurs, logo, bannière, texte de la case),
// choisit un thème avec ses dates, ou arrête le thème en cours.
// ════════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const TXT = {
    fr: {
      titre: 'Ma carte',
      intro: 'Habillez votre carte pour une saison ou un événement. La progression et le solde de vos clients ne changent pas.',
      reserve: 'Les cartes à thème sont réservées au forfait Pro+.',
      standard: 'Carte standard',
      aucun: 'Aucun thème n\'est encore préparé pour vous. Contactez WinWin pour en créer un.',
      choisir: 'Choisir ce thème',
      debut: 'Début', fin: 'Fin',
      notif: 'À l\'ouverture, vos clients reçoivent :',
      activer: 'Activer',
      annulerForm: 'Annuler',
      enCours: 'Thème « {nom} » en cours, jusqu\'au {fin} inclus.',
      programme: 'Thème « {nom} » programmé du {debut} au {fin}.',
      arreter: 'Arrêter le thème',
      annulerProg: 'Annuler la programmation',
      confirmerArret: 'Revenir tout de suite à la carte standard ? Aucune notification n\'est envoyée.',
      bascule: 'Mise à jour des cartes de vos clients en cours…',
      unSeul: 'Un seul thème à la fois : arrêtez le thème en cours pour en choisir un autre.',
      remplace: 'Le thème programmé sera remplacé.',
      erreur: 'Impossible de charger l\'onglet. Réessayez.',
      reessayer: 'Réessayer',
      active: 'Thème activé.', programmeOk: 'Thème programmé.',
      err: {
        dates_invalides: 'Dates invalides.', debut_passe: 'Le début ne peut pas être dans le passé.',
        fin_avant_debut: 'La fin doit suivre le début.', debut_trop_loin: 'Début au plus dans un an.',
        duree_trop_longue: 'Durée de 3 mois au plus.', theme_en_cours: 'Un thème est déjà en cours.',
        theme_modifie_entre_temps: 'Le thème a changé entre-temps : rechargez l\'onglet.',
      },
      dates: 'Dates en temps universel (UTC) : le thème s\'ouvre le jour du début et se termine après le jour de fin.',
    },
    en: {
      titre: 'My card',
      intro: 'Dress up your card for a season or an event. Your customers\' progress and balance never change.',
      reserve: 'Themed cards are part of the Pro+ plan.',
      standard: 'Standard card',
      aucun: 'No theme has been prepared for you yet. Contact WinWin to create one.',
      choisir: 'Choose this theme',
      debut: 'Start', fin: 'End',
      notif: 'When it opens, your customers receive:',
      activer: 'Activate',
      annulerForm: 'Cancel',
      enCours: 'Theme "{nom}" live until {fin} included.',
      programme: 'Theme "{nom}" scheduled from {debut} to {fin}.',
      arreter: 'Stop the theme',
      annulerProg: 'Cancel the schedule',
      confirmerArret: 'Go back to the standard card now? No notification is sent.',
      bascule: 'Updating your customers\' cards…',
      unSeul: 'One theme at a time: stop the current theme to choose another one.',
      remplace: 'The scheduled theme will be replaced.',
      erreur: 'Could not load this tab. Please retry.',
      reessayer: 'Retry',
      active: 'Theme activated.', programmeOk: 'Theme scheduled.',
      err: {
        dates_invalides: 'Invalid dates.', debut_passe: 'The start cannot be in the past.',
        fin_avant_debut: 'The end must follow the start.', debut_trop_loin: 'Start within a year.',
        duree_trop_longue: '3 months at most.', theme_en_cours: 'A theme is already live.',
        theme_modifie_entre_temps: 'The theme changed meanwhile: reload the tab.',
      },
      dates: 'Dates in universal time (UTC): the theme opens on the start day and ends after the end day.',
    },
  };
  const tx = (cle, vars) => {
    const d = TXT[_lang === 'fr' ? 'fr' : 'en'];
    let s = d[cle] != null ? d[cle] : cle;
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
    return s;
  };
  const jourLisible = j => {
    try { return new Date(`${j}T00:00:00Z`).toLocaleDateString(_lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }); }
    catch { return j; }
  };

  const CSS = `
    #tab-carte .mc-intro { font-size: 13px; color: var(--muted); margin: 0 0 14px; }
    #tab-carte .mc-etat { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; margin-bottom: 14px; font-size: 14px; }
    #tab-carte .mc-etat .btn { margin-top: 10px; }
    #tab-carte .mc-grille { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    #tab-carte .mc-bloc { display: flex; flex-direction: column; gap: 8px; }
    #tab-carte .mc-nom { font-weight: 600; font-size: 14px; }
    #tab-carte .mc-carte { width: 100%; max-width: 360px; margin: 0 auto; border-radius: 14px; overflow: hidden; box-shadow: 0 6px 22px rgba(0,0,0,.45);
      font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', system-ui, sans-serif; padding-bottom: 16px; }
    #tab-carte .mc-tete { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; min-height: 58px; }
    #tab-carte .mc-logo { max-height: 42px; max-width: 48%; object-fit: contain; object-position: left center; }
    #tab-carte .mc-marchand { font-size: 15px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    #tab-carte .mc-banniere { display: block; width: 100%; aspect-ratio: 750 / 246; object-fit: cover; }
    #tab-carte .mc-champs { display: flex; justify-content: space-between; padding: 12px 16px 0; }
    #tab-carte .mc-champs small { display: block; font-size: 11px; font-weight: 600; letter-spacing: .8px; }
    #tab-carte .mc-champs b { display: block; font-size: 22px; font-weight: 400; margin-top: 1px; }
    #tab-carte .mc-case { padding: 8px 16px 0; font-size: 15px; }
    #tab-carte .mc-qr { display: block; width: 116px; height: 116px; margin: 16px auto 0; background: #fff; border-radius: 8px; padding: 6px; }
    #tab-carte .mc-form { display: grid; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; }
    #tab-carte .mc-form .mc-ligne { display: flex; gap: 8px; }
    #tab-carte .mc-form label { flex: 1; font-size: 12px; color: var(--muted); display: grid; gap: 4px; }
    #tab-carte .mc-form .mc-msg { font-size: 13px; }
    #tab-carte .mc-note { font-size: 12px; color: var(--muted); }
    #tab-carte .mc-retour { font-size: 13px; }`;

  let donnees = null;
  let ouvert = null;   // id du thème dont le formulaire est ouvert

  function panneau() { return document.getElementById('tab-carte'); }

  function styles() {
    if (document.getElementById('mc-styles')) return;
    const st = document.createElement('style');
    st.id = 'mc-styles';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // La vraie carte : bannière et logo réels (servis par le serveur), couleurs,
  // nom, prénom + progression, texte de la case, disposés comme dans Wallet.
  // Libellés CLIENT / PROGRESS : ceux de la carte (en anglais sur toutes les cartes).
  function carte(a) {
    const qr = donnees && donnees.qr;
    return `
      <div class="mc-carte" style="background:${esc(a.couleur_fond)};color:${esc(a.couleur_texte)}">
        <div class="mc-tete">
          ${a.logo_url ? `<img class="mc-logo" src="${esc(a.logo_url)}" alt="" onerror="this.style.visibility='hidden'">` : '<span></span>'}
          <span class="mc-marchand">${esc(a.nom || '')}</span>
        </div>
        ${a.banniere ? `<img class="mc-banniere" src="${esc(a.banniere)}" alt="">` : ''}
        <div class="mc-champs">
          <div><small style="color:${esc(a.couleur_label)}">CLIENT</small><b>Sarah</b></div>
          <div style="text-align:right"><small style="color:${esc(a.couleur_label)}">PROGRESS</small><b>${esc(a.rempli)} / ${esc(a.max)}</b></div>
        </div>
        ${a.texte_case ? `<div class="mc-case">${esc(a.texte_case)}</div>` : ''}
        ${qr ? `<img class="mc-qr" src="${esc(qr)}" alt="">` : ''}
      </div>`;
  }

  function etat() {
    const a = donnees.actif;
    let html = '';
    if (a) {
      const enCours = a.etat === 'en_cours';
      html += `<div>${esc(tx(enCours ? 'enCours' : 'programme', { nom: a.nom, debut: jourLisible(a.debut), fin: jourLisible(a.fin) }))}</div>
        <button class="btn btn-ghost" id="mc-arreter" type="button">${esc(tx(enCours ? 'arreter' : 'annulerProg'))}</button>`;
    }
    if (donnees.bascule) html += `<div class="mc-note" style="margin-top:6px">${esc(tx('bascule'))}</div>`;
    return html ? `<div class="mc-etat">${html}</div>` : '';
  }

  function formulaire(th) {
    const j = donnees.aujourdhui;
    const remplace = donnees.actif && donnees.actif.etat === 'programme';
    return `
      <form class="mc-form" data-theme="${esc(th.id)}" onsubmit="return false">
        <div class="mc-ligne">
          <label>${esc(tx('debut'))}<input type="date" name="debut" min="${esc(j)}" value="${esc(j)}" required></label>
          <label>${esc(tx('fin'))}<input type="date" name="fin" min="${esc(j)}" required></label>
        </div>
        <div class="mc-note">${esc(tx('dates'))}</div>
        <div class="mc-msg">${esc(tx('notif'))} « ${esc(th.message_ouverture)} »</div>
        ${remplace ? `<div class="mc-note">${esc(tx('remplace'))}</div>` : ''}
        <div class="mc-ligne">
          <button class="btn btn-primary" type="submit">${esc(tx('activer'))}</button>
          <button class="btn btn-ghost" type="button" data-fermer="1">${esc(tx('annulerForm'))}</button>
        </div>
        <div class="mc-retour" role="status"></div>
      </form>`;
  }

  function rendre() {
    const p = panneau();
    if (!donnees.eligible) {
      p.innerHTML = `<div class="tab-header"><h2>${esc(tx('titre'))}</h2></div><div class="alert alert-info">${esc(tx('reserve'))}</div>`;
      return;
    }
    const enCours = donnees.actif && donnees.actif.etat === 'en_cours';
    const blocs = [`<div class="mc-bloc"><div class="mc-nom">${esc(tx('standard'))}</div>${carte(donnees.standard)}</div>`];
    for (const th of donnees.themes) {
      const choisi = donnees.actif && donnees.actif.id === th.id;
      blocs.push(`<div class="mc-bloc"><div class="mc-nom">${esc(th.nom)}</div>${carte(th.apercu)}
        ${ouvert === th.id ? formulaire(th)
          : choisi || enCours ? ''
          : `<button class="btn btn-primary" type="button" data-choisir="${esc(th.id)}">${esc(tx('choisir'))}</button>`}
      </div>`);
    }
    p.innerHTML = `
      <div class="tab-header"><h2>${esc(tx('titre'))}</h2></div>
      <p class="mc-intro">${esc(tx('intro'))}</p>
      ${etat()}
      ${enCours ? `<p class="mc-note">${esc(tx('unSeul'))}</p>` : ''}
      ${donnees.themes.length ? '' : `<div class="alert alert-info" style="margin-bottom:14px">${esc(tx('aucun'))}</div>`}
      <div class="mc-grille">${blocs.join('')}</div>`;
  }

  async function lireReponse(r) { try { return await r.json(); } catch { return {}; } }

  async function charger() {
    styles();
    const p = panneau();
    if (!donnees) p.innerHTML = '<div class="loading-center"><span class="spinner"></span></div>';
    try {
      const r = await api('/api/merchants/me/themes');
      if (!r.ok) throw new Error(String(r.status));
      donnees = await r.json();
      rendre();
    } catch (e) {
      p.innerHTML = `<div class="alert alert-info">${esc(tx('erreur'))}</div>
        <button class="btn btn-ghost" type="button" id="mc-reessayer">${esc(tx('reessayer'))}</button>`;
    }
  }

  async function activer(form) {
    const retour = form.querySelector('.mc-retour');
    const bouton = form.querySelector('button[type=submit]');
    const corps = { theme_id: form.dataset.theme, debut: form.debut.value, fin: form.fin.value };
    bouton.disabled = true;
    try {
      const r = await api('/api/merchants/me/theme', { method: 'POST', body: JSON.stringify(corps) });
      const d = await lireReponse(r);
      if (!r.ok) { retour.textContent = (TXT[_lang === 'fr' ? 'fr' : 'en'].err[d.error]) || d.error || String(r.status); return; }
      ouvert = null;
      await charger();
      const msg = document.createElement('div');
      msg.className = 'mc-note';
      msg.textContent = tx(d.etat === 'en_cours' ? 'active' : 'programmeOk');
      const et = panneau().querySelector('.mc-etat');
      if (et) et.appendChild(msg);
    } catch (e) {
      retour.textContent = e.message;
    } finally { bouton.disabled = false; }
  }

  async function arreter() {
    if (!confirm(tx('confirmerArret'))) return;
    const r = await api('/api/merchants/me/theme', { method: 'DELETE' }).catch(() => null);
    if (r && !r.ok) {
      const d = await lireReponse(r);
      alert((TXT[_lang === 'fr' ? 'fr' : 'en'].err[d.error]) || d.error || String(r.status));
    }
    await charger();
  }

  document.addEventListener('click', e => {
    const p = panneau();
    if (!p || !p.contains(e.target)) return;
    const choisir = e.target.closest('[data-choisir]');
    if (choisir) { ouvert = choisir.dataset.choisir; rendre(); return; }
    if (e.target.closest('[data-fermer]')) { ouvert = null; rendre(); return; }
    if (e.target.closest('#mc-arreter')) { arreter(); return; }
    if (e.target.closest('#mc-reessayer')) { charger(); }
  });
  document.addEventListener('submit', e => {
    const form = e.target.closest && e.target.closest('#tab-carte .mc-form');
    if (form) { e.preventDefault(); activer(form); }
  });

  window.MaCarte = { charger };
})();
