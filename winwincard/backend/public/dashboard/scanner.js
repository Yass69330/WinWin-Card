// ════════════════════════════════════════════════════════════════════════════
// ONGLET « SCANNER » DU DASHBOARD (t42, découpage du dashboard, onglet 6/6)
//
// Fichier à part, sur le modèle des 5 autres onglets : une erreur ici n'arrête
// que cet onglet. Code DÉPLACÉ TEL QUEL depuis index.html : caméra et lecture du
// QR (jsQR, chargé par le cœur), verrou de carte, confirmation avant écriture,
// pavé de points, saisie manuelle, clé d'idempotence, panneau d'incident et
// nouvel essai, renouvellement de session, affichage du résultat.
//
// Balayage des références (04/11) — ce fichier :
//   - utilise du cœur : api, t, showLogin, clearSession, showErr, S (lit
//     displayMax, marchandSlug, token, typeProgramme ; ÉCRIT S.token au
//     renouvellement de session), window.Scans, jsQR ;
//   - écrit dans le stockage local : 'ww_dashboard_cle_en_attente' (sa clé en
//     attente, même nom qu'avant : une clé gardée avant la mise à jour est
//     retrouvée) et 'ww_dash_token' (session renouvelée). JAMAIS la clé de la
//     caisse ('ww_scanner_cle_en_attente', public/scanner/index.html, page à part
//     qui ne charge pas ce fichier) ;
//   - pose 16 écouteurs, au chargement, sur le balisage de l'onglet et de ses 4
//     fenêtres, qui RESTE au cœur avec son style (sc-*) et ses textes data-i18n ;
//   - n'est appelé par le cœur qu'à travers window.Scanner : demarrer
//     (ouverture de l'onglet), arreter (changement d'onglet, écran de connexion).
// Fichier servi depuis le cache par le service worker : changer ?v= dans
// index.html à chaque modification.
// ════════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const TXT = {
    en: {
      addPoints:'+ Add points',
      addStamp:'+ Add a stamp',
      cameraError:({msg})=>'Cannot access camera: '+msg,
      cameraErrorName:'Camera error',
      carteInconnue:'Unknown card for this shop',
      codeInvalide:'Invalid code — scan the QR or type the 6-character backup code',
      compteSuspenduTexte:'This visit was not recorded. Contact WinWin.',
      compteSuspenduTitre:'Account suspended',
      connexionPerdueTexte:'This visit may not have been recorded. Retry: it will never be counted twice.',
      connexionPerdueTitre:'Connection lost',
      dejaEnregistre:'Already recorded — this visit had gone through, nothing was added.',
      enterSerial:'Enter a serial number',
      errorName:'Error',
      invalidPoints:'Enter a positive whole number',
      limiteurTexte:({min})=>`This visit was not recorded. Retry in about ${min} min.`,
      limiteurTitre:'Too many requests',
      lockedHint:'Move the card away to scan the next client',
      lockedIncertain:'⚠️ Visit not confirmed',
      lockedIncertainHint:'Tap below to retry — never counted twice',
      lockedNonEnregistre:'Card not recorded',
      lockedScanned:({prenom})=>`✓ ${prenom} — already scanned`,
      lockedScannedAnon:'✓ Card already scanned',
      nouvelEssai:'⏳ New attempt…',
      pickClient:'Multiple matches — tap the right client:',
      processing:'⏳ Processing…',
      refusAnnule:'This visit was undone in the meantime. Scan again to record it.',
      refusConflit:'Conflicting request — nothing was recorded. Scan again.',
      remiseSous:({prenom})=>`Give ${prenom} their reward`,
      remiseTitre:'Card complete',
      seReconnecter:'Sign in again',
      sessionExpireeTexte:'This visit was not recorded. Sign in again to continue.',
      sessionExpireeTitre:'Session expired',
      seuilSous:'Reward on your next visit',
      seuilTitre:({prenom})=>`Thanks for your loyalty ${prenom}`,
      unknownError:'Unknown error',
      useBoutiqueLogin:'Scan with your store login (Scanner app)',
    },
    fr: {
      addPoints:'+ Ajouter des points',
      addStamp:'+ Ajouter un tampon',
      cameraError:({msg})=>"Impossible d'accéder à la caméra : "+msg,
      cameraErrorName:'Erreur caméra',
      carteInconnue:'Carte inconnue chez ce commerce',
      codeInvalide:'Code invalide — scannez le QR ou tapez les 6 caractères du code de secours',
      compteSuspenduTexte:'Ce passage n\'a pas été enregistré. Contactez WinWin.',
      compteSuspenduTitre:'Compte suspendu',
      connexionPerdueTexte:'Ce passage n\'est peut-être pas enregistré. Réessayez : il ne sera jamais compté deux fois.',
      connexionPerdueTitre:'Connexion perdue',
      dejaEnregistre:'Déjà enregistré — ce passage avait bien été pris en compte, rien n\'a été ajouté.',
      enterSerial:'Saisissez un numéro de série',
      errorName:'Erreur',
      invalidPoints:'Saisis un nombre entier positif',
      limiteurTexte:({min})=>`Ce passage n'a pas été enregistré. Réessayez dans ${min} min environ.`,
      limiteurTitre:'Trop de demandes',
      lockedHint:'Écartez la carte pour scanner le client suivant',
      lockedIncertain:'⚠️ Passage non confirmé',
      lockedIncertainHint:'Appuyez ci-dessous pour réessayer — jamais compté deux fois',
      lockedNonEnregistre:'Carte non enregistrée',
      lockedScanned:({prenom})=>`✓ ${prenom} — déjà scanné`,
      lockedScannedAnon:'✓ Carte déjà scannée',
      nouvelEssai:'⏳ Nouvel essai…',
      pickClient:'Plusieurs clients — appuyez sur le bon :',
      processing:'⏳ Traitement…',
      refusAnnule:'Ce passage a été annulé entre-temps. Rescannez pour l\'enregistrer.',
      refusConflit:'Demande en conflit — rien n\'a été enregistré. Rescannez.',
      remiseSous:({prenom})=>`Remets la récompense à ${prenom}`,
      remiseTitre:'Carte complétée',
      seReconnecter:'Se reconnecter',
      sessionExpireeTexte:'Ce passage n\'a pas été enregistré. Reconnectez-vous pour continuer.',
      sessionExpireeTitre:'Session expirée',
      seuilSous:'Récompense au prochain passage',
      seuilTitre:({prenom})=>`Merci pour ta fidélité, ${prenom}`,
      unknownError:'Erreur inconnue',
      useBoutiqueLogin:'Scannez avec l\'identifiant de la boutique (appli Scanner)',
    },
  };

  // Une clé absente d'ici (cancel, reessayer, signOut, et celles du balisage) est
  // lue dans le dictionnaire du cœur.
  function tx(cle, vars) {
    const d = TXT[_lang === 'fr' ? 'fr' : 'en'];
    let s = d[cle] != null ? d[cle] : TXT.en[cle];
    if (s == null) return t(cle, vars);
    if (typeof s === 'function') return s(vars || {});
    if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
    return s;
  }

  // ── État de l'onglet (avant : au cœur, à côté de S) ──────────────────────
  // awaitingConfirm : le dashboard reçoit la MÊME confirmation avant écriture que
  // la PWA scanner (elle n'existait que côté PWA — asymétrie qui, ici, produisait
  // un vrai tampon non désiré et pas seulement une modale à fermer).
  // lockedSerial/lockedPrenom/lockClearSince : verrou de carte (A) + réarmement par
  // sortie du champ (B). Identiques à la PWA — voir scanner/index.html.
  // Jamais persistés : un rechargement lève tout.
  const SC = {
    stream: null, rafId: null, scanning: false, processing: false,
    awaitingPoints: false, awaitingConfirm: false,
    awaitingIncident: false,   // panneau d'incident ouvert : détection en pause (étape 12b)
    // lockedEtat : 'ok' | 'refus' | 'incertain' — décide du bandeau (étape 12b).
    lockedSerial: null, lockedPrenom: null, lockedEtat: null, lockClearSince: null,
  };

  // Délai SANS aucun QR dans le champ avant que le verrou tombe tout seul (B).
  // Pas « une seule image vide » : jsQR rate régulièrement une image alors que la
  // carte est toujours là (flou, reflet) — une levée sur image isolée ferait
  // revenir le problème par intermittence.
  const SC_LOCK_CLEAR_MS = 600;

  // ════════════════════════════════════════════════
  // TAB: SCANNER
  // ════════════════════════════════════════════════
  function startScannerTab() {
    // ⚠️ Même défaut que le scanner PWA, en plus étroit : awaitingPoints n'était
    // remis à zéro nulle part. Pavé points laissé ouvert → changement d'onglet →
    // retour ici : la caméra repartait, la boucle restait aveugle. On passe par
    // les fermetures pour ne pas laisser de modale fantôme.
    SC.processing = false;
    closeConfirmDashboard();
    closePointsPadDashboard();
    fermerIncidentDashboard();
    scClearLock();
    document.getElementById('sc-result-sheet').classList.remove('visible');
    document.getElementById('sc-status').style.display = 'none';

    if (SC.stream) { SC.stream.getTracks().forEach(t => t.stop()); SC.stream = null; }
    SC.scanning = false;
    if (SC.rafId) { cancelAnimationFrame(SC.rafId); SC.rafId = null; }

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    }).then(stream => {
      SC.stream = stream;
      const video = document.getElementById('sc-video');
      video.srcObject = stream;
      video.play();
      video.addEventListener('loadeddata', () => {
        SC.scanning = true;
        scLoop();
      }, { once: true });
    }).catch(e => {
      const sheet = document.getElementById('sc-result-sheet');
      sheet.classList.add('visible');
      document.getElementById('sc-progress-section').style.display = 'none';
      document.getElementById('sc-reward-banner').style.display = 'none';
      document.getElementById('sc-reset-banner').style.display = 'none';
      document.getElementById('sc-error').style.display = 'block';
      document.getElementById('sc-error').textContent = tx('cameraError', { msg: e.message });
      document.getElementById('sc-name').textContent = tx('cameraErrorName');
      document.getElementById('sc-avatar').textContent = '⚠';
      document.getElementById('sc-avatar').style.background = 'var(--error)';
      document.getElementById('sc-serial').textContent = '';
    });
  }

  function stopScannerTab() {
    scClearLock();
    SC.awaitingConfirm = false;
    SC.scanning = false;
    if (SC.rafId) { cancelAnimationFrame(SC.rafId); SC.rafId = null; }
    if (SC.stream) { SC.stream.getTracks().forEach(t => t.stop()); SC.stream = null; }
  }

  function scLoop() {
    if (!SC.scanning) return;
    SC.rafId = requestAnimationFrame(scLoop);
    if (SC.processing || SC.awaitingPoints || SC.awaitingConfirm || SC.awaitingIncident) return;
    const video = document.getElementById('sc-video');
    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
    const canvas = document.getElementById('sc-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
    if (code && code.data) {
      SC.lockClearSince = null;   // un QR est dans le champ → le compte à rebours B repart de zéro
      handleScanQR(code.data);
    } else if (SC.lockedSerial) {
      // (B) Plus aucun QR dans le champ : le client a rangé sa carte. Au bout de
      // SC_LOCK_CLEAR_MS ininterrompues, le verrou tombe et le scanner est réarmé
      // sans le moindre appui en caisse.
      const now = performance.now();
      if (SC.lockClearSince === null) SC.lockClearSince = now;
      else if (now - SC.lockClearSince >= SC_LOCK_CLEAR_MS) scClearLock();
    }
  }

  // ════════════════════════════════════════════════
  // VERROU DE CARTE (A) — jumeau de scanner/index.html
  // ════════════════════════════════════════════════
  // Comparaison tolérante aux deux formats d'entrée : caméra = serial complet,
  // saisie manuelle = backup code 6 caractères. On compare donc aussi par suffixe,
  // sinon un scan fait au code de secours ne verrouillerait pas la carte que la
  // caméra voit juste après.
  function scIsLocked(serial) {
    const a = String(SC.lockedSerial || '').toLowerCase();
    const b = String(serial || '').toLowerCase();
    if (!a || !b) return false;
    if (a === b) return true;
    return a.length >= 6 && b.length >= 6 && (a.endsWith(b) || b.endsWith(a));
  }

  // Carte pour laquelle le bandeau est rendu (anti-réécriture, voir scShowLock).
  // Déclaré AVANT ses usages : scSetLock/scClearLock y touchent.
  let _scLockedShownFor = null;

  function scSetLock(serial, prenom, etat) {
    SC.lockedSerial   = serial || null;
    SC.lockedPrenom   = prenom || null;
    SC.lockedEtat     = etat || (prenom ? 'ok' : 'refus');
    SC.lockClearSince = null;
    _scLockedShownFor = null;
    document.getElementById('sc-locked').classList.remove('open');
  }

  function scClearLock() {
    SC.lockedSerial   = null;
    SC.lockedPrenom   = null;
    SC.lockedEtat     = null;
    SC.lockClearSince = null;
    _scLockedShownFor = null;
    document.getElementById('sc-locked').classList.remove('open');
  }

  // Même précaution que la PWA : appelée à chaque image, elle ne touche au DOM que
  // si le bandeau n'est pas déjà affiché pour cette carte.
  function scShowLock() {
    const el = document.getElementById('sc-locked');
    if (_scLockedShownFor === SC.lockedSerial && el.classList.contains('open')) return;
    _scLockedShownFor = SC.lockedSerial;
    // « Déjà scannée » seulement après un vrai crédit (étape 12b), comme la PWA.
    document.getElementById('sc-locked-title').textContent =
      SC.lockedEtat === 'incertain' ? tx('lockedIncertain')
      : SC.lockedEtat === 'refus' ? tx('lockedNonEnregistre')
      : SC.lockedPrenom ? tx('lockedScanned', { prenom: SC.lockedPrenom }) : tx('lockedScannedAnon');
    document.getElementById('sc-locked-hint').textContent =
      SC.lockedEtat === 'incertain' ? tx('lockedIncertainHint') : tx('lockedHint');
    document.getElementById('sc-locked-add').textContent =
      S.typeProgramme === 'points' ? tx('addPoints') : tx('addStamp');
    el.classList.add('open');
  }

  // Geste explicite sur une carte connue (cas « 3 pizzas »). En tampons ce tap VAUT
  // confirmation : écriture directe, sans repasser par la modale — sinon la 2ᵉ pizza
  // coûterait un appui de plus qu'aujourd'hui. En points, le pavé valide déjà.
  document.getElementById('sc-locked-add').addEventListener('click', () => {
    const serial = SC.lockedSerial;
    if (!serial) return;
    scClearLock();
    if (S.typeProgramme === 'points') openPointsPadDashboard(serial);
    else submitScanDashboard(serial);
  });

  async function handleScanQR(raw) {
    if (SC.processing || SC.awaitingPoints || SC.awaitingConfirm || SC.awaitingIncident) return;
    let serial = raw.trim();
    try {
      const url = new URL(serial);
      const parts = url.pathname.split('/').filter(Boolean);
      const candidate = parts[parts.length - 1];
      if (candidate && candidate.length > 4) serial = candidate;
    } catch {}
    // (A) Carte que le caissier vient de traiter et que le client garde levée
    // (rien ne l'avertit que c'est fini). On ne relance rien automatiquement ;
    // toute AUTRE carte passe normalement.
    if (scIsLocked(serial)) { scShowLock(); return; }
    proceedToScanDashboard(serial);
  }

  // Point d'entrée unique après résolution du serial (caméra ou saisie manuelle).
  // Mode points : ouvre le pavé numérique avant tout appel API. Mode tampons :
  // scan immédiat, comportement strictement inchangé.
  function proceedToScanDashboard(serial) {
    if (S.typeProgramme === 'points') {
      openPointsPadDashboard(serial);
    } else {
      // Mode tampons : plus jamais d'écriture directe sur simple détection. Le POST
      // ne part QUE sur le tap « Valider » — parité stricte avec la PWA scanner.
      openConfirmDashboard(serial);
    }
  }

  // ════════════════════════════════════════════════
  // CONFIRMATION AVANT ÉCRITURE (tampons) — calque de la PWA
  // ════════════════════════════════════════════════
  // awaitingConfirm met scLoop en pause (caméra allumée, aucune détection) tant que
  // la modale est ouverte. Réinitialisé sur TOUS les chemins de sortie ; jamais
  // persisté (un rechargement le remet à zéro).
  let SC_pendingConfirmSerial = null;

  function openConfirmDashboard(serial) {
    SC_pendingConfirmSerial = serial;
    SC.awaitingConfirm = true;
    document.getElementById('sc-confirm-btn').disabled = false; // ré-armer (debounce du tour précédent)
    document.getElementById('modal-sc-confirm').classList.add('open');
  }

  function closeConfirmDashboard() {
    document.getElementById('modal-sc-confirm').classList.remove('open');
    SC_pendingConfirmSerial = null;
    SC.awaitingConfirm = false;
  }

  document.getElementById('sc-confirm-btn').addEventListener('click', () => {
    const serial = SC_pendingConfirmSerial;
    if (!serial) return;
    document.getElementById('sc-confirm-btn').disabled = true; // debounce anti double-tap réflexe
    closeConfirmDashboard();
    submitScanDashboard(serial);
  });

  // Refus explicite : on VERROUILLE la carte refusée. Sans ça, la boucle de
  // détection la re-capte à l'image suivante et rouvre la modale aussitôt — le
  // caissier taperait « Annuler » sans jamais s'en débarrasser.
  document.getElementById('sc-confirm-cancel').addEventListener('click', () => {
    const serial = SC_pendingConfirmSerial;
    closeConfirmDashboard();
    if (serial) scSetLock(serial, null);
  });

  document.getElementById('modal-sc-confirm').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-sc-confirm')) {
      const serial = SC_pendingConfirmSerial;
      closeConfirmDashboard();
      if (serial) scSetLock(serial, null);
    }
  });

  // ── Clé d'idempotence (étape 11b) — même règle que scanner/index.html ──────
  // Une clé par scan VOULU (carte + montant), envoyée avec le scan : le serveur ne
  // crédite jamais deux fois la même clé (migration 051). GARDÉE tant qu'aucune
  // réponse claire n'est arrivée (erreur réseau, réponse illisible, 5xx) : un
  // nouvel essai sur la même carte avec le même montant reprend la même clé.
  // EFFACÉE dès qu'une réponse claire arrive : le scan suivant en prend une neuve.
  // CLE_DUREE_MS au plus ; localStorage pour survivre à un rechargement.
  const CLE_DUREE_MS = 10 * 60 * 1000;
  const CLE_STOCKAGE = 'ww_dashboard_cle_en_attente';
  let _cleEnAttente = null;

  function nouvelleCle() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // iOS < 15.4 : UUID v4 tiré de getRandomValues.
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // Même carte, serial complet (caméra) ou code de secours (6 derniers caractères).
  function memeCarte(a, b) {
    a = String(a || '').toLowerCase(); b = String(b || '').toLowerCase();
    if (!a || !b) return false;
    return a === b || (a.length >= 6 && b.length >= 6 && (a.endsWith(b) || b.endsWith(a)));
  }

  function cleDuScan(serial, points) {
    let e = _cleEnAttente;
    if (!e) { try { e = JSON.parse(localStorage.getItem(CLE_STOCKAGE) || 'null'); } catch { e = null; } }
    const montant = points == null ? null : points;
    if (e && e.cle && memeCarte(e.serial, serial) && e.points === montant
        && Date.now() - e.cree < CLE_DUREE_MS) {
      _cleEnAttente = e;
      return e.cle;
    }
    _cleEnAttente = { serial, points: montant, cle: nouvelleCle(), cree: Date.now() };
    try { localStorage.setItem(CLE_STOCKAGE, JSON.stringify(_cleEnAttente)); } catch {}
    return _cleEnAttente.cle;
  }

  function oublierCle() {
    _cleEnAttente = null;
    try { localStorage.removeItem(CLE_STOCKAGE); } catch {}
  }

  // ── Après une erreur (étape 12b) — même règle que public/scanner/index.html ──
  // Scan normal inchangé. Délai maximal pour tout le passage ; échec passager
  // (réseau, 5xx, limiteur) : UN nouvel essai automatique, même clé ; s'il échoue
  // encore : panneau « Connexion perdue ». Session ou compte refusés : panneau en
  // mots simples, puis l'écran de connexion.
  const DELAI_SCAN_MS = 15000;
  const PAUSE_AVANT_ESSAI_MS = 1000;

  async function envoyerScanDashboard(serial, points, cle, limite) {
    const body = { serial_number: serial, cle_idempotence: cle };
    if (points != null) body.points = points;
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), Math.max(0, limite - Date.now()));
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${S.token}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      let data = null;
      try { data = await res.json(); } catch {
        if (ctrl.signal.aborted) return { res: null, data: null, passager: false };
      }
      return { res, data, passager: res.status >= 500 || res.status === 429 };
    } catch {
      return { res: null, data: null, passager: !ctrl.signal.aborted };
    } finally {
      clearTimeout(minuteur);
    }
  }

  async function submitScanDashboard(serial, points) {
    if (SC.processing) return;
    SC.processing = true;
    const statusEl = document.getElementById('sc-status');
    statusEl.textContent = tx('processing'); statusEl.style.display = 'block';
    try { navigator.vibrate && navigator.vibrate(50); } catch {}

    const cle = cleDuScan(serial, points);
    const limite = Date.now() + DELAI_SCAN_MS;
    let r = await envoyerScanDashboard(serial, points, cle, limite);
    if (r.passager && Date.now() + PAUSE_AVANT_ESSAI_MS < limite) {
      statusEl.textContent = tx('nouvelEssai');
      await new Promise(ok => setTimeout(ok, PAUSE_AVANT_ESSAI_MS));
      r = await envoyerScanDashboard(serial, points, cle, limite);
    }
    statusEl.style.display = 'none';
    const { res } = r;
    const data = r.data || {};

    // Pas de réponse claire : peut-être crédité. Clé GARDÉE (Réessayer la reprend).
    if (!res || res.status >= 500 || res.status === 429) {
      SC.processing = false;
      if (res && res.status === 429) {
        const s = Number(res.headers.get('Retry-After') || res.headers.get('RateLimit-Reset')) || 60;
        ouvrirIncidentDashboard('limiteur', { serial, points, min: Math.max(1, Math.ceil(s / 60)) });
      } else {
        ouvrirIncidentDashboard('connexion', { serial, points });
      }
      return;
    }

    // Réponse claire (succès ou refus) : la clé a servi.
    oublierCle();
    SC.scanning = false;
    if (window.Scans) window.Scans.oublier();   // historique de l'onglet Scans à relire

    const code = data.error;
    if (res.status === 401 || (res.status === 403 && (code === 'session_revoked' || code === 'Accès refusé'))) {
      ouvrirIncidentDashboard('session', { serial });
      return;
    }
    if (res.status === 403 && (code === 'account_suspended' || code === 'Merchant account suspended')) {
      ouvrirIncidentDashboard('suspendu', { serial });
      return;
    }
    if (res.status === 409 && data.candidates) { showScanCandidates(data.candidates); return; }
    // Réponse définitive du serveur (succès OU refus) : la carte est traitée, on la
    // verrouille. Le prénom vient de la réponse — aucune lecture supplémentaire.
    scSetLock(serial, res.ok ? data.prenom : null);
    showScanResult(res.ok ? data : { error: messageRefusDashboard(res.status, data) }, res.ok, serial);
    if (res.ok) renouvelerSessionDashboardSiBesoin();
  }

  function messageRefusDashboard(status, data) {
    const code = (data && data.error) || '';
    if (code === 'scan_cancelled') return tx('refusAnnule');
    if (code === 'idempotency_conflict') return tx('refusConflit');
    if (code === 'use_boutique_login') return tx('useBoutiqueLogin');
    if (status === 404) return tx('carteInconnue');
    if (status === 400 && code.startsWith('Invalid code')) return tx('codeInvalide');
    if (status === 400 && code.startsWith('points must be')) return tx('invalidPoints');
    return code || tx('unknownError');
  }

  let _incidentDashboard = null;

  function ouvrirIncidentDashboard(type, contexte) {
    _incidentDashboard = { type, ...contexte };
    SC.awaitingIncident = true;
    const [titre, texte, principal, secondaire] = {
      connexion: [tx('connexionPerdueTitre'), tx('connexionPerdueTexte'), tx('reessayer'), tx('cancel')],
      limiteur:  [tx('limiteurTitre'), tx('limiteurTexte', { min: contexte.min }), tx('reessayer'), tx('cancel')],
      session:   [tx('sessionExpireeTitre'), tx('sessionExpireeTexte'), tx('seReconnecter'), null],
      suspendu:  [tx('compteSuspenduTitre'), tx('compteSuspenduTexte'), tx('signOut'), null],
    }[type];
    document.getElementById('sc-incident-titre').textContent = titre;
    document.getElementById('sc-incident-texte').textContent = texte;
    document.getElementById('sc-incident-principal').textContent = principal;
    const sec = document.getElementById('sc-incident-secondaire');
    sec.textContent = secondaire || '';
    sec.style.display = secondaire ? '' : 'none';
    document.getElementById('modal-sc-incident').classList.add('open');
  }

  function fermerIncidentDashboard() {
    document.getElementById('modal-sc-incident').classList.remove('open');
    SC.awaitingIncident = false;
    _incidentDashboard = null;
  }

  document.getElementById('sc-incident-principal').addEventListener('click', () => {
    const i = _incidentDashboard;
    fermerIncidentDashboard();
    if (!i) return;
    if (i.type === 'connexion' || i.type === 'limiteur') { submitScanDashboard(i.serial, i.points); return; }
    // Session ou compte : retour à l'écran de connexion, identifiant pré-rempli.
    const slug = S.marchandSlug;
    clearSession();
    showLogin();
    const champ = document.getElementById('in-slug');
    if (!champ.value && slug) champ.value = slug;
  });

  document.getElementById('sc-incident-secondaire').addEventListener('click', () => {
    const i = _incidentDashboard;
    fermerIncidentDashboard();
    if (i) scSetLock(i.serial, null, i.type === 'limiteur' ? 'refus' : 'incertain');
  });

  // Renouvellement silencieux de la session (étape 12a) : après un scan réussi
  // seulement, si la session longue expire dans moins de 60 jours ; au plus une
  // tentative par chargement, après la réponse. Aucune requête pour décider.
  const RENOUVELER_SOUS_MS = 60 * 24 * 3600 * 1000;
  const SESSION_LONGUE_MIN_S = 300 * 24 * 3600;
  let _renouvellementTente = false;

  function renouvelerSessionDashboardSiBesoin() {
    if (_renouvellementTente || !S.token) return;
    let p;
    try { p = JSON.parse(atob(S.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return; }
    if (!p.iat || !p.exp || p.exp - p.iat < SESSION_LONGUE_MIN_S) return;
    if (p.exp * 1000 - Date.now() > RENOUVELER_SOUS_MS) return;
    _renouvellementTente = true;
    fetch('/api/scanner/renouveler', { method: 'POST', headers: { 'Authorization': `Bearer ${S.token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d || !d.token) return;
        S.token = d.token;
        try { localStorage.setItem('ww_dash_token', d.token); } catch {}
      })
      .catch(() => {});
  }

  // Collision backup code : prénoms candidats en boutons. Un tap re-soumet le
  // serial complet du client choisi → match exact, tampon posé.
  function showScanCandidates(candidates) {
    const sheet = document.getElementById('sc-result-sheet');
    sheet.classList.add('visible');
    SC.processing = false;
    document.getElementById('sc-result-header').style.display = 'none';
    document.getElementById('sc-progress-section').style.display = 'none';
    document.getElementById('sc-reward-banner').style.display = 'none';
    document.getElementById('sc-reset-banner').style.display  = 'none';
    document.getElementById('sc-error').style.display         = 'none';

    const box   = document.getElementById('sc-candidates');
    const label = document.getElementById('sc-candidates-label');
    label.textContent = tx('pickClient');
    [...box.querySelectorAll('button')].forEach(b => b.remove());
    candidates.forEach(c => {
      const b = document.createElement('button');
      b.className = 'btn btn-primary';
      b.textContent = c.prenom;
      b.addEventListener('click', () => { box.style.display = 'none'; SC.processing = false; proceedToScanDashboard(c.serial); });
      box.appendChild(b);
    });
    box.style.display = 'flex';
  }

  function showScanResult(data, ok, serial) {
    const sheet = document.getElementById('sc-result-sheet');
    sheet.classList.add('visible');
    document.getElementById('sc-result-header').style.display = '';
    document.getElementById('sc-candidates').style.display = 'none';
    document.getElementById('sc-reward-banner').style.display = 'none';
    document.getElementById('sc-reset-banner').style.display  = 'none';
    document.getElementById('sc-error').style.display         = 'none';
    document.getElementById('sc-progress-section').style.display = ok ? '' : 'none';
    document.getElementById('sc-deja').style.display = 'none';

    if (!ok) {
      document.getElementById('sc-error').textContent = data.error || tx('unknownError');
      document.getElementById('sc-error').style.display = 'block';
      document.getElementById('sc-name').textContent = tx('errorName');
      document.getElementById('sc-avatar').textContent = '✗';
      document.getElementById('sc-avatar').style.background = 'var(--error)';
      document.getElementById('sc-serial').textContent = serial;
      return;
    }

    const { prenom, stored_value_apres: val, stored_value_avant, max_value, display_max_value, recompense, is_reset } = data;
    const stored = val ?? 0;
    const displayMax = display_max_value || max_value || S.displayMax;
    // Le drapeau vient désormais du SERVEUR. L'ancienne déduction « solde === 0 »
    // ne marchait qu'en mode tampons : en mode points la remise laisse le surplus
    // reporté (ex. 130), jamais 0 — le dashboard ne détectait donc JAMAIS la
    // remise chez un marchand en points. Repli sur l'ancien calcul si le serveur
    // est plus ancien que ce front (déploiement en cours).
    const isReset = (is_reset !== undefined)
      ? is_reset
      : (stored === 0 && stored_value_avant > 0 && !recompense);

    const av = document.getElementById('sc-avatar');
    av.textContent = (prenom || '?').charAt(0).toUpperCase();
    av.style.background = recompense ? '#f59e0b' : 'var(--accent)';

    document.getElementById('sc-name').textContent   = prenom || '–';
    document.getElementById('sc-serial').textContent = serial;

    // Renvoi d'un scan déjà crédité (même clé) : même résultat, rien n'a été ajouté.
    if (data.deja_enregistre) {
      const deja = document.getElementById('sc-deja');
      deja.textContent = tx('dejaEnregistre');
      deja.style.display = 'block';
    }

    // Texte non clampé : un scan points peut franchir le seuil en un coup (ex.
    // 480 + 50 = 530 pour un seuil à 500) → on affiche la valeur réelle "530/500"
    // (surplus reporté au scan de redemption, migration_022, jamais perdu).
    // Seule la BARRE visuelle reste bridée à 100% (pas de débordement du cadre).
    const pct = Math.min(stored / displayMax * 100, 100);
    document.getElementById('sc-value').textContent    = stored;
    document.getElementById('sc-fraction').textContent = `${stored} / ${displayMax}`;
    document.getElementById('sc-bar').style.width      = pct + '%';

    // Dots — n'a de sens qu'en mode tampons (peu d'unités). En mode points le
    // seuil peut être élevé ; la barre + la fraction suffisent (compteur simple).
    const dotsWrap = document.getElementById('sc-dots');
    dotsWrap.innerHTML = '';
    if (S.typeProgramme !== 'points') {
      for (let i = 1; i <= Math.min(displayMax, 20); i++) {
        const d = document.createElement('div');
        d.className = 'sc-dot' + (i <= stored ? ' filled' : '');
        if (!d.classList.contains('filled')) d.textContent = i;
        dotsWrap.appendChild(d);
      }
    }

    // ── Récompense : deux moments distincts, mêmes messages que le scanner PWA ──
    const banniere = document.getElementById('sc-reward-banner');
    const titre    = document.getElementById('sc-reward-title');
    const sous     = document.getElementById('sc-reward-sub');
    if (recompense) {
      // Seuil franchi — rien à remettre aujourd'hui.
      document.getElementById('sc-reward-icon').textContent = '🎉';
      titre.textContent = tx('seuilTitre', { prenom });
      sous.textContent  = tx('seuilSous');
      banniere.style.display = 'flex';
      try { navigator.vibrate && navigator.vibrate([100, 50, 100, 50, 200]); } catch {}
    } else if (isReset) {
      // Remise — instruction d'action pour le caissier.
      document.getElementById('sc-reward-icon').textContent = '🎁';
      titre.textContent = tx('remiseTitre');
      sous.textContent  = tx('remiseSous', { prenom });
      banniere.style.display = 'flex';
      try { navigator.vibrate && navigator.vibrate([100, 50, 100, 50, 200]); } catch {}
    }
  }

  document.getElementById('sc-btn-rescan').addEventListener('click', () => {
    SC.processing = false;
    closeConfirmDashboard();
    closePointsPadDashboard();
    document.getElementById('sc-result-sheet').classList.remove('visible');
    SC.scanning = true;
    scLoop();
  });

  document.getElementById('sc-btn-manual').addEventListener('click', () => openManualScan());
  document.getElementById('sc-btn-manual-after').addEventListener('click', () => {
    SC.processing = false;
    closeConfirmDashboard();
    closePointsPadDashboard();
    document.getElementById('sc-result-sheet').classList.remove('visible');
    SC.scanning = true; scLoop();
    openManualScan();
  });

  function openManualScan() {
    document.getElementById('sc-manual-input').value = '';
    document.getElementById('sc-manual-error').style.display = 'none';
    document.getElementById('modal-scan-manual').classList.add('open');
    setTimeout(() => document.getElementById('sc-manual-input').focus(), 150);
  }
  function closeManualScan() { document.getElementById('modal-scan-manual').classList.remove('open'); }

  document.getElementById('sc-manual-cancel').addEventListener('click', closeManualScan);
  document.getElementById('modal-scan-manual').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-scan-manual')) closeManualScan();
  });
  document.getElementById('sc-manual-submit').addEventListener('click', async () => {
    const serial = document.getElementById('sc-manual-input').value.trim();
    const errEl  = document.getElementById('sc-manual-error');
    if (!serial) { showErr(errEl, tx('enterSerial')); return; }
    closeManualScan();
    SC.processing = false;
    proceedToScanDashboard(serial);
  });

  // ════════════════════════════════════════════════
  // POINTS PAD — mode "points" : saisie du montant avant l'incrément
  // ════════════════════════════════════════════════
  let SC_pendingSerial = null;

  function openPointsPadDashboard(serial) {
    SC_pendingSerial = serial;
    SC.awaitingPoints = true;
    document.getElementById('sc-points-input').value = '';
    document.getElementById('sc-points-error').style.display = 'none';
    document.getElementById('modal-sc-points').classList.add('open');
    setTimeout(() => document.getElementById('sc-points-input').focus(), 150);
  }

  function closePointsPadDashboard() {
    document.getElementById('modal-sc-points').classList.remove('open');
    SC_pendingSerial = null;
    SC.awaitingPoints = false;
  }

  // Même raison que la modale de confirmation : sans verrou, le pavé se rouvre en
  // boucle sur le client précédent tant que sa carte reste dans le champ.
  document.getElementById('sc-points-cancel').addEventListener('click', () => {
    const serial = SC_pendingSerial;
    closePointsPadDashboard();
    if (serial) scSetLock(serial, null);
  });
  document.getElementById('modal-sc-points').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-sc-points')) closePointsPadDashboard();
  });
  document.getElementById('sc-points-submit').addEventListener('click', async () => {
    const raw = document.getElementById('sc-points-input').value.trim();
    const errEl = document.getElementById('sc-points-error');
    if (!/^[0-9]+$/.test(raw) || parseInt(raw, 10) <= 0) {
      showErr(errEl, tx('invalidPoints'));
      return;
    }
    const n = parseInt(raw, 10);
    const serial = SC_pendingSerial;
    closePointsPadDashboard();
    await submitScanDashboard(serial, n);
  });
  document.getElementById('sc-points-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('sc-points-submit').click();
  });

  // ════════════════════════════════════════════════
  // FICHE CLIENT (et suppression) : clients.js (t42) ; le balisage reste plus haut
  // ════════════════════════════════════════════════

  // ── Points d'entrée (appelés par le cœur) ──────────────────────────────
  // soumettre et lireQR : exposées pour les tests navigateur (cle_ecrans.js,
  // caisse_erreurs.js, onglets.js), qui appelaient avant les globaux du cœur
  // (submitScanDashboard) ; lireQR = ce que fait la caméra quand elle lit un QR
  // (le banc de test n'a pas de caméra).
  window.Scanner = { demarrer: startScannerTab, arreter: stopScannerTab, soumettre: submitScanDashboard, lireQR: handleScanQR };
})();
