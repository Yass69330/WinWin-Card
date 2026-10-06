# PASSATION TECHNIQUE — WinWin Card

> **À qui s'adresse ce document.** À une session Claude Code neuve ou à un développeur
> humain qui n'a jamais vu ce code. Il remplace la mémoire de la session qui a construit
> le mode points, l'i18n, le backup code et corrigé les 4 bugs de l'audit #3. Tout ce qui
> n'est pas ici est perdu. Lisez-le EN ENTIER avant de toucher au backend ou au SQL.
>
> **Qui pilote.** Le fondateur, non-développeur. Il valide chaque étape, exécute lui-même
> les migrations SQL dans Supabase, et teste sur de vrais téléphones. La méthode de travail
> (section 7) n'est pas décorative : c'est le contrat.
>
> **Audit global (26-29/09/2026) — à lire avant tout chantier.** La synthèse
> `docs/audit/99-synthese.md` donne l'état de santé, le tableau de capacité, le calendrier
> des échéances (en tête : la clé Supabase historique, supprimée fin 2026) et la **roadmap
> ordonnée** (aucune correction d'argent ou de scan avant le filet de tests, étape 10). Les
> rapports de segment sont dans `docs/audit/` (00a à 06, A). Plusieurs points de ce
> document ne sont plus exacts : voir la synthèse §11.2. Les décisions de l'audit sont
> consignées dans la synthèse §12, et non ici.

---

## 1. ÉTAT ACTUEL DU CODE

### Ce que fait le produit

WinWin Card est une plateforme de cartes de fidélité dématérialisées (Apple Wallet +
Google Wallet) pour commerçants. Un client scanne un QR code en boutique, s'inscrit sur
une page web (« landing »), ajoute sa carte à son téléphone. À chaque visite, le
commerçant scanne le QR du pass du client → le solde avance → à un seuil, récompense.

### Architecture (5 lignes)

- **Backend** : Node.js / Express, dans le sous-dossier `winwincard/backend/` (la racine
  du repo contient un vieux site vitrine statique, sans rapport).
- **Base de données** : Supabase (Postgres managé + Storage pour les images). Les
  migrations SQL sont **exécutées à la main** par le fondateur dans l'éditeur SQL de
  Supabase — il n'y a **aucun runner de migrations automatisé**.
- **Déploiement** : Railway, **auto-déployé à chaque push** sur la branche
  `claude/keen-goldberg-MXslu`. **Un `git push` = une mise en production.** Il n'y a pas
  de staging.
- **Front** : 4 pages HTML/JS **vanilla** (aucun framework, aucun build), servies en
  statique par Express.
- **Tests** : **il n'y a AUCUNE suite de tests automatisés.** La validation se fait par
  `node --check` (syntaxe), par des scripts de logique rejoués en isolation, et par des
  tests manuels sur vrais iPhone/Android. Ne présumez jamais qu'un test attrapera votre
  régression : rien ne l'attrapera.

### Fichiers structurants

| Fichier | Rôle |
|---|---|
| `src/index.js` | App Express, montage des routes, statiques, rate-limits |
| `src/routes/scan.js` | **Cœur du système** : POST /api/scan (résolution client + incrément + notifs + wallets) et GET /api/scan (historique) |
| `src/routes/clients.js` | Inscription client, liste/fiche/PATCH (prénom, points), export CSV, RGPD |
| `src/routes/merchants.js` | Login marchand, /me, /:slug/public (landing) |
| `src/routes/admin.js` | CRUD marchands (panel admin), preview strip, endpoints de re-sync Google Wallet |
| `src/routes/apple-wallet.js` | Protocole Apple Wallet (registration devices, refresh du pass, welcome push) |
| `src/routes/passes.js` | Téléchargement initial du .pkpass |
| `src/services/apple-pass.js` | Génération du .pkpass (pass.json, images, signature) |
| `src/services/google-pass.js` | API REST Google Wallet (LoyaltyClass + LoyaltyObject) |
| `src/services/apns.js` | Push silencieux Apple (HTTP/2, JWT ES256) |
| `src/services/strip-generator.js` | Génère l'image « strip » à tampons (SVG → PNG via sharp). Couleurs des pastilles adaptatives WCAG, écrasables par marchand (`couleur_pastille_fond/contour/icone`, migration_026). Icônes Phosphor dans `ICONS` (dont `sneaker`). |
| `src/services/strip-cache.js` | Cache des strips : LRU mémoire + Supabase Storage, clé versionnée par `strip_config_version` |
| `src/workers/cron.js` | Workflows quotidiens (relance inactifs, near-reward, **anniversaire**). Un seul par client par nuit non implémenté — voir dette. |
| `src/i18n/messages.js` | Messages de notifications FR/EN côté serveur |
| `src/middleware/auth.js` | JWT : rôles `marchand`, `admin` (+ `scanner` prévu mais jamais émis) |
| `public/admin/index.html` | Panel admin (le fondateur) — création/édition marchands |
| `public/dashboard/index.html` | Dashboard marchand (stats, clients, scanner intégré, notifs) |
| `public/scanner/index.html` | PWA scanner de caisse (login marchand, caméra, saisie manuelle, historique) |
| `public/landing.html` | Page d'inscription client (`/l/:slug`) |
| `database/schema.sql` + `database/migration_*.sql` | Schéma et migrations (voir pièges §3.3 : 012 et 022 sont NEUTRALISÉES, 023 est la référence pour le RPC ; 025 réconcilie repo↔prod ; 026 = couleurs pastilles ; 027 = colonnes workflow birthday — schema.sql + 002→027 reproduit la prod ; 040→044 ajoutées depuis, cf. tableau §11) |

### Données clés (table `marchands` et `clients`)

- `marchands.type_programme` : `'stamps'` (défaut) ou `'points'`. Fixe le mode du
  programme de fidélité. **Wam N Fade (client payant) est en points ; tous les autres
  marchands sont en tampons.**
- `marchands.max_value` : le seuil (10 tampons, ou p. ex. 500 points).
- `marchands.langue` : `'en'` (défaut) ou `'fr'`. **Figée à la création**, pilote toute
  l'i18n (landing, dashboard, scanner, notifs, label du strip).
- `clients.stored_value` : le solde. `clients.pass_serial_number` : UUID v4, **immuable**,
  encodé dans le QR du pass (le QR ne contient QUE le serial — pas le prénom), clé de tout
  (passes, device_tokens, objet Google).
- `clients.date_anniversaire` : type `date` Postgres, nullable, collectée **uniquement sur
  la landing premium** (Pro+ ET `landing_premium`). Sert au workflow birthday.
- `marchands.couleur_pastille_fond/contour/icone` : couleurs manuelles optionnelles des
  pastilles du strip (migration_026). NULL = calcul WCAG auto (voir §3.10).
- `marchands.workflow_birthday_enabled/message` : workflow anniversaire (migration_027).
- Table `scans` : journal de chaque scan (`stored_value_avant`, `stored_value_apres`),
  **jamais purgée** (conservée à vie ; seule `workflow_executions` est purgée à 90 j).

### Mode tampons vs mode points — concrètement dans le code

**Tampons (défaut, tous les marchands actuels sauf Wam N Fade)** :
- Un scan = **+1**, quoi que contienne la requête (défense en profondeur dans `scan.js`).
- À `max_value` : scan gagnant → reward (pass doré Apple). Le solde **reste au seuil** ;
  le **scan suivant** remet à 0. Ce différé d'un scan est **volontaire et vital** (§3.6).
- Le strip du pass est une image de tampons générée (`strip-generator.js`), en cache.

**Points (Wam N Fade)** :
- Le caissier saisit un **montant variable** après le scan (pavé numérique dans les deux
  UI scanner). `scan.js` valide (entier 1..100000) et le passe au RPC.
- Franchissement du seuil possible en un coup (480 + 50 = 530 pour un seuil 500) → reward
  sur ce scan, affichage **réel** « 530/500 » partout (pas de clamp ; seule la barre
  visuelle est bridée à 100 %).
- Le scan **suivant** (dit « de redemption ») ne remet pas à 0 : il **reporte le
  surplus** → `solde - seuil + points_du_scan` (530 → +100 → 130). La notif de ce scan
  est un message de progression (« +100 — Sarah : 130/500 pts »), **jamais** « remise à
  zéro » (qui serait un mensonge).
- **Pas de strip à tampons** : la génération est bypassée (Apple `apple-pass.js`,
  Google `google-pass.js`) → image fixe du marchand (`image_strip_url`) si définie,
  sinon strip uni / pas de bannière.
- Doré Google : `REWARD_GOLD = '#c9a84c'` appliqué par défaut au reward **pour tous les
  modes** (parité avec le doré Apple), sauf si `couleur_fond_reward` est définie.

**Le RPC central** : `increment_stored_value(p_client_id uuid, p_max_value integer,
p_amount integer DEFAULT 1, p_type_programme text DEFAULT 'stamps')` — **une seule
fonction en base** (voir l'incident §3.3), définie dans
`database/migration_023_drop_legacy_overloads.sql`. Verrou ligne (`SELECT … FOR UPDATE`)
= scans concurrents sérialisés, aucun point perdu. Logique :

```
si solde_avant >= seuil        → redemption : points ? report du surplus : reset à 0 ; is_reset=true
sinon si solde_avant + montant >= seuil → scan gagnant : additionne, PAS de reset ; is_reset=false
sinon                          → additionne
```

`scan.js` en déduit : `recompense = !isReset && apresScan >= maxValue`.

### Fonctionnalités périphériques à connaître

- **Backup code** : les 6 derniers caractères du serial, affichés au dos du pass
  (« Backup code », Apple backField + Google textModule). En caisse, si la caméra échoue,
  le caissier tape ces 6 caractères → `scan.js` résout par suffixe (insensible à la
  casse, scopé marchand). Collision (ultra-rare) → HTTP 409 + boutons prénom cliquables.
- **i18n FR/EN** : catalogues inline dans chaque page front (`I18N` + `t()` +
  `data-i18n`), messages serveur dans `src/i18n/messages.js`. Langue par marchand.
- **Parrainage** : le parrain est crédité **UNE SEULE FOIS par filleul, à vie**, au
  premier tampon/point du filleul. Déclencheur `avantScan === 0` dans `scan.js`,
  dédupliqué par un « ticket » écrit dans `referral_credits` AVANT le crédit, garanti
  par l'index unique `referral_credits_filleul_unique` (migration_024). RPC
  `credit_referral` inchangé. ⚠️ L'ancienne sémantique décrite ici (« premier scan
  depuis le dernier reset ») était un BUG (re-crédit à chaque cycle en tampons),
  corrigé le 2026-07-13 — voir §2 item [5].
- **Auth** : JWT stateless. Dashboard 7 jours, scanner 365 jours (`remember_device`),
  stockés en `localStorage`. Sessions simultanées illimitées, aucune révocation possible.

---

## 2. CE QU'ON VIENT DE CORRIGER (audit #3 — 4 items, tous validés en prod)

> Si un fix ci-dessous vous paraît « bizarre », c'est qu'il corrige un vrai bug. Ne le
> « nettoyez » pas sans avoir compris la cause.

### [1] CRITIQUE — Le scan par backup code ne rafraîchissait jamais le pass
- **Symptôme** : scan par code de secours → le solde avançait en base, mais la carte du
  client ne bougeait pas (pas de notif, pas de solde à jour, pas de doré).
- **Cause réelle** : le champ `serial_number` du body n'est PAS forcément un serial —
  c'est une **entrée** (UUID complet OU code 6 caractères). Trois effets de bord
  (`passes.update`, push APNs, PATCH Google) utilisaient cette entrée brute au lieu du
  serial résolu → avec un code 6 caractères : 0 ligne matchée, 0 device token, PATCH
  d'un objet inexistant (404 avalé).
- **Fix** (`src/routes/scan.js`) : la variable du body s'appelle `serial_input` et ne
  sert qu'à la résolution ; `const serial = client.pass_serial_number` (le serial résolu)
  alimente tous les effets de bord. **Ne revenez jamais en arrière sur ce nommage.**

### [2] Le bouton « Points » de la fiche client ne répondait plus
- **Symptôme** : dashboard → fiche client → « Nom » marche, « Points » ne répond pas ;
  un refresh « finit par » le réparer. Reproduit aussi en mode tampons.
- **Cause réelle** : le handler écrivait `adjust-label.textContent = …`, ce qui
  **détruit l'enfant** `<span id="adjust-max">` (textContent remplace tous les enfants
  par du texte). À l'ouverture suivante, la relecture de `adjust-max` renvoyait `null`
  → TypeError **avant** l'ouverture du modal. Marche 1 fois par chargement de page, puis
  cassé. Régression introduite par l'i18n branchée après coup.
- **Fix** (`public/dashboard/index.html`) : le `<span id="adjust-max">` a été supprimé
  du HTML et sa lecture supprimée du JS ; `t('newBalance', {max})` rend le libellé
  complet dans `adjust-label` (élément stable, sans enfant), idempotent.

### [3] Grille de pastilles dans la fiche client en mode points
- **Symptôme** : fiche client d'un marchand points → ~500 points bleus affichés.
- **Cause** : `renderClientSheet` générait `max_value` pastilles sans vérifier le mode.
  C'était la 4ᵉ surface d'affichage oubliée du chantier points (voir §3.5).
- **Fix** (`public/dashboard/index.html`) : bypass `if (S.typeProgramme !== 'points')`,
  identique à celui de l'écran résultat du scanner. Le compteur « X/max » + la barre
  restent.

### [4] Liste admin : « 500 tampons » pour un marchand en points
- **Fix** : libellé adaptatif `points/tampons` selon `m.type_programme`
  (`public/admin/index.html`) + ajout de `type_programme` au `select` de l'endpoint
  liste (`src/routes/admin.js` — il n'y était pas).

### Session du 2026-07-13 — suite de l'audit #3 (parrainage + schéma)

### [5] CRITIQUE — Parrain re-crédité en boucle (mode tampons)
- **Symptôme** : en tampons, le solde du filleul revient à 0 à chaque carte bouclée ;
  `avantScan === 0` re-déclenchait le crédit parrain à CHAQUE cycle, indéfiniment.
  Aucune déduplication : `referral_credits` était un journal jamais consulté avant de
  créditer, écrit en fire-and-forget muet (voir §3.9). En points le solde ne repasse
  jamais par 0 (bug invisible chez Wam N Fade), mais une remise à zéro manuelle depuis
  la fiche client le reproduisait dans les DEUX modes — la cause racine était l'absence
  de déduplication, pas le reset des tampons.
- **Fix** : règle métier « un crédit par filleul, à vie », portée par la BASE :
  index unique `referral_credits_filleul_unique` (migration_024) + dans `scan.js` le
  ticket est inséré AVANT le crédit, avec lecture de l'erreur (23505 = déjà crédité →
  refus silencieux ; autre erreur → échec bruyant SANS crédit). Comportement
  **fail-closed assumé** : si quelque chose casse entre ticket et crédit, on rate un
  crédit (rattrapable à la main) — on n'en double jamais un.

### [6] Schéma non reproductible — réglé par migration_025
- Trois colonnes de `marchands` (`type_programme`, `langue`, `couleur_texte_reward`)
  existaient en prod sans être créées par AUCUN fichier (SQL manuel jamais committé) :
  rejouer les migrations sur une base vierge cassait login marchand, scan et génération
  de pass. La photographie complète de la prod (2026-07-13) a aussi révélé 2 contraintes
  CHECK hors fichiers (`langue`, `type_programme`) et une divergence de nullabilité sur
  `landing_premium`. `migration_025_delta_reconciliation.sql` clôt le tout :
  **schema.sql + 002→025 reproduit la prod**. Le repo dit à nouveau la vérité.

### [7] Push Apple perdus — session APNs zombie (incident Magic Clean, 2026-07-15)
- **Symptôme** : ajustement de points depuis le dashboard → la carte sur le téléphone ne
  se met jamais à jour (pas « en retard » : JAMAIS, jusqu'au prochain scan ou à
  l'ouverture manuelle de Wallet). Intermittent, ancien, réapparu.
- **Cause réelle** : `apns.js` réutilise une connexion HTTP/2 persistante vers Apple.
  Quand le réseau la coupe EN SILENCE (session « zombie »), le push est écrit dans le
  vide : aucune réponse, erreur `read ETIMEDOUT` seulement ~7 min plus tard — code
  d'erreur ABSENT de la liste du retry existant → jamais renvoyé. Preuve : logs Railway
  du 2026-07-15, deux pushes (09:52 et 09:59) morts dans la même session zombie ; le
  premier avait « marché » uniquement parce que Wallet était ouvert sous les yeux du
  fondateur (synchro déclenchée par l'appareil, pas par le push).
- **Fix** (`apns.js`) : borne de 10 s par push (`req.setTimeout` → destroy stream +
  session) + `ETIMEDOUT`/`APNS_TIMEOUT` ajoutés aux erreurs déclenchant le retry unique
  sur session neuve. Zéro push supplémentaire en fonctionnement normal ; au pire UN
  renvoi du même push quand la ligne était morte.

### Session du 2026-07-2x — strip, i18n, birthday, scanner

### [8] Icône `sneaker` + couleurs manuelles des pastilles
- **Sneaker** ajoutée au générateur (`ICONS`, path Phosphor authentique v2.1.1) + sélecteur admin.
- **Couleurs manuelles** `couleur_pastille_fond/contour/icone` (migration_026) : écrasent le
  calcul WCAG dans `stampColors(bgColor, overrides)`. NULL → comportement historique
  identique (prouvé par test isolé). Contour optionnel ajouté sur la pastille **remplie**
  (permet cercle transparent + icône visible). **Non appliquées en état reward** (le doré
  garde son WCAG) ni en mode points (générateur bypassé). Champ texte admin accepte
  `transparent`/rgba/hex ; garde-fou contraste non bloquant. Voir §3.10.

### [9] Placeholder téléphone landing selon la langue
- L'input tel avait un placeholder `+33…` figé pour tous. Branché sur l'i18n (`data-i18n-ph`,
  clé `phonePh`) : `+971…` en `en` (marché UAE), `+33…` en `fr`. Repli statique = `+971`.

### [10] Workflow anniversaire (birthday)
- Nouveau workflow auto dans `cron.js`, calqué sur inactive : envoi le jour J (matching
  jour+mois **UTC**, année ignorée, 29/02 sans code spécial), une fois par an (dédup via
  `workflow_executions` type `birthday`, `executed_at >= 1er janvier UTC`, sans nouvelle
  colonne). **Réservé Pro+ ET `landing_premium=true`** (seule surface où la date est
  collectée). Message custom `workflow_birthday_message` ou fallback i18n `birthday`.
  Zéro écriture `stored_value`, pas de quota (comme inactive). Colonnes = migration_027.
  Déclenchement manuel : **PAS** câblé dans `/api/admin/workflows/trigger` (choix fondateur,
  test via le cron nocturne 08:00 UTC = 12:00 Dubaï).

### [11] Scanner — confirmation avant écriture (tampons) + historique renforcé
- **Anti double-scan** : au retour de « next scan », la caméra rouvrait et re-scannait le
  même QR → +1 involontaire (stamps). Fix : écran « Valider ce scan ? » (sans nom : le QR
  ne contient que le serial, afficher le prénom aurait exigé une lecture — refusé). **Le
  POST d'écriture ne part QUE sur le tap**, jamais sur la détection. Flag `awaitingConfirm`
  (pause `scanLoop`), réinitialisé sur TOUS les chemins de sortie + jamais persisté (reload
  = reset ; le réflexe caissier fermer/rouvrir est donc auto-réparateur). Points inchangé
  (le pavé fait déjà office de validation). POST `/api/scan` **strictement inchangé**.
- **Historique** (`GET /api/scan`, plafond 200 ; scanner passé à `?limit=50`) : affiche
  désormais `avant → après` + heure exacte (données déjà récupérées). Devient la « preuve
  de caisse » puisque l'annulation LIFO a été écartée (trop complexe — rattrapage d'erreur
  reste sur le dashboard marchand).

---

## 3. LES PIÈGES DE CETTE CODEBASE (règles apprises douloureusement)

### 3.1 — Ne JAMAIS réutiliser un identifiant brut du body après avoir résolu l'entité
**Règle** : dès qu'une route résout une entité à partir d'une entrée flexible, tous les
effets de bord utilisent **la clé de l'entité résolue**, jamais l'entrée.
**Né de** : item [1] ci-dessus. L'entrée acceptait deux formats ; le nom de variable
(`serial_number`) a induit tout le monde en erreur pendant des semaines.

### 3.2 — Ne JAMAIS écraser le textContent d'un élément qui contient un enfant à id
**Règle** : `el.textContent = …` **détruit les enfants** de `el`. Si un enfant porte un
`id` relu ailleurs, la relecture renverra `null` — souvent bien plus tard, de façon
« intermittente ». Piège typique de l'i18n branchée après coup sur des libellés statiques
qui contenaient des `<span>`.
**Né de** : item [2]. Une chasse complète a été faite sur les 3 fronts : `adjust-max`
était la seule occurrence cassante ; `logo-initial`/`mockup-initial` (landing) partagent
le motif mais sont inoffensifs par conception (placeholder détruit volontairement, jamais
relu) — ne « corrigez » pas ça.

### 3.3 — Postgres : UNE SEULE signature par nom de fonction
**Règle** : `CREATE OR REPLACE FUNCTION` ne remplace que si la liste des **types** de
paramètres est identique — sinon il **crée une surcharge**. Une fonction à N paramètres
dont les derniers ont un `DEFAULT` est candidate pour tout appel à N-k arguments : elle
entre en **collision** avec toute surcharge plus courte → erreur
`42725 function is not unique` sur les appels existants. **Ajouter un paramètre à défaut
est un REMPLACEMENT (drop + recreate), jamais une addition.**
**Né de** : l'incident RPC. `increment_stored_value` a accumulé 3 surcharges (2-arg,
3-arg, 4-arg à défauts). Dès l'exécution de la migration 022, **l'appel 3-arg du code
déployé en prod était ambigu** — tout scan risquait une 500, indépendamment de tout
déploiement. Résolu par DROP manuel des deux anciennes.
**État actuel** : une seule fonction en base (4-arg).
`migration_023_drop_legacy_overloads.sql` est **la source de vérité** ;
`migration_012` et `migration_022` sont **NEUTRALISÉES** (fichiers 100 % commentaires,
aucun CREATE) — ne réintroduisez JAMAIS un CREATE de cette fonction ailleurs que dans la
migration canonique la plus récente.

### 3.4 — Google Wallet : la CLASSE (design) vs l'OBJET (solde)
**Règle** : chez Google, le design partagé (hero/bannière, logo, couleur de base) vit
dans la **LoyaltyClass**, persistée côté Google et keyée par le **slug** du marchand
(`classId = issuerId.slug`). Le solde du client vit dans le **LoyaltyObject**. La classe
ne se met à jour QUE par un PUT explicite (`createOrUpdateLoyaltyClass`). Conséquences :
- **Toute modification de config marchand DOIT passer par le formulaire admin** — le
  PATCH admin déclenche le re-sync de classe (`admin.js`, appel après update). Un
  **UPDATE SQL direct laisse la classe Google périmée** (aucun trigger possible : un
  trigger Postgres ne peut pas appeler l'API Google).
- Re-sync manuel ciblé si besoin : `POST /api/admin/google-wallet/class/:marchandId`
  (token admin ; depuis la console du panel admin :
  `fetch('/api/admin/google-wallet/class/<id>', {method:'POST', headers:{Authorization:'Bearer '+localStorage.getItem('ww_admin_token')}})`).
  **Jamais** le batch `/classes/sync` sans raison (touche TOUS les marchands).
- Le PUT de classe **préserve `reviewStatus: APPROVED`** (sinon Google redéclencherait
  une revue). Une mise à jour de classe **se propage aux passes déjà installés** (délai
  de quelques secondes à minutes ; ouvrir l'app Google Wallet force la synchro).
- ⚠️ Corollaire jamais traité : **changer le `slug` d'un marchand orphelinerait sa classe
  Google** (nouveau classId). Ne changez jamais un slug sans y penser.
**Né de** : le hero à 10 tampons resté affiché sur Google après conversion de Pizza
Sabbioni en points par SQL, alors qu'Apple (qui régénère le pass à chaque téléchargement)
était correct.

### 3.5 — Recenser TOUTES les surfaces d'affichage avant de changer une sémantique
**Règle** : le solde/seuil/progression s'affiche à (au moins) **7 endroits actifs** :
strip Apple, hero/balance Google, champ texte du pass Apple, écran résultat du scanner
PWA, écran résultat de l'onglet scanner du dashboard, **fiche client du dashboard**,
liste clients du dashboard — plus les historiques (3) et les notifications texte. Toute
modification de sémantique d'affichage doit être vérifiée sur CHAQUE surface, liste en
main.
**Né de** : la fiche client (pastilles) a été oubliée pendant DEUX phases du chantier
points, découverte en prod par le fondateur.

### 3.6 — Le reset différé d'un scan est VITAL pour le doré Apple — ne l'« optimisez » jamais
**Règle** : le scan gagnant ne remet JAMAIS le solde à 0 (ni en tampons, ni en points).
Le fond doré Apple n'est pas poussé : après le push silencieux APNs, **Apple revient
chercher le pass de façon asynchrone** et `isPassDoré()` relit `stored_value` **en
base** à ce moment-là. Si le scan gagnant remettait à 0, Apple lirait 0 → jamais de
doré. C'est pour ça que le reset (tampons) ou le report (points) n'arrivent qu'au scan
suivant.
**Né de** : l'analyse de l'option « reset immédiat », abandonnée précisément pour ça.

### 3.7 — Discipline migrations : la base d'abord, le repo doit dire la vérité
**Règle** : (a) toute migration est **exécutée dans Supabase et confirmée par le
fondateur AVANT** de pousser le code qui en dépend ; (b) toute modification exécutée en
base **doit exister en fichier dans `database/`** — une migration « donnée dans le chat »
et jamais committée fait mentir le repo (c'est arrivé : la 3-arg de la Phase 1 n'a jamais
eu de fichier, et `migration_012` a longtemps décrit une fonction qui n'existait plus
telle quelle) ; (c) tester les DEUX chemins après une migration de fonction : l'ancien
appel du code déployé ET le nouveau.

### 3.8 — Divers appris sur le tas
- **`git push` = déploiement production** (Railway auto-deploy). Il n'y a pas d'étape
  intermédiaire. Committer localement sans pousser est la façon de « préparer sans
  déployer » (le stop-hook du repo réclame des commits — commit local le satisfait).
- **Faux positif du hook de signature** : le hook peut afficher `Unverified (N)` sur des
  commits pourtant signés — c'est `gpg.ssh.allowedSignersFile` non configuré localement,
  pas une vraie absence de signature (`git cat-file -p <sha>` montre le bloc `gpgsig`).
  Ne pas « réparer » à coups de `--amend --reset-author` : sans effet.
- **`sharp`** (dépendance native de strip-generator) n'est pas installable dans tous les
  environnements de dev — `node --check` passe, mais `require('./strip-generator')`
  peut échouer localement. Testez la logique en l'isolant.
- **`strip_config_version`** : les strips générés sont en cache (Storage), keyés par ce
  compteur. Il est bumpé automatiquement quand un champ de `VISUAL_FIELDS`
  (`admin.js`) change via le PATCH admin. Si vous ajoutez un champ qui influence le
  rendu du strip, ajoutez-le à `VISUAL_FIELDS`, sinon les vieux strips resteront servis.
- **`langue` est figée à la création** (décision produit) : le label du strip est gravé
  dans les images en cache à la première génération. Pas de bump prévu au changement de
  langue puisque la langue ne change jamais.
- **`passReset` (i18n) contient « 0/max » en dur** : ne l'utilisez jamais pour un scan
  de redemption en mode points (le solde n'y est pas 0) — `scan.js` route déjà ce cas
  vers `passProgress`.

### 3.9 — supabase-js NE REJETTE JAMAIS : tout `.catch()` sur une requête Supabase est du CODE MORT
**Règle** : supabase-js (v2) ne lance jamais d'exception sur une erreur de requête — il
RÉSOUT toujours avec `{ data, error }`, y compris sur une panne réseau. Conséquence :
un `.then().catch(console.error)` collé sur une requête n'attrapera JAMAIS rien, et un
`.then()` vide jette l'erreur sans la regarder — l'échec est alors invisible PARTOUT,
même dans les logs Railway. Toute requête dont l'échec compte doit LIRE `error` dans la
réponse et le traiter explicitement. (Nuance : un `.catch()` sur l'appel d'une fonction
`async` maison fonctionne normalement — le piège ne concerne que les requêtes/builders
supabase-js.) Chasse faite le 2026-07-13 : le pattern muet existe ENCORE sur l'insert
des consentements RGPD (`clients.js`) — si cet insert échoue, la preuve de consentement
n'est jamais enregistrée et personne ne le sait. Non corrigé (hors périmètre), à traiter.
**Né de** : le diagnostic du bug parrainage — `referral_credits` était VIDE en prod
malgré des tests « réussis », sans la moindre trace d'erreur nulle part. C'est le
finding le plus important de cette session.

### 3.10 — Le repo ne dit pas forcément la vérité sur la base : PHOTOGRAPHIER avant tout chantier SQL
**Règle** : ne jamais déduire l'état réel de la base des fichiers de migration. Avant
tout chantier qui touche au schéma, photographier la base réelle en lecture seule
(`information_schema.columns`, `pg_constraint` + `pg_get_constraintdef`, `pg_indexes`,
`pg_proc` + `pg_get_functiondef`, triggers, policies) et réconcilier ligne à ligne avec
`database/`. ⚠️ L'éditeur SQL Supabase tronque l'affichage à ~100 lignes sans le dire :
vérifier que les résultats d'introspection sont complets (compter les tables attendues).
**Né de** : l'item [3] de l'audit #3. Deux contraintes CHECK vivaient en prod sans être
dans AUCUN fichier — même l'audit ne les avait pas vues. Généralise la règle §5
« listez les fonctions réellement en base » à TOUT le schéma.

---

## 4. LA DETTE OUVERTE

Par gravité décroissante :

1. **Le scanner PWA ne gère pas l'expiration du token (401)** — `public/scanner/index.html`.
   Le token dure 365 jours, mais à expiration (ou rotation de `JWT_SECRET`), le scan
   échoue avec un message brut, **sans redirection vers le login**. Le caissier est
   bloqué sans comprendre. Le dashboard, lui, gère le 401 proprement (wrapper `api()`).
   *Impact : caisse morte un matin, sans explication.*

2. **Pas de rôle caissier** — le scanner utilise les identifiants complets du marchand.
   Le rôle `'scanner'` est accepté par `authScanner` mais **aucun endpoint ne l'émet**.
   Quiconque a l'accès caisse a TOUT (dashboard, export clients, notifications).
   *Impact : sécurité/gouvernance, pas un bug fonctionnel.*

3. **Sessions JWT non révocables** — stateless pur, aucune blacklist, sessions
   simultanées illimitées. Révoquer = changer `JWT_SECRET` = déconnecter TOUT LE MONDE.
   *Impact : impossible de couper l'accès d'un appareil volé/parti avec un ex-employé.*

4. **Re-sync Google silencieusement faillible** — le re-sync de classe déclenché par le
   PATCH admin est fire-and-forget (`.catch(console.error)`). S'il échoue (réseau,
   quota), la classe reste périmée et **personne ne le sait**. Pas de statut « dernière
   synchro » ni de bouton re-sync dans l'admin (la manip passe par la console, §3.4).
   *Impact : le bug Pizza Sabbioni peut se reproduire sans SQL direct.*
   **REPORTÉ (arbitrage fondateur, 2026-07-13)** : il ne veut pas multiplier les appels
   à l'API Google Wallet, par crainte de restrictions côté Google. Ne pas re-proposer
   sans élément nouveau.

5. **Historiques : le scan de redemption points est mal classé** — dans l'onglet Scans
   et la fiche client du dashboard, reward/reset sont **reconstruits après coup** depuis
   `stored_value_avant/apres`. En points, un scan de redemption (530 → 130) ne matche
   aucune heuristique proprement. Accepté V1, cosmétique, deux endroits
   (`renderScans`, `renderClientSheet`).

6. **Cas limite du report en cascade** — si le scan de redemption dépasse À NOUVEAU le
   seuil d'un coup (achat > seuil), pas de reward sur ce scan (`is_reset` reste true) ;
   il retombe au scan suivant. Documenté dans `migration_023`, accepté V1.

7. **Pizza Sabbioni est un marchand de TEST** — converti en points (seuil 500) pour
   valider le chantier, état d'origine : tampons/10/inactif. **Vérifier son état actuel
   en base avant tout test dessus, et ne jamais le confondre avec un vrai client.**
   C'est le cobaye officiel : testez dessus, jamais sur Wam N Fade directement.

8. **Divers mineurs** : messages d'erreur serveur en anglais (hors périmètre i18n,
   choix assumé) ; mockup de la landing avec pastilles décoratives statiques (pas un
   vrai solde, jugé caduc) ; endpoint `/api/admin/google-wallet/classes/sync` (batch)
   existe et est dangereux par volume ; `display_max_value` permet d'afficher un
   dénominateur différent du seuil réel (utilisé rarement, pensez-y en debug).

9. **Aucune idempotence sur /api/scan — REPORTÉE (arbitrage fondateur, 2026-07-13),
   dette assumée** : pas de clé d'idempotence ni de fenêtre anti-rejeu ; un double-tap
   du caissier ou un retry réseau = double crédit (le FOR UPDATE sérialise mais ne
   dédoublonne pas). Raisons du report : volume trop faible aujourd'hui + garde-fou
   humain (le caissier montre l'historique au client après chaque scan).
   **À TRAITER AVANT d'avoir plusieurs marchands en mode points** — en points c'est de
   la valeur monétaire.

10. **Login email fragile — CLASSÉ SANS SUITE (arbitrage fondateur, 2026-07-13)** :
    `merchants.js` fait `.single()` sur `email_contact`, colonne sans contrainte
    unique ; deux marchands avec le même email = login email impossible. Décision :
    emails bidon, champ inutilisé aujourd'hui. Ne pas ressortir ce finding sans
    changement d'usage du champ.

11. **Listing Apple sur-inclusif + horodatage sur la mauvaise horloge — À CORRIGER
    ENSEMBLE, JAMAIS séparément — REPORTÉ (arbitrage fondateur, 2026-07-15)** :
    dans `apple-wallet.js`, `GET /v1/devices/:id/registrations/...` répond « tous les
    passes de l'appareil ont changé » (le filtre `passesUpdatedSince` porte sur l'embed
    `passes(updated_at)` sans `!inner` → il n'exclut pas les parents) et renvoie
    `lastUpdated = new Date()` (horloge Node) alors que le filtre compare des
    timestamps Postgres. Les DEUX défauts se neutralisent : la sur-inclusion fait tout
    revérifier par l'iPhone et le 304 par pass (If-Modified-Since) fait le tri.
    Impact prod : marginal (un client réel a 1-3 passes) — quelques téléchargements
    inutiles et des erreurs « Server requested update but the pass was unchanged »
    consignées par Apple à chaque synchro d'appareil multi-passes. ⚠️ PIÈGE : corriger
    le filtrage SANS l'horodatage (ou l'inverse) activerait le bug masqué → mises à
    jour RATÉES. Raison du report : impact réel négligeable, prudence vis-à-vis du
    canal Apple.

12. **Fiabilité des notifs à l'échelle — EXPLORÉ, EN ATTENTE DE MESURE (2026-07-2x)** :
    trois angles identifiés, non implémentés. (a) **Pas de nettoyage 410/BadDeviceToken**
    dans `apns.js` : les device_tokens morts s'accumulent à vie et sont re-poussés (Apple
    répond 200 = accepté ≠ livré). (b) **Churn de `device_id`** : une réinstall peut créer
    un nouveau `device_id` en laissant l'ancien = zombie (candidats mesurables : serials à
    plusieurs `device_id`). (c) **Zéro observabilité** sur les chemins auto (scan, cron) —
    seul le marketing compte ses envois (`notification_logs`). Ordre proposé si on reprend :
    mesurer d'abord (churn en base ; tokens morts nécessitent un envoi-diagnostic ou un
    logging déployé), puis 410-cleanup (avec garde-fou timestamp → suppose une colonne
    `last_registered_at`, absente aujourd'hui car `created_at` figé au upsert). Ligne rouge
    fondateur : zéro régression sur near_reward/inactive/welcome/scan. Reste minimal.

13. **Anti-rafale push (priorité workflows + apns-collapse-id) — PARKÉ (2026-07-2x)** :
    un client peut matcher inactive + near_reward + birthday le même run → 2-3 push au
    même pass alors que `notification_message` est un champ unique écrasé (seul le dernier
    message est réellement affichable). Pistes évaluées : « un seul workflow/client/nuit »
    (priorité birthday > inactive > near_reward via un Set en mémoire, réordonner les
    appels du schedule) + `apns-collapse-id = serial` (coalescence Apple, sans effet sur
    les push isolés). **Abandonné pour l'instant** : trop peu de valeur à ~50 clients pour
    le risque. Ressortir si volume ↑.

14. **Couleur du texte « LOYALTY CARD » du strip — DEMANDÉ, NON FAIT** : aujourd'hui
    calculée en WCAG depuis le fond (`labelSvg`, blanc 50 % sur fond sombre), aucun champ
    manuel. Le fondateur veut pouvoir la choisir. Même plomberie que les couleurs de
    pastilles (colonne optionnelle `couleur_label_strip` → override dans `labelSvg`, NULL =
    comportement actuel, + trio admin + `VISUAL_FIELDS`). Petit chantier, à faire plus tard.

---

## 5. LES ZONES DANGEREUSES

### 🔴 `increment_stored_value` (le RPC) — l'argent des clients
C'est LA fonction qui fait foi sur les soldes. Toute modification :
- passe par une **nouvelle migration** qui `CREATE OR REPLACE` la **même signature
  4-arg** (jamais une signature de longueur différente — relire §3.3) ;
- est testée en SQL sur un **client jetable** (INSERT → appels → DELETE), sur les deux
  modes, **avant** tout push de code ;
- préserve le `FOR UPDATE` (verrou ligne) — c'est lui qui empêche deux caisses
  simultanées de perdre des points ;
- préserve le contrat de retour (`stored_value_avant, stored_value_apres, is_reset`) —
  `scan.js` et la détection du reward en dépendent mot pour mot.

### 🔴 `scan.js` — le couplage reward/reset
`recompense = !isReset && apresScan >= maxValue` : cette ligne et la sémantique
d'`is_reset` sont couplées au RPC ET au différé du doré Apple (§3.6). Ne modifiez
jamais l'un sans re-tracer les trois. Le chemin caméra et le chemin backup code
convergent ici : tout effet de bord utilise `client.pass_serial_number` (§3.1).

### 🔴 Les migrations Supabase
Pas de runner : ce qui est en base est ce que le fondateur a exécuté. Avant tout
chantier SQL : **listez les fonctions réellement en base**
(`SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname = '…'`)
plutôt que de faire confiance aux fichiers. Après : mettez le fichier en accord.

### 🟠 `google-pass.js` — classe vs objet
Relire §3.4 avant d'y toucher. Le hero, le logo et la couleur de base sont dans la
classe (figée) ; le solde et la couleur reward dans l'objet (PATCHé à chaque scan).
Modifier le design → il faut un re-PUT de classe pour les marchands existants.

### 🟠 Le formulaire admin est le SEUL chemin sûr pour modifier un marchand
SQL direct sur `marchands` = classe Google périmée + pas de bump de
`strip_config_version` + aucun garde-fou. Si un champ n'est pas éditable dans l'admin,
la bonne réponse est de l'ajouter à l'admin (pattern existant : HTML + `resetForm` +
`fillForm` + `collectForm` + `ALLOWED` dans `admin.js`), pas de contourner par SQL.

### 🟠 Tout push déploie la prod
Wam N Fade est un client payant actif en tampons→points. Le mode tampons est le mode de
tous les autres marchands : **la règle absolue de tous les chantiers passés était « zéro
régression tampons »** — chaque nouveau comportement est gardé par
`type_programme === 'points'` ou par un défaut neutre. Maintenez cette discipline.

### 🟡 Les fronts sont des fichiers uniques sans tests
`dashboard/index.html` fait ~1700 lignes de JS inline. Une typo = un écran mort en prod.
Toujours : extraire le `<script>` et `node --check` avant de committer (pattern utilisé
partout dans l'historique). Vérifier la couverture i18n (toute clé `t('x')` doit exister
en `en` ET `fr`).

---

## 6. COMMENT VÉRIFIER QUE TOUT VA BIEN (checklist de reprise)

Avant d'attaquer un chantier, valider l'état de départ :

1. `git log --oneline -8` — la branche de prod est `claude/keen-goldberg-MXslu`, la
   branche de travail de la session en cours est `claude/epic-dijkstra-4pnlu9` (poussée
   en fast-forward vers la prod à chaque feu vert). Dernier commit connu : `25cd3cf`
   (confirmation scanner + historique renforcé). Repères antérieurs : `225e022`
   (placeholder tél), `34c4bb6` (birthday), `b197bdc` (couleurs pastilles), `7795411`
   (SW scanner network-first), `72a96c4` (fix parrainage), `37ecc63` (fin session i18n/points).
2. En base : une **seule** fonction `increment_stored_value` (requête §5-migrations).
3. Un scan caméra ET un scan backup code sur le cobaye Pizza Sabbioni (voir son état,
   dette #7) : solde + notif + pass rafraîchi dans les deux cas.
4. `type_programme` de Wam N Fade = `'points'`, des autres marchands = `'stamps'`.
5. `cd winwincard/backend && npm ci && npm test` → « 86/86 OK » au 03/10 (filet de
   l'étape 10, §15 quaterdecies).

## 7. MÉTHODE DE TRAVAIL AVEC LE FONDATEUR (le contrat)

Cette méthode a évité deux catastrophes en prod (l'ambiguïté RPC attrapée en test SQL
manuel ; le reset immédiat abandonné avant code). La respecter :

1. **Diagnostic avant code.** On rapporte la cause réelle prouvée par le code, on
   attend la validation, PUIS on code. Pas de contournement (setTimeout, retry…) : la
   cause racine.
2. **Migrations avant code dépendant.** Le fondateur exécute lui-même le SQL dans
   Supabase et confirme. Aucun push de code qui suppose une migration non confirmée.
3. **Rapport avant push.** On committe localement, on décrit le diff, on pousse après
   feu vert (rappel : push = prod).
4. **Zéro régression tampons.** Tout changement est gardé par le mode ou par un défaut
   neutre, et on le prouve (table de décision, test isolé).
5. **Test terrain sur cobaye.** Pizza Sabbioni d'abord, sur vrais iPhone ET Android,
   puis seulement Wam N Fade.
6. **Parler clair.** Le fondateur n'est pas développeur : expliquer le jargon, dire
   franchement ce qu'on ne sait pas (ex. : les délais de propagation Google), signaler
   spontanément ce qu'on découvre en chemin.
7. **`npm test` avant tout push qui touche l'argent, le scan, les migrations ou
   l'authentification** (règle de Yass, 02/10). Dans `winwincard/backend`, le filet doit
   finir sur « N/N OK » ; le résultat figure dans le rapport avant push. Un KO bloque le
   push : on corrige le code, ou, si le changement de comportement est VOULU (étape de la
   roadmap validée), on inverse le scénario « ÉTAT ACTUEL » dans le même commit et on le
   dit. Une migration passe le filet AVANT d'être donnée à Yass pour Supabase (le filet
   rejoue toutes les migrations du dépôt). Détail : §15 quaterdecies.
8. **On ne lève pas le plafond de l'étape 21 avant que les campagnes aient un rythme**
   (règle de Yass, 05/10). Aujourd'hui, le plafond de 1 000 lignes limite une campagne à
   1 000 envois ; c'est lui qui protège la plateforme. Au banc, une campagne vers les
   16 230 appareils du réseau, sans plafond, coupe 68 scans sur 82 et bloque le serveur
   jusqu'à 37 s (§15 novodecies). Compte comme une levée : relever « Max rows » dans
   Supabase (réglage global, il vaut pour toutes les lectures) ; ou lire en plusieurs pages
   les destinataires d'une campagne (`notifications.js`). Ces deux gestes attendent le
   chantier « rythme d'envoi des campagnes » (§15 vicies). Paginer une autre lecture, par
   exemple la liste des clients du dashboard, ne lève pas le plafond des campagnes.

---

*Rédigé le 2026-07-13, en fin de session, par la session Claude Code qui a livré : i18n
FR/EN complète, backup code, historique scanner, mode points (fondation → report du
surplus), résolution de l'incident RPC, re-sync Google Wallet, et les 4 correctifs de
l'audit #3. Dernier commit : `37ecc63`.*

*Mis à jour le 2026-07-13 par la session suivante : fix du parrainage (un crédit par
filleul à vie — migration_024 + ticket avant crédit dans scan.js), réconciliation
repo↔prod (migration_025), pièges §3.9 (supabase-js ne rejette jamais) et §3.10
(photographier la base), arbitrages fondateur consignés en dette #4, #9, #10.*

*Mis à jour ~2026-07-2x par la session suivante : incident push APNs zombie corrigé
(§2 item [7], timeout+retry `apns.js`) ; SW scanner passé en network-first (fin du
bundle figé) ; icône sneaker + couleurs manuelles des pastilles (§2 [8], migration_026) ;
placeholder tél i18n (§2 [9]) ; workflow anniversaire (§2 [10], migration_027) ;
confirmation scanner avant écriture + historique renforcé (§2 [11]). Nouvelles dettes
consignées : #12 fiabilité notifs à l'échelle (410-cleanup/observabilité/churn, à mesurer
d'abord), #13 anti-rafale push (parké), #14 couleur du label strip (demandé, non fait).
LIFO/annulation caissier explicitement écartée (rattrapage sur dashboard). Dernier
commit : `25cd3cf`.*

---
---

# PARTIE II — CHANTIER FRANCHISE / MULTI-BOUTIQUES (migrations 028→039)

*Cette partie couvre tout ce qui a été livré après le commit `25cd3cf` : les
corrections de grants, le chantier multi-boutiques (5 étapes), l'annulation de
scan, et la dette à jour. La Partie I ci-dessus reste valable — pièges §3,
zones dangereuses §5, contrat §7 s'appliquent toujours.*

## 8. LES MIGRATIONS 028 → 039

| # | Objet | Note |
|---|---|---|
| 028 | `GRANT … workflow_executions TO service_role` | La dédup workflows ne marchait pas (table sans grant DML → inserts muets). **Leçon clé : toute table créée par migration doit recevoir son GRANT service_role explicite** (seul migration_006 l'avait). |
| 029 | `couleur_label_strip` | Résout la dette #14 (couleur manuelle du label « LOYALTY CARD »). |
| 030 | `GRANT … referral_credits TO service_role` | Même bug que 028 : le parrain n'était jamais crédité (ticket insert muet). |
| 031 | `scans.montant_credite` + `recompense_distribuee` | Colonnes de mesure, remplies **côté JS** (scan.js), RPC non touchée. |
| 032 | Table `points_de_vente` | Boutiques enfants du marchand. Soft-delete `deleted_at`, nom unique insensible casse sur actives. |
| 033 | `scans.point_de_vente_id` (FK **ON DELETE RESTRICT**) + `points_de_vente.actif` + `scanner_login`/`scanner_password_hash` | FK RESTRICT (jamais CASCADE) protège l'historique. |
| 034 | Index partiel `(marchand_id) WHERE deleted_at IS NULL AND scanner_login IS NOT NULL` | Soutient le durcissement du token marchand au scan. |
| 035 | `marchands.freq_seuil_bas`/`freq_seuil_haut` (déf. 5/10, CHECK bas≤haut) | Seuils de distribution de fréquence, réglables admin. |
| 036 | **Fonction `group_stats(uuid) RETURNS jsonb`** | Agrégation dashboard groupe, LECTURE SEULE. |
| 037 | Index composite `scans(marchand_id, date_scan)` | group_stats lit la tranche 90 j sans parcourir tout l'historique. |
| 038 | `scans.annule_le` + **fonction `annuler_scan(uuid,uuid) RETURNS jsonb`** | Annulation atomique du dernier scan d'un client. |
| 039 | `group_stats` re-CREATE OR REPLACE + filtre `annule_le IS NULL` | Exclut les scans annulés de tous les indicateurs réseau. |
| 040 | CHECK `strip_mode` élargi à `points_bar` | Auto-adaptative : retire par introspection toute contrainte CHECK portant sur strip_mode, quel que soit son nom. Garde-fou : exception si une valeur inattendue existe. |
| 041 | `couleur_barre_principale` / `couleur_barre_secondaire` | Deux réglages seulement. |
| 042 | Table `diagnostics_camera` + index (étiquette, date) | Instrument de terrain, un lien par PDV. |
| 043 | CHECK `strip_theme` élargi à `illustration` ; colonnes `strip_illustration`, `strip_produit`, `strip_vide` | Même patron d'introspection que la 040. |
| 044 | **Fonction `admin_marchands_stats() RETURNS jsonb`** | Même motif que `group_stats` (§12). |
| 045 | `marchands.token_version` (int NOT NULL DEFAULT 1) | Révocation des jetons marchand. DEFAULT 1 = aucune reconnexion forcée (§18). |
| 046 | Table `notification_envois` + 5 index + GRANT | Registre des envois de notification, toutes surfaces. Rétention 90 j via la purge du cron. |
| 047 | `marchands.lien_avis_google` + CHECK du registre élargi à `'avis'` + table `avis_clics` | Chantier avis Google (§15 sexies). |
| 048 | Consignation de ce qui vivait en production hors dépôt : droits `service_role` sur 7 tables, RLS sur 4 tables, `rls_auto_enable()` + déclencheur `ensure_rls` | Étape 9 (§15 octies). **Sans effet en production** (chaque bloc n'agit que si l'élément manque) ; indispensable à toute base rejouée depuis le dépôt. |
| 049 | Table `cron_passages` + index + RLS + GRANT (SELECT, INSERT, UPDATE ; séquence) | Suivi du passage quotidien du cron, lu par `/health/cron` (§15 nonies). Une ligne par jour, pas de purge. |
| 050 | `EXECUTE` des fonctions de `public` réservé à `service_role` (existantes et futures) | Étape 7, point 5 (§15 undecies). **NON EXÉCUTÉE, NON POSÉE (décision de Yass, 01/10)** : fichier sur la branche `relecture/etape7-points-5-10` seulement. **Numéro réservé : la prochaine migration de production est la 051.** |
| 051 | `scans.cle_idempotence` + index unique `(marchand_id, clé)` ; **fonction `crediter_scan(uuid, uuid, uuid, integer, integer, text, uuid, text, text, text) RETURNS jsonb`** ; CHECK `clients.stored_value >= 0` et `marchands.max_value > 0` | Étape 11a, le crédit incassable (§15 quindecies) : crédit, ligne et carte en une transaction ; appelle `increment_stored_value` telle quelle. Fermée à `anon`/`authenticated`. Additive : l'ancien code marche avec. |
| 052 | Table `ajustements` (journal, RLS, GRANT service_role) ; **fonctions `ajuster_solde(uuid, uuid, integer, integer)` et `annuler_ajustement(uuid, uuid)` RETURNS jsonb** ; `annuler_scan` re-CREATE OR REPLACE (même signature) avec la règle de l'ordre inverse | Étape 13b (§15 septdecies). Ajustements hors des scans (ce ne sont pas des visites). Additive : le code 13a (`424d3e8`) passe 139/139 sur une base qui la porte. **Exécutée par Yass le 04/10, AVANT le push de 13b** : contrôle 6 × `true`, écarts IDENTIQUE (0 écart · 48 plateforme). |
| 053 | **`credit_referral(uuid, integer)` re-CREATE OR REPLACE** (même signature, même retour, droits inchangés), `SET search_path = public` | Étape 14b (§15 octodecies) : jamais de baisse ; plafond au seuil en tampons, bonus entier en points ; verrou du parrain seul (`FOR UPDATE OF c`). Le code en place marche avec (même appel). **Exécutée par Yass le 04/10, AVANT le push de 14b** : vérification `true | true | true`, contrôle 4 × `true`, écarts IDENTIQUE (0 écart · 48 plateforme). |

## 9. LE MODÈLE MULTI-BOUTIQUES

**Invariant central (argument de vente) :** un réseau = **UN SEUL `marchand`**. Les
`points_de_vente` sont ses **enfants purement analytiques**. Le solde
(`clients.stored_value`) reste **unique et partagé** sur tout le réseau — jamais
fragmenté par boutique. Une boutique « produit de l'activité », elle ne « possède »
aucun client.

**Deux leviers distincts, à ne jamais confondre :**
- **`points_de_vente.actif`** = COUPURE de l'accès scanner. Levier du **franchiseur**
  (dashboard, `PATCH /me/points-de-vente/:id/actif`), **réversible**, **neutre pour la
  facturation**. Effet immédiat (relu au scan).
- **`points_de_vente.deleted_at`** = ARCHIVAGE. Levier de l'**admin**, retire de la
  **facturation** + gestion, **conserve l'historique**.
- Le scan bloque si `actif = false` **OU** `deleted_at IS NOT NULL`.

**Facturation :** le nombre de **boutiques actives** par marchand est la base facturée
→ **création et archivage réservés à l'admin** ; le franchiseur ne fait que lister +
renommer + couper/rétablir.

## 10. AUTH SCANNER PAR BOUTIQUE (le lot le plus sensible)

- **Rôles JWT** : `marchand`, `admin`, `scanner` (les trois existent dans `auth.js`).
- **Login unifié** `POST /api/scanner/login` (`scanner-auth.js`, rate-limité) : essaie
  d'abord un **login boutique** (`scanner_login`, match `.eq(lower())`, **jamais ilike**),
  puis retombe sur le **login marchand** (mono-site). `authScanner` pose `req.marchandId`,
  `req.scannerRole`, `req.pointDeVenteId`.
- **Durcissement** : dès qu'un marchand a **≥1 boutique provisionnée** (login posé, non
  archivée), le **token marchand est refusé au scan** (`use_boutique_login`). Garantit
  qu'un mot de passe marchand ayant pu circuler n'est pas une porte d'entrée sur un réseau.
  **Zéro fenêtre morte** : le blocage n'est conditionné qu'à l'existence d'un login
  boutique utilisable (la création de boutique pose les identifiants dans la foulée).
- **Coupure immédiate** : le scan **relit `actif`/`deleted_at` EN BASE à chaque passage**
  (`scan.js`, avant toute écriture), **jamais depuis le JWT** → couper une boutique bloque
  le scan suivant, sans attendre l'expiration du token 1 an.
- **Provisioning** : `PATCH /api/admin/points-de-vente/:id/scanner` (admin) pose
  login + mot de passe (hash via `hashPassword`, **jamais renvoyé**, login stocké en
  minuscules). Une boutique = un login (partagé par les tablettes du comptoir).
- **Mono-site : byte-identique** — pas de boutique → token marchand, scan `point_de_vente_id`
  NULL, comportement d'origine.

## 11. ATTRIBUTION + COLONNES DE MESURE DU SCAN

Écrites **côté JS** dans `scan.js` à l'insertion (RPC `increment_stored_value` **non
touchée**) :
- **`montant_credite`** : points/tampons réellement ajoutés, jamais négatif. `amount`
  sur un scan normal/gagnant ; **0** sur une redemption tampons ; `amount` sur une
  redemption points. (Résout le `après−avant` négatif des resets.)
- **`recompense_distribuee`** : `TRUE` sur le scan de **redemption** (`is_reset`) — la
  boutique qui **remet** le cadeau (≠ « débloquée »/franchissement de seuil).
- **`point_de_vente_id`** : boutique du token scanner (NULL pour un token marchand).

## 12. DASHBOARD GROUPE (`group_stats`)

- `GET /me/group-stats` (`merchants.js`) → **fonction SQL `group_stats(uuid)`** qui fait
  le `GROUP BY` côté Postgres et renvoie un jsonb. **Pourquoi une fonction et pas du JS :**
  PostgREST tronque toute lecture de lignes à **1 000** → une agrégation JS fausserait
  silencieusement un réseau. La fonction agrège en base (immunisée).
- **Troisième et quatrième instances du plafond 1 000, découvertes le 21/09 :** `admin.js`
  (`GET /marchands`) comptait en JS — corrigé par la migration 044. `cron.js:44` (scans 30 j
  par marchand) porte le même motif, **non corrigé**.
- **Le comptage JS n'est pas seulement sous-estimé, il est INSTABLE** :
  `increment_stored_value` fait `UPDATE clients SET stored_value`, ce qui déplace
  physiquement la ligne. Sans `ORDER BY`, l'ensemble des « 1 000 premières lignes » change à
  chaque scan. Constaté : un marchand passé de 0 à 6 en trois jours pour 44 porteurs réels.
- **Bloc réseau** (jamais ventilé) : porteurs, actifs 30 j, nouveaux ce mois, taux de
  retour (ce mois ∩ mois précédent), mobilité (>1 boutique / 90 j).
- **Bloc boutiques** (une ligne, archivées incluses SI activité récente) : scans, clients
  distincts, récompenses distribuées, **évolution % vs mois précédent** (tiret si mois
  précédent = 0), triable, tri défaut scans desc.
- **Compteur de scans non attribués** (token marchand sur un réseau = tablette non enrôlée).
- **Distribution de fréquence** : 3 tranches selon `freq_seuil_bas`/`haut`, barre HTML/CSS
  (aucune bibliothèque). Onglet « Réseau » **visible seulement si ≥1 boutique** (mono-site
  intact).
- **RÈGLE :** ne **jamais** netter `montant_credite` et `recompense_distribuee` en un seul
  chiffre (ce serait la balance inter-boutiques, hors périmètre volontaire).

## 13. ANNULATION DU DERNIER SCAN (étape 5)

- **`POST /api/scan/:id/annuler`** (authScanner) → **fonction `annuler_scan(uuid,uuid)`**.
  Cible le scan actif **le plus récent DU CLIENT** (pas de la boutique — le solde est par
  client). **Répétable** (déroule plusieurs scans). Restaure `stored_value` à
  `stored_value_avant`, marque `annule_le`. **Verrou par carte** (`FOR UPDATE`), atomique.
- **3 garde-fous serveur** (refus 409, rien modifié) : pas le dernier actif du client
  (`pas_le_dernier`), solde ≠ `apres` (`solde_incoherent`), déjà annulé / autre boutique.
- **Resync du pass** après coup (réutilise `syncPassAfterAdjustment` de `clients.js`,
  exporté).
- **Principe qui réduit le risque :** l'annulation **restaure le solde**, donc tout ce
  qui **dérive du solde** (pass, near_reward, points fiche client) est **auto-corrigé,
  sans filtre**. Seul ce qui **compte des scans** doit filtrer `annule_le IS NULL`.
- **Surfaces de comptage filtrées** (inventaire validé, ne pas en oublier) : `group_stats`
  (via 039, un seul point), `/me/stats` ×2 (`merchants.js`), admin `/marchands` +
  `/stats` (`admin.js`). **Affichage marqué (pas filtré)** : historique scanner + onglet
  Scans + fiche client. **Workflow inactifs (`cron.js`) : PAS de filtre** — un scan annulé
  reste une **visite physique** (arbitrage fondateur : ne pas relancer « tu nous manques »
  quelqu'un qui était là).

## 14. NOUVELLES ZONES DANGEREUSES (compléter §5)

- 🔴 **`annuler_scan`** — écrit le solde (l'argent). **Signature unique et définitive**
  `(uuid, uuid)`, `FOR UPDATE` par carte, **ne touche PAS `increment_stored_value`**.
  Même discipline §3.3 que le RPC de scan.
- 🔴 **`group_stats`** — **signature unique** `(uuid) RETURNS jsonb`. Toute métrique future
  vit **dans le json**, jamais dans la signature (évite le piège juillet). Toujours
  `CREATE OR REPLACE`, jamais une variante de longueur.
- 🟠 **Le chemin chaud du scan** (`scan.js`) fait désormais, avant écriture : relecture
  boutique (token scanner) OU test de durcissement (token marchand, index partiel 034).
  Un `const { data } = …` sans lire `error` y interpréterait une panne DB comme « boutique
  coupée » (§3.9) — connu, faible probabilité.

## 15. LES DEUX INCOHÉRENCES GOOGLE HERO (image de palier)

`images_tiers` (JSON `{min,max,url}` par palier de solde) alimente **les deux wallets**,
image **poussée brute** (aucun redim./crop serveur ; aspects Apple ~3.05:1 et Google
~3.07:1 compatibles ; seule la résolution diffère). MAIS Google a **deux chemins
divergents** :
1. **À la création** de l'objet (`googleHeroUrl`, `google-pass.js:60`) : `google_hero_url`
   → strip généré → `image_strip_url`. **`images_tiers` ignoré** → une image de palier
   n'apparaît sur Google **qu'après le premier scan** (mise à jour).
2. **À la mise à jour** (`google-pass.js:380`) : `images_tiers` → `image_strip_url` →
   strip généré. **`google_hero_url` ignoré** → si le marchand règle les deux, le hero
   Google **change après le 1er scan**.
Côté Apple (`apple-pass.js:429`) la précédence est cohérente à chaque génération :
`images_tiers → image_strip_url → strip généré → uni`. Les champs strip Apple/Google
**coexistent en chaîne de repli** (ne s'excluent pas) : `image_strip_url` = repli
universel, `google_hero_url` = override Google, `images_tiers` court-circuite le reste
là où il est consulté. **Statut : dette cosmétique documentée, non corrigée.**

## 15 bis. THÈME DE STRIP « ILLUSTRATION »

Registre `src/services/illustrations/` — **frozen, append-only : une clé ne se renomme ni ne
se supprime jamais** (les clés sont stockées en base, `marchands.strip_illustration`).
`obtenir()` ne substitue JAMAIS ; clé inconnue → `console.error` + tous les passages rendus
en état restant, plus bandeau rouge dans l'admin. C'est la leçon de l'icône Phosphor
renommée en juillet, dont le repli silencieux était invisible.

`strip_custom_background_url` est **IGNORÉ** en thème illustration (volontaire : un fond
photographique sous onze dessins multicolores est illisible). Mode points : thème ignoré.
État doré : fond = `couleur_fond`, **jamais** `couleur_fond_reward` — l'effet doré vient des
illustrations allumées, pas d'un fond jaune.

Police Poppins ; si `@fontsource/poppins` manque au boot, resvg retombe sur DM Sans. La
table d'avances `AVANCES_POPPINS` (relevée par rastérisation) réserve 30 px pour ce cas,
sans quoi un produit de 24 caractères déborde la zone sûre.

## 15 ter. AUTORISATION MARCHAND (chantier P0 sécurité)

Avant ce chantier, `authMarchand` ne consultait **rien** en base : ni `actif`, ni
le mot de passe. Aucune des 14 routes qu'il protège ne vérifiait `actif` non plus,
dont 5 qui écrivent. Un jeton marchand était irrévocable pendant toute sa durée de
vie — 365 jours depuis `4e63731`.

**Deux leviers, un seul cache.** `src/services/marchand-cache.js` lit `actif` ET
`token_version` en une requête, TTL 60 s par `marchand_id`, anti-stampede. Le cas
(b) ne coûte donc **aucune requête de plus** que le cas (a). Mesuré : 20 appels
consécutifs = 1 lecture base, 19 servies par le cache.

- **`actif` → 403 `account_suspended`** : suspension du compte.
- **`token_version` → 403 `session_revoked`** : tablette perdue ou volée chez un
  marchand qui reste ACTIF. Bouton admin « Déconnecter les appareils »
  (`POST /marchands/:id/revoquer-sessions`). Coupe le dashboard **et** les
  caisses — les jetons boutique portent le même `marchand_id`.

**LE TTL N'EST PAS LE DÉLAI DE COUPURE.** Les deux chemins admin (suspension,
révocation) appellent `invalider()` → effet immédiat. Le TTL ne couvre que les
changements faits ailleurs (SQL brut), où la coupure prend au plus une minute.

**AUCUNE RECONNEXION FORCÉE, règle absolue du chantier.** Un jeton émis avant le
déploiement ne porte pas de champ `tv` ; `payload.tv ?? 1` le fait valoir 1, et la
migration met `token_version` à 1 partout. Ne jamais changer ce DEFAULT, ne jamais
traiter un `tv` absent comme invalide : ce serait déconnecter tout le parc.

**COMPORTEMENT EN PANNE DE LECTURE — décision fondateur.** Si Supabase répond une
erreur, on **ne refuse pas** : on sert la dernière valeur connue même périmée, à
défaut on laisse passer en journalisant. Refuser arrêterait TOUTES les caisses de
TOUS les marchands pendant l'incident. Une ligne ABSENTE (marchand supprimé) est
une réponse valide, pas une panne, et vaut refus.

**Non traité, écarté en pilotage :** le cas (c) — la caisse mono-site tourne
toujours avec un jeton `role: 'marchand'` (`scanner-auth.js:97`), identique à celui
du dashboard, donc porteuse des 14 routes.

**HYPOTHÈSES DU CORRECTIF — ce qui le ferait casser.**

1. **Une seule instance.** Le cache vit en mémoire du processus Node. Avec
   plusieurs instances Railway, `invalider()` ne touche QUE l'instance qui a reçu
   l'appel admin : les autres continuent de servir leur copie jusqu'à expiration,
   donc la suspension et la révocation y prennent **jusqu'à 60 s**. C'est
   acceptable aujourd'hui (instance unique) et ça ne l'est plus le jour d'un
   passage multi-instance — **à revoir à ce moment-là**, pas avant. Pistes :
   invalidation par canal partagé (Postgres `LISTEN/NOTIFY`, Redis) ou TTL réduit.
2. **`token_version` révoque TOUT ce qui porte l'identité du marchand** —
   dashboard et caisses ensemble, sans distinction. C'est voulu pour le cas
   « tablette perdue », mais ça en fait un instrument **grossier** : on ne peut
   pas couper un seul appareil. Corollaire dimensionnant pour la roadmap : les
   futures intégrations API (borne, caisse, e-commerce) doivent avoir **leurs
   propres clés et leur propre révocation**, jamais un jeton marchand — sinon
   révoquer une tablette volée couperait aussi le site e-commerce de la cliente.
   Pour couper une seule boutique, le levier existe déjà : `points_de_vente.actif`.

## 15 quater. DIAGNOSTIC SMART NOTIFS (phase 1, 2026-09-25)

Déclencheur terrain : un porteur a reçu la relance inactif de 5 marchands **au même
instant**. Diagnostic mené sur le code seul — aucun accès base depuis le conteneur,
aucune requête exécutée. Les requêtes de vérification sont dans le fil de pilotage.

**POURQUOI TOUT ARRIVE ENSEMBLE — trois causes qui se composent.**
1. **Un seul cron global**, `0 8 * * *` UTC (`cron.js:9`), pour les 48 marchands.
   Aucun étalement, aucun fuseau marchand (la colonne n'existe pas).
2. **Le push APNs vise un TOKEN, pas un pass** (`apns.js:98` :
   `/3/device/${pushToken}`, topic `pass.com.winwincard.loyalty`). Tous les marchands
   partagent le Pass Type ID → un token couvre tous les pass d'un appareil.
3. **Le filtre de « passes updated since » est inerte** (`apple-wallet.js:90`) :
   `.gt('passes.updated_at', …)` porte sur une ressource EMBARQUÉE. Sans `!inner`,
   PostgREST ne supprime pas la ligne parente, il vide l'embed → l'endpoint renvoie
   **tous** les serials de l'appareil. **Hypothèse forte, non vérifiée en production**
   (test : `curl …?passesUpdatedSince=2030-01-01T00:00:00Z`, doit renvoyer 204).

Le champ `notification_txt` porte `changeMessage: '%@'` (`apple-pass.js:356-360`) :
chaque pass re-téléchargé dont ce champ a changé déclenche une notification iOS.

**ÉTAT PAR WORKFLOW.**
- `inactive`, `near_reward` : partent, mais **tronquables** — `grep -c "order(\|range("`
  sur `cron.js` = **0**. `cron.js:44` (scans 30 j) est le pire cas : tronquée, des
  clients actifs sont classés inactifs et **relancés à tort**. `cron.js:46` tronquée
  ferait sauter la déduplication.
- `birthday` : **ne peut rien envoyer**. Exige `date_anniversaire IS NOT NULL`
  (`cron.js:174`) ; le champ de la landing est masqué en V1 (`landing.html:513-517`,
  classe `field-v2`).
- `purge` : lit `count` mais pas `error` (`cron.js:233`) — silencieuse en cas d'échec.

**CE QUI N'EST PAS MESURABLE.** Le cron n'écrit **rien** dans `notification_logs` :
les envois de workflow ne laissent que des `console.log` Railway, éphémères. Les
statuts APNs sont lus (`apns.js:127`) et journalisés, jamais stockés.

**410 NON TRAITÉ.** Aucune occurrence de `410` / `Unregistered` / `BadDeviceToken`
dans `src/`. Un token mort est re-poussé indéfiniment et gonfle `total_apple`, ce qui
rend le taux d'envoi du dashboard ininterprétable. Côté Google, **aucun callback**
save/delete : on met à jour des objets dont on ignore l'état.

**`.catch()` MORT CONFIRMÉ** (§3.9) : `notifications.js:137`, `.then().catch()` sur un
insert Supabase — un échec d'écriture de `notification_logs` est silencieux. Les trois
autres occurrences portent sur `supabase.storage`, qui rejette bien : légitimes.

**Rappel** : `workflow_executions` n'a reçu son GRANT qu'en migration **028** ; avant,
la table restait vide et la déduplication ne fonctionnait pas. Toute lecture
d'historique antérieure à 028 est sans valeur.

## 15 quinquies. REGISTRE DES ENVOIS (smart notifs, phase 2)

Répond à une seule question : **quelles notifications partent, lesquelles Apple et
Google acceptent ou refusent**. Aucun changement de comportement visible.

**DIX SURFACES D'ENVOI, recensement complet.** La phase 1 n'en avait vu que sept.
Trois manquaient, toutes confirmées par `grep` sur les appels APNs et Google :

| Source | Où | Manquée en phase 1 ? |
|---|---|---|
| `inactive`, `near_reward`, `birthday` | `cron.js` | non |
| `manuel` | `notifications.js` | non |
| `scan` | `scan.js:220`, `scan.js:242` | non |
| `welcome` | `apple-wallet.js:172` | non |
| `ajustement` | `clients.js:232` → `syncPassAfterAdjustment` | **OUI** |
| `annulation` | `scan.js:390` → `syncPassAfterAdjustment` | **OUI** |
| parrainage | `scan.js:324` → `notifierMiseAJourPass` | **OUI** (rattaché à `scan`) |

Le workflow **anniversaire fonctionne** : il s'active avec la landing premium, où le
champ date de naissance est visible. La phase 1 n'avait lu que la landing standard.
**Correction d'un constat erroné de l'audit `docs/audit/01-notifications.md` §4.**

**RÈGLE ABSOLUE : le registre ne bloque ni ne retarde jamais un envoi.** Deux
garanties dans `notif-registre.js` : l'écriture a TOUJOURS lieu après l'envoi, et
`Lot.ecrire()` comme `enregistrer()` **ne rejettent jamais** — elles journalisent.
Un registre en panne laisse la plateforme envoyer normalement.

**ÉCRITURES GROUPÉES.** Un insert par lot, jamais un par push. Flush **par
marchand** dans le cron, et non en fin de workflow : si le cron meurt en route on ne
perd que le marchand en cours. Découpe à 500 lignes par insert.
Écritures ajoutées par passage de cron : **0 avant → au plus 3 × (marchands Pro+
ayant au moins un envoi)** après. Un marchand sans envoi n'écrit rien.

**PAS DE JETON EN CLAIR.** `token_hash` = `md5(push_token)`. md5 est **natif
Postgres** (digest() exigerait pgcrypto) et sert de clé de corrélation, pas de
primitive de sécurité. Jointure : `md5(dt.push_token) = e.token_hash`.

**`statut` NULL ≠ refus.** NULL veut dire « aucune réponse obtenue » (coupure,
timeout, session morte). Distinguer les deux est tout l'intérêt du registre.

**LES 410 SONT NOTÉS, RIEN N'EST SUPPRIMÉ.** Aucune logique d'effacement de
`device_tokens` — décision de pilotage, hors périmètre de ce lot.

**ÉCRITURES MUETTES CORRIGÉES** (§3.9) : `.then().catch()` mort sur l'insert de
`notification_logs` (`notifications.js`), les trois inserts de déduplication du cron,
et la purge qui ne lisait pas son `error`.

**EFFET DE BORD NEUTRALISÉ.** `updateLoyaltyObjectPoints` (`google-pass.js`) ne
lisait pas le statut du PATCH : un refus Google passait inaperçu. Il lève désormais.
Dans `scan.js`, l'appel est maintenant enveloppé d'un `catch` — sans quoi
l'exception sauterait l'`addMessage` qui suit et le message Android ne partirait
plus, ce qui aurait été un changement de comportement visible.

**HYPOTHÈSES — ce qui ferait casser ce lot.**
1. **Appariement par index** dans `notifications.js` : `Promise.allSettled` préserve
   l'ordre des entrées, donc `appleResults[i]` correspond à `tokens[i]`. Si un jour
   les envois étaient filtrés ou réordonnés avant `allSettled`, les lignes du
   registre seraient attribuées au mauvais jeton — **sans erreur visible**.
2. **Le CHECK sur `source` fige les huit valeurs.** Toute surface d'envoi ajoutée
   plus tard DOIT être ajoutée au CHECK, sinon son insert échoue — silencieusement
   du point de vue de l'envoi, qui partira quand même.
3. **Crash du cron** : un lot accumulé mais non écrit est perdu. Borné à un marchand.
4. **Le registre mesure la RÉPONSE d'Apple, pas l'affichage.** Un 200 ne prouve pas
   qu'une notification s'est affichée sur l'écran du porteur — non obtenable.

**HORS PÉRIMÈTRE, décidé en pilotage** : purge des jetons morts, statut joignable sur
la fiche client, troncature du cron (chantier P1), filtre « passes updated since »,
un push par jeton, étalement/fuseau marchand, callbacks Google, logique de
l'anniversaire.

**LES TROIS PREUVES EXIGÉES EN REVUE (2026-09-25).** Trois risques avaient été
soulevés en pilotage. Aucun n'a nécessité de correction de code — mais deux
reposaient sur des affirmations non étayées de ma livraison. Les preuves sont
consignées ici pour que la question ne se repose pas.

**1. Rétention 90 jours — implémentée, dans `purgeOldExecutions` (`cron.js`).**
Même passage de cron et même `PURGE_DAYS = 90` que `workflow_executions`, aucun
nouveau planificateur. La purge **lit désormais son `error`** : l'ancienne ne le
faisait pas, et un `GRANT DELETE` manquant aurait fait grossir la table sans fin,
en silence. Le GRANT de la migration 046 inclut bien `DELETE`. Vérifié sur
PostgreSQL 16 : une ligne à 91 jours est supprimée, les autres restent.

**2. Panne Google totale — les QUATRE chemins tiennent.** Le risque : rendre
`updateLoyaltyObjectPoints` capable de lever exposait `scan`, mais aussi
`ajustement`, `annulation` et `parrainage`. Testé avec Google renvoyant 503 sur
**toute** écriture d'objet — 9 assertions, 0 échec :

| Chemin | Protection dans la fonction | Protection au site d'appel |
|---|---|---|
| scan | `catch` sur l'update (`scan.js`) | `.catch()` + fire-and-forget |
| ajustement | `catch` (`clients.js`) | `.catch()`, `res.json` indépendant |
| annulation | même fonction, même `catch` | `.catch()` + fire-and-forget |
| parrainage | via `mettreAJourGoogleWallet`, déjà protégé | `.catch()` |

Constaté sous panne : la fonction **ne lève pas**, l'`addMessage` est tenté
**malgré** l'échec de l'update, le registre est écrit quand même, les deux lignes
Google portent le 503 et la ligne Apple reste un succès. Un incident Google ne peut
donc pas faire échouer une annulation ni un ajustement côté marchand.

**3. Latence du scan — mesurée.** « L'envoi n'est jamais bloqué » ne disait rien de
la réponse à la caisse. Séquence réelle de `scan.js` horodatée :

```
   0ms  scan : écriture en base terminée
   0ms  >>> res.json() — LA CAISSE A SA RÉPONSE
 121ms  APNs répondu
 161ms  REGISTRE écrit
```

Les appels sont lancés **sans `await`** avant `res.json()`, et aucun `await` ne
s'intercale. Le registre s'ajoute à une chaîne qui tourne déjà en arrière-plan
**après** la réponse. La caisse n'attend rien.

**ÉTAT FINAL DU CHANTIER (clôturé le 2026-09-25).**

Registre déployé le **25/09** (commit `4b2d3f5`, migration 046 exécutée avant le
push). **Dix surfaces tracées.** Envoi manuel **vérifié en production** : deux
lignes, Apple et Google, statut 200, même horodatage à la microseconde — donc bien
un insert unique.

Reste **une requête de contrôle du premier passage de cron**, à lancer le 26/09
après 08:00 UTC. Le cron n'avait pas encore tourné au moment de la clôture (déployé
à 17:14 UTC, prochain passage le lendemain).

**LIMITE — `serial_number` absent sur les lignes Apple de l'envoi manuel.**
`notifications.js` ne sélectionne que `push_token` (la requête est scopée au
marchand, le serial n'y est pas chargé) ; les lignes Google, elles, portent le
serial. Conséquence : sur un envoi manuel, une ligne Apple dit **quel appareil** a
été poussé, pas **quelle carte**. Le lien se reconstitue par
`md5(dt.push_token) = e.token_hash`, **mais il est définitivement perdu si la carte
est supprimée** (la ligne `device_tokens` part en cascade). Correction non retenue
en pilotage : une ligne dans le `select`, à faire si le besoin apparaît.

**PIÈGE DE LECTURE, constaté à la recette.** Un envoi manuel est scopé
`.eq('marchand_id', req.marchandId)` sur `device_tokens` ET sur `passes` : il ne
touche QUE les porteurs de ce marchand. Un testeur détenant N cartes chez N
marchands ne verra donc qu'**une** ligne Apple, pas N. Ne pas confondre le parc de
l'appareil avec la portée d'une campagne.

**MIS EN PARKING CÔTÉ PILOTAGE** — connus, non traités, aucune date :
filtre « passes updated since » (§12) et un push par jeton ; suppression des jetons
morts (410) ; callbacks Google Wallet (save/delete) ; statut joignable sur la fiche
client.

## 15 sexies. AVIS GOOGLE + OUVERTURE DES WORKFLOWS AU PRO (2026-09-25)

Deux chantiers livrés ensemble, une seule migration : **047**.

### A. Ouverture des workflows automatiques au forfait Pro

Les trois workflows du cron étaient filtrés `.eq('forfait','pro_plus')`
(`cron.js` lignes 28, 89, 158). Ils lisent maintenant une constante unique,
`FORFAITS_WORKFLOWS = ['pro','pro_plus']` — **`basic` reste exclu**.

**Rien ne s'allume tout seul.** Les interrupteurs par marchand
(`workflow_*_enabled`) restent le seul déclencheur réel : les 15 Pro les ont tous
à `false` (vérifié en SQL côté pilotage avant le chantier), donc le déploiement
n'envoie strictement rien. Il rend seulement ces cases **opérantes**.

**Corollaire front, indispensable :** la section « Workflows automatiques » de
l'admin était conditionnée à `pro_plus`. Sans elle, un Pro n'aurait eu aucune
case à cocher et l'ouverture serait restée théorique. Elle s'affiche désormais
pour `pro` et `pro_plus` ; la section **landing premium reste Pro+**.

**NO-OP ASSUMÉ — anniversaire chez un Pro.** `runBirthdayWorkflow` exige
`landing_premium = true` (seule surface où le client saisit sa date de
naissance), et `landing_premium` reste un droit Pro+. Un Pro peut donc cocher
« Message d'anniversaire » sans qu'il ne parte jamais rien : aucune date n'est
collectée. Le formulaire l'annonce déjà (bandeau orange sous la case). Ce n'est
pas un oubli, c'est la conséquence de ne pas avoir ouvert la landing premium.

### B. Demande d'avis Google

**Déclencheur : `is_reset`**, c'est-à-dire la récompense **REMISE**, pas le
franchissement du seuil. Même signal dans les deux modes (tampons et points).
Un client qui atteint 10/10 ne reçoit rien ; il reçoit la demande d'avis au
passage suivant, celui où la boutique lui donne effectivement le cadeau.

**`marchands.lien_avis_google` est l'unique interrupteur.** Vide ou `NULL` → pas
de lien au dos de la carte ET pas de notification. Aucun booléen séparé : un
réglage de moins à désynchroniser. Saisi dans le formulaire admin (jamais en SQL
brut : classe Google), validé côté code — `http(s)` obligatoire, 500 caractères
maximum, valeur enregistrée après `trim`.

**Forme du lien recommandée**, à fabriquer à l'installation de chaque marchand :
`https://search.google.com/local/writereview?placeid=<Place ID>`. Elle ouvre
directement la fenêtre d'avis, sans passer par la fiche — c'est la forme validée
en réel le 26/09. Un lien de partage Google Maps fonctionne aussi mais fait
atterrir sur la fiche, avec un clic de plus.

Accepté **à la création comme à la
modification** : le formulaire affiche le champ dès la création, l'ignorer
côté `POST` aurait fait disparaître le lien sans message (c'est le piège que
`telephone` et `adresse` portent encore aujourd'hui — non corrigé ici, hors
périmètre).

**Chaîne complète :**

| Moment | Ce qui se passe | Requêtes ajoutées |
|---|---|---|
| Scan de remise | `avis.planifier()` après `res.json()` — arme un minuteur en mémoire | **0** |
| T+30 min | réécriture de `passes.notification_message`, relecture des jetons, push APNs, `addMessage` Google, une ligne de registre `source='avis'` | 1 update + 1 select + 1 insert |
| Clic sur le lien | résolution du marchand, `302`, puis insert dans `avis_clics` | 1 select + 1 insert |

Le « 0 requête au scan » est **mesuré**, pas supposé : le même scan chez un
marchand avec lien et sans lien produit le même nombre d'appels Supabase (8).
`lien_avis_google`, la langue et le prénom sont déjà en main — ils ont été
ajoutés aux listes `SELECT` existantes (règle §2[4]), pas relus.

**Pourquoi 30 minutes :** au moment du scan le client est encore en caisse.
Lui demander un avis devant le commerçant, c'est demander un avis de complaisance.

**Pourquoi relire les jetons à T+30 (option a, tranchée en pilotage) :** un
client qui désinstalle sa carte entre-temps n'est pas poussé sur un jeton mort,
et un appareil ajouté entre-temps la reçoit. Coût : une lecture par récompense.

**Le lien de la carte n'est pas celui du marchand.** Il pointe sur
`app.winwin-card.com/avis/<serial>`, qui redirige en 302 vers la page d'avis du
marchand. C'est la seule façon de mesurer un clic. Deux détails qui comptent :
- `Cache-Control: no-store` sur la redirection — sans lui, le téléphone met le
  302 en cache et les clics suivants partiraient chez Google sans repasser par
  nous. Le compteur sous-compterait **sans qu'on puisse le voir**.
- on redirige vers l'URL **revalidée**, jamais vers la valeur brute de la base :
  un lien sans schéma deviendrait une redirection relative sur notre domaine.

**Où vit le lien :** backField Apple `avis_google` (entre « How it works » et
« Refer a Friend ») et `linksModuleData` sur l'**OBJET** Google — jamais sur la
classe, puisque l'URL porte le serial de la carte. Posé aussi au PATCH, ce qui
donne le lien aux cartes déjà installées à leur prochaine mise à jour.
**`primaryFields` et `auxiliaryFields` n'ont pas été touchés** (chantier dédié).

**Texte (B3, tranché en pilotage) :** pas de suffixe, pas de case éphémère, pas
d'horodatage. L'avis écrit dans `notification_txt` comme tout le reste. Entre
deux récompenses il y a forcément des scans, qui écrivent chacun une valeur
différente dans ce champ ; la comparaison `old/new` d'iOS voit donc toujours un
changement.

### Limites connues, hors périmètre

1. **Le minuteur vit en mémoire d'une seule instance.** Un redémarrage Railway
   dans la fenêtre de 30 min perd les demandes en attente. La perte est
   silencieuse et ne produit **jamais de doublon**. Ce qui la rendrait fiable —
   une table de rendez-vous relue par le cron — coûte une table, un
   planificateur et des requêtes à chaque passage.
2. **Retirer le lien ne l'efface pas des objets Google déjà créés.** Côté Apple
   le champ disparaît à la mise à jour suivante ; côté Google il faudrait
   pousser `{ uris: [] }`, dont l'acceptation par l'API n'est **pas vérifiée**.
   Un PATCH refusé ferait échouer la mise à jour des points de **tous** les
   porteurs Android. Non vérifié = non envoyé.
3. **CONFIRMÉ le 26/09 — un message constant répété sans changement de valeur
   n'affiche rien sur iOS.** Cette règle avait été consignée le 25/09, puis
   rétrogradée en hypothèse parce que les données de terrain semblaient la
   contredire. **Le test l'a tranchée : elle est vraie.**

   *Protocole (Yass, iPhone, 26/09) :* deux campagnes manuelles au texte
   **identique**, à 5 minutes d'écart → **la seconde ne s'affiche pas**. Un
   texte **différent** juste après → **il s'affiche**. C'est bien la comparaison
   `old/new` de `changeMessage: '%@'` qui décide, rien d'autre.

   *Portée :* la relance inactif et l'anniversaire envoient un texte identique
   d'une fois sur l'autre. Entre deux envois consécutifs **sans rien pour changer
   la valeur entre-temps**, seul le premier s'affiche. Les 9 séquences de
   relances identiques consécutives relevées sur l'appareil `b1fa63b0…`
   (`docs/audit/A-scalabilite-anterieure.md` §1) sont donc, pour l'essentiel, des pushes
   acceptés par APNs et **jamais vus**.

   *Ce que ça ne change pas :* l'avis Google n'est pas concerné — le scan de
   remise écrit une valeur différente juste avant, la demande d'avis s'affiche.

   **Conséquence à retenir : un `200` au registre ne prouve pas qu'une
   notification a été vue.** Aucune mesure ne distingue « accepté » de
   « affiché », ni côté Apple ni côté Google.

4. **`serial_number` reste NULL sur la surface manuelle** (consigné au lot
   précédent). L'avis, lui, le renseigne.
5. **`avis_clics` n'est pas purgée** — indicateur commercial à regarder sur la
   durée, volume très faible, contrairement au registre d'envois (TTL 90 j).

### Plafond Google de 3 notifications / 24 h — CONFIRMÉ par la documentation

**CONFIRMÉ par la documentation officielle Google Wallet, NON OBSERVÉ en
production.** Maximum **3 notifications par carte et par 24 h**, pour les messages
`TEXT_AND_NOTIFY` **comme pour les notifications de mise à jour** ; au-delà,
`QuotaExceededException`.
<https://developers.google.com/wallet/retail/loyalty-cards/use-cases/trigger-push-notifications>

Le commentaire du dépôt (`google-pass.js:497`) disait donc vrai, mais rien ne
l'étayait : il est désormais rattaché à sa source. Ce qui reste non vérifié est
l'**effet réel** — aucune mesure en production ne montre un envoi écrêté, et le
registre des envois ne le montrerait pas (voir plus bas). Aucune parade n'est
codée, conformément au cadrage.

**Le quota est partagé avec les mises à jour, ce qui change l'arithmétique.** On
avait compté un envoi par `addMessageToLoyaltyObject`. Si nos PATCH d'objet
(`updateLoyaltyObjectPoints`) déclenchent une notification de mise à jour, un
seul scan en consomme **deux**, pas une. `buildLoyaltyClass` ne pose aucun
réglage de notification — reste à établir si le défaut Google en émet quand même.
À trancher dans le segment cartes (4) ou infrastructure (6).

**Si ce plafond existe, voici ce que l'avis peut rencontrer.** Six surfaces
appellent `addMessageToLoyaltyObject` : scan, avis, les trois workflows du cron,
la campagne manuelle, plus ajustement/annulation. Sur une journée de récompense :

| Ordre | Surface | Heure |
|---|---|---|
| 1 | scan de remise | en caisse |
| 2 | **avis** | +30 min |
| 3 | workflow du cron (anniversaire p. ex.) | 08:00 UTC suivant |
| 4 | campagne manuelle du marchand | au choix du marchand |

**L'avis arrive en 2ᵉ position, dans les 30 minutes qui suivent le scan.** Pour
qu'il soit lui-même écrêté, il faudrait trois envois Google dans les 24 h
*précédentes* — c'est-à-dire plusieurs scans le même jour, ou plusieurs
campagnes. Cas possible mais rare. Ce sont bien plus probablement les envois
**suivants** (cron de la nuit, campagne manuelle) qui seraient écrêtés par l'avis.

**Conséquence à surveiller :** ouvrir les workflows au Pro augmente le nombre
d'envois Google par carte. Si le plafond existe, les marchands qui allument tout
et envoient des campagnes manuelles verront des notifications Android
silencieusement perdues — **le registre les enregistrera en `200`**, exactement
comme la limite iOS ci-dessus. Aucune mesure ne distingue aujourd'hui « accepté »
de « affiché ». À instruire dans un chantier d'observabilité, pas ici.

### Migration 047 — ce qu'elle fait, dans cet ordre

1. `marchands.lien_avis_google text` + `CHECK` de longueur (≤ 500).
2. `CHECK` de `notification_envois.source` élargi à une **neuvième** valeur,
   `'avis'`. Même patron d'introspection que 040 et 043 : on ne présume jamais du
   nom de la contrainte. Garde-fou : une valeur inattendue fait échouer toute la
   transaction.
3. Table `avis_clics` + index `(marchand_id, clique_le DESC)` + RLS + `GRANT` sur
   la table **et sa séquence**.

Rejouable. Vérifiée sur PostgreSQL 16 local : les six colonnes de contrôle à
`true`, rejeu à blanc, garde-fou déclenché puis levé, retour arrière fourni.

### Déploiement et reste à faire

**Déployé le 26/09/2026** (25/09 22:08 UTC) sur `keen-goldberg-MXslu`, commit
**`ca0579a`**. Migration 047 exécutée par Yass AVANT le push, six colonnes de
contrôle à `true`. Photographie prise au même moment : 15 marchands Pro, **tous
interrupteurs éteints**, aucun lien d'avis configuré — le déploiement n'a donc
envoyé strictement rien, il a rendu ces réglages opérants.

**Recette passée le 26/09 — les deux tests sont VERTS.**

1. **Bout en bout sur Hamza Salon.** Notification reçue à **T+30 min**, registre
   conforme : une ligne `apple 200` et une ligne `google 200`, toutes deux en
   `source='avis'`. Le lien au dos de la carte ouvre bien la fenêtre d'avis
   Google. Le clic est enregistré dans `avis_clics` avec le bon marchand, le bon
   client et le bon serial. Toute la chaîne est donc vérifiée en réel : minuteur,
   relecture des jetons, double envoi, registre, lien, redirection, comptage.
2. **Règle iOS** — voir limite 3 ci-dessus : confirmée.

**Traité à la clôture :** l'anniversaire du Grand Buffet Indien (allumé sans
landing premium, donc inerte) a été éteint par Yass le 26/09.

**Suite ouverte par ce chantier :** la chronologie produite pour la vérification
annexe a mis au jour un défaut de fond — la relance et le boost ne s'arrêtent
jamais pour un client inactif. Constats chiffrés et pistes dans
`docs/audit/A-scalabilite-anterieure.md`, premier matériau du chantier scalabilité.

**La migration DOIT être passée avant le déploiement du code.** Sans elle, la
colonne n'existe pas (toutes les listes `SELECT` du pass échouent) et le registre
refuserait la source `'avis'` — la notification partirait sans laisser de trace,
le registre ne bloquant jamais un envoi (§15 quinquies).

## 15 septies. CLÉ SUPABASE : GARDE-FOU DE DÉPLOIEMENT PUIS BASCULE (2026-09-29)

Chantier ouvert par l'échéance n° 1 de l'audit (99 §6) : la clé historique
`service_role` (format `eyJ…`) sera supprimée par Supabase fin 2026 (date exacte non
annoncée). Roadmap : étape 1 (garde-fou) **livrée**, étape 2 (bascule) **faite par Yass
le 29/09 au soir**. **Clés historiques (`anon`, `service_role` au format `eyJ`)
DÉSACTIVÉES par Yass le 01/10 vers 08:15 UTC, vérifications OK** (voir B, état).

**Où vit la clé — une seule, côté serveur.** `SUPABASE_SERVICE_KEY` n'est lue que dans
`services/supabase.js:8-14` (client unique, 17 fichiers l'importent, base ET Storage).
Au boot, `index.js:10-15` et `supabase.js:3-5` ne vérifient que sa **présence**. Aucune
page web n'utilise de clé Supabase (ni `createClient`, ni clé dans `public/`) : la clé
publique (`anon` / `sb_publishable_`) ne sert nulle part. Les images passent par des
URL publiques du Storage, sans clé.

**Le code accepte `sb_secret_` sans modification.** Ni le code ni supabase-js 2.107.0
ne regardent le format : la valeur part telle quelle dans `apikey` et
`Authorization: Bearer` (`dist/index.cjs:932-933`), le Storage passe par le même
`fetch` (`:1277`). Le guide officiel Supabase « Migrating to publishable and secret API
keys » (étape 3) décrit exactement ce cas. Aucune fonction SQL ne lit les claims du jeton.
Réserve : la doc conseille d'envoyer les nouvelles clés dans `apikey` seulement ; le
test `curl` de l'étape 2 de la bascule (en-têtes identiques à supabase-js) tranche
avant de toucher la production.

### A. Le garde-fou `/health/db` (commit `c115e90`)

**Avant :** le healthcheck Railway visait `/health`, qui ne touche pas la base. Rejoué
contre une fausse base : clé fausse, clé publique, base muette, Supabase en 503… **6 cas
de panne sur 6 acceptés** — la version cassée remplaçait la version saine, et au
comptoir tout se lisait « carte introuvable ».

**Après :** `railway.toml` vise `/health/db`, qui lit une ligne de `marchands` et
**exige une ligne**. Railway n'active une version qu'après un 2xx ; sinon le déploiement
est marqué en échec et **l'ancienne version reste en ligne** (doc Railway,
`healthchecks.md`). Refusés : clé fausse ou révoquée (erreur), clé publique anon ou
`sb_publishable_` (liste vide ou refus sous RLS — c'est pourquoi une réponse « sans
erreur » ne suffit pas), base injoignable (délai 5 s). **`/health` inchangé** : c'est la
sonde d'UptimeRobot (`HEAD /health`).

**Pourquoi au déploiement et pas au démarrage** (écart assumé avec la formulation de
l'audit 06 P2) : un serveur qui s'arrêterait au boot faute de base s'arrêterait aussi
lors d'un simple redémarrage pendant une coupure Supabase — 3 essais
(`railway.toml:8-9`) puis service arrêté jusqu'à une action humaine. Le healthcheck
n'intervient qu'au déploiement.

**Réessais de la bibliothèque.** postgrest-js 2.107.0 réessaie seul un GET jusqu'à 3 fois
sur coupure réseau ou statut 503/520 (`dist/index.cjs:7, 21, 115-120`). L'`abortSignal`
de 5 s englobe ces réessais ; Railway réinterroge ensuite jusqu'à 30 s.

**Tests** (vrai serveur, dépendances du lockfile, fausse base PostgREST locale, clé
factice) : bonne clé acceptée ; 6/6 cas de panne refusés ; clé reçue à l'identique dans
les deux en-têtes ; **0 occurrence de la clé dans les journaux** (seul le motif est
journalisé) ; `/health` reste 200 base muette ; le serveur survit à la base arrêtée.

**HYPOTHÈSES — ce qui ferait casser le garde-fou.**
1. **`marchands` n'est jamais vide.** Une base neuve (environnement de test, structure
   UAE) fait échouer tout déploiement tant qu'aucun marchand n'existe.
2. **La clé publique ne lit aucune ligne de `marchands`** (RLS sans policy pour
   `anon`). Une policy qui l'y ouvrirait rendrait le contrôle aveugle à la clé publique.
3. **`railway.toml` est lu par Railway — jusqu'au 2026-12-01 seulement** (voir §16,
   nouvelle dette). Après cette date, c'est le chemin saisi dans le tableau de bord qui
   compte : il doit valoir `/health/db`.

**LIMITES.** Ce n'est pas une supervision : Railway n'appelle la route qu'au
déploiement (étape 5 de la roadmap, à part). Supabase en panne pendant un push →
déploiement refusé, version en place conservée (voulu). Le Storage n'est pas testé par
la route (le `curl` de la bascule le couvre). Route publique : une lecture d'une ligne,
sous le limiteur global.

**Reste à vérifier par Yass après le déploiement :** (1) détail du déploiement Railway :
healthcheck `/health/db` avec l'icône de fichier, déploiement réussi ;
(2) `https://app.winwin-card.com/health/db` → `{"status":"ok"}` ; (3) saisir
`/health/db` (délai 30 s) dans Settings → Healthcheck Path du tableau de bord ;
(4) facultatif : essai réel avec la clé publique, qui doit être refusé sans effet sur
la production. Si le déploiement du garde-fou échoue, la version précédente reste en
ligne ; les lignes `[health/db]` des journaux donnent le motif.

### B. La bascule vers `sb_secret_` (à faire par Yass, aucun code)

**ÉTAT (relevé de Yass, 29/09 au soir) : étapes 1 à 5 FAITES.** La clé secrète dédiée
`serveur_railway` (`sb_secret_…`) est en production dans `SUPABASE_SERVICE_KEY`.
Vérifié par Yass : `/health/db` → `{"status":"ok"}`, admin, scan cobaye puis annulation.
**Reste :** étape 6 (observation, dont le cron de 08:00 UTC), **étape 7 prévue vers le
03/10** (désactiver les clés historiques ; retour : les réactiver), étape 8 (ménage).

Principe : ancienne et nouvelle clés fonctionnent **en même temps** tant que les clés
historiques ne sont pas désactivées ; la désactivation est elle-même réversible
(réactivation) jusqu'à la suppression par Supabase. Ne pas toucher la page « JWT Keys »
de Supabase ni `JWT_SECRET` de Railway (sans rapport).

1. Supabase → API Keys → créer une clé secrète dédiée (ex. `serveur_railway`) ; elle
   commence par `sb_secret_`. *Retour : la supprimer, tant qu'elle n'est pas dans
   Railway.*
2. Test depuis le Mac, lecture seule (`read -s` pour ne pas afficher la clé) : `curl`
   sur `/rest/v1/marchands?select=id&limit=1` et `/storage/v1/bucket` avec les en-têtes
   `apikey` ET `Authorization: Bearer`. Attendu : une ligne, puis 200. Une erreur qui
   parle de JWT = STOP, retour au diagnostic.
3. Noter le déploiement Railway actif.
4. Remplacer la valeur de `SUPABASE_SERVICE_KEY` dans Railway et déployer. Avec le
   garde-fou, une mauvaise valeur est refusée et la version en place continue. *Retour :
   Rollback Railway (restaure les variables, 72 h) ou remettre l'ancienne valeur, lisible
   dans l'onglet « Legacy API keys ».*
5. Vérifier tout de suite : liste admin, connexion dashboard, scan + annulation sur le
   cobaye, journaux sans `Invalid API key` / `JWT` / `401`.
6. Observer quelques jours (au moins un cron de 08:00 UTC) ; recenser tout autre usage
   d'une clé `eyJ` (`.env` du MacBook, outil tiers — Supabase n'a aucun compteur).
7. Désactiver les clés historiques (onglet Legacy). *Retour : les réactiver ; après
   cette étape, un Rollback Railway seul ne suffit plus.* À faire bien avant la fin de
   l'année : après la suppression par Supabase, ce retour n'existe plus.
8. Ménage : `.env.example:3` (format `eyJ`), commentaire `supabase.js:7`.

## 15 octies. ÉTAPE 9 : LE DÉPÔT RECONSTRUIT LA PRODUCTION (migration 048, 2026-09-29)

**Le défaut.** Rejoué tel quel (`schema.sql` + 002→047 + `rgpd_effacement.sql`), le
dépôt donnait une base où le serveur recevait « permission denied » sur les 7 tables
centrales (`marchands`, `clients`, `passes`, `scans`, `device_tokens`, `consentements`,
`workflows`) : 7 tables sur 14 accessibles, constaté sur PostgreSQL 16. Une restauration
après perte du projet, la base du filet de tests (étape 10) ou un second projet Supabase
ne fonctionnaient donc pas. Origine des droits en production : inconnue (00a §5.1).

**Ce qui manquait au dépôt — prouvé en production le 29/09** par une requête d'écarts
en lecture seule : 13 écarts, tous déjà photographiés le 26/09, aucun imprévu.
1. SELECT, INSERT, UPDATE, DELETE de `service_role` sur les 7 tables ;
2. RLS active sur `diagnostics_camera`, `points_de_vente`, `referral_credits`,
   `workflow_executions` ;
3. fonction `public.rls_auto_enable()` + déclencheur d'événement `ensure_rls` (RLS
   d'office sur toute table créée dans `public`, 00a §6.1).
Prouvé au passage, non photographié par l'audit : les 16 objets appartiennent à
`postgres` ; aucun droit posé colonne par colonne ; aucune RLS forcée ; code des 7
fonctions du dépôt identique en production.

**Migration 048** (commit `bd3a1ba`). Chaque bloc n'agit que si l'élément manque.
Nécessaire : un simple `GRANT` d'un droit déjà en place **réécrit le catalogue**
(vérifié) — sans ces conditions, la migration aurait écrit en production. **Exécutée par
Yass le 29/09, contrôle à 4 × `true`.**

**Décisions de pilotage (29/09).**
- **Non consignés** : TRUNCATE / REFERENCES / TRIGGER de `anon`, `authenticated` et
  `service_role` sur les 14 tables (privilèges par défaut de Supabase, inutiles au
  serveur ; les écrire graverait une exposition que l'étape 7 veut réduire) ; le texte de
  4 fonctions, qui ne diffère que par des commentaires (00a §4).
- **`ensure_rls` consigné** : défaut sûr, toute nouvelle table est protégée d'office. Elle
  exige toujours son `GRANT` explicite à `service_role` (leçon de 028 et 030).

**L'outil de preuve : `database/requetes/ecarts_prod_depot/`.**
- `generer.sh` rejoue tout le dépôt dans une base jetable (PostgreSQL local, rôle
  superutilisateur ; dans le conteneur : `PSQL='runuser -u postgres -- psql' bash
  generer.sh`), fige son état dans `ecarts_prod_depot.sql`, vérifie 0 écart sur la base
  rejouée, puis la supprime. `etat_base.sql` = la photographie (formules de 00a).
- `ecarts_prod_depot.sql` : requête en **lecture seule**, à coller dans le SQL Editor.
  **Résultat en production le 29/09, après la 048 : `IDENTIQUE au dépôt (hors
  plateforme) | 0 écart(s) · 42 plateforme`** — seules restent les 3 lignes des droits
  hérités de Supabase.
- **RÈGLE : après chaque migration, relancer `generer.sh`, committer la requête
  régénérée, et la lancer en production.** Tout écart autre que « plateforme » signifie
  que la base et le dépôt divergent (c'est ce qui aurait attrapé 028, 030 et les trois
  textes de fonctions jamais committés).

**Tests (PostgreSQL 16) : 15/15.** 49 fichiers rejoués sans échec ; avant la 048, 7 tables
sur 14 et pas de RLS d'office ; 1er passage : 13 actions, contrôle 4 × `true` ; 2e
passage : aucune action, catalogue inchangé ; après : 14/14 tables lues, créées, modifiées
et supprimées par `service_role`, RLS d'office sur une nouvelle table ; sur une copie
simulée de la production (validée par la requête du 29/09) : aucune action, aucune
écriture au catalogue ; un écart inventé est détecté.

**HYPOTHÈSES — ce qui ferait casser.**
1. **`CREATE EVENT TRIGGER` exige un superutilisateur.** Sur Supabase, `postgres` le peut
   (le déclencheur de production lui appartient). Sur un projet NEUF, non vérifié avant
   l'environnement de test (étape 15). S'il était refusé, la transaction entière serait
   annulée : rien de posé.
2. **La comparaison est faite en PostgreSQL 16, la production est en 17.6.** Les
   empreintes sont indépendantes de la version (00a §2.2) ; le droit MAINTAIN
   (PostgreSQL 17) n'est pas comparé.

**LIMITES — ce que « identique » ne couvre pas.** Uniquement le schéma `public` : ni les
réglages de la plateforme (délais des rôles, plafond de 1 000 lignes de l'API, schémas
exposés, privilèges par défaut), ni le Storage (bucket `passes`, recréé par le code ;
règles de `storage.objects` non photographiées), ni les extensions de la plateforme, ni
Supabase Auth. Ces réglages ne sont pas du SQL du projet : ils relèvent d'une fiche de
réglages, **non écrite**. La partie « réglages Railway » de l'étape 9 relève de la
décision sur `railway.toml` avant le 01/12 (§16).

## 15 nonies. ÉTAPE 5 : SUPERVISION — BASE ET CRON (2026-09-29)

**Avant.** Une seule sonde : UptimeRobot sur `HEAD /health`, qui ne touche pas la base
(audit 02, annexe). Le cron de 08:00 UTC ne laissait que deux lignes de journal (7 jours
chez Railway), « terminés » s'affichait même si tout avait échoué, et rien n'alertait.

**Sondes UptimeRobot (réglées par Yass), alertes par e-mail reçues sur son téléphone** (pas
d'application) :
1. `/health` — le serveur répond (existante).
2. `/health/db` — **créée le 29/09.** La base répond avec les droits du serveur (même route
   que le healthcheck de déploiement, §15 septies). Testé en HEAD : 200 / 503.
3. `/health/cron` — **créée par Yass le 30/09**, après le premier passage suivi (08:00:01 →
   08:03:36 UTC). Leçon pour toute future base neuve : la créer AVANT le premier passage
   la fait alerter aussitôt (`pas_demarre`), aucune ligne n'existant encore.
Lecture croisée : `/health` OK et `/health/db` KO → base ou clé ; les deux KO → serveur,
Railway ou domaine.

**Suivi du cron (migration 049, `services/cron-passages.js`).** `passageQuotidien()`
(`workers/cron.js`) écrit une ligne `cron_passages` au début (`en_cours`), la complète à
la fin (`ok` ou `erreurs`, bilan des envois par étape). Les 4 étapes, leur ordre et leurs
messages d'erreur sont ceux d'origine. **Le suivi ne bloque jamais le cron** (même règle
que le registre, §15 quinquies) : table absente, droit retiré ou base en panne → le cron
tourne, le refus est journalisé `[cron-suivi]`, et `/health/cron` répond 503.
`/health/cron` → 200 `fini` / `en_cours` ; 503 `pas_demarre` (aucune ligne 10 min après
08:00), `pas_fini` (en cours 60 min après), `erreurs`, `lecture_impossible`. Avant 08:10
UTC, c'est le passage de la veille qui est jugé. La route n'expose que l'état et les heures.
Le déclenchement manuel admin (`/api/admin/workflows/trigger`) n'est **pas** suivi.

**Tests (base rejouée depuis le dépôt, PostgREST 12.2.12 local, supabase-js 2.107.0, code
du dépôt) : 28/28** — décision heure par heure (11 cas), vrai passage avec les vraies
étapes (1 inactif relancé sur un marchand cobaye, déduplication écrite), étape qui lève
(les suivantes tournent, journal au format d'origine), suivi en panne (le cron tourne),
`etat()` à travers PostgREST (7 cas). Routes sur le vrai serveur : 503 puis 200, HEAD OK ;
`cron_passages` illisible sans clé (401). **Production, après la 049 : requête d'écarts
`IDENTIQUE au dépôt (hors plateforme) | 0 écart(s) · 45 plateforme`** (15 tables).
Le banc (`lancer.sh`, `e2e.js`) est resté dans le scratchpad, hors dépôt : il préfigure
l'API locale du filet de tests (étape 10).

**HYPOTHÈSES — ce qui ferait casser.**
1. **Le serveur tourne en UTC** (audit 06 §5.1) : node-cron planifie à l'heure du process.
2. **08:00 est écrit deux fois** : `cron.schedule('0 8 * * *')` et `HEURE_UTC` de
   `cron-passages.js`. Changer l'un sans l'autre = alertes fausses.
3. **`DELAI_FIN_MIN = 60`** : le passage du 30/09 a duré **3 min 35** (08:00:01 →
   08:03:36 UTC, relevé de Yass) ; celui du 26/09, 80 s (00b C6). Une à deux heures à
   100 000 porteurs (99 §5.2). À relever avec le volume, sinon `pas_fini` à tort. Le
   commentaire de `cron-passages.js:21` dit encore « 80 s » : à corriger au prochain
   commit de code.

**LIMITES.** « Fini sans erreur » ≠ « juste » tant que l'étape 22 n'est pas faite (une
lecture en échec DANS un workflow n'est toujours pas vue, `cron.js:41`). `/health/db` ne
voit pas une base passée en lecture seule. Les alertes n'arrivent qu'à Yass (décision C3 :
ajouter la personne qui supervisera). Sentry (erreurs serveur) reste installé et inactif,
hors de ce chantier. **Point à vérifier par Yass** : les conditions d'UptimeRobot sur
l'usage commercial de l'offre gratuite (sources contradictoires, non tranché).

## 15 decies. ÉTAPE 6 : SERVEUR À AMSTERDAM (2026-09-30)

**Fait par Yass le 30/09 vers 09:05 UTC** : service Railway en **EU West Metal
(Amsterdam, `europe-west4-drams3a`), 1 réplique**, US West à 0. Vérifications OK. Aucun
code. La base reste à Paris (`eu-west-3`). Diagnostic préalable : rien ne dépendait de la
région — aucun stockage persistant (fichiers temporaires seulement,
`apple-pass.js:517`, `strip-generator.js:68`), les restrictions réseau de Supabase ne
s'appliquent pas à supabase-js (doc Supabase), pas d'IP de sortie fixe en offre Hobby,
domaine inchangé (doc Railway), région absente de `railway.toml`.

**Mesures (Yass, Dubaï, même Wi-Fi, Chrome, médiane de 15 essais, méthode 00a §7.2) :**

| | `/health` | Dinapoli (1 requête base) | `/health/db` (1 requête base) | Coût d'une requête base |
|---|---|---|---|---|
| 26/09 (audit, Californie) | 291 ms | 504 ms | — | ≈ 213 ms |
| 30/09 AVANT (Californie) | 287 ms | 514 ms | 496 ms | ≈ 210–230 ms |
| 30/09 APRÈS (Amsterdam) | 282 ms | 360 ms | 405 ms | **≈ 80–120 ms**, minimums ≈ 40 ms |

**Gain mesuré : ≈ 100 à 150 ms par requête base.** Chiffrage (HYPOTHÈSE, calcul sur
ces mesures) : les 4 requêtes enchaînées d'un scan passent d'environ 0,85 s à environ
0,35 s ; un scan vu de Dubaï d'environ 1,1 s à environ 0,65 s. Même gain par carte dans
le cron (3 requêtes par carte).

**Pourquoi `/health` n'a pas bougé depuis Dubaï.** Railway n'a **pas de réglage
d'entrée par service** : son réseau d'entrée est en anycast, chaque utilisateur entre au
point de présence (POP) que choisit le routage de son fournisseur d'accès, puis le trafic
traverse le réseau interne de Railway jusqu'à la région (doc Railway « Edge
Networking »). Le DNS de `app.winwin-card.com` (zone chez le registraire, alias vers
Railway, **pas de Cloudflare**, audit 06 annexe A) n'a rien de régional. Un POP européen
aurait divisé `/health` par deux environ : **le POP d'entrée depuis ce Wi-Fi de Dubaï
n'est donc pas en Europe** (HYPOTHÈSE : côte Est américaine ou Singapour, qui donnent
tous deux un total quasi identique avant et après). **À vérifier sans code** : page
`https://routing-info-production.up.railway.app/` depuis le même Wi-Fi ; en-tête de
réponse `X-Railway-Upstream-Zone` avec `X-Railway-Debug: 1` ; attribut `@edgeRegion`
des journaux HTTP Railway.

**Pourquoi 80–120 ms et non les 10–30 ms annoncés.** L'hypothèse de l'audit imputait les
213 ms à la seule distance. Les mesures montrent une **part fixe d'environ 70 ms**,
indépendante de la distance : avant ≈ aller-retour Californie–Paris (≈ 140–150 ms) +
≈ 70 ms ; après ≈ aller-retour Amsterdam–Paris (≈ 10 ms) + ≈ 70 ms (HYPOTHÈSE : ordres
de grandeur des allers-retours, non mesurés). Cette part fixe (passerelle Supabase,
PostgREST, TLS/HTTP, supabase-js) n'est pas décomposable depuis Dubaï. **Pas la
nouvelle clé** : l'« avant » a été mesuré avec `sb_secret_` (210–230 ms), comme le 26/09
avec la clé historique (213 ms). Bruit de mesure : les deux routes à une requête
diffèrent de ≈ 45 ms entre elles. **À mesurer sans code** : `@upstreamRqDuration` des
journaux HTTP Railway (`/health` contre `/health/db`), et durées des journaux d'API
Supabase.

**Conséquences.** Le levier restant sur le scan est le **nombre d'allers-retours**
(étape 11, transaction unique ; 02 P1) : chaque aller-retour évité vaut désormais
≈ 80–100 ms. Côté Dubaï, le trajet caisse ↔ Railway (≈ 280 ms) dépend du POP d'entrée,
que Railway ne permet pas de choisir. **Écarté pour l'instant** : un Cloudflare devant le
domaine (gain incertain, risque élevé sur l'adresse gravée dans les cartes Apple, les
appels d'Apple et de Google, les limiteurs) ; plusieurs régions (cron doublé, 00b F5).

**Reste à vérifier :** le passage du cron du 01/10 à 08:00 UTC, le premier à Amsterdam
(`/health/cron` → `fini`, début vers 08:00 UTC : confirme le fuseau). **La sonde
UptimeRobot `/health/cron` est créée** (confirmé par Yass le 30/09) : les trois sondes
sont en place.

## 15 undecies. ÉTAPE 7 : VERROUILLAGE — EN COURS (diagnostic du 2026-09-30)

**RÈGLE DE PILOTAGE (corrigée le 30/09).** Amine n'est **pas** engagé et son accès en
écriture au dépôt a été retiré le 30/09. La règle « code relu par Amine avant push » est
**supprimée**. À la place, selon la numérotation du diagnostic (points 5 à 11) :
- **points 6, 7, 8, 9** : faits par Claude, testés, puis feu vert de Yass avant push ;
- **points 5 et 10** (les plus risqués) : code écrit et testé **sans push**, puis un
  dossier d'une page pour un développeur extérieur : contexte en 3 lignes, diff, tests
  passés, 3 questions précises, temps estimé.

**Faits (réglages de Yass, sans code) :**
- double authentification GitHub (29/09) ;
- protection de branche niveau 1 : règle GitHub « Protection prod » (suppression et
  réécriture forcée interdites) ;
- chemins surveillés Railway `/winwincard/backend/**` (30/09 ; les motifs partent de la
  racine du dépôt, même avec un sous-dossier racine — doc Railway ; réglés dans le
  tableau de bord, pas dans `railway.toml`, plus lu après le 01/12). **Test, première
  moitié réussie :** `e7e3ac8` (passation seule) marqué « skipped » par Railway.
  **Seconde moitié réussie :** `4604fb6` (point 7, touche `winwincard/backend/`) a
  redéployé — le nouveau `admin/sw.js` est en ligne.

**Décision de Yass (30/09) :** le mot de passe admin actuel est conservé. Retiré des tâches.

**Point à confirmer :** copie de `JWT_SECRET` hors de Railway (étape 4), préalable du point 10.

**Points de code :**
- **5. Migration 050** *(dossier extérieur)* : droit d'exécution des fonctions retiré à
  `PUBLIC`, `anon`, `authenticated` (explicite pour `service_role`, et pour les futures
  fonctions). `effacer_client` détruit une carte et reste appelable avec la clé publique ;
  la désactivation des clés historiques ne ferme rien (`sb_publishable_` = même rôle).
  **Risque** : un `service_role` privé d'exécution arrêterait tous les scans → banc
  PostgREST + requête d'écarts régénérée avant exécution.
  **NON POSÉ — décision de Yass (01/10).** Écrit et testé (32/32), rangé sur la branche
  `relecture/etape7-points-5-10` (non déployée) avec son dossier de relecture. **À la place :**
  suppression des clés publiques inutilisées (détail ci-dessous).
- **6. Mot de passe admin comparé à temps constant — FAIT** : poussé `98b9605`,
  « vérifié » par Yass le 30/09 (détail ci-dessous).
- **7. Service worker de l'admin — FAIT** : poussé `4604fb6`, « vérifié » par Yass le 30/09
  après les trois contrôles (détail ci-dessous).
- **8. Coordonnées clients réservées au Pro+ — FAIT** : poussé `a990413` le 30/09. Liste
  ET fiche (le diagnostic ne citait que la liste) ; détail ci-dessous. Règle élargie le
  30/09 au soir : coordonnées = Pro+ OU landing premium active (§15 duodecies).
- **9. Page du dashboard vidée à chaque changement de session — NON FAIT, décision de
  Yass (30/09)** : ne se fait pas, noté en dette mineure (§16).
- **10. Secret des cartes Apple séparé** *(dossier extérieur)* (`apple-pass.js:26-30`) :
  nouvelle variable reprenant EXACTEMENT la valeur actuelle de `JWT_SECRET`, repli sur
  `JWT_SECRET`. **Risque élevé** : un caractère de différence = 1 104 cartes iPhone figées.
  **NON POSÉ — RISQUE ACCEPTÉ par Yass (01/10) sur `JWT_SECRET`.** Écrit et testé
  (32/32), rangé sur la branche `relecture/etape7-points-5-10` (non déployée). Détail ci-dessous.
- **11. Logo de secours Google** (`google-pass.js:65`, seule référence au dépôt dans le
  code) déplacé, classes concernées resynchronisées ; **puis** décision sur la visibilité
  du dépôt. **PIÈGE (doc GitHub) : sur l'offre gratuite, GitHub Pages et la protection de
  branche ne marchent que sur un dépôt public** — privé = vitrine `winwin-card.com` et
  règle « Protection prod » coupées. Options : GitHub Pro, ou vitrine dans un dépôt
  public séparé. L'offre GitHub de Yass n'a pas été relevée.

### Point 7 — service worker de l'admin en « réseau d'abord » (30/09)

**Défaut (00b §4.7).** L'ancien `public/admin/sw.js` pré-cachait `/admin/` à
l'installation, puis le servait depuis le cache sans jamais le rafraîchir (cache
d'abord, aucune écriture au passage, nom de cache figé). Toute modification de
`admin/index.html` — 8 commits du 26/08 au 25/09 — restait invisible sur un appareil où
l'admin avait déjà été ouvert, sauf rechargement forcé. Même défaut que le scanner en
2026-07.

**Correctif (`public/admin/sw.js`, seul fichier de l'admin modifié).** Les pages
(navigations) passent par le réseau d'abord ; le cache `winwin-admin-v2` ne sert qu'en
repli hors ligne, et ne garde que les réponses valides (une 500 n'est jamais mise en
cache). Rien d'autre n'est intercepté : API, icônes, manifest, images vont au réseau
comme sans worker. L'activation supprime `winwin-admin-v1` et **seulement les caches
`winwin-admin-*`** : l'ancien code supprimait tous les caches de l'origine, dont ceux du
dashboard et du scanner. Pas de pré-cache : l'installation ne dépend plus d'un
téléchargement. `index.html` inchangé (enregistrement du worker : `index.html:1923`).

**Tests : 21/21** (Chromium via Playwright, serveur reproduisant les en-têtes de
`src/index.js` : `.html` en `no-store`, `sw.js` en `max-age=0`, repli SPA) :
- ancien worker installé, `index.html` modifié → l'ancienne page reste servie (défaut
  reproduit) ;
- nouveau `sw.js` déployé → 1re ouverture encore ancienne, `winwin-admin-v1` supprimé,
  2e ouverture à jour ; caches du dashboard et du scanner conservés ;
- ensuite chaque modification (index, `preview.html`, repli SPA `/admin/marchands/42`)
  est servie dès le chargement suivant ; chaque appel API arrive au serveur ; le cache
  ne contient que des pages ; une 500 est transmise mais pas gardée ;
- serveur arrêté → dernière version valide servie (pas la 500) ; page jamais ouverte →
  erreur réseau ordinaire ;
- appareil neuf → worker installé, modifications servies au chargement suivant.
Contre-épreuve : l'ancien worker échoue à 10 de ces vérifications ; une variante sans
filtre de préfixe échoue à la conservation des caches voisins. Vraie page
`admin/index.html` : contrôlée par le nouveau worker, aucune erreur console. Scripts de
test non versés (bloc-notes de session).

**Ce que Yass verra après le déploiement.** Sur un appareil où l'admin a déjà été ouvert :
la **1re ouverture montre encore l'ancienne version** (servie par l'ancien worker, qui se
remplace en arrière-plan) ; **à partir de la 2e, la version à jour**, puis toute
modification future dès le chargement suivant. Si des nouveautés d'admin apparaissent
alors pour la première fois, c'est l'ancien cache qui les masquait.

**Hypothèses (ce qui le ferait casser).**
- Le navigateur revérifie `sw.js` à chaque ouverture en contournant son cache HTTP
  (comportement par défaut). Un intermédiaire qui mettrait `sw.js` en cache — un CDN
  devant le domaine, écarté au §15 decies — retarderait les mises à jour du worker.
- Le préfixe `winwin-admin-` reste réservé à l'admin.
- Changer `CACHE` seulement si la stratégie change ; revenir au « cache d'abord » sur les
  pages recréerait le défaut.

**Limites.** Hors ligne, seules les pages déjà ouvertes avec le nouveau worker sont
disponibles ; l'admin est de toute façon inutilisable hors ligne (tout passe par l'API).
Les workers du dashboard et du scanner purgent encore tous les caches de l'origine,
celui de l'admin compris (repli hors ligne seulement, pas la fraîcheur) : dette §16,
non corrigée ici (hors périmètre).

**Vérification après push (Yass).** 1. Railway démarre un déploiement pour ce commit
(seconde moitié du test des chemins surveillés) et le healthcheck passe. 2.
`https://app.winwin-card.com/admin/sw.js` contient `winwin-admin-v2`. 3. Admin ouvert
deux fois : la seconde est à jour ; connexion et fiche d'un marchand OK.

**Retour arrière.** `git revert` du commit, puis push : l'ancien worker se réinstalle
(nouveau pré-cache, donc à jour à cet instant, puis figé à nouveau).

**Au passage, même commit :** commentaire de `cron-passages.js:21` corrigé (« 80 s » →
« 3 min 35 le 30/09 »), comme prévu au premier commit de code.

### Point 6 — mot de passe admin comparé à temps constant (30/09)

**Défaut.** `POST /api/admin/login` comparait la saisie au mot de passe avec `!==`, qui
s'arrête au premier caractère différent : en théorie, la durée de la réponse révèle
combien de caractères du début sont justes. **Exploitation à distance très
improbable** : limiteur de 10 essais par heure et par adresse (`rateLimiters.js`,
`trust proxy` réglé), bruit réseau de plusieurs millisecondes contre des écarts de
nanosecondes. Défense en profondeur, pas une brèche ouverte. C'était la seule
comparaison de secret en `!==` du serveur : jeton des cartes Apple
(`apple-wallet.js:15`) et mots de passe marchand et boutique (`auth-utils.js`,
scrypt) étaient déjà comparés à temps constant.

**Correctif.** `safeEqual` dans `services/auth-utils.js` : empreintes SHA-256 des deux
chaînes (encodage utf16le, pour que « empreintes égales » équivaille exactement à
« chaînes égales ») comparées avec `crypto.timingSafeEqual` ; tout ce qui n'est pas
une chaîne est refusé. La route admin l'utilise. Réponses inchangées : 401 « Mot de
passe incorrect », 500 si `ADMIN_PASSWORD` absent, jeton de 24 h. Le mot de passe de
Yass ne change pas ; aucune variable Railway à toucher.

**Tests : 42/42.**
- `safeEqual` donne le même verdict que `===` sur 12 cas limites (accents, emoji,
  demi-paire isolée, caractère nul, accent composé) et sur 20 000 paires aléatoires ;
  refuse `undefined`, `null`, nombre, booléen, tableau, objet, Buffer.
- Route : ancien code (HEAD) et nouveau appelés avec les mêmes 17 entrées (bon mot de
  passe ; un caractère de trop, de moins, premier faux, casse ; vide, absent, `null`,
  nombre, booléen, tableau contenant le bon, objet ; texte brut ; JSON invalide ;
  secret numérique saisi en nombre et en chaîne ; secret absent) : réponses
  identiques (statut et corps ; jeton : rôle admin, 24 h).
- Durée, secret de 200 000 caractères : avec `!==`, une saisie fausse seulement à la
  fin prend 60 fois plus longtemps qu'une saisie fausse au début ; avec `safeEqual`,
  rapport 1,00. Scripts non versés (bloc-notes de session).

**Hypothèses.** `ADMIN_PASSWORD` est une chaîne (variable d'environnement : toujours).
**Limites.** La durée dépend encore de la longueur de la saisie, choisie par
l'appelant : elle ne révèle rien du secret. Inchangé, hors périmètre : mot de passe
unique partagé, jeton admin de 24 h non révocable.

**Vérification après push (Yass).** Connexion à l'admin avec ton mot de passe → OK.
Un seul essai avec un mauvais mot de passe → « Mot de passe incorrect » (chaque essai
faux compte dans les 10 par heure).

**Retour arrière.** `git revert` du commit, puis push.

### Point 8 — coordonnées clients réservées au Pro+ (30/09)

**Défaut.** Les coordonnées (email, téléphone, anniversaire) ne sont collectées qu'en
Pro+ (`clients.js:37`), mais deux routes les renvoyaient à tout marchand, quel que
soit son forfait : la liste `GET /api/clients` (tous les clients d'un coup) et la
fiche `GET /api/clients/:id`. Seul le dashboard les masquait
(`dashboard/index.html:1969`), pas le serveur. Cas réel : un marchand repassé de Pro+
à Pro garde en base les coordonnées collectées ; il les recevait toujours, lisibles
dans les outils du navigateur. L'export CSV, lui, était déjà réservé au Pro+.

**Correctif (`routes/clients.js`).**
- **Liste : plus aucune coordonnée, quel que soit le forfait — choix validé par Yass
  (feu vert du 30/09).** Le dashboard n'y affiche que prénom et points (`renderClients`), et charger
  toutes les coordonnées dans le navigateur multipliait les copies (cf. point 9 :
  la liste restait en mémoire d'une session à l'autre). Pour un Pro+, rien ne change
  à l'écran : les coordonnées restent sur la fiche et dans l'export.
- **Fiche : coordonnées renvoyées au Pro+ seulement**, à `null` sinon (forme de la
  réponse inchangée). Le forfait est lu en base à chaque ouverture, en parallèle de
  la lecture du client : pas de temps d'attente en plus. Forfait illisible → fiche
  servie sans coordonnées, et une ligne `[clients] fiche : forfait illisible` au
  journal.

**Tests : 35/35**, banc complet (base rejouée depuis le dépôt, PostgREST, ancien serveur
HEAD et nouveau côte à côte), marchands Pro+, Pro (coordonnées collectées en Pro+) et
Basic :
- AVANT, défaut reproduit : la liste envoyait au Pro les emails de ses clients ; les
  fiches du Pro et du Basic contenaient des coordonnées ;
- liste : aucune coordonnée pour les trois ; mêmes clients, même ordre, mêmes autres
  champs qu'avant ;
- fiche Pro+ identique à avant, coordonnées comprises ; fiches Pro et Basic : coordonnées
  à `null`, tout le reste identique (client et scans) ; 404 inchangés (client d'un autre
  marchand, client supprimé, identifiant inconnu) ; export inchangé (Pro+ 200, Pro 403) ;
- forfait changé en base → effet immédiat dans les deux sens ;
- lecture du forfait refusée (droit retiré sur la colonne) → fiche servie sans
  coordonnées, ligne au journal ; droit rendu → coordonnées de retour ;
- vrai dashboard dans Chromium : Pro+ voit sa liste et les coordonnées sur la fiche ;
  Pro voit sa liste et une fiche sans coordonnées ; aucune adresse dans la réponse de
  la liste. Scripts non versés (bloc-notes de session).

**Hypothèses (ce qui le ferait casser).** « Pro+ » = `forfait === 'pro_plus'`, règle
écrite à trois endroits du serveur (inscription `clients.js:37` et `:56`, export,
fiche) et une du dashboard. Un nouveau forfait au-dessus du Pro+ n'aurait AUCUNE
coordonnée tant que ces endroits ne sont pas mis à jour ensemble.

**Limites.** Les coordonnées d'un marchand repassé en Pro restent en base : masquées,
pas effacées. Les effacer, ou les rendre au retour en Pro+, est une décision métier et
RGPD, non prise. La fiche garde une lecture en base de plus par ouverture (en
parallèle). La liste reste plafonnée à 1 000 lignes par PostgREST : dette découverte ici
(§16), non traitée.

**Vérification après push (Yass).** Dashboard d'un marchand Pro+ : la liste s'affiche,
une fiche montre email et téléphone. Dashboard d'un marchand Pro ou Basic : la liste
s'affiche, la fiche n'a pas de coordonnées (comme avant à l'écran).

**Retour arrière.** `git revert` du commit, puis push.

### Points 5 et 10 — écrits, testés, NON POSÉS (décisions de Yass, 01/10)

**Où est le travail.** Branche **`relecture/etape7-points-5-10`**, partie de la branche de production :
`migration_050_execution_fonctions.sql`, requête d'écarts régénérée pour 050, code du point
10 (`apple-pass.js`, `index.js`), dossiers et patchs dans `docs/relecture/`. **Railway ne la
déploie pas** (il ne suit que `claude/keen-goldberg-MXslu`) ; ne pas ouvrir de pull request
vers la production sans décision. **Le numéro 050 est RÉSERVÉ** : la prochaine migration de
production prendra 051 (sinon deux « 050 » le jour où la branche serait reprise).

**Point 5 remplacé, pour l'instant, par la suppression des clés publiques.** **Fait le
01/10 :** clés historiques désactivées vers 08:15 UTC, vérifications OK (Yass). **La clé
publishable « default » ne peut pas être supprimée dans Supabase : elle est gardée.** La
faille du point 5 reste donc **théorique** : exploitable seulement par qui détient cette
clé, affichée uniquement dans le tableau de bord Supabase, jamais publiée par WinWin.
Vérifié le 01/10 :
- **Aucune clé publique utilisée.** Le serveur ne lit que `SUPABASE_URL` et
  `SUPABASE_SERVICE_KEY` (`services/supabase.js`, seul client) ; aucune page (`public/`),
  aucun script, aucune configuration ne contient de clé ni n'appelle Supabase ; aucun
  jeton `eyJ` ni clé `sb_` dans les 60 commits de l'historique. Pas de Supabase Auth, ni
  Realtime, ni Edge Functions dans le code.
- **Ce que la suppression ne casse pas.** Les images (logos, bandeaux des cartes) sont
  lues par des URL publiques de Storage (`getPublicUrl`), qui ne demandent aucune clé ;
  le serveur écrit avec sa clé secrète. Le tableau de bord Supabase n'utilise pas la clé
  publishable du projet.
- **Ce qu'on ne peut pas vérifier d'ici.** Un outil extérieur (automatisation, tableur,
  script sur un poste) qui aurait reçu la clé publique : à vérifier par Yass. Que Supabase
  autorise la suppression de la clé « default » : non documenté (doc Supabase relue ; le
  site supabase.com est inaccessible depuis le conteneur).
- **Limite.** Sans aucune clé publique valide, `anon` et `authenticated` ne peuvent plus
  joindre l'API : la faille d'`effacer_client` n'est plus atteignable. Mais les droits en
  base restent ouverts (`exec=111`) : **toute clé publishable recréée plus tard (par un
  outil, un tutoriel, le bouton « Connect » de Supabase) rouvre la faille**. Si la clé
  « default » ne peut pas être supprimée, la faille reste ouverte à quiconque la détient
  (elle n'est affichée que dans le tableau de bord Supabase). La migration 050 reste prête.

**Point 10 — risque accepté sur `JWT_SECRET`.** Tant que le point 10 n'est pas posé, les
cartes iPhone (≈ 1 104) sont signées avec `JWT_SECRET` : le changer, même après une fuite,
figerait toutes ces cartes. **Si un jour il faut changer `JWT_SECRET` : poser D'ABORD le
point 10 avec l'ANCIENNE valeur** (branche `relecture/etape7-points-5-10`, procédure du dossier),
vérifier le journal « identique : oui », puis seulement changer `JWT_SECRET`. Copie de
`JWT_SECRET` hors de Railway : toujours non confirmée.

**Règle de pilotage (30/09), appliquée :** code écrit et testé sans push, puis un dossier
d'une page pour un développeur extérieur (contexte, diff, tests, 3 questions, temps
estimé), remis à Yass le 01/10.

**Point 5 — migration 050.** Pour chaque fonction de `public` appartenant au rôle qui
exécute (postgres) et hors extension : `EXECUTE` retiré à `PUBLIC`, `anon`,
`authenticated`, accordé à `service_role` ; mêmes règles pour les fonctions futures
(défaut global pour `PUBLIC` — un défaut par schéma ne peut pas le retirer) ;
`NOTIFY pgrst`. Échec explicite si aucune fonction n'est traitée (mauvais rôle).
Vérification (4 × true) et retour arrière dans le fichier, **testés tels qu'écrits**.
Banc avec les privilèges par défaut de Supabase simulés : faille reproduite (`anon` efface
un client par `effacer_client`), puis fermée ; les 6 appels du serveur passent par les
vraies routes ; déclencheurs intacts. Les suites existantes (règle 2, règle 3, point 8)
donnent des résultats identiques ligne à ligne avec et sans 050. Requête d'écarts
régénérée **sur la branche de relecture seulement** : seules les 8 lignes `exec=111`
deviennent `exec=001`. La requête de la branche de production reste celle de 049, valable
tant que 050 n'est pas exécutée. Aucun code ne change : la
migration s'exécute seule, puis son fichier et la requête régénérée se poussent.

**Point 10 — secret des cartes Apple.** `secretCartes()` dans `apple-pass.js` :
`APPLE_PASS_SECRET`, repli sur `JWT_SECRET`. Au démarrage (`index.js`) : refus si la
variable ne diffère de `JWT_SECRET` que par des espaces ; le journal dit quelle variable
signe les cartes et si elle est identique à `JWT_SECRET` (jamais de valeur). Déployé sans
la variable : aucun changement. Ordre : code, puis variable (journal « identique : oui »),
puis scan cobaye sur une carte iPhone. **Préalable toujours non confirmé : copie de
`JWT_SECRET` hors de Railway.** La rotation de `JWT_SECRET` elle-même reste une opération
distincte, qui déconnecte tous les dashboards et toutes les caisses.

**Hypothèses.** 050 : exécutée par `postgres` dans le SQL Editor ; aucun composant Supabase
n'appelle les fonctions de `public` avec `anon` ou `authenticated` (question posée). Point
10 : `computeAuthToken` reste l'unique source du jeton (`pass.json` et webservice).

**Limite.** Une branche non suivie vieillit : avant de la reprendre, la fusionner avec la
production, rejouer les deux bancs et régénérer la requête d'écarts.

## 15 duodecies. FORFAITS ALIGNÉS SUR L'OFFRE COMMERCIALE (2026-09-30)

**Décisions de Yass (30/09).**
1. Smart notifications dès le Pro.
2. Landing premium : case cochable dans l'admin, **en Pro comme en Pro+** (D1 b : pas
   forcée en Pro+ ; Basic : section masquée, comme avant). Un marchand dont la landing
   premium est active récolte email, téléphone et anniversaire, **les voit sur la fiche
   et peut les exporter en CSV** (D2 b).
3. Quotas de notifications manuelles : Basic 0, Pro 5, Pro+ 20 (avant 0 / 10 / 50). Le
   quota réglé à la main dans l'admin prime toujours, **0 compris** (D3 : 0 devient
   possible depuis l'admin).
4. Ensuite, Yass repasse en Pro, par le formulaire admin, les commerçants français mis
   en Pro+ pour les smart notifications. Parrainage inchangé (tous forfaits).

**Diagnostic.** La règle 1 était déjà en place depuis le 25/09 (`ca0579a`, §15 sexies)
sauf l'anniversaire, qui exige la landing premium, alors réservée au Pro+ : la règle 2
le débloque. Requêtes de Yass en production (30/09) : **aucun Pro+ n'utilise de fond
photo** sur ses cartes (le fond photo reste Pro+, `strip-cache.js:232`) ; **aucun
marchand n'a dépassé le nouveau quota** de son forfait sur les trois derniers mois.

**Livré.**
- `src/services/forfaits.js` (nouveau) : **seul endroit où les règles s'écrivent** —
  `landingPremiumActive` (Pro ou Pro+, case à `true` ; `landing_premium` est nullable
  en production), `droitCoordonnees`, `limiteMensuelle`, `NOTIF_LIMITS`.
- Inscription (`clients.js`) : coordonnées et consentements enregistrés si la landing
  premium est active (avant : si Pro+, case ignorée). Fiche et export CSV : droit =
  `droitCoordonnees`.
- `GET /merchants/:slug/public` renvoie `landing_premium_actif` ; la landing ne
  recalcule plus la règle (`landing.html`). `GET /merchants/me` renvoie
  `coordonnees` ; le dashboard montre le bouton d'export sur cette seule information
  et affiche les coordonnées que l'API lui envoie (plus de test `pro_plus`).
- Dashboard : `/me` relu à chaque chargement de l'aperçu (en parallèle, sans attente de
  plus). Avant, il ne l'était que si `max_value` valait 10 : un changement fait dans
  l'admin pouvait laisser un bouton faux jusqu'à la déconnexion.
- Admin : section « Landing page » visible en Pro et Pro+ ; la case reflète toujours la
  base, même masquée (changer le forfait dans le formulaire révèle la vraie valeur au
  lieu d'une case vide qui écraserait la base). Quota manuel : vide → quota du forfait,
  0 → 0 (avant, `parseInt(...) || null` transformait 0 en « quota du forfait »).
- `notifications.js` : quotas lus dans `forfaits.js`.
- Cron : **aucun changement de comportement** ; le filtre SQL de l'anniversaire
  (forfait ∈ pro, pro_plus ET case cochée) était déjà la règle 2. Commentaires mis à
  jour.

**Interprétation validée par Yass (feu vert du 30/09).** « Coordonnées visibles si landing premium
active » est codé **« Pro+, OU landing premium active »** : un Pro+ sans la case garde
la fiche et l'export (aucune régression pour un Pro+). La landing d'un Pro+ sans la
case ne récolte rien de nouveau.

**Tests.**
- **Règle 2 + D3 : 73/73**, stable sur 6 passages. Banc complet (base rejouée,
  PostgREST, ancien serveur HEAD et nouveau côte à côte), six marchands : Pro+, Pro,
  Basic, chacun avec et sans la case (Basic : case restée cochée en base). API publique,
  inscription (coordonnées + consentements en base), fiche, export, `/me`, anniversaire
  du cron (retenus : Pro+ et Pro avec case, jamais Basic ni sans case). Navigateur :
  champs de la landing, inscription réelle par la landing d'un Pro avec case, bouton
  d'export et fiche du dashboard (dont une mémoire locale fausse, corrigée par le
  serveur), formulaire admin (case, quota 0, vide, 7 ; Basic enregistré sans toucher la
  case ; bascule Basic → Pro dans le formulaire).
- **Règle 3 : 23/23** (quotas 0/5/20, quota manuel prioritaire, blocage au bon seuil,
  mois précédent non compté, forfait illisible → quota du Pro).
- **Point 8, régression : 31/31** sur les vérifications « nouveau = référence » ; les
  4 vérifications « avant correction » n'ont plus d'objet (la référence HEAD contient
  déjà le point 8).
- Instabilité du banc corrigée : le service worker du dashboard recharge la page à sa
  première installation ; bloqué dans ce test. Aucun lien avec le code livré.

**Hypothèses (ce qui le ferait casser).** Deux miroirs hors de `forfaits.js`, à tenir
alignés : le filtre SQL de l'anniversaire (`cron.js`) et la visibilité de la section
dans l'admin. Un nouveau forfait doit être ajouté à `forfaits.js` ET à ces deux miroirs.

**Limites.** Un marchand qui perd la landing premium (case décochée, ou repassé en
Basic) garde en base les coordonnées déjà récoltées : masquées, pas effacées. Le texte
de consentement de la landing est inchangé. Le serveur ne valide pas la valeur du quota
manuel (§16). Un quota manuel à 0 renvoie le message existant « not available on the
Basic plan », quel que soit le forfait (message non modifié).

**DÉCISION DE YASS (01/10) : les commerçants français RESTENT en Pro+ pour l'instant.**
Yass les repassera en Pro le jour où une fonction Pro+ sera ajoutée. D'ici là, rien à
faire ; la procédure ci-dessous sert ce jour-là.

**Étape 4, pour Yass (le jour venu).** Pour chaque commerçant français à repasser en
Pro : ouvrir sa fiche dans l'admin, forfait → Pro, **cocher « Landing page premium »**
s'il doit continuer à récolter et voir les coordonnées et à envoyer l'anniversaire,
enregistrer. Il garde les relances, passe à 5 notifications manuelles par mois (aucun
n'a dépassé ce seuil). Chaque enregistrement régénère les images des cartes : sans
effet visible, aucun fond photo n'étant utilisé.

**Vérification après push (Yass).** Un Pro avec la case : sa landing montre les trois
champs ; son dashboard montre le bouton d'export et les coordonnées sur une fiche. Un Pro
sans la case : ni champs, ni bouton, ni coordonnées. Onglet notifications d'un Pro :
« … / 5 ». Admin : un quota à 0 reste 0 après enregistrement.

**Retour arrière.** `git revert` du commit, puis push. Les cases cochées en Pro restent en
base, sans effet avec l'ancien code (qui exige le Pro+).

## 15 terdecies. ÉTAPE 8 : NODE FIGÉ, RÉGLAGES RAILWAY AVANT LE 01/12 — EN COURS (01/10)

**Diagnostic (01/10, aucun réglage touché).**
- **Node.** `engines.node` valait `>=22.0.0` et `.nvmrc` `22`. Nixpacks (déclaré par
  `railway.toml`) lit `NIXPACKS_NODE_VERSION`, puis `engines`, puis `.nvmrc`, prend la
  version paire la plus récente de sa table qui recoupe la plage (24) et installe celle de
  son archive épinglée : **24.10.0** (code source de Nixpacks, `src/providers/node/mod.rs`,
  relu le 01/10). Railpack lit `RAILPACK_NODE_VERSION`, `devEngines`, puis `engines`, puis
  `.nvmrc`, et résout la plage avec mise (documentation de Railpack, relue le 01/10) :
  `>=22.0.0` laisserait passer la version la plus haute, donc 26. **Le saut menace dès que
  le constructeur change, pas seulement après le 28/10.**
- **Constructeur.** La documentation de Railway ne propose plus que Railpack (par défaut) et
  Dockerfile ; Nixpacks n'est utilisé que parce que `railway.toml` le demande. **Ce que
  propose la liste « Builder » du service : à relever par Yass (capture).**
- **Signature des cartes Apple.** Elle appelle le programme `openssl` de l'image
  (`apple-pass.js:290`). Présence d'`openssl` dans l'image Railpack : HYPOTHÈSE à tester
  (sinon `RAILPACK_DEPLOY_APT_PACKAGES=openssl`). **Le healthcheck `/health/db` ne verrait
  pas une signature cassée** : il faut tester une vraie carte.
- **Les 5 réglages de `railway.toml`** → tableau de bord (service → Settings) : Build →
  Builder ; Deploy → Custom Start Command `npm start` ; Healthcheck Path `/health/db` ;
  Healthcheck Timeout `30` (ou variable `RAILWAY_HEALTHCHECK_TIMEOUT_SEC`) ; Restart Policy
  On Failure, 3. **Tant que le fichier est lu, il l'emporte à chaque déploiement** et ne
  modifie pas le tableau de bord (doc Railway, Config as Code) : saisir les valeurs
  maintenant est sans effet ; la page d'un déploiement marque d'une icône de fichier les
  réglages venus du fichier.

**Plan proposé (ordre, risque, retour arrière).**
1. Figer Node — **FAIT** (ci-dessous).
2. Captures des réglages actuels et de la liste Builder (Yass) — aucun risque.
3. Saisie des réglages Deploy dans le tableau de bord (Yass) — sans effet tant que le fichier
   existe ; au plus un redémarrage si Railway redéploie à l'application. Retour : ressaisir
   les valeurs des captures.
4. Constructeur : Nixpacks si encore proposé (sursis : en maintenance depuis le 24/11/2025,
   plus aucun correctif de Node) ; sinon Railpack ou Dockerfile **essayés dans un
   environnement temporaire** (il reprend les variables de production — même base, mêmes
   certificats, même cron de 08:00 UTC : le faire tourner hors de 08:00, sans le domaine
   `app.winwin-card.com`, le supprimer le jour même).
5. Retrait de `railway.toml` par un commit, vers la mi-novembre : premier déploiement lu
   depuis le tableau de bord, à notre date. Retour : revert (le fichier revient, valable
   jusqu'au 30/11 seulement).
**Décision de Yass attendue pour 2 à 5.** Autre voie possible, sans urgence :
`railway config migrate` (réglages dans `.railway/railway.ts`, versionnés).

**Relevé et décision de Yass (01/10).** Captures : Builder = Nixpacks, marqué
« Deprecated » ; Start command `npm start`, Healthcheck `/health/db` et 30, Restart On
Failure et 3 — **tous verrouillés par `railway.toml`** (champs non modifiables, la liste
Builder ne s'ouvre pas), valeurs correctes. Déploiement `b3ba6f8` vert, `/health` →
`v24.10.0`. **Décision : on garde Nixpacks ; changement de constructeur reporté à
l'étape 20**, testé ce jour-là avec une vérification de carte iPhone sur le téléphone de
Yass.

**Ce que le verrou cache (01/10).** L'écran affiche les valeurs du FICHIER ; les valeurs
ENREGISTRÉES pour le service (celles qui serviront sans le fichier) sont invisibles tant
qu'il existe. La saisie dans le tableau de bord, prévue au geste 3, est impossible.
Nixpacks sélectionnable après retrait : **non démontré, probablement non** — la
documentation de Railway ne liste plus que Railpack et Dockerfile (Config as Code, relu le
01/10) et le paramètre `builder` n'apparaît plus dans les champs documentés de
`serviceInstanceUpdate` (API publique) ; une réponse du forum Railway, vue en résumé de
recherche (page inaccessible depuis le conteneur), dit Nixpacks non sélectionnable. **Ce
qui décidera : la valeur `builder` ENREGISTRÉE du service**, lisible par une requête en
lecture seule de l'API publique (`serviceInstance`). Si elle vaut `NIXPACKS`, retirer le
fichier garde Nixpacks. Sinon, **garder Nixpacks après le 01/12 est impossible** (le
fichier cesse d'être lu ce jour-là) et l'étape 20 devra être faite avant le 01/12.
Procédure transmise à Yass le 01/10 : 1. requête de lecture ; 2. si besoin, mise à jour
des 4 réglages Deploy enregistrés par l'API pendant que le fichier, prioritaire, les
neutralise ; 3. retrait de `railway.toml` par un commit (feu vert), vérifications ;
retour : revert, valable jusqu'au 30/11.

**Geste 1 — Node figé à 24.10.0 (01/10, feu vert de Yass).** `engines.node` : `24.10.0`
(exact) ; `.nvmrc` : `24.10.0` (les deux sources disent enfin la même chose) ;
`package-lock.json` régénéré par npm (`--package-lock-only`) : seule la ligne `engines` de
la racine change. Exact plutôt que `24.x` : le jour du changement de constructeur, Node ne
doit pas bouger en même temps ; les correctifs de Node viendront à part (étape 20).
Simulation des deux règles (bibliothèque semver de npm, liste de versions fictive) :
Nixpacks → `nodejs_24` (24.10.0, inchangé) ; Railpack → exactement 24.10.0, contre la plus
haute version avec `>=22.0.0`. **Hypothèses** : mise et la bibliothèque semver de Nixpacks
traitent une version exacte comme npm ; Nixpacks garde son archive épinglée. **Limite** :
Node reste sans correctif de sécurité depuis octobre 2025 (inchangé). **Vérification après
déploiement** : `/health` → `"node":"v24.10.0"`. **Retour arrière** : revert du commit.

### Geste 2 — Dockerfile à la place de Nixpacks (préparé et testé le 02/10, NON poussé)

**Décision de Yass (02/10).** Passage à un Dockerfile : Nixpacks ne tiendra pas après le
01/12. Requête GraphiQL non faite. Champ « Railway Config File » relevé **vide** par Yass :
`railway.toml` est lu à sa place par défaut (racine du dossier source) ; rien à vider le
jour J.

**Documentation Railway (relue le 02/10, dépôt `railwayapp/docs`).** Railway utilise un
fichier nommé exactement `Dockerfile` à la racine du dossier source (`winwincard/backend`)
et l'annonce par « Using detected Dockerfile! » ; il construit toujours avec un Dockerfile
s'il en trouve un (le réglage Builder ne compte plus). Watch Paths : motifs depuis la racine
du dépôt, `/winwincard/backend/**` couvre le Dockerfile ; aucun réglage à changer.

**Contenu.** `winwincard/backend/Dockerfile` : image officielle **complète**
`node:24.10.0-trixie` épinglée par empreinte (Debian 13) ; `ENV NODE_ENV=production` ;
`npm ci --omit=dev` ; `CMD ["npm", "start"]`. `.dockerignore` (dépendances locales,
`.env`, journaux).

**EN DEUX PUSHS (proposition de Yass, retenue le 02/10).**
- **2a.** Dockerfile + `.dockerignore`, et `railway.toml` **gardé** avec
  `builder = "DOCKERFILE"` (valeur documentée par Railway, Config as Code). Le healthcheck
  `/health/db` (30 s), le redémarrage On Failure (3) et la commande de démarrage restent
  dans le fichier : la nouvelle image part **sous le garde-fou**.
- **2b, un autre jour, avant la mi-novembre.** Suppression de `railway.toml`, puis
  healthcheck et redémarrage remis dans le tableau de bord.
- **Pourquoi c'est mieux qu'un seul push.** Le changement risqué, c'est-à-dire l'image,
  est protégé par le healthcheck. Le déploiement sans garde-fou ne change plus que la
  source des réglages, avec une image déjà éprouvée en production. Une seule chose
  change à la fois.
- **Pourquoi l'image complète et pas « slim ».** La version « slim » n'a pas le programme
  `openssl` qui signe les cartes Apple (vérifié dans les deux images « slim »). L'installer
  par `apt-get` à chaque construction fonctionnerait chez Railway, mais n'a pas pu être
  essayé ici (miroirs Debian refusés par la politique réseau de l'environnement de
  session) et ferait varier la version d'`openssl` d'une construction à l'autre. L'image
  complète contient OpenSSL 3.5.1, figé par l'empreinte. Coût : 2,02 Go non compressés.
- **Ce que Nixpacks posait sans le dire** (code source, `get_node_environment_variables`) :
  `NODE_ENV=production` — **repris**, car il choisit le serveur de notifications Apple de
  production (`apns.js:65`) ; `CI=true` et `NPM_CONFIG_PRODUCTION=false` — non repris
  (aucun usage dans le code ; seule dépendance de développement : nodemon).

**Essais (02/10, Docker 29.3.1 sur la machine de session).**
- **Construction.** Le Dockerfile du contexte de construction est identique, octet pour
  octet, à celui du dépôt. L'essai l'utilise avec **deux lignes de plus**, placées après
  `FROM` : le certificat du proxy de la session, indispensable ici et absent en production.
  Résultat : 213 paquets npm, image de 2,02 Go.
- **Dans l'image, sans réseau.** Node v24.10.0, OpenSSL 3.5.1, `NODE_ENV=production`.
- **Carte Apple signée par l'`openssl` de l'image,** avec une fausse chaîne de
  certificats (fausse racine, faux WWDR, faux certificat de signature à phrase secrète) :
  - empreintes du manifeste toutes justes ;
  - signature vérifiée par un `openssl` indépendant (3.0.13, celui de la machine), avec un
    condensat SHA-256 et la chaîne embarquée ;
  - un manifeste altéré d'un octet est refusé.
- **Bandeaux.** Trois thèmes (tampons, illustration, points) en trois tailles : les
  9 images sont identiques, octet pour octet, au rendu fait hors de l'image (sharp 0.33.5,
  resvg 2.6.2). Vérifiées à l'œil, polices comprises.
- **Serveur.** Démarré par la commande de l'image (`npm start` → `node src/index.js`)
  sur une base rejouée : `/health` → v24.10.0, `/health/db` → 200, et la vraie route
  `/api/passes/:serial/apple` → 200 (`application/vnd.apple.pkpass`), signature vérifiée.

**Hypothèses et limites.**
- Les vrais certificats Apple ne sont pas testables ici : la carte iPhone de Yass, le jour
  J, est la seule preuve possible.
- Le système et OpenSSL sont figés par l'empreinte : aucun correctif de sécurité Debian
  sans commit (comme sous Nixpacks aujourd'hui) ; la mise à jour relève de l'étape 20.
- `npm start` tourne en processus principal ; l'arrêt propre relève de l'étape 14.
- Une variable Railway `NODE_ENV` éventuelle l'emporte sur celle de l'image.
- La première construction sera plus longue que d'habitude, l'image de base pesant environ
  400 Mo compressés.

**Premier déploiement sans `railway.toml` (push 2b) : réglages probables.**
- Constructeur : ignoré (le Dockerfile l'emporte).
- Commande de démarrage : probablement vide, donc `npm start` de l'image.
- Healthcheck : probablement aucun.
- Redémarrage : défaut de Railway, On Failure avec 10 essais.

**Risque de ce déploiement (2b).** Sans healthcheck, Railway rend le nouveau conteneur actif
dès son démarrage, au lieu d'attendre `/health/db`. Un conteneur qui ne démarrerait pas, ou
ne lirait pas la base, remplacerait donc l'ancien au lieu d'être refusé : coupure jusqu'au
retour arrière. Avec le découpage, c'est **très peu probable** : l'image sera déjà
éprouvée en production par 2a, et seule la source des réglages change. Quelques requêtes
peuvent aussi échouer pendant la bascule.

**Push 2a (hors 07:30–09:15 UTC, à l'heure donnée par Yass).**
1. Journal de construction : « Using detected Dockerfile! ».
2. Le déploiement passe le healthcheck `/health/db`, toujours dans le fichier.
3. `/health` → v24.10.0.
4. Vérification d'une carte iPhone par Yass : une nouvelle carte installée (signature),
   puis un scan, et la carte se met à jour (notification Apple de production).
5. Le lendemain : `/health/cron` (cron de 08:00 UTC dans la nouvelle image).

**Push 2a FAIT et VÉRIFIÉ (02/10, `6f8f596`, poussé à 12:13 UTC).** Vérifié par Yass :
déploiement vert sous garde-fou (healthcheck `/health/db` de `railway.toml`), `/health` →
v24.10.0, carte iPhone créée, scannée et mise à jour. Les journaux « pass was unchanged »
d'Apple existaient déjà avant (relance de 08:00 UTC) : sans lien avec le Dockerfile, **à
reprendre aux étapes 23-24** (cartes régénérées sans changement, 02 §11). **Push 2b prévu
vers le 05/10.**

**Push 2b FAIT le 04/10** (`/health/cron` du 04/10 « fini » avant le push) : `railway.toml`
supprimé ; commentaire de `src/index.js` mis à jour (`5630092`). **Vérifié par Yass le
04/10** : « Using detected Dockerfile! », Custom Start Command vide, Healthcheck Path
`/health/db` (30 s) et Restart Policy On Failure (3) reposés dans le tableau de bord et
déployés (« Healthcheck succeeded! »), `/health` v24.10.0, `/health/db` ok, scan de test
OK. **L'étape 8 est close.**

**Push 2b (un autre jour, avant la mi-novembre).**
1. Suppression de `railway.toml`.
2. Après le déploiement, dans Settings, désormais déverrouillés :
   - Healthcheck Path `/health/db`, Timeout `30` ;
   - Restart Policy On Failure, `3` ;
   - commande de démarrage (« Custom Start Command ») **VIDE**, jamais `npm start` : un
     champ rempli remplace la commande du Dockerfile (documentation Railway,
     `deployments/start-command.md`) et rendrait impossible l'arrêt propre de l'étape 14
     (mesuré le 03/10 : démarré par `npm`, Node ne reçoit pas le signal d'arrêt).
3. Appliquer et déployer : le second déploiement doit passer le healthcheck.
4. Contrôler la page du déploiement : plus d'icône de fichier, bonnes valeurs.

**Retour arrière.**
- **2a :** Railway → Deployments → déploiement précédent (`b3ba6f8`, Nixpacks) →
  Rollback, qui restaure son image et ses variables (si l'image est encore conservée par
  l'offre). Puis `git revert` : retour à `builder = "nixpacks"`, valable jusqu'au 30/11.
- **2b :** Rollback vers le déploiement 2a, puis `git revert` : le fichier revient,
  valable jusqu'au 30/11.

## 15 quaterdecies. ÉTAPE 10 : LE FILET DE TESTS ARGENT ET SCAN (02/10)

**Ce que c'est.** Une commande, `npm test` dans `winwincard/backend`, rejoue la base depuis
le dépôt dans un PostgreSQL local jetable, démarre le vrai serveur et vérifie 62
comportements de l'argent et du scan. Résultat en une ligne : « N/N OK ». Rien de réel n'est
touché (ni Supabase, ni Railway, ni Apple, ni Google). Durée : 10 à 12 s ; le premier
lancement télécharge en plus PostgREST depuis GitHub, empreinte vérifiée. Fichiers :
`tests/lancer.js` (orchestration) et `tests/scenarios.js` (scénarios). **Aucun code de
production modifié** ; `package.json` reçoit le script `test`, le lockfile est inchangé.

**Comment il marche.**
1. Base `winwin_filet` recréée : prélude Supabase (rôles anon, authenticated, service_role ;
   extensions), puis `schema.sql`, les migrations dans l'ordre, `rgpd_effacement.sql`. C'est
   la méthode de `database/requetes/ecarts_prod_depot/generer.sh` (§15 octies) : une
   nouvelle migration du dépôt est rejouée sans rien changer au filet.
2. PostgREST v12.2.12 (l'API que Supabase met devant la base) derrière le préfixe
   `/rest/v1`, avec une clé service_role locale.
3. Le vrai `src/index.js`, lancé depuis un dossier temporaire VIDE : un `.env` présent sur la
   machine n'est jamais lu. Preuve du 02/10 : un `.env` piège contenant un `SENTRY_DSN` →
   journal du serveur « SENTRY_DSN absent ». Sans clés Apple ni Google, les envois
   échouent proprement en local.
4. À la fin : base supprimée, processus arrêtés (`FILET_GARDER=1` les garde pour enquêter).
   Code de sortie 0 si tout est OK, 1 au moindre KO, 2 si le filet n'a pas pu tourner
   (« FILET INTERROMPU »).

**Les 62 vérifications** (liste validée par Yass le 02/10 ; audit 02 §10, synthèse §4.3).

| Bloc | Ce qui est vérifié |
|---|---|
| 0. Préalable | droits de service_role sur les 7 tables centrales (étape 9) ; `/health/db` 200 |
| 1. Tampons | +1 ; montant envoyé ignoré ; 9→10 récompense acquise non remise ; remise au passage suivant ; lignes de journal |
| 2. Points | +50 ; franchissement ; report du surplus (530→80) ; report en cascade (630→140) ; montants refusés sans écriture ; borne 100 000 ; fonction SQL appelée seule |
| 3. Simultanés, renvoi | 10 scans simultanés : rien de perdu, chaîne du journal complète ; renvoi (ÉTAT ACTUEL) |
| 4. Annulation | jeton marchand ET jeton boutique (écart A) : dernier scan seulement, une seule fois, répétable, refus après ajustement, deux annulations simultanées, autre boutique refusée |
| 5. Ajustement | accepté ; bornes refusées ; ajustement pendant un scan |
| 6. Code de secours | crédit ; code partagé par deux clients (409, aucun crédit) ; inconnu ; format |
| 7. Refus avant écriture | boutique coupée ; archivée ; jeton marchand sur un réseau ; carte d'un autre marchand ; marchand suspendu puis réactivé |
| 8. Parrainage | inscription avec le lien ; crédit unique à vie ; mode points (écart B, ÉTAT ACTUEL) |
| 9. Coupures | crédit sans ligne ; journal dans le désordre (ÉTAT ACTUEL) |

**Les « ÉTAT ACTUEL » : défauts figés tels quels, et l'étape qui les inversera.** Un
scénario « ÉTAT ACTUEL » qui passe au rouge signale un changement de comportement : voulu
(l'étape qui corrige inverse le scénario dans le même commit) ou non (régression).

| Constat figé | Étape |
|---|---|
| même demande envoyée deux fois : deux crédits | 11 |
| crédit sans ligne de journal (coupure) ; journal dans le désordre : rien ne s'annule | 11 |
| ajustement sans ligne de journal ; ajustement pendant un scan : 5 ou 6 selon l'ordre d'arrivée | 13 (ajustement conditionnel, journalisé) |
| en points, ajustement au-dessus du seuil accepté par le serveur (l'écran le refuse) | 13 (« sans plafond au seuil » : c'est l'écran qui changera) |
| annulation d'un dernier scan hors des 100 derniers de la boutique : acceptée par le serveur | 13 (annulation rendue atteignable) |
| jeton marchand sur un réseau : annule le scan d'une boutique | 13 (bouton du dashboard, écart A) |
| parrainage en points : parrain crédité (+5), et ramené au seuil s'il est au-dessus (perd 30) | 14b (écart B, `credit_referral`) : **inversé** — parrainage permis en points (décision 1 refusée), bonus entier, jamais de baisse |
| parrain en tampons déjà à 10/10 : le tampon est perdu | aucune : règle produit du 27/09 (audit 02 §4.4) |

**Preuve qu'il attrape une casse (02/10).** Trois règles cassées exprès en local, puis
remises (`git checkout`, rien commité) :

| Casse | Résultat |
|---|---|
| `scan.js` : la boutique coupée n'est plus refusée | 60/62 : refus 403 et « rien d'écrit » en KO |
| `scan.js` : l'annulation d'une autre boutique n'est plus refusée | 60/62 : autre boutique acceptée, KO |
| migration 023 : le surplus des points n'est plus reporté | 58/62 : les 4 vérifications du report en KO |

Stabilité : 6 passages complets à 62/62 le 02/10, de 10 à 12 s chacun.

**Décisions de Yass (02/10).**
- **Écart A** : bouton « annuler le dernier scan » dans le dashboard (décision du 29/09),
  chantier à part à l'étape 13. Le filet teste dès maintenant la route avec les deux jetons.
- **Écart B** : le filet fige l'état actuel (parrain crédité en points). La règle « jamais
  en mode points » entrera dans le code à l'étape 14, avec la correction de
  `credit_referral`. **D'ici là, Yass ne coche jamais la case parrainage d'un marchand en
  points.**
- **Règle** : `npm test` avant tout push qui touche l'argent, le scan, les migrations ou
  l'authentification (§7, règle 7).
- **Phase 2, REPORTÉE** : GitHub Actions lance le filet à chaque push et Railway attend son
  résultat (« Wait for CI ») avant de déployer. Après 2 à 3 semaines sans fausse alerte,
  soit vers le 16-23/10. Rien n'est fait.

**Hypothèses (ce qui ferait casser le filet) et limites.**
- PostgreSQL 16 dans le conteneur, 17.6 en production (00a §8) ; PostgREST 12.2.12 en
  local, version de Supabase non vérifiée. Un comportement propre aux versions de
  production échapperait au filet.
- Le filet suppose que le dépôt reconstruit la production (étape 9 : requête d'écarts
  IDENTIQUE le 29/09). Un changement fait à la main dans Supabase, sans migration, lui est
  invisible : relancer la requête d'écarts après chaque migration.
- Jetons fabriqués avec le secret local : le filet teste les droits de chaque jeton
  (marchand, boutique, admin), PAS les écrans de connexion ni les mots de passe.
- Ni carte Apple ou Google, ni notification, ni écran (dashboard, scanner) : le serveur et
  la base seulement. Le filet ne remplace pas le test terrain sur cobaye (§7, règle 5).
- Les données du filet (marchands, boutiques, clients) sont écrites directement en base :
  une migration qui ajoute une colonne obligatoire à ces tables arrête le filet
  (« FILET INTERROMPU ») ; compléter alors les données dans `scenarios.js`.
- Linux x86-64 seulement (binaire PostgREST), PostgreSQL local avec accès
  superutilisateur, `curl` et `tar`. Réseau vers GitHub au premier lancement :
  téléchargement réessayé 4 fois (GitHub a répondu 502 une fois le 02/10).

**Déploiement.** Le commit touche `winwincard/backend/` (`tests/`, `package.json`) :
Railway reconstruit et redéploie (chemins surveillés), sous le garde-fou `/health/db`. Le
code servi est inchangé ; l'image contient le dossier `tests/`, jamais exécuté par
`npm start`. Option, non faite : ajouter la ligne `!/winwincard/backend/tests/**` sous
`/winwincard/backend/**` dans les chemins surveillés, pour qu'un commit qui ne touche que
les tests ne redéploie pas (négation documentée par Railway, qui exige une règle
d'inclusion avant elle).

## 15 quindecies. ÉTAPE 11a : LE CRÉDIT INCASSABLE (03/10)

**Décisions de Yass (03/10).** Étape 11 faite sans développeur extérieur, en deux pushs :
11a (base et serveur, écrans inchangés) puis 11b (écrans : clé envoyée, et gardée après
une erreur) ; demandes sans clé acceptées pendant la transition ; 11a le 03/10, push vers
12:30 UTC au plus tôt (après le rush du midi en France) ; push 2b de l'étape 8 reporté au
lendemain.

**Le défaut (audit 02 §3.2, §4.1 à §4.3).** Un scan écrivait le solde
(`increment_stored_value`), PUIS la ligne de journal et la carte, en deux autres
écritures. Une coupure entre elles laissait un solde crédité sans ligne (et la caisse
voyait parfois « succès ») ; deux scans du même client écrivaient leurs lignes dans le
désordre (le dernier ne s'annulait plus) ; un renvoi créditait deux fois. **Mesuré sur le
banc le 03/10** : 10 scans simultanés → journal dans le désordre 4 fois sur 5.

**Ce que fait 11a.**
- **Migration 051** : fonction `crediter_scan`, une transaction : verrou de la carte,
  renvoi reconnu par sa clé, crédit par `increment_stored_value` (la règle reste à un
  seul endroit, inchangée), ligne de journal, carte (message et date). Tout ou rien.
  L'heure de la ligne est prise APRÈS le verrou (`clock_timestamp()`) : l'ordre des
  dates suit l'ordre des crédits. Clé d'idempotence `scans.cle_idempotence`, unique par
  marchand. Garde-fous : solde jamais négatif, seuil jamais nul ni négatif. Fonction
  fermée à `anon` et `authenticated`.
- **`scan.js`** : un seul appel à `crediter_scan` au lieu de trois écritures (un échange
  avec la base de moins par scan, ≈ 0,2 s, HYPOTHÈSE à mesurer). Clé facultative
  (`cle_idempotence`, UUID). Renvoi d'une clé déjà enregistrée : même réponse, marquée
  `deja_enregistre`, rien recrédité, ni parrainage ni demande d'avis relancés.
- Les messages de la carte restent écrits par i18n : le serveur prépare les trois
  messages possibles, la base pose celui de l'issue réelle (« {{solde}} » remplacé).

**Réponses nouvelles de `POST /api/scan`** (aucune n'arrive tant qu'aucun écran
n'envoie de clé, donc pas avant 11b) : 400 clé mal formée ; 409 `idempotency_conflict`
(même clé pour une autre carte ou un autre montant) ; 409 `scan_cancelled` (renvoi d'un
scan annulé depuis : jamais recrédité). Champ `deja_enregistre` dans la réponse.

**Tests (filet, `npm test`) : 86/86** (4 passages sous Node 24.10.0, la version de
production, et 1 sous Node 22, celle du conteneur ; versions intermédiaires du filet :
84/84 × 6, 85/85 × 5). Inversés : renvoi (même
clé → un crédit), crédit sans ligne (panne forcée dans la transaction → rien d'écrit),
désordre (10 scans simultanés → chaîne dans l'ordre des dates). Nouveaux : 10 envois
simultanés de la même clé, même clé pour deux cartes en même temps (dont une course
provoquée qui fait refuser la base, erreur 23505 → 409), clé d'une autre carte / d'un
autre montant / d'un autre marchand, clé mal formée, renvoi d'une remise, renvoi d'un scan annulé, panne à
l'écriture de la carte, message de la carte, garde-fous, droits de la fonction.
**Preuves** : le nouveau filet (84 vérifications à ce stade) sur l'ANCIEN `scan.js` → 68/84, dont « panne à
l'écriture de la ligne → 200, solde +1, aucune ligne » (la caisse voyait un succès) ;
`clock_timestamp()` remplacé par `now()` → désordre revu 2 fois sur 3. L'ancien code sur
la nouvelle base passe les 62 vérifications d'avant : la migration est sans risque pour
le code en place et pour un retour arrière.

**Migration 051 EXÉCUTÉE par Yass le 03/10, avant le push.** Vérification : `0 | 0 |
true | false | false` ; contrôle : 7 × `true` ; requête d'écarts : **IDENTIQUE au dépôt**,
0 écart, 45 droits « plateforme » (Dxt hérités, 15 objets × 3 rôles, regroupés en 3
lignes), dont `crediter_scan` identique (code, droits `exec=001`, `search_path`). Pizza
Sabbioni confirmé en points, seuil 500.

**Ordre du jour J.** 1. Requête de vérification (soldes négatifs, seuils ≤ 0 : 0 et 0) ;
2. migration 051 dans Supabase ; 3. requête de contrôle (7 × `true`) ; 4. requête
d'écarts régénérée (`IDENTIQUE`, 3 lignes plateforme) ; 5. push sur feu vert ; 6. tests
manuels sur Pizza Sabbioni (iPhone et Android) ; 7. si bons, 11b le même jour.

**Retour arrière.** Railway → Rollback vers le déploiement précédent, puis `git revert`.
La migration reste : l'ancien code marche avec (prouvé par le filet). Les lignes de
retrait (contraintes, fonction, colonne) sont en fin de `migration_051`, à n'utiliser
qu'après le retour arrière du code.

**Hypothèses (ce qui ferait casser) et limites.**
- Une clé = un scan voulu. Un écran qui réutiliserait une clé pour une autre carte ou un
  autre montant est refusé (409, rien d'écrit) ; pour le même montant sur la même carte,
  le second scan voulu serait pris pour un renvoi (11b doit changer de clé après chaque
  réponse claire).
- Les messages restent du texte simple où « {{solde}} » n'apparaît qu'à sa place (un
  prénom contenant « {{solde}} » afficherait un nombre : sans conséquence).
- Envois Apple et Google toujours APRÈS la réponse, hors transaction : un plantage juste
  après l'écriture laisse la carte non rafraîchie jusqu'au scan suivant (argent juste).
  Sur un renvoi, Apple et l'objet Google sont renvoyés (sans effet si à jour), pas le
  message Google (il s'afficherait deux fois sur Android).
- L'ordre des dates est garanti pour les lignes écrites par `crediter_scan` ; l'historique
  ancien reste tel quel.
- La transaction garde la carte verrouillée pendant l'écriture de la ligne, qui touche
  la ligne du marchand (clé étrangère). `credit_referral` verrouille le client PUIS le
  marchand (mesuré le 03/10 sur PostgreSQL 16 : le crédit du parrain attend la fin du
  scan, aucun blocage croisé). Si cet ordre changeait, un parrain scanné pendant le
  crédit de son filleul pourrait se bloquer une seconde, et PostgreSQL annulerait l'une
  des deux opérations. L'étape 14 retire le verrou du marchand (audit 02 P4).
- Le test de l'ordre des dates détecte une régression par probabilité (2 fois sur 3 avec
  `now()`), pas à chaque passage.
- `npm test` prend le Node du PATH. Le conteneur a Node 22 : pour la parité avec la
  production, lancer le filet sous Node 24.10.0 (archive officielle nodejs.org,
  empreinte vérifiée).
- Hors périmètre : ajustement sans ligne (étape 13), parrainage (14), route machines
  (P6), clé obligatoire (après 11b, quand les journaux montrent 100 % de scans avec clé).

**11a POUSSÉ et VÉRIFIÉ (03/10).** `0a28d37`, poussé à 12:50 UTC. Tests de Yass en
production : Hamza Salon (tampons, carte « Test Docker » de Yass) — scan, remise,
annulation, refus d'annuler un scan antérieur à un ajustement : conformes ; chiffre de
la carte posé par la base (« +1 — … : 2/9 pts ») ; Pizza Sabbioni (points) : franchissement
et remise avec report conformes ; code de secours ; aucun 500. Deux constats, tous deux
hors 11a : un ajustement jusqu'au seuil envoie « Points mis à jour », pas « Merci pour ta
fidélité » (question produit pour l'étape 13) ; annuler une remise n'annule pas la
demande d'avis programmée (§16).

### 11b — les écrans envoient la clé (03/10)

**Ce que fait 11b** (`scanner/index.html`, `dashboard/index.html`, aucun code serveur) :
chaque scan voulu (carte + montant) reçoit une clé, envoyée avec le scan. La clé est
**gardée** tant qu'aucune réponse claire n'est arrivée (erreur réseau, réponse
illisible, 5xx) : un nouvel essai sur la même carte (serial complet ou code de secours)
avec le même montant reprend la même clé, et le serveur répond « déjà enregistré » au
lieu de recréditer. Elle est **effacée** dès qu'une réponse claire arrive (succès ou
refus) : le scan suivant, même de la même carte (« + Ajouter un tampon »), est un nouveau
scan. Gardée 10 min au plus, en `localStorage` (survit au réflexe « fermer/rouvrir ») ;
UUID par `crypto.randomUUID`, repli `getRandomValues` (iOS < 15.4). Les écrans affichent
« Déjà enregistré — … rien n'a été ajouté », et des messages clairs pour les refus
`scan_cancelled` et `idempotency_conflict`.

**Tests.** `npm test` : 86/86 (serveur inchangé). **Test navigateur** (nouveau,
`tests/navigateur/cle_ecrans.js`, hors `npm test` car il exige Playwright, présent dans
le conteneur cloud) : les vrais écrans dans Chromium, contre le serveur et la base du
filet ; le serveur crédite et la réponse est coupée avant l'écran. 15/15 (101/101 avec
le filet, 3 passages) : réponse perdue puis nouvel essai, erreur 500 puis « + Ajouter un
tampon », écran rechargé entre-temps, nouvel essai par code de secours, clé de plus de
10 min (nouveau scan), scan annulé entre-temps (refus clair, puis le suivant crédite),
points (même montant : une fois ; autre montant : nouveau scan), onglet du dashboard.
**Preuve** : sur les écrans d'avant, le nouvel essai crédite deux fois (`2|2`).
Lancement : `NODE_PATH=$(npm root -g) FILET_EN_PLUS=tests/navigateur/cle_ecrans.js node
tests/lancer.js` (variable `FILET_EN_PLUS` ajoutée à `lancer.js`).

**Hypothèses et limites.**
- Un même achat retapé dans les 10 min après une erreur sans réponse est pris pour un
  nouvel essai (« déjà enregistré » si le premier est passé). Si c'était vraiment un
  second achat, la caissière rescanne : la réponse claire a effacé la clé, le scan
  suivant crédite.
- Un autre montant, une autre carte scannée entre-temps, ou plus de 10 min = un nouveau
  scan : un double crédit reste possible dans ces cas, visible dans l'historique et
  annulable.
- Un écran resté ouvert depuis avant le push n'envoie pas de clé jusqu'à son
  rechargement (TRANSITION, acceptée par le serveur).
- L'étape 12 reste à faire : ne pas reproposer la carte après une erreur, le dire,
  délai maximal, 401/403/429.

## 15 sexdecies. ÉTAPE 12 : LA CAISSE APRÈS UNE ERREUR (12a et 12b poussés le 04/10)

**État (04/10).** 12a poussé seul (`ebe0d81`), **vérifié par Yass** : déploiement vert,
healthcheck OK, scan et annulation au scanner, scan depuis le dashboard, aucun 500. 12b
poussé ensuite, sur son feu vert, après 133/133 sur la branche `etape12` remise sur la
production (`5630092`). **12b vérifié par Yass le 04/10** (`2b31c92`) : scan normal
inchangé, « + Ajouter un tampon », bandeau « Carte non enregistrée », panneau « Connexion
perdue » en mode avion, scan depuis le dashboard, aucun 500. **L'étape 12 est close.**

**Diagnostic (03/10, observé dans le vrai écran, captures sur le banc).** Erreur réseau :
« Erreur réseau : Failed to fetch » 3 s, puis la carte tenue est reproposée aussitôt.
Pas de réponse : « Traitement… » sans fin (aucun délai). Session expirée (dont l'échéance
d'un an, premières le 26/05/2027), révoquée, compte suspendu : message brut (« Token
invalide ou expiré », « session_revoked », « account_suspended »), puis « ✓ Carte déjà
scannée » alors que rien n'est passé, et la même erreur à chaque scan. Boutique coupée :
écran de scan caméra éteinte, figé. Limiteur : « Erreur réseau : Unexpected token 'T'… »
(le limiteur global répondait en texte).

**Décisions de Yass (03/10).** Validées : renouvellement silencieux de la session (1),
un nouvel essai automatique avant le panneau (2), délai maximal de 15 s (3), découpage
12a puis 12b (5). **Refusée : toute vérification de session à l'ouverture ou au retour
au premier plan (4).** Contrainte absolue : aucune requête régulière en plus, aucun
ralentissement ; le scan normal ne change en rien (ni tap, ni écran, ni temps) ; seuls
appels en plus autorisés : le renouvellement (rare) et le nouvel essai (après une
erreur). Yass juge ces correctifs non primordiaux. Calendrier : push 2b de l'étape 8
d'abord, seul ; 12a et 12b un autre jour.

**12a — serveur.** (1) Le limiteur global répond en JSON `{ error: 'rate_limited' }`
(`index.js`), avec `Retry-After`. (2) `POST /api/scanner/renouveler` (`scanner-auth.js`) :
mêmes contrôles que le scan (`authScanner` : expiré 401, révoqué ou suspendu 403), rend
un jeton neuf d'un an avec exactement les mêmes champs ; une session courte (7 jours,
« ne pas se souvenir ») n'est jamais prolongée (400 `session_courte`). Filet : bloc 11,
6 vérifications ; `npm test` 92/92.

**12b — écrans** (scanner et onglet scanner du dashboard, même règle).
- Scan normal inchangé : un appel, mêmes écrans ; les ajouts (minuteur, lecture de la
  date d'expiration dans le jeton, sans requête) ne coûtent rien.
- Délai maximal de 15 s pour tout le passage. Échec passager (réseau, 5xx, limiteur)
  arrivé avant : UN nouvel essai automatique après 1 s, même clé (jamais de double
  crédit). S'il échoue encore, ou si le délai est écoulé : panneau « Connexion perdue —
  ce passage n'est peut-être pas enregistré », Réessayer (même clé, sans retaper le
  montant) / Annuler ; la détection est en pause, la carte n'est plus reproposée.
- 401, `session_revoked` : panneau « Session expirée » → écran de connexion, identifiant
  pré-rempli (`ww_scanner_identifiant`, jamais le mot de passe). `account_suspended` :
  « Compte suspendu ». `access_disabled` : « Caisse désactivée » (plus d'écran figé).
  Limiteur : « Trop de demandes — réessayez dans N min ».
- Bandeau de la carte tenue : « ✓ Prénom — déjà scanné » seulement après un vrai crédit ;
  « Carte non enregistrée » après un refus ou « Annuler » ; « ⚠️ Passage non confirmé »
  après une connexion perdue.
- Refus restants en mots simples : carte inconnue, code invalide, montant.
- Renouvellement : après un scan RÉUSSI seulement, si la session longue expire dans
  moins de 60 jours (lu dans le jeton) ; au plus une tentative par chargement, après la
  réponse. Une fois par an et par appareil.

**Tests.** Nouveau `tests/navigateur/caisse_erreurs.js` : les cas du diagnostic dans le
vrai écran, plus la contrainte (aucune requête à l'ouverture, une seule par scan normal,
renouvellement seulement quand il faut). `cle_ecrans.js` adapté (un échec seul est
désormais rattrapé par le nouvel essai automatique). `FILET_EN_PLUS` accepte plusieurs
modules. **133/133**, 3 passages, Node 24.10.0 :
`NODE_PATH=$(npm root -g) FILET_EN_PLUS=tests/navigateur/cle_ecrans.js,tests/navigateur/caisse_erreurs.js node tests/lancer.js`.
Preuve : sur les écrans et le serveur d'avant, la route de renouvellement n'existe pas
(6 KO) et le test navigateur s'arrête au premier comportement manquant (aucun nouvel
essai automatique).

**Hypothèses et limites.**
- Une caisse qui ne réussit aucun scan pendant les 60 jours avant l'échéance (commerce
  fermé deux mois) n'est pas renouvelée : elle affichera « Session expirée » et l'écran
  de connexion. Le dashboard n'est renouvelé que par les scans de son onglet : une
  session de dashboard sans scan expire au bout d'un an (écran de connexion, inchangé).
- Session volée : valable tant qu'elle sert (hypothèse acceptée, décision 1) ; la
  révocation par l'admin la coupe.
- Le nouvel essai sur un 429 échoue presque toujours (fenêtre de 15 min) : une requête
  de plus, sans effet. Le limiteur lui-même (compte par adresse du proxy de Railway)
  reste l'étape 17.
- Les messages simples reposent sur les textes d'erreur du serveur (« Invalid code… »,
  « points must be… », « Accès refusé ») ; les tests les surveillent.
- Rangement : commits locaux sur la branche `etape12` (non poussée), pour que le push
  2b parte seul sur la branche de production.

## 15 septdecies. ÉTAPE 13 : ANNULER ET AJUSTER DEPUIS LE DASHBOARD (close le 04/10)

**Décisions de Yass (03/10).** Validées : (1) bouton « Annuler » dans la **fiche client**
du dashboard, pas dans l'onglet Scans ; (2) ajustements tracés dans une **table à part**,
annulables dans l'ordre inverse avec les scans ; (3) ajustement **vérifié** (refusé si
un scan vient de passer) et **sans plafond en points**, avec une confirmation à l'écran
au-delà du seuil ; plafond inchangé en tampons. **Refusée (4) : aucun changement de
message — « Points mis à jour » pour tout ajustement.** Scanner inchangé. Découpage 13a
(sans migration) puis 13b (migration 052). Contrainte : aucune requête régulière en
plus, rien de plus lourd pour la caissière. Calendrier : 2b, puis 12, puis 13.

**13a — le bouton.** Fiche client : « Annuler » sur le passage actif le plus récent du
client, confirmation « Le solde revient à N », refus en mots simples. Même route que le
scanner (`POST /api/scan/:id/annuler`, qui acceptait déjà la session du marchand) :
aucun code serveur, aucune requête à l'ouverture de la fiche, une au tap. La fiche
montre les 10 derniers scans du client : plus de limite des 100 derniers. Sur un
réseau, le gérant annule le passage de n'importe quelle boutique (décision du 29/09 ;
le test du filet n'est plus un « ÉTAT ACTUEL »).

**13b — le journal des ajustements.**
- **Migration 052** : table `ajustements` (avant, après, date, annulé le) ;
  `ajuster_solde` (verrou de la carte ; refus `solde_change` si le solde a bougé depuis
  la lecture de l'écran ; même valeur → rien d'écrit ; sinon solde + ligne, une
  transaction) ; `annuler_ajustement` (dernier mouvement actif du client — ni scan ni
  ajustement actif après lui — et solde inchangé) ; `annuler_scan` refuse aussi un scan
  suivi d'un ajustement actif (`pas_le_dernier`).
- **Serveur** : `PATCH /api/clients/:id` passe par `ajuster_solde` avec
  `stored_value_attendu` (409 `solde_change` + solde actuel) ; sans ce champ (écran
  d'avant), ajusté sans vérification mais tracé (TRANSITION) ; même valeur → aucune
  poussée de carte. `POST /api/clients/ajustements/:id/annuler` (session marchand). La
  fiche (`GET /api/clients/:id`) lit scans et ajustements EN PARALLÈLE : pas plus
  longue qu'avant ; journal illisible → fiche sans ajustements.
- **Écran** : la fiche mêle scans et ajustements par date (« ✎ 2 → 9 pts ·
  ajustement ») ; « Annuler » sur le dernier mouvement actif, scan ou ajustement.
  Ajustement : envoie le solde affiché ; si un scan vient de passer : « Un scan vient de
  passer : le solde est maintenant de N. Vérifiez et recommencez. », rien d'écrit ; la
  ligne du journal est ajoutée sur place (pas de relecture). Points : plafond 1 000 000,
  confirmation au-delà du seuil. Tampons : plafond au seuil, inchangé.
- **Ordre inverse, exemple** (le cas de Hamza Salon) : scan 1→2, ajustement 2→10,
  remise 10→0 : annuler la remise (→ 10), puis l'ajustement (→ 2), puis le scan (→ 1).

**Tests.** Filet 105/105 : bloc 5 réécrit (ajustement tracé, refus si un scan vient de
passer, ajustement et scan au même instant sans jamais effacer le scan, TRANSITION),
bloc « 5 bis » (ordre inverse, déjà annulé, solde modifié hors journal, autre marchand,
droits ; deux ajustements revenus au solde du scan : seule la règle de l'ordre inverse
le protège). Navigateur `tests/navigateur/fiche_annulation.js` : 13 vérifications (13a
et 13b). Tout ensemble : **159/159** (3 passages à 158/158, puis 1 à 159/159 après l'ajout du
dernier test du bloc « 5 bis »), Node 24.10.0 —
`NODE_PATH=$(npm root -g) FILET_EN_PLUS=tests/navigateur/cle_ecrans.js,tests/navigateur/fiche_annulation.js,tests/navigateur/caisse_erreurs.js node tests/lancer.js`.
**Preuves** : sur le code 13a, le filet s'arrête (table absente) ; sans la règle de
l'ordre inverse dans `annuler_scan`, 2 KO, dont le scan annulé derrière deux
ajustements (solde 4, journal « 5→8, 8→5 » incohérent).

**Ordre du jour J (13b).** Vérification : `SELECT to_regclass('public.ajustements') IS
NULL, to_regprocedure('public.annuler_scan(uuid,uuid)') IS NOT NULL;` → `true | true` ;
migration 052 ; contrôle en fin de fichier (6 × `true`) ; requête d'écarts régénérée
(IDENTIQUE) ; push ; tests sur Pizza Sabbioni (points) et une carte de test en tampons.

**État (04/10).** 13a poussé seul (`424d3e8`, en avance rapide sur `2b31c92`) et
**vérifié par Yass le 04/10**. 13b remis sur `424d3e8` : **159/159 deux fois**. Fenêtre
entre la migration et le push : le code 13a, sur une base rejouée avec la 052 en plus
(52 fichiers), passe **139/139** — l'ancien `PATCH` écrit le solde sans ligne au journal,
`annuler_scan` ne trouve aucun ajustement et se comporte comme avant. **Migration 052
exécutée par Yass le 04/10, AVANT le push** : vérification `true | true`, migration OK,
contrôle 6 × `true`, requête d'écarts `IDENTIQUE au dépôt (hors plateforme) | 0 écart(s)
· 48 plateforme` (45 + les 3 droits hérités de la nouvelle table, comme 42 → 45 à la
049). 13b poussé ensuite, sur son feu vert (`bcde845`). **13b vérifié par Yass le 04/10** :
ordre inverse, ajustement vérifié, points au-dessus du seuil, aucun 500. **L'étape 13
est close.**

**Hypothèses et limites.**
- Un ajustement d'AVANT la 052 n'a pas de ligne : le scan qui le précède reste refusé
  par le contrôle du solde, comme aujourd'hui.
- L'ordre des mouvements repose sur les dates (`clock_timestamp()` sous le verrou de la
  carte pour les ajustements et les scans de `crediter_scan`).
- La fiche montre les 10 derniers scans et les 10 derniers ajustements.
- Hors périmètre : la caisse mono-site, connectée avec la session du marchand, peut
  ajuster et annuler un ajustement (droits, audit segment 3) ; l'onglet Scans du
  dashboard garde son affichage (pas d'ajustements, pas de bouton).

## 15 octodecies. ÉTAPE 14 : PARRAINAGE EN POINTS ET ARRÊT PROPRE (close le 04/10)

**Diagnostic (03/10, aucun code, aucune branche).**
- *Parrainage* : `credit_referral` (migration 015) plafonne au seuil, `LEAST(avant +
  bonus, seuil)` : en points, un parrain AU-DESSUS du seuil est ramené au seuil (530 →
  500 pour un seuil de 500, « ÉTAT ACTUEL » du filet, bloc 8). Le `FOR UPDATE` sur la
  jointure verrouille aussi la ligne du marchand (audit D3). En tampons, le parrain déjà
  à 10/10 perd son tampon : règle produit du 27/09, inchangée.
- *Redéploiement* : Railway envoie SIGTERM puis tue l'ancien serveur 0 s après
  (`RAILWAY_DEPLOYMENT_DRAINING_SECONDS`, défaut 0) ; aucun gestionnaire de SIGTERM dans
  `src/` ; démarré par `npm start` (Dockerfile), Node ne reçoit pas le signal (mesuré
  avec Node 24.10.0). Coupé à chaque push : les envois faits après la réponse (cartes
  Apple et Google, registre, **crédit de parrainage, perdu pour de bon** : son ticket est
  écrit avant le crédit), les demandes d'avis gardées en mémoire, le cron de 08:00 s'il
  tourne. L'argent d'un scan coupé est protégé depuis 11a et 12b.

**Décisions de Yass (écrites le 03/10, reçues le 04/10).**
1. **Refusée** : pas d'interdiction du parrainage en points (« avec la décision 2, il
   n'y a plus de risque de perte »).
2. **Validée** : `credit_referral` ne baisse jamais un solde et ne verrouille que le
   parrain.
3. **Validée, à condition de ne rien coûter en stockage, en requêtes ni en réglages
   risqués** : `CMD ["node", "src/index.js"]` dans le Dockerfile ; fin des requêtes et
   des envois en cours ; arrêt du cron ; 30 s (`RAILWAY_DEPLOYMENT_DRAINING_SECONDS`,
   posée avec 14a, pas avant ; chevauchement laissé à 0).
4. **(a)** : les demandes d'avis en attente sont perdues au redéploiement, comme
   aujourd'hui.
5. **Découpage** : 14a (arrêt propre, sans migration), puis 14b (parrainage, migration
   053).

Le code attend que 2b, 12 et 13 soient en production : c'est le cas du code depuis le
04/10 (`bcde845`) ; 14a s'écrit après la vérification de 13b.

**Hypothèses et limites connues à ce jour (à confirmer au code).**
- *Décision 3* : aucun stockage, aucune requête en plus ; les 30 s sont un maximum (le
  serveur s'arrête seul dès que les requêtes, les envois et le cron sont finis) et ne
  retardent pas la mise en service du nouveau serveur. Si l'arrêt bloque, Railway tue au
  bout de 30 s : le cas d'aujourd'hui.
- *Décision 1 refusée, en points* : sans la règle, le plafond au seuil reste. Avec la
  décision 2, un parrain au-dessus du seuil garde son solde mais ne reçoit pas le bonus ;
  juste sous le seuil, il n'en reçoit qu'une partie. Depuis 13b, un solde en points peut
  dépasser le seuil par ajustement. **Décision de Yass (04/10) pour 14b : le bonus est
  crédité EN ENTIER en mode points** (cohérent avec « sans plafond en points » de 13b) ;
  **plafond au seuil conservé en tampons** (règle du 27/09).
- **Reporté** : le crédit de parrainage n'écrit aucune ligne au journal ; après lui, le
  dernier scan du parrain ne s'annule plus (« solde incohérent »), et le journal des
  ajustements de 13b ne le voit pas.
- **Provisoire (décision 4 a)** : demandes d'avis perdues à chaque redéploiement (Hamza
  Salon seul concerné au 03/10).

**14a — l'arrêt propre (écrit, testé et poussé le 04/10).** Avant le push, Yass a posé
`RAILWAY_DEPLOYMENT_DRAINING_SECONDS` = 30 (Variables du service ; déploiement vert,
healthcheck OK) et vérifié « Custom Start Command » vide. Poussé (`acbb82d`) puis
**vérifié par Yass le 04/10**.
- `Dockerfile` : `CMD ["node", "src/index.js"]` (même programme que `npm start`).
  **Mesuré le 04/10 avec le code 14a** : lancé par `npm start`, npm sort (code 143) et
  le serveur ne reçoit jamais le signal (0 ligne `[arret]`) ; lancé par `node`, arrêt
  propre et sortie 0.
- `src/services/arret.js` (sans dépendance) : `suivre(promesse)` range un travail lancé
  sans être attendu ; `arreter()` au SIGTERM (et SIGINT) : arrêt de la planification du
  cron, plus de nouvelle connexion, les requêtes en cours finissent (connexions gardées
  ouvertes fermées dès qu'elles sont au repos, vérifié : 0,2 s au lieu de 6 s), les
  travaux suivis sont attendus (y compris ceux lancés pendant l'arrêt), **au plus 20 s**,
  bilan `[arret] fini en N ms : K tâche(s) attendue(s), demande(s) d'avis perdue(s) : D`
  ou `[arret] limite de 20 s atteinte : …`, sortie 0.
- Branché sur les 19 envois lancés après la réponse (cartes Apple et Google du scan, de
  l'ajustement et des annulations, crédit de parrainage et ses cartes, lien de
  parrainage, push de bienvenue Apple, consentements, clic d'avis, envoi d'avis à T+30, `notification_logs`,
  classe Google de l'admin ×3, retrait d'image, purge des bandeaux), sur le passage du
  cron (`workers/cron.js` : `arreterPlanification()`), et sur `asyncHandler` (un handler
  qui continue après sa réponse est attendu). Chaque expression est inchangée, seulement
  enveloppée ; un rejet non attrapé le reste (`finally`, pas `then(f, f)`).
- **Coût** : aucune requête, aucune écriture, aucun stockage ; en vie normale, un `Set`
  de promesses. Seul réglage : la variable des 30 s (jour J).

**Tests 14a.** Bloc 12 du filet (9 vérifications) : un SECOND serveur, coupé par
SIGTERM pendant un scan bloqué en base et pendant le crédit d'un parrain lancé après la
réponse (tickets verrouillés 4 s) → scan 200 (2 → 3, une ligne), parrain crédité
(3 → 4), nouvelle connexion refusée, sortie seule code 0, bilan au journal ; le module
seul (faux serveur) : second signal sans effet, envoi lancé pendant l'arrêt attendu,
limite tenue, échec de l'arrêt du cron sans effet. Filet complet **168/168 deux fois**
(Node 24.10.0, tests navigateur compris). **Preuves** : sur le code en production
(`7319dd9`), 4 KO — réponse coupée (`UND_ERR_SOCKET`, l'argent est crédité quand même
depuis 11a), parrain NON crédité (3, ticket écrit : le défaut du diagnostic), tué par
SIGTERM ; sans `suivre()` autour du crédit de parrainage, 1 KO (parrain à 3).

**Hypothèses de 14a (ce qui la ferait casser).**
- « Custom Start Command » VIDE dans Railway : rempli (`npm start`), il prime sur le
  Dockerfile et l'arrêt propre ne se déclenche jamais (aucune ligne `[arret]`).
- 20 s < `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` (30) : sans la variable (défaut 0),
  Railway tue au signal, comme avant 14a.
- Un nouvel envoi après réponse écrit SANS `suivre()` n'est pas attendu (règle à suivre
  pour tout futur fire-and-forget).
- Railway ne route plus de nouvelle requête vers l'ancien serveur une fois le signal
  envoyé (documentation : SIGTERM « once the new deployment is online ») ; sinon, refus
  de connexion, comme avant 14a (12b refait l'essai).
- Sortie 0 même à la limite : la politique « On Failure » ne relance pas un serveur
  arrêté par Railway.

**Limites.** Un passage du cron plus long que 20 s (≈ 80 s à 08:00 UTC) est coupé comme
avant : pas de push entre 08:00 et 08:05 UTC. Les demandes d'avis en mémoire sont
perdues (comptées au bilan). Les événements Sentry non encore envoyés sont perdus à la
sortie, comme avant. Le push de 14a lui-même ne profite pas de l'arrêt propre (c'est
l'ancien serveur qu'on arrête) : il se voit au redéploiement SUIVANT.

**14b — le parrainage (écrit et testé le 04/10 ; migration 053 exécutée par Yass AVANT le
push : vérification `true | true | true`, contrôle 4 × `true`, écarts `IDENTIQUE au dépôt
(hors plateforme) | 0 écart(s) · 48 plateforme` ; poussé sur son feu vert).**
**14b vérifié par Yass le 04/10** (`1203d6c`). **L'étape 14 est close.**
- **Migration 053** : `credit_referral` re-CREATE OR REPLACE, même signature et même
  retour (aucun code serveur à changer ; seul un commentaire de `scan.js`). Tampons :
  `LEAST(avant + bonus, seuil)`, plafond conservé (règle du 27/09). Points : `avant +
  bonus`, **bonus entier sans plafond** (décision de Yass du 04/10). Puis
  `GREATEST(après, avant)` dans les deux modes : **jamais de baisse**. Verrou `FOR
  UPDATE OF c` : le parrain seul, la ligne du marchand n'est que lue (audit 02 P4).
- Le parrainage reste permis en points (décision 1 refusée) ; rien dans l'admin.
- **Découvert en testant** : avec la 015, un bonus négatif BAISSAIT le solde (40 → 37) ;
  la 053 le rend sans effet. Sans risque en pratique : la base refuse un bonus < 1
  (CHECK `referral_bonus_points_positive`, migration 014) et `scan.js` passe `|| 1` ;
  seul un appel direct de la fonction y menait.

**Tests 14b.** Bloc 8 réécrit (8 vérifications au lieu de 3 pour `credit_referral`) :
tampons 9 → 10, 10/10 reste 10 (règle), 12 (seuil baissé) reste 12 ; points 100 → 105,
498 → 503, 530 → 535 ; bonus −3 sans effet ; crédit qui passe pendant qu'une autre
session tient la ligne du marchand (`lock_timeout` 300 ms). Filet complet **173/173
deux fois** (Node 24.10.0, tests navigateur compris). **Preuve** : sur une base sans la
053 (la production d'aujourd'hui), 5 KO (12 → 10, 498 → 500, 530 → 500, 40 → 37, crédit
bloqué par le verrou du marchand). Migration rejouée deux fois sur une base qui la porte
déjà : sans erreur ; contrôle 4 × `true`.

**Ordre du jour J (14b).** Vérification : `true | true | true` (fonction présente, une
seule version, ancienne version) ; migration 053 ; contrôle (4 × `true`) ; requête
d'écarts régénérée (attendu IDENTIQUE, 0 écart · 48 plateforme : aucune table en plus) ;
push ; tests sur une carte de test.

**Hypothèses et limites de 14b.**
- `type_programme` vaut `stamps` ou `points` (CHECK de la migration 025) ; tout autre
  mode serait traité comme les tampons (plafond).
- En points, un parrain peut dépasser le seuil : la récompense se remet au passage
  suivant, comme après un ajustement (13b).
- Droits de `credit_referral` inchangés (`exec=111`, comme toutes les fonctions
  d'avant 051) : la fermeture à la clé publique reste celle de la 050, non posée
  (décision du 01/10).
- **Toujours reporté** : le crédit de parrainage n'écrit aucune ligne au journal ; après
  lui, le dernier scan du parrain ne s'annule plus (« solde incohérent »).

## 15 novodecies. ÉTAPE 15 : CAMPAGNE DE CHARGE — TEMPS 1, BANC LOCAL (05/10, branche `campagne/etape15`, branche de relecture)

**Correction du diagnostic (05/10).** Le diagnostic de l'étape 15 plaçait le serveur en
Californie, d'après l'audit 00a/06 : faux depuis le 30/09 (serveur à Amsterdam,
`europe-west4-drams3a`, base à Paris, §15 decies). **Leçon : l'état actuel se lit dans
cette passation et dans le dépôt, jamais dans l'audit seul.** Conséquences : serveur de
test à Amsterdam, base de test à Paris (`eu-west-3`) ; « variante Amsterdam » sans objet.
**La production est en Micro depuis le 05/10** (étape 19 avancée, sans surcoût,
information de Yass).

**Décisions de Yass (05/10).** (1) Deux temps : banc local, puis projets réels de 3 à 5
jours. (2) Imitation par un fichier chargé via `NODE_OPTIONS`, **zéro ligne de `src/`
modifiée**. (3) Générateur par le réseau privé, une adresse par boutique et par iPhone,
limiteur inchangé ; mesure de l'entrée publique **sur le serveur de test uniquement** ; si
le limiteur est contournable : noté pour l'étape 17, rien corrigé. (4) `scripts/load-test.js`
supprimé. (5) Sans objet. (6) Après la campagne, l'outil rejoint la production, **inerte**
comme le filet : rien dans `src/` ne le charge, il n'entre pas dans l'image Docker.
**Données** : 100 000 porteurs — un gros réseau (UN marchand, 15 boutiques, ≈ 20 000
porteurs), un marchand « plafond » par paliers (5 000, 20 000, 50 000), le reste en petits
commerces. Plafond de 1 000 lignes (étape 21) atteint : le noter et chercher ce qui casse
APRÈS lui, sans rien corriger. **Limiteur** : plusieurs caisses d'une boutique derrière UNE
adresse (wifi), clients en 4G ; test de contournement prioritaire (objectif ×50).

**Livré (`winwincard/backend/tests/charge/`, rien dans `src/`, `Dockerfile` ni
`package*.json`).**
- `campagne.js`, chargé par le seul serveur de test : garde-fous (marchand témoin en base,
  `API_BASE_URL` hors production, aucune vraie clé, pas de Sentry), clés factices, APNs et
  Google redirigés vers l'imitateur, **liste blanche des sorties** (base de test et
  imitateur), mesures côté serveur, passage complet du cron, sonde de sortie et **sonde
  d'adresse** (ce que le serveur reçoit en `X-Forwarded-For` et l'adresse qu'Express en
  retient, par `proxy-addr` et `trust proxy` 1 comme `index.js:25`) — tout sous
  `/__campagne/*`, clé dérivée du `JWT_SECRET` de test, 404 sans elle.
- `imitateur.js` : APNs HTTP/2 (50–300 ms, 1 % de 410, 1 000 flux simultanés par
  connexion), Google (création 1,4 s médiane,
  2,4 s p90, mesurées en 04 n° 3 ; autres appels 0,4 s, HYPOTHÈSE), stockage en mémoire
  (banc), **iPhones simulés** (liste puis cartes avec If-Modified-Since, appareil à jour au
  départ, une adresse 4G chacun) : ≈ 3,3 téléchargements ou vérifications par scan, comme
  mesuré en production (3,4, 04 §4.2).
- `donnees.sql` : 100 000 porteurs, 64 % sur iPhone, 1,27 appareil par carte (≈ 2,7 cartes
  par appareil), ≈ 270 000 scans sur 90 jours (14 % à 08:00 UTC), registre de 800 000
  lignes, relances (inactifs et « proches ») à l'équilibre, marchand témoin. Généré en
  ≈ 50 s sur le banc (590 Mo).
- `generateur.js` : refuse `winwin-card.com` avant toute requête, vérifie le témoin avant
  toute écriture ; scénarios scan, rush, dashboard, campagne, cron, wifi, adresse ;
  arrivées au fil de l'eau ; résumé court par scénario.
- `banc-local.js` (banc complet sur la machine), `garde-fous.js` (preuve, 23 vérifications).
- `tests/lancer.js` : prête ses outils quand on le charge (base nommée, et en option délai,
  stockage, plafond de lignes) ; filet inchangé (119/119).
- `.dockerignore` : `tests/charge` exclu. **Prouvé avec Docker** (export du contexte de
  construction de l'image de production) : `tests/` y contient `lancer.js`,
  `scenarios.js`, `navigateur/`, et pas `charge/`.

**Délai du banc : 100 ms par requête base.** Source : §15 decies, 80 à 120 ms par requête
base vue de Dubaï après le passage à Amsterdam (`/health/db` moins `/health`), minimum
≈ 40 ms. HYPOTHÈSE, à confirmer au temps 2 : le fichier de campagne y mesure chaque appel
à la base côté serveur. **Trajet caisse ↔ serveur** (mesures du §15 decies) : Dubaï
≈ 0,28 s (`/health`, point d'entrée hors d'Europe) ; France NON MESURÉ (HYPOTHÈSE
≈ 0,05 à 0,1 s ; à mesurer sans code : `/health` depuis un navigateur en France).

**Preuves (`garde-fous.js`, 23/23).** Le serveur de campagne refuse de démarrer sans
marchand témoin (jamais en écoute), avec l'`API_BASE_URL` de production ou absente, avec
une vraie clé Apple ou Google, avec `SENTRY_DSN`. Le générateur refuse
`app.winwin-card.com` et ses sous-domaines **sans aucune requête** (sentinelle : 0 appel),
et refuse un serveur sans témoin sans rien écrire. Depuis le serveur de test : Google
(OAuth, Wallet) servi par l'imitateur ; APNs de production et de bac à sable connectés à
l'imitateur ; `app.winwin-card.com`, `www.apple.com` et tout autre hôte **bloqués et
comptés**. Sonde d'adresse : elle retient la dernière entrée de `X-Forwarded-For` (la
première, falsifiable, est ignorée), comme Express avec `trust proxy` 1. Après ces
changements, filet complet **173/173**.

**Premiers coûts (banc local).** 4 cœurs partagés par PostgreSQL, PostgREST, l'imitateur et
le générateur : des ordres de grandeur, pas des chiffres de production.

| Scénario | Caisse (scan vu du générateur) | Serveur | Remarques |
|---|---|---|---|
| scan seul | méd. 340–455 ms, max 500 | 4 requêtes base ≈ 105 ms chacune | indépendant de la taille du marchand (identique à 50 000 porteurs) |
| pointe ×3 (1 860 scans/h) | méd. 420 ms, p99 495 | boucle p99 19 ms, max 120 ; 200 Mo | 3,7 requêtes d'iPhone par push |
| pointe ×10 (6 200 scans/h) | méd. 350 ms, p99 471 | boucle p99 30 ms, max 105 ; 280 Mo | tient sans broncher |
| dashboard | — | stats 120 ms, réseau (`group_stats`) 250–320 ms, clients 120–160 ms | liste tronquée à 1 000 (50 000 porteurs) |
| campagne vers 1 000 appareils | **méd. 1,1–2,9 s, p95 14–22 s, max 26 s ; 4 scans coupés** | envoi 4,5–8,6 s ; boucle p99 240–465 ms, **max ≈ 1 s** ; **650 Mo** | 2 700–3 600 requêtes d'iPhone en ≈ 40 s ; jusqu'à 228 connexions d'iPhone refusées |
| idem, iPhones étalés sur 1 à 60 s | méd. 2,1 s, p95 16,7 s, max 24 s | boucle max 1,3 s ; 690 Mo | **le délai de retour des iPhones ne change pas le constat** |
| **campagne SANS plafond de lignes** (après l'étape 21), 16 230 appareils | **68 scans coupés sur 82, max 150 s** | envoi 176 s ; **boucle bloquée jusqu'à 37 s** ; **3,1 Go** ; 35 % d'échecs Apple | la plateforme est hors service plusieurs minutes |
| **cron, passage complet** (palier 50 000) | méd. 430 ms (non gêné) | **3 237 cartes en 2 927 s (49 min), 0,9 s par carte** ; boucle p99 18 ms ; 360 Mo | 2 866 inactifs + 371 « proches » ; 9 458 requêtes d'iPhone (2 573 × 200, 6 885 × 304) |
| wifi d'une boutique | premier 429 à la **301ᵉ** requête | — | une boutique tient au plus **20 scans/min** sur 15 min |

Coûts unitaires : génération d'une carte Apple 13–20 ms hors base quand le bandeau est en
cache ; rendu d'un bandeau méd. 25 ms, jusqu'à 110–150 ms (bloque la boucle) ;
téléchargement d'une carte par l'iPhone ≈ 107 ms en 304 (1 requête base), 340–450 ms en
200 (3 requêtes base et génération).

**Ce qui casse APRÈS le plafond de 1 000 lignes (constaté, rien corrigé).**
- **Campagne** : 1 000 appareils seulement (sur ≈ 16 000 au réseau, ≈ 40 000 au plafond à
  50 000 porteurs) ; mais le `PATCH` touche TOUTES les cartes du marchand (50 000 en
  1,3 s) : leur date change, et chacune sera re-téléchargée en entier (200 au lieu de 304)
  à sa prochaine vérification (2 164 × 200 pour 1 394 × 304 au palier 50 000).
- **Cron** : les lectures de clients, de scans récents et de déduplication sont tronquées
  à 1 000. Au palier 50 000, il prévoit 957 relances pour le plafond **dont 546 vers des
  clients actifs**, et n'examine que 957 de ses 20 138 inactifs ; réseau : 913 relances,
  dont 559 vers des actifs. Sur tout le parc : 2 849 relances d'inactifs prévues, dont
  1 105 vers des actifs (calcul en lecture sur la base du banc, mêmes lectures que le cron).
- **Le plafond protège aujourd'hui de la tempête** : à 1 000 appareils, une campagne gèle
  déjà la caisse jusqu'à 26 s. **Mesuré sans le plafond** (ce que deviendrait l'étape 21
  sans cadence) : une campagne vers les 16 230 appareils du réseau dure 176 s, coupe 68
  scans sur 82, bloque le serveur jusqu'à 37 s, monte à 3,1 Go, et 35 % des envois Apple
  échouent : `apns.js` coupe à 10 s les envois en attente et **détruit toute la
  connexion** (`apns.js:150-155`), ce qui fait échouer les envois qui la partageaient.
  **Dépendance à inscrire au calendrier : cadencer les campagnes (et donc les retours
  d'iPhone) AVANT de lever le plafond de l'étape 21.**

**Limites du temps 1.** Processeur local partagé ; PostgreSQL et PostgREST locaux avec
un délai fixe (la file de PostgREST, 10 connexions par défaut, gonfle les temps base
pendant la tempête : à mesurer sur Supabase) ; stockage en mémoire ; délais d'Apple, de
Google (hors création) et du retour des iPhones (1 à 5 s) **HYPOTHÈSE** (le délai des
iPhones testé de 1 à 60 s ne change pas le constat) ; la limite de flux simultanés
d'Apple est imitée à 1 000 par connexion (**HYPOTHÈSE**) ; dans l'essai sans plafond, une
partie des erreurs des iPhones simulés (EMFILE : trop de fichiers ouverts) vient de la
machine du banc, pas du serveur ; le logo des marchands n'est pas
téléchargé (pas d'URL publique sur le banc) ; la sonde d'adresse ne prouve rien en local
(le générateur y est le dernier proxy) : **elle se joue au temps 2, contre l'entrée
publique du serveur de test, en priorité**.

**Reste pour le temps 2.** Les services de test ont besoin de leur propre Dockerfile,
puisque l'outil est exclu de l'image de production (HYPOTHÈSE : `tests/charge/Dockerfile` et
son `Dockerfile.dockerignore`, pris en compte par Railway). **En premier** : la sonde
d'adresse contre l'entrée publique du serveur de test (`CHARGE_SCENARIOS=adresse`,
`CIBLE_PUBLIQUE`) ; une requête suffit à dire si l'adresse vue par le limiteur est
contournable, partagée par tous (proxy interne) ou réelle. Puis la mesure réelle du
coût d'une requête base. **Suite : §15 vicies (paliers, préparation du temps 2).**

## 15 vicies. ÉTAPE 15 : PALIERS DE CAMPAGNE ET PRÉPARATION DU TEMPS 2 (05/10, branche `campagne/etape15`)

**Décisions de Yass (05/10, après le temps 1).** (1) La branche `campagne/etape15` est poussée
sur GitHub comme **branche de relecture, jamais déployée**. Aucun push vers la branche de
production. (2) Gel des campagnes : **pas urgent** (le plus gros marchand actuel a ≈ 300
porteurs). On mesure au banc une campagne vers 100, 250, 500 et 750 appareils, pour fixer le
seuil (plus de 2 s à la caisse) qui déclenchera le chantier « rythme d'envoi des
campagnes ». Rien n'est codé. Règle inscrite au contrat (§7, règle 8) : **pas de levée du
plafond de l'étape 21 avant que les campagnes aient un rythme**. (3) Temps 2 : Dockerfile de
campagne et procédure de création pas à pas, avec les noms des variables seulement. Premier
geste : le test de contournement d'adresse. **Rien n'est créé avant le feu vert de Yass.**

### A. Les paliers (banc local, 05/10)

Méthode : campagne vers le marchand « plafond », dimensionné pour viser N appareils
(≈ 0,81 inscription iPhone par porteur). Les scans arrivent pendant ce temps au rythme
pointe ×3. Délai base 100 ms. Deux séries complètes ; 750 rejoué deux fois de plus pour le
diagnostic. Une campagne envoie **un push par inscription iPhone** du marchand
(`notifications.js:81`, `:111`) : le compte qui compte, c'est le nombre de lignes
`device_tokens` du marchand.

| Inscriptions iPhone notifiées | Caisse : médiane | Caisse : pire scan (par essai) | Serveur : temps propre du scan, max | Boucle bloquée, max | Mémoire |
|---|---|---|---|---|---|
| ≈ 110 | 0,43 s | 0,53 · 0,77 s | 0,47 · 0,75 s | 0,09 · 0,29 s | 210–230 Mo |
| ≈ 250 | 0,43–0,44 s | 0,96 · 1,31 s | 0,94 · 1,15 s | 0,12 · 0,33 s | 290–300 Mo |
| ≈ 520 | 0,43–0,44 s | 1,19 · **3,85 s** | 0,59 · 1,14 s | 0,17 · 0,25 s | 350–370 Mo |
| ≈ 780 | 0,44–0,45 s | **6,9 · 8,9 · 6,1 · 2,9 s** | ≤ 1,5 s | 0,26 à 0,86 s | 355–420 Mo |
| ≈ 1 020 | 0,43 · 0,87 s | **9,3 · 10,9 s** | 0,93 · 1,21 s | 0,29 · 0,31 s | 400–425 Mo |

Ces temps sont vus du générateur, sur la machine du banc. Vu d'une caisse à Dubaï, il faut
ajouter ≈ 0,28 s par scan (§15 decies). **La médiane ne bouge pas** : la plupart des scans
tombent hors de la tempête, qui dure 10 à 20 s. **Le pire scan, lui, explose dès ≈ 500
inscriptions.**

**Où passe le temps (diagnostic du 05/10).** Le pire scan de la caisse (6 à 11 s) dépasse de
loin ce que le serveur mesure lui-même, de la réception à la réponse (≤ 1,5 s). La boucle du
serveur, elle, n'est jamais bloquée plus de 0,9 s d'affilée.
- Sonde (connexion neuve toutes les 300 ms pendant une campagne vers 780) : la connexion
  TCP s'établit tout de suite, mais **333 connexions attendent d'être prises** par le
  serveur, et la réponse arrive au bout de 4,6 s.
- Processeur, relevé chaque seconde : pendant 12 s, **le serveur occupe 76 à 90 % de son
  unique cœur**. La machine, elle, reste à ≈ 70 % de ses 4 cœurs. Ce n'est donc pas la
  machine du banc qui sature : c'est le serveur, qui travaille sur un seul fil.
- Conclusion : les iPhones reviennent chercher leurs cartes (≈ 3,7 requêtes par push,
  génération et signature des cartes). Le serveur est saturé, et **le scan de la caisse
  fait la queue derrière les cartes**. Ses propres mesures (temps de route, boucle) ne
  voient pas cette attente : **seul le temps vu du client fait foi**.
- À ≈ 1 000, s'ajoute la file d'attente du noyau, pleine : **1 033 connexions refusées** et
  647 tentatives de connexion réémises (compteurs du noyau, série 2), d'où des attentes par
  paliers de 1, 3 puis 7 s. Rien de tel à 750 et en dessous (0 refus).

**Seuil.** Plus de 2 s à la caisse : **1 essai sur 2 dès ≈ 500 inscriptions iPhone
notifiées, 4 sur 4 à ≈ 750**. Seuil retenu : **500 inscriptions iPhone par campagne**
(≈ 600 porteurs au profil du banc). Le plus gros marchand actuel (≈ 300 porteurs) est à
≈ 240 inscriptions : marge d'un facteur 2.
- **Déclencheur du chantier « rythme des campagnes » (décision de Yass, 05/10)** : le
  **premier marchand à ≈ 500 porteurs, OU la signature d'un réseau**. Pas de requête
  périodique : le déclencheur se lit dans l'activité commerciale, pas en base. Repère :
  500 porteurs ≈ 400 inscriptions iPhone au profil du banc (0,81 par porteur), juste sous
  le seuil mesuré ; un réseau part de ≈ 20 000 porteurs (données du banc), bien au-delà.
- HYPOTHÈSE : un cœur du banc vaut à peu près un vCPU de Railway. Le temps 2 le dira :
  même campagne, mêmes paliers, sur l'infrastructure réelle.

**Options pour le chantier (rien codé, à choisir par Yass le moment venu).**
1. **Rythme d'envoi** : envoyer les pushes par lots (par exemple 100 toutes les 10 s). Le
   pic ne dépend plus de la taille de la campagne. Risque moyen : une campagne de 6 000
   envois dure alors 10 min. Un redéploiement en cours de route l'interrompt (arrêt propre
   limité à 20 s, étape 14a). Il faut donc garder l'avancement en base (registre
   `notification_envois`) et reprendre sans doublon. C'est la condition de la règle 8.
2. **Sortir la fabrication des cartes du chemin des caisses**, soit par des fils de calcul
   (signature et archive hors du fil principal), soit par un service séparé. Risque élevé :
   l'adresse du serveur est gravée dans chaque carte (`webServiceURL`). Un service à part
   impose une autre adresse, que seules les cartes re-téléchargées apprendraient. Une
   erreur = des cartes qui ne se mettent plus à jour, sans bruit (étape 20). Des fils de
   calcul gardent l'adresse, mais pas la file de la base.
3. **Alléger chaque retour d'iPhone** : garder en cache la carte signée tant qu'elle ne
   change pas ; ne plus modifier TOUTES les cartes du marchand à chaque campagne (le
   `PATCH` de `notifications.js:102-104` force des re-téléchargements complets). Risque
   faible à moyen (une carte périmée servie par erreur). Gain de 2 à 3 fois. Le pic reste
   proportionnel à la taille : cette option complète la 1, elle ne la remplace pas.
4. **Limiter les cartes fabriquées en même temps** (au-delà de N, réponse « réessayez plus
   tard », code 503). La caisse est protégée tout de suite. Risque : on ne sait pas quand
   iOS réessaie (HYPOTHÈSE, à tester sur un vrai iPhone) ; la carte se met à jour plus tard.
5. **Deux répliques Railway** : deux fois plus de processeur. Risque moyen : un cron qui
   tournerait deux fois, et des états gardés en mémoire (demandes d'avis, cache des
   bandeaux). Coût mensuel doublé pour le serveur.
6. **Créneaux de campagne** (pas entre 11 h et 14 h) : sans code. Ne règle pas la taille.
- **Recommandation** : 1, puis 3 avant de lever le plafond de l'étape 21 ; 4 en filet si le
  seuil approche avant que 1 soit prête.

### B. Préparation du temps 2 (rien créé : feu vert de Yass attendu)

**Livré dans `winwincard/backend/tests/charge/` (rien dans `src/`, `Dockerfile` racine ni
`package*.json`).**
- **`Dockerfile`** de campagne : même image Node que la production (empreinte), client
  `psql` (paquet Debian `postgresql-client`, pour le pilote), une image pour les trois
  services. La variable `CAMPAGNE_PROGRAMME` choisit le programme, et « Custom Start
  Command » reste vide comme en production. `exec node` : Node reçoit lui-même l'ordre
  d'arrêt.
- **`Dockerfile.dockerignore`** : celui de la racine sans l'exclusion de `tests/charge`.
  **Prouvé avec BuildKit** (export des deux contextes) : l'image de campagne contient
  `tests/charge`, celle de production non ; aucune des deux n'a `node_modules` ni `.env`.
- **`temoin.sql`** (le témoin seul, rejouable) : joué avant `donnees.sql`, ou seul.
- **`preparer.js`** : préparation de la base de test par `psql`.
  - Garde-fou avant toute écriture : la base est neuve, ou elle porte le témoin. Sinon,
    refus (sortie 3) ; la chaîne de connexion n'est jamais affichée.
  - `temoin` : rejeu du dépôt (comme le filet, sans le prélude), puis le témoin, puis la
    requête d'écarts, dont le verdict doit être « IDENTIQUE ». Un « ÉCART » met l'étape en
    échec.
  - `donnees` : vide toutes les tables de `public` et recharge le palier, en **une seule
    transaction** (un échec laisse la base telle qu'avant, prouvé).
- **`pilote.js`** : un geste = une valeur de `CAMPAGNE_ETAPE` (`attente`, `temoin`,
  `donnees`, `adresse`, ou une liste de scénarios), puis l'arrêt. Pour `adresse`, il donne
  aussi l'adresse de la sonde à ouvrir dans un navigateur.
- Sonde d'adresse : accepte la clé dans l'adresse (`?cle=`, navigateur), pour elle seule ;
  rend aussi les autres en-têtes d'adresse reçus.
- **Correctif du générateur** : une sonde d'adresse muette (clé fausse, serveur
  injoignable) concluait à tort « adresse réelle ». Elle échoue désormais, sans conclure.
- **`PROCEDURE.md`** : la procédure de Yass. Premier geste mesuré : le test d'adresse.
- Arrêt propre de l'imitateur et du pilote (premier processus du conteneur).

**Preuves.**
- Garde-fous **33/33** : les 23 du temps 1, plus la sonde au navigateur, le pilote
  (adresse, clé fausse, attente, étape inconnue) et la préparation (production simulée
  refusée en `temoin` comme en `donnees`, base étrangère refusée, base neuve en `donnees`
  refusée, rejeu sur base neuve « IDENTIQUE », relance sans effet).
- Chargement `donnees` au palier 5 000 puis 20 000 sur la même base : 44 et 47 s,
  ≈ 580 Mo. Un chargement cassé laisse la base au palier précédent.
- **Image construite avec Docker** : `npm ci`, programme par défaut (le serveur), le
  fichier de campagne chargé par `NODE_OPTIONS` (il refuse sans `API_BASE_URL`), le
  pilote, l'imitateur, et l'arrêt en 171 ms.
- **NON vérifié ici** : l'installation de `psql`. Le miroir Debian est bloqué par le réseau
  de cette machine ; l'image a donc été construite sans cette étape. Le premier
  déploiement du pilote le vérifie, et l'échec serait bruyant.
- Filet complet **173/173** (rien ne change hors de `tests/charge/`).

**Hypothèses du temps 2** (la procédure dit quoi faire si l'une est fausse) :
- Railway prend le Dockerfile par `RAILWAY_DOCKERFILE_PATH`, et le
  `Dockerfile.dockerignore` voisin. Sinon : « Cannot find module ».
- La référence `${{serveur.JWT_SECRET}}` recopie la valeur ; les adresses
  `*.railway.internal` répondent.
- Le « Session pooler » de Supabase sert `psql` et les tables temporaires ; la connexion
  directe (IPv6) n'est pas utilisée.
- La migration 048 peut poser son déclencheur sur un projet neuf (hypothèse écrite dans la
  048) : c'est pourquoi l'option « automatic RLS » reste décochée.
- Clé `sb_secret_`, comme la production depuis le 29/09 (§15 septies).

**Limites.**
- Les iPhones et le générateur passent par le réseau privé (décision 3 du temps 1) : l'entrée
  publique de Railway, qui regroupe peut-être les connexions, n'est pas sur ce chemin. La
  file de connexions vue à 1 000 pourrait s'y comporter autrement : à mesurer au temps 2
  (quelques scans par l'entrée publique, sous le seuil du limiteur).
- Le cron de 08:00 UTC tourne aussi sur le serveur de test : pas d'essai entre 08:00 et
  09:00 UTC.
- Tout redéploiement du pilote rejoue son étape inscrite, d'où la valeur de repos
  `attente`. **Correction (Yass, 06/10) : chaque push sur `campagne/etape15` redéploie
  automatiquement les TROIS services de test.** La mention « Auto deploy unavailable »,
  relevée le 05/10 sur le pilote, ne vaut plus.
  - Un push relance donc l'étape inscrite au pilote : `donnees` rechargerait la base.
  - Il redémarre aussi le serveur et l'imitateur, même arrêtés. Un serveur allumé à 08:00
    UTC fait tourner le cron sans témoin.

### C. Temps 2, environnement créé ; geste 3 en ÉCART sur 42 droits (05/10)

**Fait par Yass le 05/10, en suivant `PROCEDURE.md`.**
- Supabase `winwin-campagne-15` : Paris, Micro, clé `sb_secret_` par défaut, Max rows 1000.
  Créé avec « Automatically expose new tables » **COCHÉ** et « Enable automatic RLS » décoché.
- Railway `winwin-campagne-15` : services `serveur`, `imitateur` et `pilote`, à Amsterdam.
  `JWT_SECRET` et `ADMIN_PASSWORD` neufs. Domaine public du serveur de test :
  `https://serveur-production-46ae.up.railway.app` (pas un secret).
- **Durée de vie : jusqu'à la fin de l'étape 18, au plus tard le 31/10/2026** (décision de
  Yass). Ensuite : suppression des deux projets (`PROCEDURE.md`, dernière section).

**Résultat du geste 3 (pilote, `temoin`).** Image construite : `psql` s'installe, ce qui
lève la réserve du §15 vicies B. 53 fichiers rejoués en 10 s, la 048 passe sur un projet
neuf (hypothèse de la 048 vérifiée), témoin en place. Mais **VERDICT ÉCART : 42 écarts sur
les droits de données**, et 48 lignes « plateforme » comme en production.

**Sens de lecture.** Dans la requête d'écarts, la colonne nommée « production » est la
base où la requête tourne, ici la base de TEST ; la colonne suivante est le dépôt.
- `clients → anon | rawd | (aucun droit)` veut donc dire : la base de test donne à `anon`
  lecture, insertion, modification et suppression ; le dépôt et la production, rien.
- **La base de test a 42 droits DE PLUS que la production, aucun de moins.**
- Lecture inverse au premier passage (« anon n'a aucun droit, attendu rawd ») : le nom de
  colonne induit en erreur dès qu'on quitte la production (dette, §16).

**Cause (PROUVÉE) : les privilèges par défaut du projet neuf.** Case « Automatically expose
new tables » cochée : toute table créée par `postgres` dans `public` reçoit d'office
**tous** les droits pour `anon`, `authenticated` et `service_role`, et toute séquence
`rwU`. En production, ce réglage est **désactivé** (relevé 00b, 26/09) : une table neuve
n'y reçoit que `Dxtm` (privilèges par défaut relevés en production, 00a P5), puis ses
GRANT explicites du dépôt. Preuves :
1. **Le compte tombe juste.** 16 tables × `anon` + 15 × `authenticated` (la 006 lui
   donne déjà `notification_logs`) + 3 séquences × 2 rôles + 5 objets où le dépôt donne
   à `service_role` moins que tout (`cron_passages` sans `d`, 049 ; `diagnostics_camera`
   sans `w`, 042 ; 3 séquences sans `w`) = **42**. Chaque excédent est exactement « tout
   le reste ».
2. **Reproduction locale** : dépôt rejoué par `preparer.js` sur une base locale dont le
   rôle `postgres` donne tout par défaut aux trois rôles → **les 45 lignes du journal de
   Yass, identiques ligne à ligne** (42 écarts + 3 lignes « plateforme »).
3. **Contre-épreuve** : même rejeu, privilèges par défaut de la production (`Dxt` sur les
   tables, rien sur les séquences, exécution de `PUBLIC` conservée sur les fonctions) →
   **IDENTIQUE, 0 écart · 48 plateforme**, le verdict de la production.
4. Fonctions : 0 écart dans les deux cas. Supabase conserve l'exécution de `PUBLIC`
   (discussion #45329, lue par 00b), et les fonctions sensibles retirent ce droit
   elles-mêmes (051, 052).
5. **Confirmation sur le projet réel** : le pas `droits` proposé ci-dessous affiche les
   privilèges par défaut avant correction. Attendu : `anon=arwdDxtm`.

**Ce que la production n'a pas, et dont le code n'a pas besoin.** `cron_passages` :
insertion, modification, lecture (`cron-passages.js:40-102`), jamais de suppression (049 :
« rien ne supprime de ligne »). `diagnostics_camera` : insertion et lecture
(`diag.js:66`, `:87`), jamais de modification. Séquences : `USAGE` suffit aux insertions.

**Correction LIVRÉE (feu vert de Yass, 05/10) : pas `droits` du pilote** (`preparer.js`,
mode `droits` ; `pilote.js`). Garde-fou du témoin ; les étapes 2 et 3 en une seule
transaction :
1. afficher les privilèges par défaut (preuve de la cause sur le projet réel) ;
2. ramener ceux du rôle `postgres` dans `public` à ceux de la production : retirer
   `SELECT, INSERT, UPDATE, DELETE` des tables et tout des séquences pour les trois rôles.
   Fonctions inchangées : l'effet y est déjà le même ;
3. retirer l'EXCÉDENT seul, calculé ligne à ligne par la requête d'écarts (42 `REVOKE`,
   affichés). **Jamais d'ajout** : si un objet avait moins que la production, refus et
   rien n'est fait ;
4. une table sonde, créée puis annulée : une table future doit recevoir les droits de la
   production. Cela prouve aussi que le mécanisme est bien le réglage par défaut, et non
   un déclencheur de la plateforme ;
5. requête d'écarts rejouée : **IDENTIQUE exigé**.

Refus aussi si un écart sort des droits de données (RLS, fonction, structure…) : ce pas
ne touche qu'aux droits. Rejouable : sur une base alignée, 0 retrait.

**Preuves (garde-fous 39/39, dont 6 pour ce pas).** Une base locale « case cochée » donne
au rejeu l'ÉCART de 42 droits du projet de test. Le pas refuse, sans rien retirer, quand
un objet a moins que la production ou quand un écart touche la RLS. Sinon : 42 retraits, la
table sonde n'a aucun droit de lecture ni d'écriture (table et séquence), verdict
**IDENTIQUE, 0 écart · 48 plateforme**. Relancé : 0 retrait. Production simulée :
refus. **Recréer le projet n'est pas nécessaire.** Recréer avec
la case décochée rejouerait la contre-épreuve sur un vrai Supabase (preuve utile à
l'étape 9) ; ce n'est pas utile à la campagne, et cela coûte trois secrets à reposer.
`PROCEDURE.md` est corrigée : la case doit être décochée, comme en production.

### D. Test d'adresse sur l'entrée publique de Railway (05/10) — limiteur PARTAGÉ par relais

**Mesures de Yass** (serveur de test, sonde `/__campagne/adresse`) :

| Origine | `X-Forwarded-For` reçu | `x-real-ip` | Retenu par Express (`trust proxy` 1) |
|---|---|---|---|
| ordinateur, wifi | `91.73.16.9, 152.233.15.123` | `91.73.16.9` (vraie adresse, confirmée par mon-ip.com) | `152.233.15.123` |
| téléphone, 4G | `37.168.167.49, 79.127.178.81` | `37.168.167.49` | `79.127.178.81` |
| pilote (avait ENVOYÉ `X-Forwarded-For: 192.0.2.77`) | `208.77.244.155, 152.233.12.245` | — | `152.233.12.245` |

**Ce qui est prouvé.**
- **Le limiteur ne compte pas par client mais par relais de Railway.** L'entrée de Railway
  écrit deux adresses : celle du client, puis celle d'un relais. `trust proxy` 1
  (`index.js:25`) ne croit qu'un intermédiaire, donc Express retient la dernière adresse,
  celle du relais.
- Calcul refait avec les bibliothèques exactes du serveur (`express/lib/utils.js:223-225`
  pour `compileTrust(1)`, et `proxy-addr`) :
  - `trust proxy` 1 → le relais, dans les 3 cas ;
  - `trust proxy` 2 → la vraie adresse, dans les 3 cas (`91.73.16.9`, `37.168.167.49`,
    `208.77.244.155`).
- **L'en-tête forgé par le client est REMPLACÉ, pas complété** : le `192.0.2.77` envoyé par
  le pilote a disparu. On ne peut donc pas contourner le limiteur par `X-Forwarded-For`.
- Mais tous les clients qui passent par un même relais partagent un même compteur.

**Pourquoi la sonde a conclu « non contournable » (défaut de l'outil, `generateur.js:205-209`).**
Sa règle supposait qu'un relais partagé aurait une adresse PRIVÉE (10.x, 100.64.x, fd…). Les
relais de Railway ont des adresses PUBLIQUES (152.233.x.x, 79.127.x.x) : la sonde est
tombée dans la branche « adresse réelle ». La moitié « non contournable par cet en-tête »
est juste ; la conclusion « adresse réelle du client » est **fausse**. La bonne règle :
comparer l'adresse retenue à celle que l'entrée attribue au client (première adresse de
`X-Forwarded-For`, ou `x-real-ip`). Correction de l'outil : non faite (diagnostic seul).

**La production.**
- Même code : `index.js` est identique entre la production (`dc4a0ac`) et la branche de
  campagne.
- Même entrée : `app.winwin-card.com` est un alias vers Railway, sans Cloudflare
  (§15 decies, audit 06).
- **Comportement identique, PROUVÉ le 06/10 par les journaux de la production.** Le
  journal « combined » (`index.js:39`) écrit en tête de chaque ligne l'adresse retenue
  par Express. La visite de Yass sur `/health` (Macintosh, 07:43:17 UTC) y est inscrite
  sous `152.233.15.123`, et non sous sa vraie adresse `91.73.16.9`. UptimeRobot arrive
  lui aussi par des relais `152.233.x.x`.
- **Aucun 429** trouvé dans les journaux réseau de la production (recherche de Yass,
  06/10), sur la durée que Railway conserve.

**Les limiteurs touchés : tous, car tous comptent par `req.ip`.**
- Le global : 300 requêtes par 15 min (`index.js:45-51`), pages, cartes iPhone et santé
  comprises.
- Ceux de `rateLimiters.js:4-51`, qui comptent TOUTES les tentatives, réussies comprises :
  - inscription : 20 par heure ;
  - connexion marchand et admin : 10 par heure ;
  - connexion caisse : 20 par heure ;
  - diagnostic : 30 par heure.

Chaque compteur est partagé par tous les clients du même relais, toutes boutiques et tous
marchands confondus.

**Impact aujourd'hui (estimation, volumes de l'audit 06 : ≈ 56 crédits et 40 inscriptions
par jour).**
- **Limiteur global : risque faible aujourd'hui.** Quelques dizaines de requêtes par quart
  d'heure de pointe, contre 300 par relais.
- **Relais mesurés (06/10)** : 20 requêtes du même ordinateur sont passées par **6 relais
  distincts** (`152.233.15.120/121/123`, `152.233.68.97/98/105`), toutes précédées de
  `91.73.16.9`. Le limiteur fait donc deux erreurs à la fois. Il **éparpille** un même
  client sur ≈ 6 compteurs : sa vraie limite devient ≈ 6 × 300. Et il **mélange** dans
  chaque compteur tous les clients qui passent par ce relais.
- **Inscription, 20 par heure par relais : risque réel lors d'un événement en boutique**
  (lancement, QR au comptoir). La 21ᵉ inscription de l'heure, tous marchands confondus sur
  ce relais, reçoit un 429, et le client est perdu.
- **Blocage volontaire, possible dès aujourd'hui** : 10 requêtes de connexion marchand
  suffisent à bloquer pendant une heure les connexions au dashboard de tous les marchands
  qui passent par le même relais (20 pour les caisses). Pas besoin du bon mot de passe.
  Probabilité faible (il faut vouloir nuire), effet visible.
- **À la cible (×50)** : ≈ 1 250 requêtes par quart d'heure de pointe (≈ 540 scans par
  heure, cartes iPhone comprises). Il faudrait au moins 5 relais à charge égale, avant
  même les pages et les dashboards : **429 quasi certains** sans correctif.

**Décision de pilotage (06/10) : « lire la vraie adresse du client » est traité JUSTE
APRÈS la clôture de l'étape 15, AVANT l'étape 16.** Rien n'est codé d'ici là. Les deux
préalables (en-têtes forgés, journaux de la production) sont faits, voir plus bas.

**Test des en-têtes forgés (06/10, Yass, Terminal, serveur de test).** Requête envoyée avec
`X-Forwarded-For: 192.0.2.77, 192.0.2.78`, `X-Real-IP: 192.0.2.79` et
`Forwarded: for=192.0.2.80`. Reçu par le serveur :

| En-tête | Reçu | Verdict |
|---|---|---|
| `X-Forwarded-For` | `91.73.16.9, 152.233.68.98` | **réécrit** par Railway (les 2 forgés ont disparu) : vraie adresse, puis relais |
| `X-Real-IP` | `91.73.16.9` | **réécrit** (le forgé a disparu) : vraie adresse |
| `Forwarded` | `for=192.0.2.80` | **passe TEL QUEL** : falsifiable par n'importe quel client |
| retenu par Express (`trust proxy` 1) | `152.233.68.98` | le relais |

- Rien dans le code ne lit `Forwarded` aujourd'hui. Express lit seulement
  `X-Forwarded-For` (`proxy-addr` via `forwarded/index.js:30`). Les limiteurs comptent par
  `req.ip` (`express-rate-limit`, `dist/index.cjs:655-659`), le journal aussi (`morgan/index.js:519-523`). Aucun `x-real-ip` ni `Forwarded` dans `src/`. Règle au §16 :
  **jamais `Forwarded`**.

**DÉCISION DE PILOTAGE (06/10) : le correctif sera `trust proxy` 2, avec la garde (alerte au
plus une fois par heure si `X-Forwarded-For` n'a pas exactement 2 adresses) et le test
d'en-têtes forgés rejoué après tout changement chez Railway. Prouvé d'abord sur
l'environnement de test. Passe juste après la clôture de l'étape 15 ; rien codé d'ici là.**

**Recommandation pour le correctif : `trust proxy` 2 plutôt que `x-real-ip`** (validée
ci-dessus).
- **Pourquoi `trust proxy` 2.**
  - Un seul réglage standard d'Express (`index.js:25`), au lieu d'une fonction de clé
    écrite à la main dans 6 limiteurs.
  - L'adresse vient d'une seule source, `req.ip`, pour tous les limiteurs, le journal et
    tout usage futur.
  - Calcul prouvé : vraie adresse dans les 4 relevés (wifi, 4G, pilote, en-têtes forgés).
- **Ce qui le ferait casser (hypothèses sur Railway).**
  - Railway ajoute une étape (3 adresses au lieu de 2) : on retombe sur un relais.
    C'est le défaut d'aujourd'hui, PAS une faille : rien de falsifiable.
  - Railway retire une étape ET cesse de réécrire `X-Forwarded-For` : la première adresse
    viendrait alors du client, donc **falsifiable**. Il faudrait les deux changements à la
    fois.
  - Une requête arrive sans passer par l'entrée publique (réseau privé) : l'en-tête est
    alors celui de l'appelant. Cela n'existe qu'au projet de test.
- **Pourquoi pas `x-real-ip`.**
  - Six limiteurs à modifier, et le journal garderait le relais.
  - Si Railway cessait de RÉÉCRIRE cet en-tête, il deviendrait falsifiable aussitôt, sans
    bruit. S'il cessait de le POSER, il faudrait un repli, donc du code de plus.
  - C'est un seul changement chez Railway pour une faille, contre deux pour
    `trust proxy` 2.
- **Garde proposée avec le correctif** (petite, à valider) : journaliser une alerte, au
  plus une fois par heure, si une requête arrive avec un `X-Forwarded-For` qui n'a pas
  exactement 2 adresses. Le changement de Railway se verrait alors avant de produire ses
  effets. Rejouer aussi le test d'en-têtes forgés après chaque changement chez Railway.
- **Limites du correctif.**
  - Les caisses d'une boutique derrière un même wifi partageront de nouveau un compteur
    (300 par 15 min, ≈ 20 scans/min par boutique). C'est le reste de l'étape 17 : une
    limite propre aux cartes Apple, une limite par clé pour les machines.
  - Avec `express-rate-limit` 7.5.1, la clé d'un client en IPv6 est son adresse complète :
    une plage IPv6 peut changer d'adresse pour contourner. Regroupement par préfixe à
    étudier avec le correctif.
  - Le correctif rend aussi le journal plus parlant : il écrira la vraie adresse du
    client. C'est une donnée personnelle, déjà présente aujourd'hui dans les journaux de
    Railway via `X-Forwarded-For`.

**Classement pour l'étape 17** (« lire la vraie adresse du client », déjà inscrite à la
synthèse) :
- **Priorité 1 de l'étape, et préalable à la croissance**, au même titre que le rythme
  des campagnes. **Pas une urgence de production aujourd'hui**, vu les volumes, sauf le
  blocage volontaire décrit plus haut.
- Le correctif est petit : `trust proxy` 2, recommandé ci-dessus. Les vérifications
  préalables sont faites (en-têtes forgés réécrits, deux étapes à chaque relevé, même
  comportement en production). Il passe juste après la clôture de l'étape 15.

### E. Série de mesures du temps 2 — calendrier validé par Yass (06/10)

Le palier 20 000 est retiré : 50 000 est le pire cas, et 20 000 ne sera ajouté que si 50 000
montre une surprise. Règle : générer la veille, mesurer le lendemain.
- **Mardi 06/10, 08:15 UTC** : données au palier 5 000, serveur et imitateur arrêtés.
- **Mercredi 07/10, après 08:30 UTC** (serveur démarré après 08:00, donc aucun cron) :
  - `scan,dashboard` ;
  - `rush` ×3, puis `rush` ×10 (300 s chacun) ;
  - `campagne` vers le réseau, deux fois ;
  - `campagne` vers le marchand plafond.
  Puis données au palier 50 000, serveur arrêté.
- **Jeudi 08/10** :
  - serveur et imitateur démarrés à 07:45 UTC ;
  - `rush` ×1 pendant 3 600 s à partir de 07:58, pendant le cron naturel de 08:00 ;
  - `/health/cron` pour `debut` et `fin` ;
  - puis `dashboard,campagne` vers le plafond.
  Ensuite, serveur et imitateur arrêtés.

**Règle de push jusqu'à la fin de l'étape 15 (Yass, 06/10).**
- AUCUN push pendant les fenêtres de mesure : mercredi 07/10, 08:30–10:00 UTC ; jeudi
  08/10, 07:30–09:30 UTC. C'est une fenêtre demandée par le pilotage, au sens du
  CLAUDE.md.
- En dehors : commit local, et push seulement sur feu vert.
- Avant tout push : pilote sur `attente`. Après un push : arrêter de nouveau le serveur
  et l'imitateur s'ils devaient l'être.

Pourquoi le cron naturel : le scénario `cron` du générateur lance son propre passage
(`generateur.js:166`), et le serveur lance le sien à 08:00 (`cron.js:23`) ; rien n'empêche
deux passages simultanés. **La pointe ×10 se joue au palier 5 000 seulement** : au palier
50 000, la boutique unique du marchand plafond reçoit la moitié des scans et dépasse le
limiteur (300 requêtes par 15 min).

**Cadre du rapport final (moins de 30 lignes).** Mesures vues du pilote (Amsterdam, réseau
privé) ; une caisse à Dubaï ajoute ≈ 0,28 s.

| Mesure | Banc (temps 1) | Réel (temps 2) |
|---|---|---|
| requête base côté serveur, méd. / max | 100 ms posés | |
| scan seul, méd. / max | 340–455 / 500 ms | |
| pointe ×3, méd. / p99 | 420 / 495 ms | |
| pointe ×10, méd. / p99 ; boucle max | 350 / 471 ms ; 105 ms | |
| dashboard : stats / group-stats / clients | 120 / 250–320 / 120–160 ms | |
| campagne réseau (1 000) : caisse méd. / max ; boucle max ; mémoire | 1,1–2,9 s / 26 s ; ≈ 1 s ; 650 Mo | |
| campagne plafond 5 000 / 50 000 : caisse max ; `PATCH` des cartes | — ; 50 000 cartes en 1,3 s | |
| cron complet 50 000 : durée ; cartes ; caisse pendant | 49 min ; 3 237 ; méd. 430 ms | |
| requêtes d'iPhone par push (200 + 304) | 3,3 à 3,7 | |

Conclusions, une ligne chacune :
- hypothèses du banc (100 ms par requête base ; un cœur ≈ un vCPU de Railway) ;
- **rythme des campagnes** : seuil de plus de 2 s à la caisse (banc : ≈ 500 inscriptions) et
  déclencheur (≈ 500 porteurs ou un réseau), maintenus ou ajustés ;
- règle 8 (étape 21) ;
- **étape 16** : délais maximaux proposés d'après les maxima mesurés (base, Google, APNs) ;
- **étape 17** : `trust proxy` 2 (décidé) ; limite propre au service web Apple, dimensionnée
  sur les requêtes d'iPhone par push ;
- **étape 18** : temps de rendu des bandeaux et écritures au stockage par campagne ;
- coût réel de la série (Railway, Supabase) ;
- surprises et limites.

## 16. DETTE — MISE À JOUR (compléter §4)

**Résolu depuis :** #14 (migration 029). Partiellement résolu par le chantier :
#2 (rôle caissier — réseaux OK via login boutique refusé sur le dashboard ; mono-site
encore token complet) et #3 (révocation — boutique coupable immédiatement via `actif` ;
token marchand mono-site toujours non révocable).

**Monté en gravité (réseaux = mode points = argent) :**
- **#9 idempotence `/api/scan`** — TOUJOURS OUVERT. Un double-tap/retry = double crédit
  (le `FOR UPDATE` sérialise mais ne dédoublonne pas). **La condition « avant plusieurs
  marchands en points » que le fondateur avait posée est atteinte.** *(L'annulation
  caissier mitige — on peut annuler un doublon — mais ne remplace pas l'idempotence :
  un double-crédit non remarqué passe.)*
- **#1 scanner 401** — pas de redirection login sur token expiré ; rayon ×15 sur un
  réseau (15 caisses mortes un matin).
- **#12 observabilité notifs** — 410 non purgés, échecs auto non tracés ; angle mort sur
  le canal vendu aux réseaux.

**Nouvelle dette :**
- **`/me/stats` tronqué à 1 000 lignes** — un mono-site > ~1 000 scans/30 j voit
  actifs/rétention/fréquence **sous-estimés sans erreur** (bug PRÉSENT). `group_stats`
  est immunisé ; `/me/stats` non. Correctif = même motif `COUNT`/RPC.
- **Incohérences Google hero** (§15).
- **`remember_device` jamais câblé sur le dashboard** (corrigé le 21/09, `4e63731`). Classe
  de défaut à surveiller : *le serveur sait faire, le front ne demande jamais*. Le scanner
  l'envoyait depuis `dfdaf87` ; le dashboard, jamais, sur toute l'histoire du dépôt.
- ~~**Jeton marchand irrévocable, portée ×52.**~~ **RÉSOLU** (migration 045, §15 ter) pour
  les cas « compte suspendu » et « appareil perdu ». Reste ouvert : la caisse mono-site
  porte un jeton marchand complet (cas c, écarté en pilotage). Constat d'origine :
  `authMarchand` ne consultait RIEN en base. **Aucune des 14 routes `authMarchand` ne vérifie `actif`**, dont 5
  qui écrivent : `POST /notifications`, `PATCH`/`DELETE /clients/:id`,
  `PATCH /me/points-de-vente/:id` et `/actif`. `GET /clients/export` est ouvert aussi. Seul
  le scan est protégé (`authScanner` relit la boutique). Depuis le 21/09 la fenêtre est de
  365 j au lieu de 7.
- **Aucune idempotence serveur sur `POST /scan`.** Aucune colonne de référence externe,
  aucune contrainte unique, aucune garde applicative. Les seules protections sont en mémoire
  du navigateur (`state.processing`, `lockedSerial`). Bloquant pour toute intégration serveur
  à serveur (e-commerce, borne).
- **Code de secours non unique.** Suffixe de 6 caractères hex = 16,8 M combinaisons ; ~3 % de
  collision à 1 000 clients/marchand, ~53 % à 5 000. Géré par un 409 `ambiguous` + candidats —
  utilisable par une caissière, **impasse en serveur à serveur**.
- **Workers du dashboard et du scanner : purge de tous les caches de l'origine**
  (découvert le 2026-09-30, point 7). À leur activation, `dashboard/sw.js:8` et
  `scanner/sw.js:35` suppriment tout cache autre que le leur, y compris ceux des deux
  autres espaces (le stockage des caches est commun à l'origine). Effet : repli hors
  ligne perdu jusqu'à la prochaine ouverture en ligne ; le scanner re-télécharge jsQR.
  Gravité faible. Correctif : filtre par préfixe, comme l'admin, au prochain passage
  sur ces fichiers (toute modification d'un `sw.js` réinstalle le worker sur toutes les
  caisses).
- **Liste des clients du dashboard plafonnée à 1 000** (découvert le 2026-09-30, point 8).
  `GET /api/clients` lit tous les clients d'un marchand sans pagination ; PostgREST en
  renvoie au plus 1 000 (les mieux dotés en points), sans erreur. La recherche du
  dashboard filtre dans le navigateur (`renderClients`) : un client au-delà du 1 000e est
  introuvable dans le dashboard, et le compteur affiché plafonne. Cinquième instance du
  motif (§12). Sans effet tant qu'aucun marchand ne dépasse 1 000 clients (1 329 clients
  au total le 21/09). Correctif : recherche et pagination côté serveur.
- **Dashboard non vidé au changement de session — DETTE MINEURE, décision de Yass
  (30/09 : ne se fait pas).** Étape 7, point 9 ; audit 05 c6. Les données chargées
  pendant une session (listes, statistiques ; l'onglet Réseau n'est même pas vidé à la
  déconnexion) restent en mémoire de la page quand une autre session s'ouvre dans le
  même onglet. Portée réduite depuis le point 8 : la liste des clients ne contient plus
  de coordonnées. Cas concerné : un appareil partagé entre deux comptes, sans
  rechargement de la page.
- **Quota manuel de notifications non validé côté serveur** (découvert le 2026-09-30).
  `PATCH /api/admin/marchands/:id` enregistre `notification_quota_override` tel quel :
  seuls le champ du formulaire (`min="0"`) et `quotaManuel()` écartent un négatif ou un
  non-entier. Sans effet depuis l'admin ; un appel direct pourrait enregistrer -1 (qui
  bloque tout envoi) ou 2.5.
- **Désinscription d'un appareil Apple sans contrôle du jeton** (découvert le 2026-10-01,
  point 10). `DELETE /v1/devices/:deviceId/registrations/:passTypeId/:serial`
  (`apple-wallet.js:65-77`) ne vérifie pas l'en-tête `ApplePass`, contrairement à
  l'inscription et au téléchargement. N'importe qui connaissant un identifiant d'appareil
  et un numéro de série peut couper les mises à jour poussées d'une carte. Question posée
  dans le dossier du point 10.
- **`railway.toml` cesse d'être lu le 2026-12-01 — ÉCHÉANCE ABSENTE DE L'AUDIT
  (découverte le 2026-09-29).** Documentation Railway (`railwayapp/docs`,
  `infrastructure-as-code.md:41`) : « Existing Config as Code files stop being read on
  2026-12-01 (hard cutoff) ». Jusque-là le fichier l'emporte sur le tableau de bord ;
  ensuite, ce sont les réglages du tableau de bord qui s'appliquent pour les **cinq**
  réglages du fichier : constructeur (`nixpacks`), commande de démarrage, chemin et
  délai du healthcheck, politique de redémarrage. Risques : le garde-fou `/health/db`
  disparaîtrait en silence (§15 septies) ; si le tableau de bord n'indique pas Nixpacks,
  la version de Node changerait sans commit (audit 99, étape 8). Parade minimale :
  recopier les cinq réglages dans le tableau de bord. Parade complète : migrer
  (`railway config migrate`, Infrastructure as Code). **Décision de pilotage à prendre
  avant le 01/12.** Diagnostic et plan au §15 terdecies (01/10) ; Node figé à 24.10.0.

- **Seuil ≤ 0 saisi dans l'admin : refusé par la base, message brut (03/10).** Depuis
  la migration 051, l'enregistrement échoue (seuil inchangé, vérifié par le filet), mais
  l'admin reçoit un 500 avec le texte de PostgreSQL. Un 400 clair dans `admin.js`
  (seuil entier ≥ 1) reste à faire. Mineur : Yass est le seul utilisateur de l'admin.
- **Demandes de scan sans clé acceptées : TRANSITION (03/10).** Tant qu'elles le sont,
  un renvoi sans clé crédite deux fois (deux lignes, annulable). Les écrans envoient la
  clé depuis 11b ; à rendre obligatoire quand la part des scans avec clé
  (`scans.cle_idempotence`, par jour) reste à 100 % plusieurs jours.
- **Annuler une remise n'annule pas la demande d'avis programmée (03/10, mineur).**
  Constaté par Yass sur Hamza Salon : la remise programme la demande d'avis à +30 min
  (minuteur en mémoire, `services/avis.js`) ; l'annulation du scan ne la retire pas. Le
  client reçoit donc la demande d'avis d'une récompense annulée. Antérieur à l'étape 11.

**Toujours reportés (raison valable) :** #4 (re-sync Google, arbitrage), #5, #6, #8,
#10, #11 (corriger listing+horloge ENSEMBLE, jamais séparément), #13 (parké).

**Dette découverte par l'étape 15, temps 1 (05/10) — notée, rien corrigé (décision de Yass).**
- **Registre « 200 » sans clés.** Sans clés Apple, `sendPushUpdate` rend sans rien
  envoyer (`apns.js:185-189`) et le scan inscrit l'envoi comme réussi (`scan.js:266`,
  `notif-registre.js`, `depuisErreur(null)` → 200). Une variable de clé perdue en
  production remplirait le registre de faux succès.
- **Cron non lançable en entier à la main.** `/api/admin/workflows` ne joue que 2 étapes
  sur 4 (`workflows.js:63-64`) ; seul le passage de 08:00 UTC fait tout. Le banc le lance
  par `/__campagne/cron`, hors production.
- **Création du bucket avant chaque envoi au stockage** (`strip-cache.js:137`) : un
  aller-retour de plus par image (≈ 100 ms au banc), refusé en silence.
- **Campagne sans cadence.** Tous les envois partent ensemble (`notifications.js:110-118`),
  puis tous les iPhones reviennent : au banc, 1 000 appareils gèlent la caisse jusqu'à
  26 s. Et le `PATCH` de toutes les cartes du marchand prépare une vague de
  re-téléchargements complets.
- **Cron et plafond de lignes** : relances vers des clients actifs (05 c7), **chiffré** au
  banc : ≈ 40 % des relances d'inactifs au palier 50 000.
- **Message Google du cron envoyé à toutes les cartes**, iPhone compris (`cron.js`,
  `notifyClient` ; déjà connu, étape 23) : **chiffré** au banc à ≈ 0,4 s sur les 0,9 s
  d'une carte (délai Google imité, HYPOTHÈSE), soit jusqu'à ≈ 28 % du passage pour 64 %
  de cartes iPhone.
- **Limiteur et boutiques chargées** : 300 requêtes par quart d'heure et par adresse,
  soit 20 scans/min tenus par boutique. À ×50, une boutique de franchise à plusieurs
  caisses peut les dépasser en pointe (étape 17).

**Dette découverte par les paliers de campagne (05/10, §15 vicies) — notée, rien corrigé.**
- **Le serveur ne voit pas l'attente de ses clients.** Pendant une campagne vers ≈ 780
  inscriptions, la caisse attend jusqu'à 9 s. Le serveur, lui, mesure ≤ 1,5 s par route et
  une boucle jamais bloquée plus de 0,9 s : l'attente se fait avant que la requête lui
  parvienne. Ni ses journaux, ni Sentry, ni une sonde toutes les 5 min ne verraient une
  tempête de 15 s. Seul le temps vu du client fait foi.
- **Un seul fil pour les caisses et les cartes iPhone.** Signature et archive des cartes,
  bandeaux, JSON : tout passe sur le même cœur. 12 s à 76–90 % de ce cœur suffisent à
  mettre les scans en file (options du §15 vicies).
- **File d'attente des connexions** (511 par défaut dans Node, `app.listen` sans réglage,
  `index.js:213`) : pleine à ≈ 1 000 inscriptions au banc (1 033 refus). Derrière l'entrée
  de Railway, le comportement peut différer (HYPOTHÈSE, temps 2).

**Découverte pour l'étape 9 (le dépôt reconstruit la base) et l'étape 3 (protection des
données, restauration) — 05/10, §15 vicies C. Notée ; aucune migration pour la
production.** Question posée : que casserait une reconstruction de la production depuis
le dépôt ? Réponse prouvée par deux rejeux locaux et par le projet de test :
- **Sur un projet réglé comme la production** (« exposition automatique des nouvelles
  tables » désactivée) : **IDENTIQUE, 0 écart · 48 plateforme**. Rien ne casse ; c'est
  acquis depuis la 048.
- **Sur un projet neuf avec la case cochée** (cas du projet de test) : **le code ne casse
  pas**, car `service_role` a au moins ses droits de production. Mais il y a **42 droits
  en trop** :
  - `anon` et `authenticated` peuvent lire, insérer, modifier et supprimer sur les 16
    tables, et utiliser les 3 séquences ;
  - `service_role` gagne la suppression sur `cron_passages` et la modification sur
    `diagnostics_camera` et les séquences.
  La RLS (active sur les 16 tables, aucune règle d'accès dans le dépôt) devient alors la
  SEULE barrière entre la clé publique (`sb_publishable_` = `anon`) et les données ; en
  production, il y en a deux. Rien ne le signale au serveur ; seule la requête d'écarts le
  voit.
- **Le dépôt ne consigne pas les réglages du projet** dont dépend la fidélité d'une
  reconstruction :
  - l'exposition automatique, c'est-à-dire les privilèges par défaut ;
  - Max rows 1000 ;
  - le chemin de recherche `public, extensions`.
  La requête d'écarts ne compare pas les privilèges par défaut. **Une restauration doit
  commencer par ces réglages**, sinon elle produit une base plus ouverte que la production.
- **Point fragile (HYPOTHÈSE, simulé)** : deux fonctions que le serveur appelle n'ont aucun
  `GRANT EXECUTE` explicite à `service_role`. Elles vivent sur le droit d'exécution de
  `PUBLIC`, que Supabase conserve aujourd'hui (#45329) :
  - `credit_referral` (`scan.js:340`) ;
  - `effacer_client` (`clients.js:173`).
  Sur un projet qui retirerait ce droit, la simulation les rend inexécutables
  (`exec=000`) : bonus de parrainage non crédité, **sans bruit** (supabase-js ne lève
  pas), et effacement RGPD en échec. Les autres fonctions appelées ont leur GRANT (036,
  038, 039, 044, 051, 052). **Sur la carte, à trancher après l'étape 15 (décision de Yass,
  05/10) ; rien corrigé en production.**
- **L'exemple « purge de `cron_passages` sans DELETE » ne s'applique pas** : aucune purge
  dans le code, et la production n'a pas ce droit non plus (049).
- **RÈGLE : ne JAMAIS lire l'en-tête `Forwarded`** (ni pour un limiteur, ni pour un
  journal, ni pour une décision). L'entrée de Railway le laisse passer tel que le client
  l'envoie : prouvé le 06/10, `for=192.0.2.80` forgé reçu intact (§15 vicies D). Seuls
  `X-Forwarded-For`, lu par Express avec le bon réglage, et `X-Real-IP` sont réécrits par
  Railway. Vaut aussi pour tout outil ou bibliothèque ajouté plus tard (vérifier qu'il ne
  le lit pas).
- **Limiteurs comptés par relais de Railway** (PROUVÉ en production le 06/10, §15 vicies
  D). Un même client est éparpillé sur ≈ 6 relais, et chaque relais mélange tous les
  clients qui y passent. Correctif `trust proxy` 2 recommandé, programmé juste après
  l'étape 15 (décision de pilotage).
- **Nom de colonne trompeur** dans la requête d'écarts : « production » désigne la base
  examinée. Hors production, il fait lire le résultat à l'envers. À renommer en
  « base examinée » (`generer.sh`, puis régénérer) ; petit, non fait.

## 17. DÉCISIONS HORS PILOTAGE

Toute décision prise sans passer par le pilotage (Yass) se note ici : date, décision,
raison, effet constaté. Une entrée vaut aveu, pas justification — la règle reste le
contrat §7 (diagnostic, validation, puis code).

**2026-09-25 — `updateLoyaltyObjectPoints` lève désormais sur statut non-200.**
Le lot « registre des envois » demandait d'enregistrer le statut des mises à jour
d'objets Google. La fonction ne le LISAIT pas : rendre le statut exploitable
imposait de le vérifier, donc de lever. Ce n'était pas explicitement au périmètre.
Conséquence contenue : les deux appelants (`scan.js`, `clients.js`) enveloppent
l'appel d'un `catch` qui journalise — le comportement visible est inchangé, et
`scan.js` a reçu un `catch` supplémentaire pour que l'`addMessage` suivant parte
toujours. Sans cette levée, la colonne `statut` aurait toujours valu 200 pour cette
surface, c'est-à-dire une mesure fausse.

**2026-09-25 — ouverture de la section « Workflows » de l'admin au forfait Pro,
et découplage de `landing_premium`.** Le cadrage ne parlait que du filtre serveur
(`cron.js`). Mais la section du formulaire était conditionnée à `pro_plus` : sans
ce changement, aucun marchand Pro n'aurait eu de case à cocher et l'ouverture
serait restée sans effet. Corollaire découvert en le faisant : `landing_premium`
était envoyé **depuis le bloc des workflows**. Une fois ce bloc ouvert au Pro,
enregistrer un Pro aurait transmis `landing_premium = false` depuis une case
jamais remplie — donc **écrasé la valeur en base**. Le champ suit désormais sa
propre section (Pro+). Vérifié au navigateur : un enregistrement Pro ne contient
plus `landing_premium`, un enregistrement Pro+ le contient toujours.

**2026-09-25 — trois surfaces d'envoi ajoutées au recensement.** `ajustement`,
`annulation` et le parrainage n'étaient pas dans la liste minimale donnée en
pilotage. Elles envoient bien des pushes ; les omettre aurait laissé des trous dans
le registre. Rattachées aux sources `ajustement`, `annulation` et `scan`.

**2026-10-05 — test d'adresse : la sonde a conclu à tort « adresse réelle ».** **Aveu** :
la règle de conclusion (`generateur.js:205-209`) supposait qu'un relais partagé aurait une
adresse privée ; ceux de Railway sont publics. Le défaut a été vu par Yass dans le
navigateur, pas par l'outil. Outil non corrigé (diagnostic seul) ; la règle juste est écrite
au §15 vicies D.

**2026-10-05 — geste 3 du temps 2 : omission dans la procédure, diagnostic des droits.**
(1) **Aveu** : `PROCEDURE.md` ne disait rien de la case « Automatically expose new tables »,
qui figure pourtant dans le relevé du 26/09 (00b) ; la case est restée cochée (reconnu
côté pilotage : elle avait été laissée cochée sur consigne du pilotage), d'où les 42 droits
en trop. Procédure corrigée, correction validée par le pilotage. (2) Deux rejeux locaux (privilèges par défaut « tout »
puis « comme la production ») pour prouver la cause et répondre à « que casserait une
reconstruction » ; un premier essai trop strict sur les fonctions (exécution de `PUBLIC`
retirée) a été écarté, car la production garde ce droit (`admin_marchands_stats`, 044,
exécutable par `anon` en production alors que la 044 ne l'accorde qu'à `service_role`).
(3) Correction prototypée hors du dépôt, puis intégrée au pilote (pas `droits`) après le
feu vert de Yass. Choix de réalisation pris sans pilotage, dans ce périmètre : refus si un
écart sort des droits de données ; table sonde avec une colonne d'identité, pour éprouver
aussi les séquences futures ; sorties 1 pour les refus du pas, 3 restant réservé au
garde-fou du témoin. Raisons au §15 vicies C.

**2026-10-05 — paliers et préparation du temps 2 (étape 15), choix pris sans pilotage.**
Dans le périmètre des décisions de Yass du 05/10 :
(1) un palier ≈ 1 000 ajouté aux 4 demandés, puis une seconde série complète et deux
essais de diagnostic à 750 (sonde de connexion, processeur par processus) : un seul essai
par palier ne suffisait pas à fixer un seuil (pire scan très variable) ;
(2) seuil exprimé en inscriptions iPhone (un push par ligne `device_tokens`) ; le
déclencheur proposé (400 inscriptions, requête mensuelle) a été remplacé par la décision de
Yass : premier marchand à ≈ 500 porteurs ou signature d'un réseau ;
(3) le témoin sorti dans `temoin.sql`, joué avant `donnees.sql` ;
(4) une seule image pour les trois services, programme choisi par `CAMPAGNE_PROGRAMME`,
« Custom Start Command » vide comme en production ;
(5) base préparée par `psql` depuis le pilote, via le « Session pooler » de Supabase ;
mode `donnees` en une transaction qui vide toutes les tables de `public` ;
(6) la procédure fait créer une clé `sb_secret_` (comme la production), pas l'onglet
Legacy ; elle laisse l'option « automatic RLS » décochée, pour éprouver la 048 ;
(7) valeur de repos `attente` pour le pilote ;
(8) sonde d'adresse ouverte au navigateur par `?cle=` (clé du serveur de test seulement) ;
(9) une sonde d'adresse muette fait désormais échouer le générateur au lieu de conclure
« adresse réelle » (défaut du temps 1, trouvé en relisant) ;
(10) image construite avec Docker en local, avec le certificat du proxy de la machine
ajouté à une COPIE du Dockerfile et sans l'étape apt (miroir Debian bloqué) ; le fichier du
dépôt n'a pas cet ajout ;
(11) un rôle de test local endosse `postgres` (`options=-c role=postgres`) pour que la
requête d'écarts compare les propriétaires comme sur Supabase.
Raisons au §15 vicies.

**2026-10-05 — choix de réalisation de l'étape 15, temps 1, pris sans pilotage.** Dans le
périmètre validé : (1) délai du banc de 100 ms par requête base (milieu de 80–120 ms,
§15 decies) ; (2) iPhones simulés « à jour » au départ, pour mesurer le régime établi ;
(3) stockage imité en mémoire sur le banc ; (4) sondes `/__campagne/*` (mesures, cron
complet, sortie) dans le fichier de campagne, protégées par une clé, 404 sans elle ;
(5) PostgREST du banc plafonné à 1 000 lignes, comme Supabase ; (6) `tests/lancer.js`
prête ses outils au banc de charge au lieu de les dupliquer (filet inchangé, 119/119) ;
(7) démon Docker démarré dans le conteneur pour prouver `.dockerignore` (export du
contexte, aucune image téléchargée) ; (8) témoin à identifiant fixe
(`c0ffee15-0000-4000-8000-000000000015`, slug `temoin-campagne-15`). Raisons au §15
novodecies.

**2026-10-04 — choix de réalisation de l'étape 14b, pris sans pilotage.** Dans le
périmètre validé (décision 2 et bonus entier en points) : (1) « jamais de baisse »
appliqué aussi à un bonus nul ou négatif (sans effet) ; (2) `SET search_path = public`
ajouté, comme 051 et 052 ; (3) droits de la fonction laissés tels quels (pas de
fermeture partielle de la 050) ; (4) deux commentaires mis à jour (`scan.js`,
`tests/lancer.js`). Raisons au §15 octodecies.

**2026-10-04 — choix de réalisation de l'étape 14a, pris sans pilotage.** Dans le
périmètre validé (décision 3) : (1) limite interne de 20 s, 10 s sous les 30 s de
Railway, pour écrire le bilan avant l'arrêt forcé ; (2) TOUS les envois lancés après la
réponse sont suivis (19), pas seulement cartes, registre et parrainage, plus les
handlers via `asyncHandler` ; (3) sortie 0 même quand la limite est atteinte ; (4)
SIGINT traité comme SIGTERM (Ctrl-C en local) ; (5) un second serveur dans le filet pour
le test, sans toucher au serveur des autres scénarios. Raisons au §15 octodecies.

**2026-10-03 — choix de réalisation de l'étape 13, pris sans pilotage.** Dans le
périmètre validé : (1) un ajustement à la même valeur n'écrit rien et ne pousse pas la
carte ; (2) un écran d'avant 13b (sans solde attendu) reste accepté, ajustement tracé
mais non vérifié (TRANSITION) ; (3) l'annulation d'un ajustement passe par une route du
dashboard (session marchand) ; (4) après un refus « un scan vient de passer », la fiche
est relue (une requête, après le refus) ; après un ajustement réussi, la ligne est
ajoutée sur place (aucune requête) ; (5) icône « ✎ » et libellés. Raisons au §15
septdecies.

**2026-10-03 — choix de réalisation de l'étape 12, pris sans pilotage.** Dans le
périmètre validé : (1) le renouvellement se déclenche après un scan réussi, jamais à
l'ouverture (cohérent avec le refus de la décision 4) ; (2) le nouvel essai automatique
vaut aussi pour le limiteur (une requête de plus, sans effet le plus souvent) ; (3)
l'identifiant de connexion est gardé en `localStorage` pour être pré-rempli (jamais le
mot de passe) ; (4) une session courte de 7 jours n'est jamais prolongée ; (5)
« Accès refusé » (rôle) est traité comme une session expirée ; (6) textes des panneaux et
du bandeau. Raisons au §15 sexdecies.

**2026-10-03 — choix de réalisation de l'étape 11a, pris sans pilotage.** Dans le
périmètre validé, mais non tranchés par Yass : (1) un renvoi (même clé) renvoie la
poussée Apple et la mise à jour de l'objet Google, pas le message Google ; (2) le renvoi
d'un scan annulé depuis est refusé (409 `scan_cancelled`) plutôt que recrédité ; (3) les
messages de la carte sont préparés par le serveur et posés par la base (« {{solde}} ») ;
(4) codes de refus 400 / 409 `idempotency_conflict` / 409 `scan_cancelled`. Raisons au
§15 quindecies. Aucun n'est visible avant 11b (aucun écran n'envoie de clé).

**2026-09-29 — copie locale avancée sans demande.** Au début de la session « SETUP 4 »,
la branche locale avait 20 commits de retard sur `origin/claude/keen-goldberg-MXslu`
(dont `docs/audit/99-synthese.md`, à lire). Avancée en avance rapide
(`git merge --ff-only`), aucun changement local n'existant : rien perdu, rien poussé.

---

*Mis à jour le 2026-10-06 par la session « SETUP 4 », seizième chantier (suite 5) :
résultats de Yass sur les en-têtes. Railway réécrit `X-Forwarded-For` et `X-Real-IP`, mais
laisse passer `Forwarded` tel quel : règle « jamais `Forwarded` » au §16. 6 relais pour un
même ordinateur. Production comptée par relais, PROUVÉ par ses journaux ; aucun 429
trouvé. Recommandation : `trust proxy` 2, hypothèses et garde au §15 vicies D. Rien codé ;
correctif juste après la clôture de l'étape 15.*

*Mis à jour le 2026-10-05 par la session « SETUP 4 », seizième chantier (suite 4) : test
d'adresse (§15 vicies D). Railway REMPLACE le `X-Forwarded-For` du client (non contournable),
mais `trust proxy` 1 fait compter tous les limiteurs PAR RELAIS de Railway, pas par client ;
`trust proxy` 2 retiendrait la vraie adresse (calcul prouvé). La sonde avait conclu à tort
(défaut de l'outil, avoué au §17). Production : même code, même entrée, vérification par ses
journaux. Classement : priorité 1 de l'étape 17, préalable à la croissance. Rien corrigé.*

*Mis à jour le 2026-10-05 par la session « SETUP 4 », seizième chantier (suite 3) : pas
`droits` du pilote livré après feu vert (retraits seulement, refus si un objet a moins que la
production ou si l'écart sort des droits, table sonde, IDENTIQUE exigé) ; garde-fous 39/39,
filet 173/173 ; branche `campagne/etape15` poussée. À Yass : `CAMPAGNE_ETAPE=droits` sur le
pilote, puis Deploy. `credit_referral` / `effacer_client` : sur la carte, après l'étape 15.*

*Mis à jour le 2026-10-05 par la session « SETUP 4 », seizième chantier (suite 2) : temps 2
créé par Yass (Supabase et Railway `winwin-campagne-15`, jusqu'à la fin de l'étape 18, au plus
tard le 31/10/2026). Geste 3 : image et `psql` OK, 048 passée sur projet neuf, mais ÉCART sur
42 droits EN TROP dans la base de test (case « Automatically expose new tables » cochée ;
cause prouvée par reproduction, §15 vicies C). Reconstruction réglée comme la production :
IDENTIQUE. Découverte pour les étapes 9 et 3 au §16. Correction par un pas `droits` du pilote
proposée et prouvée en local, non codée. Déclencheur du rythme des campagnes (Yass) : premier
marchand à ≈ 500 porteurs ou signature d'un réseau.*

*Mis à jour le 2026-10-05 par la session « SETUP 4 », seizième chantier (suite) : étape 15,
paliers et préparation du temps 2 (§15 vicies). Règle 8 du contrat (§7) : pas de levée du
plafond de l'étape 21 avant que les campagnes aient un rythme. Seuil mesuré au banc : plus de
2 s à la caisse dès ≈ 500 inscriptions iPhone par campagne, cause prouvée (le serveur sature
son unique cœur, la caisse fait la queue derrière les cartes) ; déclencheur (Yass) :
premier marchand à ≈ 500 porteurs ou signature d'un réseau.
Temps 2 prêt, rien créé : Dockerfile de campagne, préparation de base, pilote,
`tests/charge/PROCEDURE.md` (premier geste : test d'adresse). Garde-fous 33/33, filet
173/173. Branche `campagne/etape15` poussée comme branche de relecture, jamais déployée.*

*Mis à jour le 2026-10-05 par la session « SETUP 4 », seizième chantier : étape 15, temps 1
(§15 novodecies), banc local sur la branche `campagne/etape15` (NON POUSSÉE). Outil
`tests/charge/` (rien dans `src/`, hors de l'image Docker, prouvé) ; garde-fous 23/23 ;
redirection Apple et Google prouvée ; premiers coûts : scan ≈ 0,35–0,45 s côté serveur,
pointe ×10 tenue, **campagne vers 1 000 appareils : caisse gelée jusqu'à 26 s**, sans
plafond de lignes (étape 21) plateforme hors service plusieurs minutes, cron complet
49 min pour 3 237 cartes. Correction : serveur à Amsterdam (le diagnostic s'appuyait à
tort sur l'audit). `scripts/load-test.js` supprimé. Filet 173/173.*

*Mis à jour le 2026-10-04 par la session « SETUP 4 » : 14b (`1203d6c`) vérifié par Yass,
**étape 14 close** (14a `acbb82d`, 14b `1203d6c`). Reste reporté : le crédit de
parrainage sans ligne au journal ; provisoire : les demandes d'avis perdues au
redéploiement (§15 octodecies). Prochaine étape de la synthèse : 15 (environnement de
test et test de charge), non commencée.*

*Mis à jour le 2026-10-04 par la session « SETUP 4 », quinzième chantier : 14a
(`acbb82d`) vérifié par Yass. 14b (§15 octodecies) : migration 053 (`credit_referral` :
jamais de baisse, bonus entier en points, plafond en tampons, verrou du parrain seul),
filet 173/173 deux fois. Migration 053 exécutée par Yass AVANT le push (vérification et
contrôle conformes, écarts IDENTIQUE, 0 écart · 48 plateforme), puis 14b poussé sur son
feu vert. Vérification de 14b en production : à suivre ; l'étape 14 sera close après.*

*Mis à jour le 2026-10-04 par la session « SETUP 4 », quatorzième chantier : étape 14a
(§15 octodecies), l'arrêt propre : `CMD node`, `services/arret.js`, 19 envois suivis,
cron arrêté au signal, 20 s au plus ; filet 168/168 deux fois. Variable
`RAILWAY_DEPLOYMENT_DRAINING_SECONDS` = 30 posée par Yass avant le push ; 14a poussé sur
son feu vert. Vérification (un redéploiement, bilan `[arret]`) : à suivre.*

*Mis à jour le 2026-10-04 par la session « SETUP 4 » : 13b (`bcde845`) vérifié par Yass,
**étape 13 close**. Étape 14b : bonus de parrainage crédité en entier en points, plafond
conservé en tampons (décision de Yass). 14a en cours d'écriture, branche locale.*

*Mis à jour le 2026-10-04 par la session « SETUP 4 » : décisions de Yass sur l'étape 14
(§15 octodecies) : 1 refusée, 2, 3 (sous condition de coût nul), 4 (a) et 5 validées ;
aucun code. Branche `relecture/etape13` non poussée : son contenu est en production
(`bcde845`).*

*Mis à jour le 2026-10-04 par la session « SETUP 4 » : 13a (`424d3e8`) vérifié par Yass.
13b (§15 septdecies) remis sur la production : 159/159 deux fois ; le code 13a passe
139/139 sur une base qui porte la 052. Migration 052 exécutée par Yass AVANT le push
(contrôle 6 × `true`, écarts IDENTIQUE, 0 écart · 48 plateforme), puis 13b poussé.
Vérification de 13b en production : à suivre.*

*Mis à jour le 2026-10-04 par la session « SETUP 4 » : étape 12 close (12a `ebe0d81` et
12b `2b31c92` vérifiés par Yass). Étape 13a : bouton « Annuler » sur le dernier passage
actif, dans la fiche client du dashboard (même route que le scanner, qui acceptait déjà
la session du marchand ; aucun code serveur, aucune migration ; test navigateur
`tests/navigateur/fiche_annulation.js`). 13b (journal des ajustements, migration 052) à
venir.*

*Mis à jour le 2026-10-04 par la session « SETUP 4 » : étape 8, push 2b (`railway.toml`
supprimé, §15 terdecies) ; réglages à reposer par Yass dans le tableau de bord, commande
de démarrage VIDE. Les branches `etape12` (poussée en relecture) et `etape13` (locale)
portent les étapes 12 et 13, non déployées.*

*Mis à jour le 2026-10-03 par la session « SETUP 4 », douzième chantier : étape 13
(§15 septdecies), annuler et ajuster depuis le dashboard : 13a (bouton « Annuler » dans
la fiche client, sans migration) et 13b (migration 052 : ajustements tracés, vérifiés,
annulables dans l'ordre inverse ; sans plafond en points, confirmation au-delà du seuil)
écrits et testés, 159/159 ; NON POUSSÉS, commits locaux sur la branche `etape13` (remise
sur la production le 04/10, après 12). Décisions de Yass : 1, 2, 3 validées, 4 refusée (« Points mis à jour »
inchangé).*

*Mis à jour le 2026-10-03 par la session « SETUP 4 », onzième chantier : étape 12
(§15 sexdecies), la caisse après une erreur : 12a (limiteur en JSON, renouvellement de
session) et 12b (délai de 15 s, un nouvel essai automatique, panneaux en mots simples,
bandeau juste) écrits et testés, 133/133 ; NON POUSSÉS, commits locaux sur la branche
`etape12`. Décisions de Yass : 1, 2, 3 et 5 validées, 4 refusée (aucune vérification de
session à l'ouverture), aucune requête régulière en plus. Push 2b de l'étape 8 d'abord,
seul.*

*Mis à jour le 2026-10-03 par la session « SETUP 4 », dixième chantier : étape 11
(§15 quindecies). 11a, le crédit incassable : migration 051 (exécutée par Yass avant le
push, écarts IDENTIQUE), `scan.js` en un seul appel (`0a28d37`, vérifié par Yass en
production). 11b : les écrans envoient la clé et la gardent après une erreur ; filet
86/86 et test navigateur 15/15. Dette découverte : message brut de l'admin sur un seuil
≤ 0 ; demandes sans clé en transition ; annuler une remise n'annule pas la demande
d'avis (§16). Push 2b de l'étape 8 reporté au 04/10.*

*Mis à jour le 2026-10-02 par la session « SETUP 4 », neuvième chantier : étape 10
(§15 quaterdecies), filet de tests argent et scan, `npm test`, 62/62 ; il attrape les trois
casses provoquées exprès. Aucun code de production touché. Décisions de Yass : écarts A
(étape 13) et B (étape 14, case parrainage jamais cochée en points d'ici là), règle « npm
test avant push » (§7, règle 7), phase 2 reportée. Étape 8 : push 2a (Dockerfile sous
garde-fou, `6f8f596`) vérifié par Yass ; push 2b vers le 05/10.*

*Mis à jour le 2026-10-01 par la session « SETUP 4 », huitième chantier : étape 8
(§15 terdecies), diagnostic des réglages Railway avant le 01/12 ; geste 1 fait : Node figé à
24.10.0 (`engines`, `.nvmrc`, lockfile). Clés historiques Supabase désactivées par Yass le
01/10 ; clé publishable « default » gardée (non supprimable), faille du point 5 théorique.
Gestes 2 à 5 : décision de Yass attendue.*

*Mis à jour le 2026-10-01 par la session « SETUP 4 », septième chantier : étape 7, points
5 (migration 050) et 10 (secret des cartes Apple), écrits et testés (32/32 chacun), NON
POSÉS par décision de Yass, rangés sur la branche `relecture/etape7-points-5-10` (non déployée) avec
leurs dossiers de relecture. Point 5 remplacé par la suppression des clés publiques (aucune
utilisée, vérifié) ; point 10 : risque accepté sur `JWT_SECRET`. Décision de Yass : les commerçants
français restent en Pro+ (§15 duodecies). Dette découverte : désinscription Apple sans
contrôle du jeton (§16).*

*Mis à jour le 2026-09-30 par la session « SETUP 4 », sixième chantier : forfaits
alignés sur l'offre commerciale (§15 duodecies). Règles 2 (landing premium en Pro et Pro+,
coordonnées suivant la landing premium) et 3 (quotas 0/5/20, quota manuel 0 possible),
règles regroupées dans `services/forfaits.js` ; 73/73 et 23/23. Point 9 de l'étape 7 :
non fait, dette mineure (décision de Yass). Dette découverte : quota manuel non validé
côté serveur (§16).*

*Mis à jour le 2026-09-30 par la session « SETUP 4 », cinquième chantier : étape 7
(§15 undecies), en cours. Règle de pilotage corrigée (Amine non engagé, accès retiré le
30/09 ; points 5 et 10 par dossier extérieur). Faits par Yass : double authentification,
règle « Protection prod », chemins surveillés (`e7e3ac8` « skipped »). Livré : point 7,
service worker de l'admin en réseau d'abord (21/21 au navigateur ; `4604fb6`, vérifié par
Yass, seconde moitié du test des chemins surveillés réussie) ; point 6, mot de passe admin
comparé à temps constant (42/42 ; `98b9605`, vérifié par Yass) ; point 8, coordonnées
clients réservées au Pro+ dans la liste et la fiche (35/35). Dette découverte : les
workers du dashboard et du scanner purgent les caches voisins ; liste des clients du
dashboard plafonnée à 1 000 (§16).*

*Mis à jour le 2026-09-30 par la session « SETUP 4 », quatrième chantier : étape 6
(§15 decies). Serveur déplacé à Amsterdam par Yass (30/09, 09:05 UTC, 1 réplique) ; coût
d'une requête base mesuré depuis Dubaï : ≈ 213 → ≈ 80–120 ms. `/health` inchangé depuis
Dubaï : POP d'entrée hors d'Europe (anycast Railway, aucun réglage par service). Part fixe
d'≈ 70 ms par requête, indépendante de la distance. Aucun code.*

*Mis à jour le 2026-09-29 par la session « SETUP 4 », troisième chantier : étape 5 (§15 nonies).
Bascule de clé faite par Yass le 29/09 au soir (§15 septies B, état ; clés historiques à
désactiver vers le 03/10). Sonde UptimeRobot `/health/db` créée par Yass. Livré : migration
049 (exécutée par Yass, contrôle 4 × `true`), suivi du cron et route `/health/cron`
(28/28), requête d'écarts régénérée (production : IDENTIQUE, 45 plateforme). Reste à Yass :
créer la sonde `/health/cron` le 30/09 après 08:10 UTC. Contrat §7 respecté : diagnostic,
proposition testée, migration exécutée AVANT le push, feu vert explicite.*

*Mis à jour le 2026-09-29 par la session « SETUP 4 », second chantier : étape 9 (§15 octies).
Migration 048 exécutée par Yass (contrôle 4 × `true`) ; requête d'écarts en production :
IDENTIQUE au dépôt hors les 3 lignes « plateforme ». Outil de preuve versé dans
`database/requetes/ecarts_prod_depot/`, à relancer après chaque migration. Ligne 047
ajoutée au tableau §8, où elle manquait. Contrat §7 respecté : diagnostic, requête lancée
par Yass, migration testée puis exécutée par Yass AVANT le push, feu vert explicite.*

*Mis à jour le 2026-09-29 par la session « SETUP 4 » : chantier clé Supabase (§15 septies).
Diagnostic : une seule clé, côté serveur, acceptée au format `sb_secret_` sans code ;
aucune clé dans les pages web. Livré : garde-fou de déploiement `/health/db` (`c115e90`,
étape 1 de la roadmap), qui refuse clé fausse, clé publique et base injoignable. Procédure
de bascule écrite pour Yass (étape 2, aucun code). Dette découverte : `railway.toml` n'est
plus lu à partir du 2026-12-01 (§16). Contrat §7 respecté : diagnostic, proposition de
code, feu vert explicite, puis commit et push.*

*Mis à jour le 2026-09-23 par la session « SETUP 3 » : migrations 040→044 ; mode points
(barre de progression, solde exact, couleurs modulables) ; code de secours sous le QR ;
diagnostic caméra (palier 0.5) ; correctif « C » (scanner aveugle) ; séparation seuil
atteint / récompense à remettre ; thème de strip « illustration » (registre, rendu, admin,
§15 bis) ; comptage admin en base (migration 044, §12) ; connexion mémorisée du dashboard.
Dette découverte : jeton marchand irrévocable sur 14 routes, absence totale d'idempotence
serveur, non-unicité du code de secours, troisième et quatrième instances du plafond 1 000.
Contrat §7 respecté : migrations exécutées par le fondateur AVANT le code, diff avant push,
feu vert explicite par déploiement.*

*Mis à jour ~2026-08 par la session « chantier franchise » : migrations 028→039 ;
multi-boutiques complet (étape 1 mesure, 2 boutiques+gestion, 3 scanner par boutique
[login unifié + durcissement + coupure + provisioning], 4 dashboard groupe `group_stats`,
5 annulation du dernier scan `annuler_scan`) ; fix bug historique (authScanner + scope
boutique) ; audit de dette complet (Partie II §16). Deux corrections de grants (028/030,
même classe que le bug parrainage). Dette #9 (idempotence) escaladée, `/me/stats`
truncation et incohérences Google hero documentées. Contrat §7 respecté de bout en bout :
migrations exécutées par le fondateur AVANT le code, diff avant push, feu vert par
déploiement.*
