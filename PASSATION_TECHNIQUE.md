# PASSATION TECHNIQUE — WinWin Card

> **À qui s'adresse ce document.** À une session Claude Code neuve ou à un développeur
> humain qui n'a jamais vu ce code. Il remplace la mémoire de la session qui a construit
> le mode points, l'i18n, le backup code et corrigé les 4 bugs de l'audit #3. Tout ce qui
> n'est pas ici est perdu. Lisez-le EN ENTIER avant de toucher au backend ou au SQL.
>
> **Qui pilote.** Le fondateur, non-développeur. Il valide chaque étape, exécute lui-même
> les migrations SQL dans Supabase, et teste sur de vrais téléphones. La méthode de travail
> (section 7) n'est pas décorative : c'est le contrat.

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
| `src/services/strip-generator.js` | Génère l'image « strip » à tampons (SVG → PNG via sharp) |
| `src/services/strip-cache.js` | Cache des strips : LRU mémoire + Supabase Storage, clé versionnée par `strip_config_version` |
| `src/workers/cron.js` | Workflows quotidiens (relance inactifs, near-reward) |
| `src/i18n/messages.js` | Messages de notifications FR/EN côté serveur |
| `src/middleware/auth.js` | JWT : rôles `marchand`, `admin` (+ `scanner` prévu mais jamais émis) |
| `public/admin/index.html` | Panel admin (le fondateur) — création/édition marchands |
| `public/dashboard/index.html` | Dashboard marchand (stats, clients, scanner intégré, notifs) |
| `public/scanner/index.html` | PWA scanner de caisse (login marchand, caméra, saisie manuelle, historique) |
| `public/landing.html` | Page d'inscription client (`/l/:slug`) |
| `database/schema.sql` + `database/migration_*.sql` | Schéma et migrations (voir pièges §3.3 : 012 et 022 sont NEUTRALISÉES, 023 est la référence pour le RPC ; 025 réconcilie repo↔prod — schema.sql + 002→025 reproduit la prod) |

### Données clés (table `marchands` et `clients`)

- `marchands.type_programme` : `'stamps'` (défaut) ou `'points'`. Fixe le mode du
  programme de fidélité. **Wam N Fade (client payant) est en points ; tous les autres
  marchands sont en tampons.**
- `marchands.max_value` : le seuil (10 tampons, ou p. ex. 500 points).
- `marchands.langue` : `'en'` (défaut) ou `'fr'`. **Figée à la création**, pilote toute
  l'i18n (landing, dashboard, scanner, notifs, label du strip).
- `clients.stored_value` : le solde. `clients.pass_serial_number` : UUID v4, **immuable**,
  encodé dans le QR du pass, clé de tout (passes, device_tokens, objet Google).
- Table `scans` : journal de chaque scan (`stored_value_avant`, `stored_value_apres`).

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

1. `git log --oneline -5` — la branche de travail est `claude/keen-goldberg-MXslu`,
   derniers commits connus : `72a96c4` (fix parrainage, item [5] §2) et les migrations
   024/025 + cette mise à jour (session du 2026-07-13 ; `37ecc63` = fin de la session
   précédente).
2. En base : une **seule** fonction `increment_stored_value` (requête §5-migrations).
3. Un scan caméra ET un scan backup code sur le cobaye Pizza Sabbioni (voir son état,
   dette #7) : solde + notif + pass rafraîchi dans les deux cas.
4. `type_programme` de Wam N Fade = `'points'`, des autres marchands = `'stamps'`.

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

---

*Rédigé le 2026-07-13, en fin de session, par la session Claude Code qui a livré : i18n
FR/EN complète, backup code, historique scanner, mode points (fondation → report du
surplus), résolution de l'incident RPC, re-sync Google Wallet, et les 4 correctifs de
l'audit #3. Dernier commit : `37ecc63`.*

*Mis à jour le 2026-07-13 par la session suivante : fix du parrainage (un crédit par
filleul à vie — migration_024 + ticket avant crédit dans scan.js), réconciliation
repo↔prod (migration_025), pièges §3.9 (supabase-js ne rejette jamais) et §3.10
(photographier la base), arbitrages fondateur consignés en dette #4, #9, #10.*
