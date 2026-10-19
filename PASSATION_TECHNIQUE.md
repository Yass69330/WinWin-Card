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

## 0. DÉMARRAGE DE SESSION : ÉTAT AU 15/10/2026 (à lire en premier)

Cette section suffit pour démarrer. Le détail de chaque point est dans la section
indiquée.

### 0.1 Ordre des chantiers : la carte, seule source (décidé le 15/10)

- **La carte des chantiers du pilotage est la seule source de l'ordre.** Chaque
  chantier vivant est une carte `t*` ou `f*`.
- **Les « étapes N » sont abandonnées.** Elles restent dans ce document comme
  historique, avec leurs numéros, mais ne disent plus rien de l'ordre.
- **Les dates et échéances vont sur une carte dédiée** du pilotage, et non dans
  ce document.
- **La session propose, le pilotage décide.** Tout ce que la session juge urgent
  ou à réordonner, vu depuis le code, remonte au pilotage. La carte enregistre
  l'ordre validé. Ce document garde la trace technique : livré, preuves,
  hypothèses, dette.
- Les règles de session sont dans `CLAUDE.md`, à la racine du dépôt. Elles priment.

### 0.2 Production

- Branche déployée : `claude/keen-goldberg-MXslu`, sur Railway, déployée à chaque
  push. Dernier push : **`34073a2`** (19/10, t17 : désinscription Apple contrôlée, quota manuel borné).
  - Pousser en avance rapide seulement, sur feu vert de Yass.
  - La migration est exécutée dans Supabase AVANT le push du code qui en dépend.
- Branche de travail des sessions : jamais poussée (consigne de Yass). Le crochet
  d'arrêt qui demande de la pousser est ignoré.
- Dernière migration exécutée en production : **065** (18/10 : 064 index avant le push, 065 après ; 3 × true chacune).
- Tests : `npm test` (filet `tests/lancer.js`, base jetable, PostgREST, vrai
  serveur, sections 0 à 26) avec contrôle de syntaxe des écrans. Dernier total :
  **342/342** filet seul, **437/437** avec les 8 tests navigateur (18/10). Tests navigateur hors `npm test` : `tests/navigateur/*.js`, avec
  Playwright. Détail au §15 septquinquagies.
- Commande :
  `PATH=~/.cache/winwin-filet/node-v24.21.0-linux-x64/bin:$PATH npm test`
  depuis `winwincard/backend`. Node doit être 24.21.0.
- Contre-épreuve : le filet rejoué sur le commit de production (git worktree +
  lien vers `node_modules`). Elle est exigée à chaque livraison.

### 0.3 Chantiers clos ou en production

- **f18** (message du boost, bloc allégé) : en production le 14/10 (`a0e044b`),
  contrôles bons. **Clos.** Détail au §15 quatuorquinquagies.
- **f15** (le marchand règle ses relances) : en production. **Clos.**
- **f10** (« À proximité » sur iPhone) : en production le 14/10 (`70caa3c`).
  - Activé chez hamza-salon seulement, pour les tests de Yass.
  - Test du créneau `00:00-24:00` sur 2 appareils : résultat non noté ici.
  - Ouverture aux vrais marchands et volet Android : décisions à prendre.
  - Détail au §15 quinquinquagies.
- **f17** (cartes à thème) : en production **dormant** le 15/10 (`495ed40`,
  migration 063).
  - L'interrupteur admin `themes_actifs` est à false partout et aucun thème n'est
    préparé. Mécanisme testé par Yass : il fonctionne.
  - Mise en service réelle plus tard : thèmes et logos préparés en admin,
    ouverture par marchand, puis rendu réel sur hamza-salon (iPhone, Android,
    arrêt silencieux, registre `theme`).
  - Détail au §15 septquinquagies.
- **t43** (clé d'idempotence obligatoire) : en production le 18/10. **Clos.**
- **Campagnes ciblées** (index des segments + inactifs 60 j seulement) : en production le
  18/10 (`665f57a`, migrations 064 et 065). Contrôle de Yass : déploiement vert, scan passé,
  menu à 60 j, comptage sans erreur. **Clos.** Détail au §15 novoquinquagies.
- **t37** (campagnes par lots, débit partagé de 30 iPhone par 10 s) : en
  production. **Clos.** C'est ce même débit qui protège la caisse pendant les
  envois de f10 et f17.

### 0.4 En attente : décisions et mesures

1. **t43, clé d'idempotence obligatoire : en production le 18/10, CLOS.**
   - Poussé `195c1e5..54a7768` à 09:24 UTC, après requête D à 100 % et WAM à jour
     (51 scans sur 14 jours, 0 sans clé).
   - Contrôle de Yass : déploiement vert, aucune ligne `ALERTE cle_idempotence`,
     scan réel passé. Détail au §15 octoquinquagies.
2. **Gain Google (règle D2, depuis le 13/10) : mesure à refaire vers le 20/10.**
   - Premier relevé, le 15/10 :
     - en brut, scan 1238 → 246 et inactive 821 → 100 ;
     - mais « avant » couvre 7 jours et « après » 2,5 jours. Par jour, environ
       410 → 220 envois Google, soit moitié moins. Signal clair et attendu.
   - **Vers le 20/10** : relancer, **normalisé pour 100 scans**, et noter ici le
     chiffre final. Requête (lignes `google` de `notification_envois`, 7 jours
     avant et après le 13/10) :
     ```sql
     WITH e AS (SELECT CASE WHEN envoye_le < '2026-10-13' THEN 'avant' ELSE 'apres' END AS p, count(*) AS envois
                  FROM notification_envois WHERE plateforme = 'google'
                   AND envoye_le >= '2026-10-06' AND envoye_le < '2026-10-20' GROUP BY 1),
          s AS (SELECT CASE WHEN date_scan < '2026-10-13' THEN 'avant' ELSE 'apres' END AS p, count(*) AS scans
                  FROM scans WHERE annule_le IS NULL
                   AND date_scan >= '2026-10-06' AND date_scan < '2026-10-20' GROUP BY 1)
     SELECT e.p, e.envois, s.scans, round(100.0 * e.envois / NULLIF(s.scans, 0), 1) AS envois_google_pour_100_scans
       FROM e JOIN s USING (p) ORDER BY 1 DESC;
     ```
3. **Environnement de test `winwin-campagne-15` : décision (b), le 15/10.**
   - Il est supprimé **au 31/10**, sans nouvelle série de charge.
   - t41 se fera par revue de code, inventaire du dashboard et test « tous les
     onglets » (`tests/navigateur/onglets.js`). Le débit partagé de t37 protège
     déjà la caisse, et f10 et f17 passent par lui.
   - Son coût n'a jamais été relevé ici.
4. **Phase 2 du filet** (GitHub Actions + « Wait for CI » dans Railway) : à lancer
   quand le pilotage le place.
   - Une seule fausse alerte connue : la limite de temps de la section 17,
     corrigée le 14/10 (1,5 s → 4 s). Depuis, toutes les exécutions sont vertes.
   - Diagnostic d'abord : PostgreSQL et PostgREST dans GitHub Actions, puis le
     réglage dans Railway par Yass.
5. **UptimeRobot** : les conditions d'usage commercial de l'offre gratuite n'ont
   pas été vérifiées (§15 novies). C'est à Yass.

### 0.5 À remonter au pilotage : urgences et ordre, vu depuis le code (15/10)

Ce sont des propositions de la session. L'ordre validé est celui de la carte.

- **Échéances datées** (carte des dates ; 20/10 et 31/10 validées par le pilotage
  le 15/10) :
  - **20/10** : mesure finale du gain Google ;
  - **31/10** : suppression de l'environnement de test ;
  - **printemps 2027** : quatre échéances, dont l'adhésion Apple (audit 99 §6).
- **Échéances closes (confirmé le 15/10, à ne pas rouvrir)** :
  - **`railway.toml` (01/12)** : **clos le 04/10**, étape 8, push 2b (`5630092`).
    - Le fichier est supprimé du dépôt (vérifié par git le 15/10 : absent).
    - Yass a vérifié dans le tableau de bord le 04/10 :
      - « Using detected Dockerfile! » : le Dockerfile remplace Nixpacks et fixe
        Node ;
      - « Custom Start Command » vide ;
      - Healthcheck Path `/health/db`, délai de 30 s ;
      - Restart Policy On Failure, 3 essais ;
      - déploiement vert (§15 terdecies, « Push 2b FAIT le 04/10 »).
    - Le 01/12 ne change donc plus rien.
  - **Clé historique Supabase (fin 2026)** : **close**. Bascule de clé le 29/09,
    clés historiques désactivées le 01/10 (§15 septies).
- **Dette de sécurité** (§16), **rangée par le pilotage le 15/10** dans le chantier
  sécurité (reste de t17) et dans le contrôle de sécurité (gate) de f17 :
  - **désinscription d'un appareil Apple sans contrôle du jeton** : n'importe qui
    connaissant un identifiant d'appareil et un numéro de série peut couper les
    mises à jour d'une carte ;
  - **quota manuel de notifications non validé** côté serveur.
- **Dette de justesse silencieuse** : **soldée** (vérifié le 18/10, §15 novoquinquagies) :
  `/me/stats` passe par `apercu_stats` (étape 26), la liste des clients est paginée
  (étape 21).
- **Proposition (t42, 18/10)** : les campagnes ciblées cassent vers 8 000 porteurs
  (fidèles) et 15 000 (inactifs). Deux index corrigent (testés sur base jetable). Pas urgent
  aujourd'hui, à faire avant un marchand de cette taille. §15 novoquinquagies.
- **Proposition (t42, 18/10)** : avant toute ouverture réelle de f17 :
  - plafonner la voie Google des bascules (aujourd'hui sans débit global) ;
  - limiter les réouvertures (message hors quota, sans limite) ;
  - éclaircir le double envoi (requête prête) ;
  - donner un propriétaire atomique aux bascules.
- **Ordre** : la section 0 est la vue de l'ordre (résumé tenu aligné par le
  pilotage), sans copie de la carte dans le dépôt (décision du 15/10). Quand un
  chantier a besoin de sa fiche complète, le pilotage colle l'extrait au démarrage.
- **Petit et utile** :
  - la clé d'idempotence obligatoire (point 0.4, n° 1) ;
  - la phase 2 du filet (point 0.4, n° 4).

### 0.5 bis Cap du 19/10 : API caisses (Black Tulip)

- t42 en pause après 3 onglets (Notifs, Réseau, Scans) ; Clients, Aperçu, Scanner plus tard.
- Cadrage de l'API caisses : `docs/api/01-api-caisses-cadrage.md` (§15 untriginta sexagies).
  Rien codé avant validation du contrat et réponses de leur technicien.

### 0.6 Où lire quoi

- Dernier chantier livré : f17, au §15 septquinquagies.
- Décisions prises sans le pilotage : §17. Dette : §16.
- Requêtes utiles : `winwincard/backend/database/requetes/` et les blocs SQL des
  sections 15.
- Audit de fond (état de santé, échéances) : `docs/audit/99-synthese.md`.

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
- **Tests** : *(texte d'origine périmé, corrigé le 15/10)* le filet `npm test`
  existe depuis l'étape 10 (voir §0.2), complété par des tests navigateur et par des
  tests manuels sur vrais iPhone et Android.

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
- **Durée de vie : gardé pour 17a et pour le diagnostic t40, supprimé AU PLUS TARD le
  31/10/2026** (décision de Yass, corrigée le 07/10 : l'étape 18 est en parking, elle ne
  borne plus rien). Ensuite : suppression des deux projets (`PROCEDURE.md`, dernière
  section).

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

### F. Temps 2, premières mesures réelles (palier 5 000) — le goulot est la BASE

**Mesures de Yass** (Railway Amsterdam, Supabase Paris en Micro ; vu du pilote) :

| Mesure | Banc (temps 1) | Réel (temps 2) |
|---|---|---|
| requête base, médiane | 100 ms posés | **107 ms** : hypothèse du banc validée |
| scan seul, méd. / p99 | 340–455 / ≈ 500 ms | 345 / 616 ms ; dashboard < 0,75 s |
| pointe ×3 : méd. / p99 / max ; boucle max ; mémoire | 420 / 495 ms / — ; 120 ms ; 200 Mo | 297 / 514 / 730 ms (154/154 en 200) ; 53 ms ; 266 Mo |
| pointe ×10 : méd. / p95 / p99 / max ; boucle max ; mémoire | 350 / — / 471 ms / — ; 105 ms ; 280 Mo | 347 / 648 / 994 / 1 481 ms (547/547 en 200) ; 52 ms ; 307 Mo |
| campagne réseau (1 000 appareils), passage 1 : scans méd. / max | 1,1–2,9 s / 26 s | **11,7 s / 154 s** |
| idem : requêtes base max ; `GET /v1/passes` méd. ; boucle max ; mémoire | 0,4–0,8 s ; — ; ≈ 1 s ; 650 Mo | **81 s** ; **24,8 s** ; 140 ms ; 560 Mo |
| passage 2 : scans méd. / max (n = 18) ; requêtes base max | — | **94,6 s / 134 s** ; 85 s |

La mesure n° 5 (campagne vers le marchand plafond) a été annulée par le pilotage : elle était
redondante, la tempête étant déjà décrite. Elle ira dans la série du seuil (paliers 123, 308
et 615), plus tard, au calme. Selon Yass, aucun marchand actuel ne lance de campagne : pas
d'urgence. Décision du pilotage pour le jour du cron : `rush` 3 600 s avec le cron de 08:00,
puis `dashboard` seul.

**Diagnostic (06–07/10) : ce qui est PROUVÉ.**
- **Ce n'est pas le serveur.** Sa boucle ne bloque pas plus de 140 ms, contre ≈ 1 s au
  banc, où le processeur saturait.
- **L'attente est du côté de Supabase.** Les temps « base » sont pris autour de l'appel
  vers l'hôte Supabase (fichier de campagne, `fetch` mesuré). Or Node 24 n'a pas de file
  propre vers une même origine : essai local, 500 requêtes envoyées ensemble, servies
  ensemble (1,6 s pour 500 réponses d'une seconde). Les 81 à 85 s se passent donc entre
  l'envoi à Supabase et sa réponse.
- **Le banc ne pouvait pas le voir.** Son délai de 100 ms était ajouté à chaque requête EN
  PARALLÈLE, sans limite de nombre (`tests/lancer.js:209`), devant un PostgreSQL local à
  4 cœurs. Il simulait la distance, pas la capacité de la base.
- **C'est une surcharge qui s'accumule.** ≈ 1 000 pushes × ≈ 3,7 requêtes d'iPhone × 1 à 3
  requêtes base chacune, soit plusieurs milliers de requêtes base en une minute. Elles
  arrivent plus vite que Supabase ne les sert. Le passage 2 (médiane 94,6 s contre 11,7 s)
  a démarré sur la file du passage 1, pas encore vidée.

**Départagé le 06/10 par la ligne JSON du passage 2** (`timestamp` 12:06:07 UTC ; passage
1 lancé à 11:42 UTC, passage 2 environ 2 min après la fin du 1 ; scans 27/27 puis 18/18 en
200). La série « mercredi » a en fait été jouée le **mardi 06/10**, après le chargement 5 000
du matin : 113 s sur Micro, 99 928 porteurs, 578 MB.
- **La file est dans la chaîne de l'API de données** (PostgREST et sa passerelle), et non
  dans l'instance, son disque ou l'entrée de Supabase.
  - Pendant la tempête, le stockage (`stockage GET` : méd. 175 ms, max 3,7 s ;
    `stockage POST` : méd. 125 ms) est resté rapide. Il passe pourtant par la même
    instance, la même entrée et le même serveur.
  - Dans le même temps, chaque requête PostgREST attendait : `base GET clients`,
    `marchands` et `passes`, méd. ≈ 24 s et p95 ≈ 25 s ; `rpc/crediter_scan`, méd.
    23,9 s ; `base GET device_tokens`, méd. 44 s. Les listes d'appareils arrivent les
    premières, au plus fort de la file.
- **Débit mesuré de l'API de données sous saturation : ≈ 32 requêtes base par seconde**
  (5 102 servies en 158 s). La file comptait ≈ 770 requêtes (loi de Little : 32/s × 24 s).
- **≈ 5,1 requêtes base par appareil réveillé** (5 102 pour 995 réveils ; 992 listes,
  puis 1 945 cartes, dont 770 en 200 et 1 175 en 304).
- **L'écran du marchand attend lui aussi** : `POST /api/notifications` a mis **51,8 s**.
  Ses écritures (`notification_logs`, 25 s) passent dans la même file.
- Ni le serveur ni les tiers ne freinent : boucle max 130 ms, 434 Mo, carte Apple méd.
  246 ms, push Apple méd. 314 ms, message Google méd. 520 ms.
- **Reste à lire**, sans risque, dans les graphiques du projet de test de 11:40 à 12:10 UTC
  le 06/10 : les connexions par rôle (celles de PostgREST plafonnent-elles, et à
  combien ?), le processeur, le rapport API. Ils diront si la limite est le nombre de
  connexions de PostgREST (HYPOTHÈSE principale) ou sa passerelle.

**Conséquence pour le chantier « rythme des campagnes »** (estimation sur un seul passage,
qui portait la file du passage 1) :
- Pour ne pas créer de file, les retours d'iPhone doivent rester sous ≈ 32 requêtes base
  par seconde, soit ≈ 6 appareils par seconde au total, caisses comprises.
- Avec une marge de moitié : ≈ 3 appareils par seconde, donc 100 appareils toutes les
  30 s. Une campagne de 1 000 appareils durerait ≈ 5 min ; 16 000 (le réseau sans plafond),
  ≈ 1 h 30.
- ~~Le seuil réel pourrait être bien plus bas que les 500 du banc (≈ 25 appareils).~~
  **INFIRMÉ le 06/10** par la vérification terrain, plus bas : 32/s était le débit sous
  surcharge, pas la capacité.
- La pointe ×10 (≈ 1,7 scan/s, ≈ 15 requêtes base/s avec ses retours d'iPhone) tient sous
  ce plafond. La saturation viendrait vers ×20.

**Donnée terrain contraire (Yass, 06/10).** Un marchand de la production (≈ 250 porteurs) a
envoyé ≈ 3 campagnes en 10 jours, sans souci signalé. Cela contredit l'estimation « ≈ 25
appareils ». Explications possibles, à départager en lecture seule :
- **(1) Les vrais iPhones reviennent bien plus étalés** que les 1 à 5 s de l'imitateur
  (`imitateur.js:34`, HYPOTHÈSE du temps 1). Livraison par Apple, appareils verrouillés ou
  hors ligne : l'arrivée est alors bien sous 32 requêtes base par seconde. Le seuil suit
  l'étalement S : ≈ 32 × S / 5 appareils, soit ≈ 770 pour S = 2 min et ≈ 1 900 pour
  S = 5 min.
- **(2) Peu d'appareils réellement atteints**, à cause des jetons périmés (410).
- **(3) Peu de scans dans les minutes qui suivent** : sans scan, « aucun souci signalé »
  ne prouve rien.
- **(4) Une partie de ces campagnes date d'avant le 05/10**, quand la production était en
  Nano, plus petite que Micro.

Méthode, en lecture seule :
- requête SQL sur la production (`notification_logs` pour l'heure et `total_apple`,
  `notification_envois` pour les envois acceptés par Apple, `scans.date_scan` sur 5 min) ;
- journaux de Railway sur la fenêtre de chaque campagne. Le journal « combined » du
  serveur donne l'heure de chaque requête, mais pas sa durée (`morgan/index.js:178`) ; les
  journaux HTTP de Railway donnent la durée.
- Si l'étalement réel est mesuré, la série du seuil se rejoue sans code, avec
  `IMITATEUR_IPHONE_MIN_MS` et `IMITATEUR_IPHONE_MAX_MS` réglés sur lui.

**Vérification terrain (Yass, 06/10, production, lecture seule).**
- **Les campagnes.** La requête trouve 4 campagnes de ce marchand (24/09, 25/09, 30/09,
  03/10), de 137 à 187 iPhones visés, avec 0 à 3 scans sur toute la plateforme dans les
  5 min. Les deux premières ont tourné en Nano, avant le comptage Apple au registre.
- **Campagne du 30/09, 16:20:24 UTC** (167 iPhones) : 133 retours `/v1/devices` entre
  16:20:22 et 16:20:38, en un seul bloc, avec quelques retardataires jusqu'à 16:45. Puis
  81 `/v1/passes` servis entre 16:20:23 et 16:20:29, dont 90 % dans la seconde :24 (le
  journal écrit à la fin de la réponse).
- **Campagne du 03/10, 19:21:41 UTC** (187 iPhones) : ≈ 165 retours entre 19:22:09 et
  19:22:51, en 3 vagues. Puis 90 `/v1/passes` entre 19:22:26 et 19:22:59, en 3 vagues.
- **Aucune file visible.**

**Conclusions.**
- **Les vrais iPhones reviennent GROUPÉS** : d'un bloc en ≈ 15 s, ou en vagues sur
  ≈ 40 s. L'imitateur (1 à 5 s) en est le **pire cas**, réaliste.
- **L'estimation « seuil ≈ 25 appareils » est INFIRMÉE. Aveu** : j'avais pris le débit
  mesuré PENDANT la surcharge (≈ 32 requêtes base/s, 5 102 en attente) pour la capacité
  de l'API de données. Or une file qui déborde fait chuter le débit. En charge modérée,
  la production a servi ≈ 73 cartes, soit ≈ 220 requêtes base, en une seconde (30/09),
  et en Nano : sa capacité est très au-dessus de 32/s.
- **Seuil réel : entre ≈ 170 appareils** (production, sans file) **et 1 000** (test,
  file de 24 à 44 s). C'est la lecture du pilotage.

**Pourquoi le test est plus sévère que ces campagnes de production** (prouvé, sauf mention) :
- **≈ 7 fois plus d'appareils** (1 000, contre 133 à 187).
- **≈ 2 à 3 fois plus de cartes revérifiées par appareil** (1 945 cartes pour 992
  appareils, contre ≈ 0,6 à 1 en production). Cause dans le code :
  - la route qui rend la liste (`apple-wallet.js:85-92`) filtre `passes.updated_at` sur la
    carte jointe ;
  - PostgREST ne filtre alors PAS les lignes de l'appareil : toutes ses cartes sont
    rendues, puis revérifiées (1 175 réponses 304 au passage 2) ;
  - les appareils de test portent ≈ 2,7 cartes de marchands tirés au hasard
    (`donnees.sql:74-80`, ratio de l'audit). Les clients de ce marchand en portent ≈ 1.
  C'est la dette « revérification de toutes les cartes » (option 2 du rythme).
- 1 000 messages Google et 1 387 lectures au stockage en même temps.
- Une base 26 fois plus grosse (578 Mo contre 22 Mo), plus que la mémoire de Micro.
- Au total, ≈ 12 fois plus de requêtes base que ces campagnes, dans une fenêtre de même
  durée.
- **Réglages de l'API de données comparés : NON VÉRIFIÉS.** Taille du groupe de
  connexions, versions, instance : relevé en lecture seule proposé (dashboard et requête
  SQL sur les deux projets).

**Alignement proposé** (rien fait) :
- **D'abord le relevé des réglages.** S'ils diffèrent, aligner le projet de TEST, jamais
  la production.
- **Ensuite, la série du seuil** (123, 308 puis 615 porteurs, soit ≈ 100, 250 et 500
  appareils) :
  - le palier ≈ 100 à 150 se compare directement à la production. Sans file au test, le
    test vaut la production ;
  - les paliers suivants trouvent le coude.
- **Sur feu vert seulement**, réduire les cartes par appareil dans `donnees.sql`, pour
  coller aux clients d'un seul marchand. Garder 2,7 reste le choix prudent : c'est la
  moyenne de la production, tirée vers le haut par quelques appareils.

**Relevé des réglages, production contre test (Yass, 06/10, lecture seule).**
- **IDENTIQUES** :
  - `max_connections` 60, `shared_buffers` 256 MB, `effective_cache_size` 768 MB,
    `work_mem` 3 500 kB, `statement_timeout` 120 s ;
  - délais des rôles : `anon` 3 s, `authenticated` et `authenticator` 8 s ;
  - Max rows 1 000 ; taille du groupe de connexions de PostgREST « Configured
    automatically » sur les deux.
- **DIFFÉRENTS** :
  - taille de la base : 25 MB en production, contre 599 MB au test ;
  - PostgreSQL 17.6 sur processeur ARM (aarch64) en production, contre 17.11 sur x86_64
    au test ;
  - PostgREST nommé « postgrest » en production (6 connexions ouvertes, trafic réel), sans
    version lisible, contre « PostgREST 14.18 » au test (1 connexion) ;
  - `pg_net` 0.20.0 contre 0.20.4.

**Lecture du pilotage (06/10) : aucun réglage à aligner.** L'écart vient surtout :
- **du volume** : la base de test dépasse `shared_buffers`, celle de la production tient en
  mémoire ;
- **de la plateforme** : processeur et versions, que Supabase fixe et qui ne s'alignent pas.

**Le seuil mesuré au test est celui de la TAILLE CIBLE**, pas celui de la production
actuelle. On garde ce cadrage. Les données de test restent à 2,7 cartes par appareil.

**Limites du test qui en découlent** (à reprendre dans le rapport final) :
- **Processeur ARM (production) contre x86 (test), et versions différentes** (PostgreSQL
  17.6 contre 17.11 ; PostgREST de version inconnue contre 14.18). Les temps absolus
  portent donc une incertitude que rien ne mesure ici. Les mécanismes, eux, ne dépendent
  pas du processeur : file dans l'API de données, taille des rafales, cartes revérifiées.
- **Un projet NEUF reçoit aujourd'hui la plateforme du test** (x86, versions récentes).
  C'est le cas d'une restauration ou d'une seconde structure (étapes 3 et 9). Le test
  préfigure donc aussi la plateforme d'une production reconstruite, ou d'une production
  que Supabase migrerait.

Les quatre hypothèses initiales, pour mémoire :
- **(a) le groupe de connexions de PostgREST**, fixé par Supabase selon la taille de
  l'instance (quelques dizaines au plus sur Micro, HYPOTHÈSE) ;
- **(b) le processeur de l'instance Micro** (2 vCPU partagés), qui porte à la fois
  PostgreSQL, PostgREST, la passerelle et le stockage ;
- **(c) le budget d'entrées-sorties disque de Micro**, entamé par les chargements de
  données ;
- **(d) l'entrée de Supabase**, face à des centaines de connexions chiffrées ouvertes en
  même temps.

Pour départager :
- comparer, dans la ligne JSON du passage 1, les temps `stockage GET/POST` (API de
  stockage : sa propre file, même instance) aux temps `base …`. Le stockage lent lui aussi
  désigne l'instance (b, c, d) ; le stockage normal désigne le groupe de PostgREST (a) ;
- lire les graphiques du projet de test (Reports : processeur, disque, connexions, API) sur
  la fenêtre de la campagne.

**Options du chantier « rythme des campagnes », révisées avec cette cause** (rien codé) :
1. **Rythme d'envoi**, par lots : reste la réponse principale. La taille des lots se règle
   désormais sur le débit mesuré de Supabase, et non plus sur le processeur. Risques
   inchangés : durée, reprise sans doublon après un redéploiement.
2. **Moins de requêtes base par retour d'iPhone** (remonte en 2) : chaque requête évitée
   soulage directement la file. Pistes : une lecture groupée (carte, client, marchand) au
   lieu de trois ; répondre « pas changé » (304) depuis une date en cache ; ne plus
   modifier toutes les cartes du marchand à chaque campagne. Risque faible à moyen (carte
   périmée servie).
3. **File côté serveur, priorité aux caisses** (nouvelle) : plafonner les requêtes base
   en vol venant des retours d'iPhone (par exemple 10 à 20). Les scans ne passent plus
   derrière des milliers de requêtes de cartes. Risque moyen : cartes mises à jour plus
   lentement, réglage à trouver.
4. **Plus de capacité chez Supabase** (instance supérieure) : seulement si les graphiques
   montrent le processeur ou le disque saturés. Coût mensuel, et le pic demeure.
5. **Créneaux de campagne** : sans code.

Rétrogradées :
- **sortir la fabrication des cartes** du fil principal, et **deux répliques Railway** :
  elles soulagent le processeur du serveur, qui n'est pas le goulot ;
- **limiter les fabrications simultanées** (réponse 503) : couvert par l'option 3.

**Règle 8 renforcée** : lever le plafond de 1 000 lignes multiplierait cette tempête sur la
base.

**Seuil réel : inconnu.** Au banc, plus de 2 s dès ≈ 500 inscriptions ; en réel, 154 s à
1 000. Le déclencheur (≈ 500 porteurs ou un réseau) est maintenu en attendant la mesure, et
pourrait devoir baisser.

**Mesurer plus tard le seuil réel, sans code** :
- un rechargement au palier dimensionné, puis une campagne vers le marchand plafond :
  `CHARGE_PLAFOND` 123, 308 puis 615 (≈ 100, 250 et 500 inscriptions, comme au banc),
  `CHARGE_CIBLE_CAMPAGNE=plafond` ;
- avant chaque campagne, un `scan` de contrôle (médiane revenue à ≈ 350 ms), et au moins
  10 min entre deux campagnes ;
- ramener le pire scan, les requêtes base et les graphiques Supabase. Le seuil est le
  premier palier où le pire scan dépasse 2 s.

Variante, une seule journée et un seul chargement : un petit ajout aux outils (trois
marchands de 123, 308 et 615 porteurs dans `donnees.sql`, cible de campagne choisie par
variable). À coder seulement sur feu vert.

### G. RAPPORT FINAL DE L'ÉTAPE 15 (07/10)

**Banc** : local, 4 cœurs, délai base posé à 100 ms. **Réel** : Railway Amsterdam +
Supabase Micro Paris (x86, PostgreSQL 17.11, PostgREST 14.18). Base de test à la taille
cible : 100 000 porteurs, 599 MB. Temps vus du pilote ; une caisse à Dubaï ajoute ≈ 0,28 s.

| Mesure | Banc | Réel |
|---|---|---|
| requête base, méd. | 100 ms posés | **107 ms** |
| scan seul, méd. / p99 | 340–455 / ≈ 500 ms | 345 / 616 ms |
| pointe ×3, méd. / p99 / max | 420 / 495 / — ms | 297 / 514 / 730 ms |
| pointe ×10, méd. / p99 / max ; boucle max | 350 / 471 / — ms ; 105 ms | 347 / 994 / 1 481 ms (547/547) ; 52 ms |
| dashboard, palier 5 000 | 120–320 ms | < 0,75 s |
| dashboard, palier 50 000 : stats / group-stats / clients | — | réseau 820 / 748 / 168 ms ; plafond 828 / **1 505** / 230 ms (listes coupées à 1 000) |
| campagne vers 1 000 appareils : caisse méd. / max | 1,1–2,9 s / 26 s (processeur) | **11,7 s / 154 s**, puis 94,6 s / 134 s (file de l'API de données) |
| cron complet, palier 50 000 | 49 min | **57 min** (08:00:00 → 08:57:15) |
| rush ×1 pendant le cron (2 h 30) : caisse méd. / p99 / max | méd. 430 ms | 313 / 633 / 1 730 ms ; base max 3,5 s ; boucle max 321 ms ; 343 Mo |
| campagnes réelles de la production (133 à 187 iPhones) | — | aucune file ; retours groupés en 15 à 40 s |

**Découvertes.**
- Le goulot des campagnes est **l'API de données de Supabase**, pas le serveur : le
  stockage est resté rapide pendant la tempête.
- Le seuil se situe **entre ≈ 170 et 1 000 appareils**, à la taille cible.
- **4 413 pushes étalés** (≈ 1,3 par seconde, cron et rush) n'ont pas gêné les caisses :
  le rythme d'envoi est la solution.
- L'écran du marchand reste bloqué **52 s** pendant une campagne.
- Un iPhone **revérifie toutes ses cartes** à chaque push (`apple-wallet.js:85-92`) :
  15 978 `GET /v1/passes` pour 4 413 pushes, soit ≈ 3,6 par push.
- Les limiteurs comptent **par relais de Railway** ; l'en-tête `Forwarded` est
  falsifiable.
- Une reconstruction depuis le dépôt dépend du réglage « exposition automatique » ;
  `credit_referral` et `effacer_client` reposent sur le droit d'exécution de `PUBLIC`.
- `near_reward` : **895 clients** notifiés d'un coup, chez le marchand plafond (plafond
  de 1 000 lignes).
- Le cron a purgé 7 013 lignes du registre ; 47 refus APNs 410 (simulés).

**Conclusions par étape.**
- **17a** (vraie adresse) : `trust proxy` 2 et sa garde (DÉCIDÉ), prouvés d'abord au
  test ; juste après la clôture.
- **16** (panne de base lue au comptoir) : sans délai maximal, la caisse a attendu
  jusqu'à 154 s. Proposition : un délai par appel à la base, au-dessus des 3,5 s mesurées
  en charge normale (par exemple 5 à 8 s), pour une erreur franche au lieu d'une attente.
- **17** (limiteurs, au-delà de 17a) : limite propre au service web Apple, dimensionnée sur
  ≈ 3,6 requêtes de carte par push (≈ 1 à 2 après le premier levier du rythme) ; limite par clé pour les
  machines.
- **18** (bandeaux) : rendus de 14 à 30 ms en réel, non bloquants. Mais ≈ 1 400 lectures
  au stockage par campagne de 1 000 appareils. Priorité inchangée.
- **21** (plafond de 1 000 lignes) : la règle 8 est confirmée. Le plafond borne
  aujourd'hui les rafales des campagnes et de `near_reward`.
- **22** (relance) : cron de 57 min à la taille cible (au-delà, `/health/cron` signale
  « pas_fini » à 60 min) ; plafond par épisode à prévoir.
- **23** (envois) : 410 et purge du registre fonctionnent ; un message Google part vers
  toutes les cartes pendant une campagne (1 018).
- **Liste « mises à jour depuis »** (`apple-wallet.js:85-92`) : cause de la revérification
  trouvée et mesurée. **Décision du pilotage (07/10) : ce n'est pas une étape à part, c'est
  le PREMIER LEVIER du chantier « rythme des campagnes ».** On ne l'ajoute pas à la feuille
  de route. **La ligne 24 de la synthèse** (`docs/audit/99-synthese.md:338`, liste
  « mises à jour depuis » et son horodatage, corrigés ensemble) **est rattachée au chantier
  « rythme des campagnes », comme son premier levier** (acté par le pilotage le 07/10). Le
  fichier de la synthèse lui-même n'est pas modifié.
- **Chantier « rythme des campagnes »** :
  - envoi par lots calibré (≈ 1 à 2 pushes par seconde prouvés sans gêne) ;
  - réponse immédiate à l'écran du marchand ;
  - moins de requêtes par retour (premier levier : la liste « mises à jour depuis ») ;
  - file prioritaire pour les caisses ;
  - **série du seuil** (paliers 123, 308 et 615) **sortie de l'étape 15, jouée dans ce
    chantier, avant puis après correction** (décision du pilotage) ;
  - déclencheur : premier marchand à ≈ 500 porteurs, ou signature d'un réseau.

**Limites du test.**
- iPhones imités qui reviennent en 1 à 5 s : le pire cas.
- 2,7 cartes par appareil, et une base 24 fois plus grosse que la production : taille
  cible.
- x86 au test contre ARM en production, versions différentes : les temps absolus sont
  incertains.
- Le générateur et les iPhones passent par le réseau privé, pas par l'entrée publique.
- Délais de Google imités (sauf création).
- 211 réponses 401 pendant le rush : artefact du jeton de 2 h du générateur
  (`generateur.js:57`), pas un défaut du serveur.
- Coût réel de la série : à relever (usage Railway, facture Supabase).

**Décisions de clôture (Yass, 07/10).**
1. `tests/charge/` est versé sur la branche de production, inerte et hors de l'image,
   avec la suppression de `scripts/load-test.js`, le `.dockerignore` et `tests/lancer.js`.
   Trois preuves avant le push : `npm test` complet, `git diff` (`src/`, `Dockerfile`,
   dépendances et `database/` intacts), et `tests/charge` absent de l'image.
   **Réunies le 07/10** :
   - `npm test`, avec les tests au navigateur : **173/173 OK** ;
   - `git diff dc4a0ac` est VIDE sur `src/`, `Dockerfile`, `package.json`,
     `package-lock.json` et `database/`. Ne changent que la passation, `.dockerignore`
     (+3 lignes), `tests/lancer.js`, `tests/charge/` et la suppression de
     `scripts/load-test.js` ;
   - image de production construite avec Docker (copie locale du `Dockerfile` racine,
     plus le seul certificat du proxy de la machine) : `/app/tests` contient
     `lancer.js`, `navigateur` et `scenarios.js`. `tests/charge` et `load-test.js` sont
     absents. Commande : `node src/index.js`.
   Versé par avance rapide depuis `dc4a0ac` (commit qui porte ce texte).
2. La liste « mises à jour depuis » est le premier levier du chantier « rythme des
   campagnes », pas une étape à part.
3. Serveur et imitateur de test éteints, pilote en `attente`. L'environnement de test est
   gardé pour 17a et pour le diagnostic t40, supprimé au plus tard le 31/10 (corrigé le
   07/10 : l'étape 18 est en parking).

**Prochaine étape après la clôture : 17a** (`trust proxy` 2 et sa garde), diagnostic
d'abord. Rien n'y est touché avant le message de Yass.

**Reste pour clore l'étape** (avant ces décisions) :
- verser `tests/charge/` sur la branche de production, inerte, hors de l'image (décision 6
  du temps 1, sur feu vert) ;
- garder l'environnement de test pour 17a et le diagnostic t40 (suppression au plus tard
  le 31/10 ; la série du seuil est sortie de l'étape 15, voir plus haut).

## 15 unvicies. ÉTAPE 17a : VRAIE ADRESSE DU CLIENT — DIAGNOSTIC (07/10, rien codé)

Décision déjà prise (06/10, §15 vicies D) : `trust proxy` 2, alerte au plus 1 par heure si
`X-Forwarded-For` n'a pas exactement 2 adresses, jamais `Forwarded`, preuve d'abord au test.

**Ce qui lit l'adresse du client (code de `05ead18`, `winwincard/backend/`).**
- `src/index.js:25` : `trust proxy` 1, seule source de `req.ip`.
- `src/index.js:39` : journal `morgan` « combined » (écrit `req.ip` en tête de ligne).
- `src/index.js:45-51` : limiteur global, 300 / 15 min.
- `src/middleware/rateLimiters.js` : inscription `:4` (20/h, monté `routes/clients.js:14`),
  admin `:13` (10/h, `index.js:122`), marchand `:22` (10/h, `index.js:114`), caisse `:33`
  (20/h, `index.js:112`), diagnostic `:45` (30/h, `routes/diag.js:49`).
- Aucun `keyGenerator` : les 6 limiteurs prennent celui d'`express-rate-limit` 7.5.1
  (`dist/index.cjs:655-659`), qui renvoie `req.ip`, adresse complète, IPv6 comprise.
- Aucun autre `req.ip`, `x-real-ip`, `Forwarded` ni `remoteAddress` dans `src/`. Sentry
  (`src/instrument.js`) sans `sendDefaultPii` : pas d'adresse envoyée.

**Calcul (`proxy-addr` 2.0.7, `trust proxy` 2) sur les chaînes relevées et sur les cas de
rupture.** Wifi, 4G, forgé : la vraie adresse. Railway +1 étape (3 adresses) : un relais,
alerte. Railway −1 étape et réécrit (1 adresse) : vraie adresse, alerte. **Railway −1 étape
ET garde le forgé (`192.0.2.77, vraie`) : 2 adresses, l'adresse forgée est retenue, AUCUNE
alerte.** Limite de la garde : elle ne voit pas ce cas ; seul le test des en-têtes forgés,
rejoué, le voit. Sans en-tête (réseau privé, contrôle de santé de Railway) : adresse de la
connexion, 0 adresse.

**Mesure à faire (point 1 du diagnostic) :** chaîne complète sur ≈ 20 requêtes, deux
réseaux, par la sonde `/__campagne/adresse` du serveur de test (aucun code à ajouter).

**Non vérifié** : support IPv6 de l'entrée de Railway (forum Railway inaccessible depuis la
session) ; nature des relais `152.233.x` / `79.127.x`.

**Décisions de pilotage (07/10, diagnostic 17a validé).**
- **Alerte : pas d'alerte sur le chemin du contrôle de santé** (sans en-tête, 0 adresse).
- **Limite ACCEPTÉE : « une étape retirée par Railway ET en-tête forgé conservé »** donne 2
  adresses, l'adresse forgée est retenue, aucune alerte. Compensée par le test des en-têtes
  forgés, **rejoué après toute annonce de Railway** (et au minimum à chaque changement
  constaté de la chaîne). Hypothèse qui fait casser le correctif : Railway cesse de
  réécrire `X-Forwarded-For`.
- **IPv6 : rien en 17a.** Si la mesure montre une adresse IPv6, la signaler au pilotage.
- **Rien n'est codé** tant que les résultats de la mesure ne sont pas envoyés et validés
  par le pilotage.

**Mesure sur le serveur de test (07/10, Yass) et code 17a (LOCAL, NON POUSSÉ).**
- Mesure : **2 adresses à chaque requête**, vrai client en premier, relais variable (`152.233.x`,
  `79.127.178.81/82`). Wi-Fi Dubaï ×5, 4G France ×5, navigation privée comprise.
  **Aucune adresse IPv6** : rien en 17a. Serveur de test et pilote éteints après la mesure.
- Code : `trust proxy` 2 (`index.js`, constante `RELAIS_ATTENDUS`) et la garde
  `src/middleware/gardeAdresse.js` : alerte au journal, au plus 1 par heure, si
  `X-Forwarded-For` n'a pas exactement 2 adresses ; pas d'alerte sur `/health/db` ; l'alerte
  ne contient aucune adresse ; aucun `await`, aucune requête base (≈ 53 ns par requête,
  mesuré). Jamais `Forwarded` ni `X-Real-IP`. Filet : section 13 de `tests/scenarios.js`.
- **Hypothèses (ce qui le ferait casser) :** Railway garde 2 adresses et RÉÉCRIT
  `X-Forwarded-For` ; `/health/db` est bien le contrôle de santé de Railway ; l'alerte lue
  dans les journaux de Railway est regardée par quelqu'un (aucun envoi, ni mail ni Sentry).
- **Limites :** la garde ne voit pas « étape retirée + en-tête forgé conservé » (acceptée,
  voir plus haut) ; le test d'en-têtes forgés contre l'entrée de Railway reste à rejouer sur
  le serveur de test, le filet local ne jouant que l'entrée (« client, relais »).
- **Dette outil (non corrigée) :** le pilote, étape `adresse`, échoue (« fetch failed »)
  quand `IMITATEUR` est renseignée et l'imitateur éteint (`generateur.js:250`, `fetch` non
  protégé). Contournement : retirer `IMITATEUR` le temps de l'étape, puis la remettre.
- **Contrôle des limites avec la vraie adresse :** requête SQL manuelle
  `database/requetes/limites_adresse_17a.sql` (inscriptions en 1 h, scans en 15 min). Ni la
  table `clients` ni `scans` ne portent la boutique d'inscription : approchée par marchand.

**Compléments 17a (07/10).**
- **Tests navigateur non rejoués pour 17a** : ils expirent dans cet environnement, y compris
  sur `05ead18` (`Navigateur : scanner (tampons)`, 30 s). Non bloquant, décision de Yass :
  aucun écran modifié. Filet sans navigateur : 133/133.
- **`/health/db`** est bien le contrôle de santé de Railway (réglage Healthcheck Path,
  étape 8) : l'exception de la garde est confirmée.
- **Limiteur global et routes Apple/cartes (DÉCIDÉ le 07/10 : inchangé en 17a, voir plus bas).** `index.js:45` est monté
  AVANT toutes les routes : il couvre `/v1/devices/*`, `/v1/passes/*`, `/v1/log`
  (`apple-wallet.js`), le téléchargement de carte (`/api/passes/:serial/apple`), Google
  (`/api/google-wallet/pass/:serial`), les pages et les fichiers statiques, sans exception.
  Avec la vraie adresse, le compteur est par adresse du client (un iPhone ≈ 3,6 à 5
  requêtes par push, très loin de 300) ; le risque ne vient que d'une adresse PARTAGÉE
  (4G à adresse commune, Wi-Fi de boutique avec la caisse). Un 429 sur la route Apple
  retarde une mise à jour de carte (l'iPhone réessaie) ; sur la caisse, il bloquerait un
  scan.

**Décision de Yass (07/10) : inscriptions de 20 à 60 par heure, dans 17a.** Code :
`rateLimiters.js:4` (`max: 60`). Limite globale (300 par 15 min) et scans INCHANGÉS ; les
routes Apple restent sous le limiteur global (limite propre au service web Apple : étape 17).
- **Mesure en production, 30 jours, glissante, par marchand** (`database/requetes/limites_adresse_17a.sql`,
  lue seule) : inscriptions en 1 h : Dinapoli **14**, Boucherie République 12, Shop By Ness 9,
  Nails By Ness 7, Hilal Kebab 7. Scans en 15 min : Hilal Kebab 15, Pizz'Amore Saxe 13, le reste
  ≤ 10. Contre 20 par heure : Dinapoli à 70 % de la limite, donc un compteur d'adresse
  partagée aurait pu refuser un vrai client ; contre 300 : au plus 15 scans, marge large.
- **Hypothèses (ce qui le ferait casser) :** le maximum du marchand borne celui de sa boutique
  (la table `clients` ne porte pas la boutique) ; la fréquence d'inscription reste du même
  ordre (60 par heure = ≈ 4 fois le maximum mesuré) ; un lancement ou un QR au comptoir
  concentré sur une seule adresse resterait sous 60. À remesurer avec la même requête au
  premier marchand à ≈ 500 porteurs ou à la signature d'un réseau.
- **Limite :** 60 par heure et par adresse protège moins contre une inscription en rafale
  depuis une seule adresse (jusqu'à 60 fausses cartes par heure et par adresse, au lieu
  de 20). Provisoire jusqu'à l'étape 17 (limite par clé, limites par type de route).
- Filet : section 13 de `tests/scenarios.js`, 135/135 (la 61ᵉ inscription est refusée, un
  autre client derrière le même relais passe).

## 15 duovicies. ÉTAPES 16 (RÉDUITE) ET 17 REGROUPÉES : DIAGNOSTIC (07/10, rien codé)

**16, délai par appel base.**
- Tous les appels passent par un seul client, `src/services/supabase.js:8-14`, sans option
  `global.fetch` (supabase-js 2.107.0 l'accepte). ≈ 190 appels dans 17 fichiers.
- **Piège mesuré (script jetable, hors dépôt) :** un `fetch` enveloppé par
  `AbortSignal.timeout` rend une `TimeoutError`, que postgrest-js ne reconnaît pas
  (`index.cjs:289` ne teste que `AbortError`). Un `GET` est alors RÉESSAYÉ 3 fois
  (attentes 1, 2, 4 s) : délai de 1 s → **11 s et 4 requêtes** ; une RPC (POST) : 1 s.
  Variante qui tient : relancer l'erreur en `AbortError` dans l'enveloppe → 1 s, 1 requête
  pour les deux. `.abortSignal()` par appel (`index.js:163`, `cron-passages.js:106`) : 1 s.
- **Les erreurs de lecture se lisent mal au scan** (`scan.js:44-46, 56, 78-83, 86`) : `error`
  n'est pas lu. Une base lente ou en panne donne `403 access_disabled` (boutique), un
  réseau traité comme mono-site (`:56`, ouvert) ou `404 Pass not found`. Le scanner
  traduit `access_disabled` par l'écran de connexion (`scanner/index.html:1279`) et le 404
  par « carte inconnue » (`:1304`). Un délai sans ce correctif aggraverait le défaut F3.
- Un scan fait jusqu'à 3 appels en série : par appel seul, 3 × 6 s dépasse les 15 s de la
  caisse (`DELAI_SCAN_MS`, `scanner/index.html:1198`, `dashboard/index.html:1735`).
- Écriture coupée : `crediter_scan` est UNE transaction (`migration_051:84-175`, verrou
  `FOR UPDATE` du client, clé lue après le verrou, index unique
  `scans_cle_idempotence_unique`). Le crédit peut aboutir alors que le serveur répond 503 ;
  le renvoi, même clé (gardée par l'écran, `scanner/index.html:1166-1178`), rend
  `deja_enregistre`. Si la base finit encore la première transaction, le renvoi attend le
  verrou puis voit la ligne. Hypothèse non mesurée : PostgREST annule-t-il la requête quand
  le client coupe. Limite : la clé reste FACULTATIVE (`scan.js:17-22`) ; sans elle, le renvoi
  recrédite.

**17, limiteurs** (tous comptés par `req.ip`, sans `keyGenerator`) : global 300 / 15 min
(`index.js:45`) ; inscription 60 / h (`rateLimiters.js:4`, `clients.js:14`) ; marchand 10 / h
(`:13`, `index.js:114`) ; admin 10 / h (`:22`, `index.js:122`) ; caisse 20 / h (`:33`,
`index.js:112`) ; diagnostic 30 / h (`:45`, `diag.js:49`). Tous comptent AUSSI les
tentatives réussies.

**Décisions de pilotage (07/10, diagnostic 16 + 17 validé). Ordre : 16 d'abord (un push,
preuves et diff avant), puis 17. Rien n'est codé à ce jour.**

*16 (réduite) :*
- Enveloppe `fetch` dans `supabase.js` qui relance toute coupure de délai en `AbortError`
  (sinon postgrest-js réessaie les lectures, 11 s au lieu de 1 s) : **6 s par appel**, et
  **budget de 9 s par scan** (version la plus simple), sous les 15 s de la caisse.
- **Les 4 corrections de lecture d'erreur au scan** : `scan.js:44-46, 56, 78-86`. Une
  base lente ou en panne répond 503, jamais 403 `access_disabled` ni 404.
- **Second client à 30 s** pour le cron (`workers/cron.js`), l'export CSV
  (`clients.js:166`), `admin_marchands_stats` (`admin.js:47`), `effacer_client`
  (`clients.js:173`) et les lectures de campagne (`notifications.js`).
- **Une ligne `[base] DÉLAI` par coupure, au plus 1 par minute et par route**, sans requête
  de plus.
- **Clé d'idempotence : PAS obligatoire en 16.** On attend que la requête D (ci-dessous)
  montre 100 % de scans avec clé sur les derniers jours. Tant que ce n'est pas le cas, un
  renvoi sans clé recrédite : limite connue.
- **« t38 point 5 »** = carte des chantiers t38, point 5 : angle mort de surveillance (le
  serveur mesure moins de 1,5 s quand la caisse attend 9 s ; `/health` et `/health/db` ne
  voient pas une base lente).
- Hypothèses : l'enveloppe ne s'applique qu'au client supabase-js (pas aux appels
  Apple/Google) ; PostgREST peut finir une transaction après la coupure du client (non
  mesuré), le renvoi même clé attend alors le verrou du client.

*17 :*
- Limiteur `/v1/*` : **1 000 par 15 min et par adresse**, exclu du global (`skip`), **`/v1/log`
  inclus** (`apple-wallet.js:210`).
- Connexion caisse : **20 par heure, ÉCHECS seulement** (`skipSuccessfulRequests`).
- Le reste **inchangé** (global 300 / 15 min, marchand 10 / h, admin 10 / h, diagnostic
  30 / h). **Inscriptions : 60 par heure et par adresse conservés**, pas de compteur par
  marchand ; **à revoir quand un réseau signe**.

**Requête D (lecture seule, à lancer à la main dans Supabase, production) : part des scans
avec clé d'idempotence, par jour, sur 14 jours.**
```sql
SELECT CASE WHEN grouping(date_trunc('day', date_scan)) = 1 THEN 'TOTAL' ELSE to_char(date_trunc('day', date_scan), 'YYYY-MM-DD') END AS jour,
       count(*) AS scans,
       count(cle_idempotence) AS avec_cle,
       round(100.0 * count(cle_idempotence) / count(*), 1) AS pct_avec_cle,
       max(date_scan) FILTER (WHERE cle_idempotence IS NULL) AS dernier_scan_sans_cle
  FROM scans
 WHERE date_scan >= now() - interval '14 days'
 GROUP BY ROLLUP (date_trunc('day', date_scan))
 ORDER BY 1 DESC;
```
À lire : les jours avant le déploiement des écrans avec clé (11b) n'en ont pas, c'est normal ;
ce qui compte est `dernier_scan_sans_cle` et le pourcentage des derniers jours.

## 15 tervicies. ÉTAPE 16 (RÉDUITE) : POUSSÉE ET VÉRIFIÉE (07/10, `d38d555` sur `claude/keen-goldberg-MXslu`)

**Poussé le 07/10 sur feu vert de Yass**, en avance rapide (`3fe3812..d38d555`, 3 commits).
**Contrôles en production FAITS et VÉRIFIÉS par Yass (07/10, vers 16:08 UTC)** : déploiement
vert ; scan cobaye (`POST /api/scan` 200) puis annulation depuis la fiche client (200), solde
revenu ; carte iPhone resynchronisée (APNs 200, carte re-téléchargée en 200) ; aucune ligne
`database_unavailable` ni `[scan] lecture … impossible`. Les « pass was unchanged » d'Apple
vus au même moment relèvent de la dette n°11 (listing sur-inclusif, étapes 23-24), sans lien.

**Correction de pilotage (07/10, Yass) appliquée :** 5 s par appel, **sans budget partagé
par scan, sans ligne `[base] DÉLAI`**. Elle remplace les « 6 s + budget de 9 s » et la ligne
de journal décidés plus haut (§15 duovicies). Aucune migration. **Push : attend le feu vert
de Yass ET le résultat de la requête D.**

**Livré (backend) :**
- `src/services/supabase.js` : enveloppe `fetch` (option `global.fetch`) ; 5 s par appel ;
  la coupure (`TimeoutError`) est relancée en `AbortError` (postgrest-js ne réessaie plus) ;
  un `.abortSignal()` de l'appelant est gardé (`AbortSignal.any`). Seuls les chemins
  `/rest/v1/` sont bornés. Second client exporté, `clientLong`, à 30 s.
- `src/routes/scan.js` : les 4 lectures (boutique, réseau, client par UUID, code de
  secours) lisent `error` → **503 `database_unavailable`** + ligne `[scan] lecture <étape>
  impossible`. `.single()` sans ligne (`PGRST116`) reste 404. Les écrans n'ont pas changé :
  un 5xx y est déjà un incident de connexion (un nouvel essai, clé gardée).
- `clientLong` : tout `workers/cron.js`, export CSV (lecture des clients), `effacer_client`,
  `admin_marchands_stats`, et dans `POST /api/notifications` les lectures `device_tokens`
  et `passes` **et la mise à jour de `passes`** (voir décisions hors pilotage).
- Filet : §14 (base lente, relais réglable devant PostgREST, second serveur) et §15
  (coupure pendant que la base écrit). `tests/lancer.js` passe `urlSupabase` et `cleService`
  aux scénarios. **Push prévu sur `claude/keen-goldberg-MXslu` (production), en avance
  rapide**, après feu vert de Yass et requête D.

**Preuves (07/10, conteneur, Node 22, PostgREST v12.2.12 local) :** `npm test` 135/135 avant,
**147/147 après** (150/150 avec le registre, 153/153 avec l'authentification) ; les 12 nouveaux tests joués sur l'ancien `src/` : 7 KO (lecture lente
servie en 200, panne réseau traitée en mono-site, panne client en 404, écriture jamais
coupée). Scan, 120 scans en série par cas, avant / après (deux tours chacun) :
délai base 100 ms → p50 327,0 / 327,5 ms (mono-site), 325,7 / 325,3 ms (boutique) ;
délai 0 → 19–21 ms / 20–22 ms (bruit du conteneur). **Requêtes base par scan : 5,25 et
5,00, identiques avant et après.** Lecture lente : 503 en ≈ 5 s, UNE requête (avant :
4 requêtes, 11 s+, ou 200 si la base finit par répondre).

**MESURÉ (était « non mesuré » en §15 duovicies), en local seulement :** quand le serveur
coupe `crediter_scan` à 5 s (carte verrouillée 7 s par une autre session), **PostgREST finit
la transaction** : solde crédité, une ligne. Le renvoi même clé rend 200 sans recréditer.
À confirmer côté Supabase (passerelle devant PostgREST) : non mesuré en production.

**Hypothèses (ce qui ferait casser) et limites :**
- Pire cas d'un scan : authentification sans cache (lecture `marchands`, 5 s) + 3 appels
  lents mais sous 5 s chacun ≈ **20 s**, au-delà des 15 s de la caisse. La caisse coupe
  alors d'elle-même (incident connexion, clé gardée). Accepté avec la correction « sans
  budget ».
- **Authentification de la caisse (demande de Yass, 07/10) :** `authScanner`
  (`middleware/auth.js`) laissait passer quand la lecture du marchand échouait sans valeur
  en cache (`marchand-cache.js:95`, `degrade: true`). Elle répond maintenant **503
  `database_unavailable`**, comme le scan. Aucune requête de plus (le second
  `etatMarchand` lit le cache). Une valeur connue, même périmée, sert toujours. Tests :
  lecture retenue 8 s → 503 vers 5 s ; panne → 503 ; base revenue → 200 (ancien code :
  2 KO, scan crédité). **Le dashboard (`authMarchand`) laisse toujours passer** :
  décision hors pilotage, hors du périmètre demandé (caisse).
- Une **erreur réseau** (connexion refusée, coupée) ou un 503 de PostgREST sur une lecture
  restent réessayés par postgrest-js (1 + 2 + 4 s) : le délai ne couvre que la lenteur.
- Une coupure pendant la lecture du **corps** de la réponse rend une `TimeoutError` non
  convertie : elle devient une erreur lue (pas de nouvel essai, le code est après la boucle
  de postgrest-js), pas une exception.
- **Stockage non borné** (`/storage/v1/` exclu), comme avant.
- **Registre des envois (demande de Yass, 07/10) :** les lots du cron (`inactive`,
  `near_reward`, `birthday`) et de la campagne manuelle passent par le client long
  (`creerLot(…, { long: true })`, `notif-registre.js`). Les écritures d'un push unique
  (scan, avis, bienvenue, ajustement, `enregistrer()`) gardent 5 s : coupées, elles sont
  journalisées et perdues, l'envoi est déjà parti. Testé (filet §14, 150/150). Les autres
  services appelés par le cron (caches…) restent sur le client 5 s.
- `AbortSignal.any` exige Node ≥ 20.3 (production : 24.10.0).
- Sans clé d'idempotence (requête D), un renvoi après coupure recrédite : limite connue.

**Décisions hors pilotage (07/10) :**
- La **mise à jour de `passes`** d'une campagne (`notifications.js`) passe sur le client
  long, pas seulement les lectures : même nature (tout un marchand en un appel) ; coupée à
  5 s, la notification visible iPhone ne partirait pas.
- Le stockage est exclu de l'enveloppe (« délai par appel BASE »).
- Réponse 503 nommée `database_unavailable`.

## 15 quatervicies. ÉTAPE 17 : LIMITEURS, POUSSÉE (07/10, `f431ae0` sur `claude/keen-goldberg-MXslu`)

**Décisions de Yass (07/10, diagnostic 17 validé)** : `/v1/*` 1 000 / 15 min / adresse, `/v1/log`
compris, hors du global ; connexion caisse 20 ÉCHECS / h / adresse (les échecs d'un collègue
sur la même adresse sont acceptés) ; correctif de la connexion caisse validé (503 sur panne,
seuls les 4xx comptent) ; inscriptions 60 / h, marchand 10 / h, admin 10 / h, diagnostic
30 / h inchangés. Aucune migration. **Poussé le 07/10 sur feu vert de Yass**, en avance rapide
(`c349c1f..f431ae0`). **Contrôles en production OK (Yass, 07/10)** : déploiement actif, scan
test et annulation réussis. Correctif de la connexion marchand poussé ensuite (`a3fadde`,
voir plus bas).

**Livré (backend) :**
- `middleware/rateLimiters.js` : `limiterAppleWallet` (1 000 / 15 min) ; `limiterScannerLogin`
  avec `skipSuccessfulRequests` et `requestWasSuccessful = statut < 400 OU ≥ 500` : seuls
  les 4xx (401, 403, 400, 429) comptent comme échecs.
- `index.js` : le global ignore `req.path` commençant par `/v1/` (`skip`) ;
  `app.use('/v1', limiterAppleWallet)` juste avant les routes Apple.
- `routes/scanner-auth.js` : les lectures de la connexion (boutique, marchand par slug puis
  par e-mail, contrôle réseau du mono-site) lisent `error` → **503 `database_unavailable`**
  + ligne `[scanner-auth] lecture <étape> impossible`. Avant : 401 « Invalid credentials » à
  un bon mot de passe (et, pour le contrôle réseau, jeton marchand délivré sans contrôle).
- Filet : §14 (connexion sur base coupée, relais du §14) et §16 (limiteurs, serveur neuf).

**Preuves (07/10, conteneur) :** `npm test` **166/166** (153 avant). Les mêmes tests sur
l'ancien `src/` : 9 KO, dont **la bonne connexion refusée en 429 après le retour de la base**
(25 essais pendant la panne = 25 échecs comptés). Base coupée via le relais : connexion
bloquée 8 s → 503 vers 5 s ; base en panne, 25 connexions → toutes 503, aucune 429 ; base
revenue → 200 et jeton. `/v1` : 1 000 requêtes mêlées passent, la 1 001e → 429 JSON ; une
autre adresse passe ; puis 300 `/health` de la même adresse passent et la 301e → 429
(le global n'a rien compté de `/v1`, il reste actif ailleurs). Connexion : 30 correctes
de suite → 200 ; 19 échecs puis bonne connexion → 200 ; 20e échec → 401, 21e tentative →
429 même avec le bon mot de passe ; autre adresse → 200. Diagnostic : 31e → 429. Scan
(120 en série, délai base 100 ms, deux tours) : p50 326,6–327,4 ms avant, 326,4 ms après
(mono-site) ; 324,4–325,6 / 325,2–325,3 ms (boutique) ; **requêtes base par scan
inchangées (5,25 et 5,00)**.

**Hypothèses et limites :**
- Compteurs EN MÉMOIRE, par processus : un redéploiement les remet à zéro ; deux instances
  Railway auraient chacune leurs compteurs (une seule aujourd'hui).
- Le compteur des échecs est par adresse : 20 échecs d'un tiers sur le même Wi-Fi bloquent
  aussi la bonne connexion pendant la fenêtre d'une heure (accepté le 07/10).
- `/v1` : blocage au-delà d'≈ 270 iPhone synchronisés derrière une même adresse en 15 min
  (≈ 3,6 requêtes par push). Seul cas plausible : un iPhone de test à ≈ 33 cartes (≈ 35
  requêtes par push, dette n°11) → ≈ 28 pushes en 15 min. Un 429 y retarde une mise à
  jour de carte, jamais un scan.
- Le téléchargement initial de carte (`/api/passes/…`) reste sous le global (décidé).
- **Écran de connexion du scanner : message brut — À TRAITER AVEC LA PROCHAINE MODIFICATION
  DU SCANNER (décision de Yass, 07/10 : on n'y touche pas pour l'instant).**
  `public/scanner/index.html:877-880` affiche le code brut de l'erreur : sur une panne, la
  caissière lit « database_unavailable » (au lieu de « identifiants invalides » avant) ; sur
  un 429, « Too many attempts… » comme aujourd'hui. Toute modification du scanner recharge
  les caisses, d'où le regroupement.

**Vérifié seulement (rien corrigé, à décider) — connexions marchand et admin :**
- **Marchand** : `routes/merchants.js:18-24` ne lit pas `error` (`.single()`). Base lente
  ou en panne → `marchand` nul → **401 « Invalid credentials »** à un bon mot de passe, et
  ce 401 est compté par `limiterMarchandLogin` (10 / h, toutes réponses comptées) : 10
  essais pendant une panne bloquent le dashboard une heure.
  **CORRIGÉ ensuite (validé par Yass le 07/10, commit séparé `a3fadde`, POUSSÉ le 07/10 en
  avance rapide `f431ae0..a3fadde` ; contrôles à faire par Yass : déploiement vert avec
  « WinWin Card API démarré », connexion au dashboard marchand)** :
  `merchants.js` lit `error` → 503 `database_unavailable` (`PGRST116`, aucune ligne,
  reste 401) ; `limiterMarchandLogin` ne compte plus les 5xx (`skipFailedRequests`,
  « échec » = statut ≥ 500) ; réussites et 4xx toujours comptées (10 / h inchangé).
  Effet de bord de `skipFailedRequests` : une requête dont le client coupe la connexion
  avant la réponse n'est pas comptée non plus. Tests (§14, relais) : lecture bloquée 8 s →
  503 vers 5 s ; 12 connexions en panne → toutes 503, aucune 429 ; base revenue → 200 ;
  1 réussite + 9 échecs puis 11e → 429 ; marchand inconnu, base saine → 401. **172/172.**
  Ancien code : 5 KO (401 en panne, dashboard bloqué en 429 après le retour de la base).
- **Admin** : `routes/admin.js:11-23` ne lit pas la base (mot de passe en variable
  d'environnement) : pas concerné.

**Décision hors pilotage (07/10) :** le contrôle réseau de la connexion mono-site
(`scanner-auth.js`, lecture `points_de_vente`) lit aussi `error` → 503, au même titre que
les deux lectures d'identifiants : sinon une panne y délivrait un jeton marchand à un
réseau sans le contrôle `use_boutique_login`.

## 15 quinvicies. t40 : DASHBOARD ET NOTIFICATIONS CIBLÉES — DIAGNOSTIC (08/10, rien codé)

Sources : code de `a3fadde` (production), audit `docs/audit/05-statistiques.md` (mesures
M1, T1-T4), mesures de l'étape 15 (§15 vicies G). **L'environnement de test n'a pas servi** :
aucune mesure ne manquait. Lignes citées sur `winwincard/backend/`.

### 1. Dashboard marchand : ce qui passe à l'échelle, ce qui ne passe pas

| Écran / route | Lecture | ×50 (50 000 porteurs) | Verdict |
|---|---|---|---|
| Aperçu `GET /me/stats` (`src/routes/merchants.js:67-93`) | 2 comptages exacts + **liste** des scans 30 j (`:73`), comptée en JS (`:76-84`) | 820 ms mesurés ; **faux dès 1 000 scans / 30 j** (≈ 33 / jour) : actifs, rétention, fréquence sous-estimés et instables | NE PASSE PAS (justesse) |
| … erreurs non lues (`:70-74`) | une panne affiche 0 client, 0 %, 0x | — | défaut F3 |
| Réseau `GET /me/group-stats` → `group_stats` (migration 039) | tout en SQL, un petit jsonb | 748 ms (réseau), **1 505 ms** (plafond) ; erreur vers 0,3 à 1,6 M scans / 90 j | PASSE (jusqu'à l'e-commerce) |
| Clients `GET /api/clients` (`src/routes/clients.js:109-118`) | toute la liste, triée par solde, sans pagination ; recherche dans le navigateur | 230 ms, **coupée à 1 000** : les petits soldes disparaissent, introuvables | NE PASSE PAS |
| Export CSV (`clients.js:122-169`) | toute la liste (client long 30 s) | **coupé à 1 000** (les plus anciens) | NE PASSE PAS |
| Historique `GET /api/scan` (`src/routes/scan.js:390-410`) | 100 à 200 derniers, `idx_scans_marchand_date` | constant | PASSE |
| Fiche client (`clients.js:188-…`) | 1 client + 10 scans | constant | PASSE |
| Notifications `GET` (`src/routes/notifications.js:20-45`) | 50 dernières + comptage du mois | constant | PASSE |
| Campagne `POST` (`notifications.js:48-…`) | jetons et cartes du marchand (`:80-90`), envoi de tout d'un coup (`:109-125`) | **coupée à 1 000 + 1 000** ; écran bloqué 52 s ; file Supabase vers 1 000 appareils | NE PASSE PAS sans t37 |
| QR, profil, boutiques | 1 ligne chacun | constant | PASSE |

Le dashboard n'a **aucun graphique** aujourd'hui, ni réseau ni mono-site : des chiffres et
des tableaux. L'Aperçu se recharge maintenant à la demande (`loadOverview(force)`,
`public/dashboard/index.html:1139`) : le constat « figé » de l'audit 05 est à revérifier.

### 2. Statistiques mono-boutique aussi riches qu'un réseau

**Faisable avec condition : les définitions (étape 26) d'abord.**
- `group_stats` calcule déjà tout par marchand : elle marche pour un mono-site sans boutique.
  Indicateurs réutilisables tels quels : porteurs, actifs 30 j, nouveaux du mois, taux de
  retour, répartition des passages, récompenses remises (`recompense_distribuee`, aujourd'hui
  invisible pour un mono-site). À masquer : boutiques, scans non attribués, mobilité entre
  boutiques (exclusion du Socle respectée : aucune comparaison entre boutiques).
- Condition : deux définitions sont biaisées (mois entamé contre mois complet ; rétention
  divisée par toute la base, audit 05 §4.1-4.2). Les recopier sur tous les marchands
  multiplierait les chiffres faux. D'où l'étape 26 avant.
- Coût : **1 appel au lieu de 3** à l'ouverture de l'Aperçu (`/me/stats` remplacé). Charge :
  0,1 à 0,7 s à 5 000 porteurs, 0,8 à 1,5 s à 50 000 (mesuré), à la demande seulement.
  Aucune requête régulière, aucun effet sur le scan.
- Un graphique (scans par jour sur 30 j) : une requête groupée par jour sur
  `idx_scans_marchand_date`, 30 lignes, du même ordre de coût. Faisable, à décider.
- Stockage : rien.

### 3. Choix des champs de la landing : modèle de données (technique, court)

- **Aujourd'hui** : un seul interrupteur, `marchands.landing_premium` (Pro ou Pro+, case de
  l'admin, `src/services/forfaits.js:34`). Allumé, la landing montre e-mail, téléphone et
  anniversaire ensemble (`public/landing.html:885-890`) ; le serveur accepte les trois
  (`clients.js:37-42`) et écrit une preuve par champ dans `consentements` (`:55-65`).
  **Aucun choix champ par champ.**
- **Faisable sans casser l'inscription** : une colonne de réglage par marchand, par exemple
  `marchands.champs_landing text[]` (`{email}`, `{email,produit_favori}`…), NULL = règle
  actuelle (les trois si premium). `GET /merchants/:slug/public` la renvoie (même lecture) ;
  la landing n'affiche que ces champs ; l'inscription n'accepte que ceux-là (miroir
  serveur, comme `landingPremiumActive`). **Zéro requête en plus** à l'inscription.
- **« Par boutique »** : réglable par MARCHAND tout de suite. Par point de vente d'un réseau :
  NON aujourd'hui, la landing n'a pas de paramètre de boutique (`/l/:slug`) ; il faudrait
  `/l/:slug?b=…` et un réglage par `points_de_vente`. À décider avec la landing premium.
- **Où stocker** : un champ qui servira à cibler (produit favori) → **colonne de `clients`**
  (`produit_favori text`, ou identifiant d'une petite table `produits` par marchand si la
  liste est fermée) ; des préférences libres, jamais filtrées → une colonne `jsonb`. Pas de
  table à part : elle ajouterait une écriture à l'inscription et une jointure à la lecture.
- **Poids à 100 000 porteurs** : ≈ 2 à 4 Mo pour une colonne texte courte, ≈ 10 Mo pour un
  `jsonb` de 100 octets, ≈ 3 à 4 Mo par index ; la base de test pèse 599 Mo : négligeable.
- **Lecture** : fiche et export ajoutent la colonne à leur `select` (même requête).
- **Scan : aucun effet**, `SELECT_CLIENT` liste ses colonnes (`scan.js:73`).
- **Index** pour s'en servir : `(marchand_id, produit_favori)` le jour où une campagne filtre
  dessus ; aucun avant.
- **À ne pas oublier** : `effacer_client` (`database/rgpd_effacement.sql:45-49`) efface
  colonne par colonne : chaque nouveau champ doit y être ajouté, sinon l'effacement RGPD
  le laisse en base.

### 4. Segmentation et campagnes ciblées

**Ce qu'on peut cibler avec les données existantes** (aucune colonne à ajouter) :
- dernier passage (inactifs depuis N jours), nombre de passages sur une période, solde
  (proches de la récompense), récompenses remises, date d'inscription (nouveaux) ;
- **boutique fréquentée** (`scans.point_de_vente_id`, migration 033 ; jamais pour un client
  jamais scanné) ;
- anniversaire (landing premium seulement), parrains / filleuls, plateforme (Apple :
  `device_tokens` ; Google : `passes.google_pass_url`).

**Comment, sans requête régulière** : une fonction SQL de sélection appelée **au moment de
l'envoi** (comme `group_stats`), qui rend la liste des destinataires. Coût : 1 appel par
campagne (quota de 5 à 20 par mois et par marchand), ≈ le coût de `group_stats` (≤ 1,5 s à
50 000 porteurs). Index existants suffisants (`idx_scans_marchand_date`, `idx_scans_client`,
`idx_clients_marchand`). Rien de stocké, rien d'écrit au scan.
- Alternative écartée : des colonnes résumé sur `clients` (dernier passage, nombre de
  passages) tenues par `crediter_scan` : zéro requête en plus, mais toucherait la fonction
  de l'argent et l'annulation (recalcul). Pas nécessaire à ce volume.
- Demanderait des données en plus : produit favori, préférences (point 3), un fuseau par
  marchand pour « aujourd'hui » à Dubaï.
- Demanderait un index en plus : anniversaire filtré en SQL → index sur
  `(marchand_id, extract(month…), extract(day…))` ; filtre par produit (point 3).

**Règle 8** : cibler **réduit** le nombre de destinataires (une boutique, un segment) : c'est
le contraire d'une campagne plus large. Faisable avant t37 **à condition** que la sélection
garde le plafond actuel (au plus 1 000 + 1 000 par envoi) et qu'aucun segment ne puisse
dépasser « tous les porteurs ». Deux réserves :
- un envoi ciblé de 1 000 appareils crée la même file Supabase qu'aujourd'hui : t37 reste
  la condition des gros envois ;
- un message Google part vers toutes les cartes d'une campagne (étape 23) : à corriger
  avant de multiplier les campagnes.

### 5. Plafond de 1 000 lignes (étape 21) dans le dashboard et le cron

| Où | Effet au-delà de 1 000 |
|---|---|
| Aperçu, scans 30 j (`merchants.js:73`) | actifs, rétention, fréquence faux, différents de l'onglet Réseau |
| Liste clients (`clients.js:113-118`) | compteur bloqué à 1 000, clients introuvables |
| Export (`clients.js:136-141`) | les plus anciens manquent |
| Campagne (`notifications.js:80-90`) | 1 000 iPhone + 1 000 cartes Google au plus, sans le dire (voulu par la règle 8) |
| Cron inactifs (`src/workers/cron.js:89-93`) | **liste des scans coupée → des clients ACTIFS relancés comme inactifs** ; liste des clients coupée → les autres jamais évalués ; liste de dédoublonnage coupée → relances en double |
| Cron proches de la récompense (`cron.js:151-158`) | 895 notifiés d'un coup mesurés ; dédoublonnage coupé aussi |
| Cron anniversaire (`cron.js:228-237`) | au-delà de 1 000 anniversaires connus, des anniversaires manqués |

**Le plus grave n'est pas dans le dashboard : c'est le cron inactifs**, qui enverra des
relances à tort dès ≈ 33 scans par jour chez un marchand. Proposition compatible avec la
règle 8 : **sélection juste en SQL, envoi toujours plafonné** (au plus 1 000 par passage,
le reste au passage suivant) — on corrige qui reçoit, pas combien.

### 6. Rapport du cron visible par le marchand

| Source | Ce qu'elle a | Par marchand ? | Manque |
|---|---|---|---|
| `workflow_executions` (migration 010) | une ligne par client relancé, type, `executed_at`, 90 j | **oui** (`marchand_id`) | index : `idx_wf_exec_lookup` commence par `workflow_type, client_id` → pas utilisable pour « ce marchand, aujourd'hui » |
| `notification_envois` (migration 046) | une ligne par push, source, statut, 90 j | oui, index `(marchand_id, envoye_le)` | compte des appareils et des cartes, pas des clients (audit 05 §4.3) |
| `cron_passages` (migration 049) | un passage par jour, bilan **global** par workflow | **non** | rien par marchand |

**Faisable** : « aujourd'hui : X relances, Y proches de la récompense, Z anniversaires » =
un comptage groupé sur `workflow_executions` (marchand, depuis minuit).
- Coût : 1 lecture à l'ouverture de l'onglet (à la demande, aucune requête régulière) ; un
  index `(marchand_id, executed_at)` : ≈ 5 à 15 Mo à 100 000 porteurs, une écriture
  d'index par relance (négligeable devant les 3 requêtes de chaque relance).
- Limites : `workflow_executions` note une tentative, pas une réception (un client sans
  appareil est compté) ; « aujourd'hui » en UTC (le passage de 08:00 UTC tombe à 12:00 à
  Dubaï, 10:00 à Lyon). Les acceptations Apple et Google se lisent dans le registre, en
  appareils.
- **Condition** : après la sélection juste du point 5, sinon le rapport affichera des
  relances à tort comme un succès.

### 7. Points faibles non listés

1. **Preuves de consentement perdues sans bruit** : `clients.js:67-69`,
   `insert(...).then().catch()` (supabase-js ne rejette jamais, §3.9). Une écriture ratée
   n'est vue nulle part. **À corriger avant de collecter un champ de plus.** Coût : nul.
2. **`consentements` sans index** (`database/schema.sql:137-144`) : effacement et preuve
   « montrez-moi le consentement de ce client » relisent la table. Sans effet aujourd'hui ;
   index `(client_id)` à prévoir avec le point 3.
3. **Carte sans ligne `passes`** possible : `clients.js:58`, l'erreur n'est pas lue.
4. **Chaque relance coûte 3 requêtes** en série (`cron.js:272-290` et `:105`) : mise à jour
   de la carte, lecture des jetons, écriture du dédoublonnage. C'est ce qui donne 57 min à
   50 000 porteurs. Grouper par lot (une écriture pour tout le marchand) ferait
   gagner l'essentiel ; à faire dans 22.
5. **Le cron inactifs lit les scans sans exclure les annulations** (`cron.js:90`) : un
   passage annulé compte comme une visite.
6. **Quota des campagnes sans verrou** (`notifications.js:58-75`) : deux clics simultanés
   passent tous les deux.
7. **Pas de fuseau par marchand** : « aujourd'hui », « ce mois » et l'heure des relances
   sont en UTC (Dubaï : 4 h d'écart).
8. **Écran du dashboard** : message d'erreur brut à la connexion (`public/dashboard/index.html`,
   même cas que le scanner, noté à l'étape 17).

### Avant le premier marchand à ≈ 1 000 porteurs (ou le premier réseau) / ce qui peut attendre

**Avant** : t37 (rythme) ; sélection juste du cron (point 5) ; Aperçu en SQL (point 2,
après 26) ; liste et export paginés côté serveur (21) ; consentements lus (point 7.1).
**Peut attendre** : graphique, rapport du cron (après la sélection juste), choix des champs
de la landing et produit favori (avec la landing premium), campagnes par segment (après
t37 et 23), fuseau par marchand (avant le premier marchand à Dubaï qui lit ses chiffres
du jour).

### Ordre de travail proposé (rien codé)

1. **t37, rythme des campagnes** (déjà prévu ; déclencheur : premier marchand à ≈ 500
   porteurs ou un réseau). Condition de tout gros envoi.
2. **22 + la part « cron » de 21 : sélection juste, envoi plafonné.** Fonctions SQL pour
   inactifs, proches de la récompense, anniversaires, dédoublonnage compris ; envoi au plus
   1 000 par passage ; relances groupées (7.4) ; arrêt sur une panne de lecture. Respecte la
   règle 8 (aucun envoi plus large).
3. **26, définitions**, puis **Aperçu en SQL, identique pour mono et réseau** (point 2).
4. **21, reste** : liste clients paginée avec recherche serveur, export par tranches. Après
   t37 pour la campagne.
5. **23, envois** (message Google borné), puis **campagnes par segment** (point 4).
6. **Rapport du cron** (point 6), une fois 2 en place.
7. Avec la landing premium : **choix des champs** et **produit favori** (point 3), après le
   correctif des consentements (7.1).

## 15 sexvicies. t37 : RYTHME D'ENVOI DES CAMPAGNES — DIAGNOSTIC ET PROPOSITION (08/10, rien codé)

**Décision de Yass (08/10)** : un plafond fixe de 1 000 destinataires n'est pas une
solution ; t37 supprime le plafond des DESTINATAIRES de campagne, sans geler les caisses.
Les listes du dashboard restent dans l'étape 21. Sources : §15 sexdecies à vicies G (étape
15), audits 01, 04, A ; code de `a3fadde`. Le débit mesuré PENDANT la saturation n'est pas
une capacité : il n'est pas utilisé ici.

### 0. Ce que fait une campagne aujourd'hui (`src/routes/notifications.js:48-170`)

Tout se passe dans la requête HTTP du marchand : lecture de TOUS les jetons et de toutes les
cartes Google (`:80-90`, coupées à 1 000), mise à jour de `marchands` et de TOUTES les
cartes du marchand (`:97-106`, 50 000 cartes en 1,3 s au banc), puis **tous les pushes en
même temps** (`:109-125`), registre et `notification_logs` à la fin (`:128-160`). Mesuré :
écran bloqué 51,8 s ; vers 1 000 appareils, scans méd. 11,7 s, max 154 s (file dans l'API de
données de Supabase, pas dans le serveur).

### 1. Les leviers

**Coût d'un iPhone réveillé, route par route (avant tout « 304 »)** :

| Route | Requêtes base | Ce qui existe | Ce qui manque |
|---|---|---|---|
| liste `GET /v1/devices/…/registrations` (`apple-wallet.js:81-104`) | 1 | `passesUpdatedSince` est lu, mais le filtre porte sur la carte jointe sans `!inner` : **il ne filtre rien**, toutes les cartes de l'appareil sont rendues ; `lastUpdated` vient de l'horloge de Node | le filtre réel ET l'horodatage pris en base, **corrigés ensemble** (dette n°11, ligne 24 de la synthèse ; l'un sans l'autre fait manquer des mises à jour) |
| carte `GET /v1/passes/…` en **304** (`:108-131`) | **1** | **existe et marche** : `If-Modified-Since` comparé à `passes.updated_at` à la seconde. Ce sont les 1 175 « 304 » du test : les AUTRES cartes de l'appareil, revérifiées à cause de la liste | rien sur la route ; c'est la liste qui les provoque |
| carte en **200** (`:133-165`) | **3, en série** (`passes`, `clients`, `marchands`) + génération 13-20 ms + images (logo et icône relus à chaque carte, `apple-pass.js:448-450` ; 1 387 lectures au stockage pendant le test) | `Last-Modified` posé | une seule requête (carte, client et marchand joints) ; images du marchand gardées en mémoire |
| téléchargement initial `/api/passes/:serial/apple` | — | hors campagne | — |

Au profil du test (2,7 cartes par appareil) : 1 + 3 + 1,7 × 1 ≈ **5,1 requêtes par appareil**
(mesuré : 5 102 pour 995). Au profil de la production (≈ 1 carte) : **≈ 4**.

| Levier | Requêtes | Effet sur les caisses | Risque | Effort |
|---|---|---|---|---|
| **a. Lots étalés, avancement en base** : la campagne devient une ligne en base ; l'écran reçoit une réponse immédiate ; un minuteur du serveur envoie un lot (par exemple 50 iPhone) toutes les 10 s, met à jour les cartes DU LOT, écrit registre et avancement | + 3 à 4 par lot (lire le lot suivant, mettre à jour ses cartes, écrire l'avancement et le registre), soit ≈ 0,07 par appareil ; supprime la mise à jour des 50 000 cartes d'un coup | **le pic ne dépend plus de la taille** : il vaut celui d'un lot, quelle que soit la campagne | moyen : durée (8 000 iPhone ≈ 27 min à 5 / s), reprise après coupure, double lancement | moyen : 1 migration, 1 boucle, 1 reprise au démarrage, écran |
| **b1. Carte en 200 en une seule requête** | 3 → 1 par carte téléchargée | ≈ ÷ 2 de requêtes par appareil (4 → 2) : lots deux fois plus gros à charge égale | faible (même lecture, jointe) | faible |
| **b2. Liste vraiment filtrée + horodatage en base** (ligne 24) | supprime les 304 des autres cartes : 0 en production (≈ 1 carte), − 1,7 par appareil au test | faible en production, fort pour les porteurs de plusieurs cartes (réseaux, multi-marchands) | **moyen** : une erreur = des cartes qui ne se mettent plus à jour, sans bruit ; à tester sur un vrai iPhone | moyen |
| b3. Cache de la carte signée | 0 en campagne : chaque carte change une fois, le cache ne sert pas | aucun en campagne | faible à moyen (carte périmée) | moyen |
| b4. Images du marchand en mémoire | 0 requête base ; − ≈ 3 lectures au stockage par carte | faible (le stockage est resté rapide) | faible | faible |
| **c. File côté serveur, priorité aux caisses** : au plus N retours d'iPhone (`/v1/*`) traités en même temps (par exemple 10) ; les suivants attendent en mémoire, ou reçoivent 503 au-delà d'une attente | 0 | **protège le scan quoi qu'il arrive** (rafale d'iPhone, cron, retours imprévus) : les scans ne passent jamais derrière des milliers de cartes | moyen : cartes plus lentes à se mettre à jour, réglage de N ; comportement d'iOS sur 503 non vérifié | faible |
| d1. Ne plus envoyer de message Google aux cartes iPhone (étape 23) | 0 requête base ; ≈ − 64 % des appels Google | aucun sur la base (Google ne rappelle pas notre serveur) | moyen (porteurs Apple ET Google : non mesuré) | faible à moyen |
| d2. Un seul débit d'envoi partagé par la campagne et le cron | 0 | évite que les deux s'additionnent | faible | faible |

Écartés : instance Supabase supérieure (coût, le pic demeure), deux répliques Railway (le
serveur n'est pas le goulot), créneaux interdits (ne règlent pas la taille).

### 2. Recommandation

**En premier, ensemble : a + c + b1.**
- a supprime le plafond des destinataires sans pic ;
- c est le filet qui garantit la caisse, même si un lot est mal réglé ;
- b1 divise par deux le coût de chaque retour, donc la durée des campagnes.
- d2 dans le même chantier (même minuteur).
**Ensuite** : b2 (avec la ligne 24, test sur vrai iPhone), d1 (étape 23). b3 et b4 :
seulement si les mesures le demandent.
**Débit de départ** : 50 iPhone toutes les 10 s (5 par seconde), réglable par variable,
calé ensuite par la série du seuil. Repère : la production a servi 133 à 187 retours
groupés en 15 à 40 s sans file. Durées : 1 500 porteurs (≈ 1 200 iPhone) ≈ 4 min ; 10 000
porteurs (≈ 8 100) ≈ 27 min ; avec b1, ≈ 2 fois moins si les mesures le permettent.

### 3. Les cas qui font peur

- **Redéploiement ou crash au milieu.** Aujourd'hui : l'arrêt propre attend 20 s, puis tout
  ce qui reste est perdu ; le registre et `notification_logs` ne sont écrits qu'à la fin
  (ni trace, ni quota consommé : le marchand relance et les premiers reçoivent deux fois).
  Avec a : l'avancement est en base après chaque lot ; au démarrage, le serveur lit les
  campagnes « en cours » (1 lecture au démarrage, pas de requête régulière) et reprend au
  curseur. Ordre proposé : **Apple** envoyé PUIS curseur écrit (au pire un lot reçoit deux
  pushes silencieux : sans effet visible, la carte n'a pas changé) ; **Google** : curseur
  écrit AVANT l'envoi (au pire un lot perd son message, jamais de doublon visible ni de quota
  gâché). Hypothèse : une seule instance Railway ; la campagne est « prise » par
  l'instance (comme `cron_passages.instance`).
- **Double clic, deux campagnes proches.** Aujourd'hui : quota lu puis envoi, sans verrou
  (`notifications.js:58-75`) : deux clics passent. Avec a : **une seule campagne en cours
  par marchand** (index unique partiel en base) ; la seconde est refusée (409, « une
  campagne est en cours »). Le quota se compte à la création.
- **Le cron de 08:00 UTC.** Il envoie en série, ≈ 0,9 s par carte (étape 15 : 4 413 pushes
  étalés n'ont pas gêné les caisses). Proposition : un seul débit partagé dans le serveur
  (d2) ; pendant le passage du cron, la campagne ralentit de moitié. Zéro requête.
- **Apple et Google ensemble.** Rythmes différents : le goulot vient des retours
  d'iPhone (Apple). Google ne rappelle jamais notre serveur ; ses envois coûtent un appel
  à Google (méd. 520 ms) et une ligne de registre. Proposition : Google dans le même lot,
  en parallèle borné (5 à 10 appels simultanés), sans attendre les retours d'iPhone. Le
  quota de l'API Google (par projet) n'est pas connu : console Google, à relever.

### 4. Google

- **Quota : 3 notifications par carte et par 24 h**, messages `TEXT_AND_NOTIFY` compris,
  au-delà `QuotaExceededException` : **confirmé par la documentation officielle le 26/09**
  (audit A §5.2, lien cité) ; **non observé** en production (le registre ne le verrait pas :
  un refus pour quota répond 200). Non revérifié aujourd'hui : la page de Google n'est pas
  joignable depuis ce poste. Les mises à jour d'objet ne notifient pas (audit 04 §4.5). Un
  plafond de 10 messages par carte s'ajoute.
- **Le filtre actuel ne trie rien** : la campagne vise les cartes dont `google_pass_url`
  n'est pas nul (`notifications.js:84-90`), or ce lien est créé à l'inscription pour
  **toutes** les cartes (`clients.js:84-88`) ; 64 % finissent sur un iPhone (audit 04).
- **Gain si t37 n'envoie plus aux cartes iPhone** (étape 23) : ≈ 64 % des appels Google en
  moins (≈ 650 sur 1 000 cartes ; 6 400 sur 10 000), autant de lignes de registre, aucune
  requête base en moins côté retours. Le gain réel est ailleurs : ne plus consommer pour
  rien le plafond de 10 messages d'objets jamais installés. **Condition** : un signal
  fiable « carte Google installée » (rappels de Google ; à défaut, la sonnette Apple, avec le
  risque des porteurs à deux plateformes, non mesuré).

### 5. Ce que voit le marchand

- Au clic : réponse immédiate, « Envoi en cours vers N appareils iPhone et M cartes Google,
  environ X min. Vous pouvez fermer cette page. »
- Pendant : « Envoyés : A / N iPhone, G / M Google » (acceptés par Apple et Google, jamais
  « reçus ») ; bouton **Arrêter l'envoi** (les lots restants ne partent pas, ceux déjà
  envoyés restent). Lu par la route existante `GET /api/notifications`, rafraîchie toutes
  les 15 s **seulement pendant un envoi et page ouverte** : pas de requête régulière.
- À la fin : « Terminé en X min : A iPhone, G Google, E refus (appareils retirés) ». Le
  compteur parle d'appareils et de cartes, pas de clients (audit 05 §4.3).
- À trancher par Yass : une campagne arrêtée compte-t-elle dans le quota du mois
  (proposition : oui si au moins un lot est parti).

### 6. À quelle taille le problème apparaît

- **Sûr** : vers 1 000 appareils, file de 24 à 44 s dans l'API de données, caisse jusqu'à
  154 s (test, base de 578 Mo, 2,7 cartes par appareil).
- **Absent** : 133 à 187 appareils en production (4 campagnes, aucune file).
- **Banc** : pire scan au-delà de 2 s dans 1 essai sur 2 vers 500 inscriptions iPhone,
  4 sur 4 vers 750 (processeur local, pas Supabase).
- **Le seuil réel, entre ≈ 170 et 1 000 appareils, n'est pas mesuré** : c'est la série du
  seuil (123, 308, 615 porteurs). Déclencheur inchangé : premier marchand à ≈ 500 porteurs
  ou un réseau.

### 7. Plan de mesure

**Environnement** : le projet de test `winwin-campagne-15` (Railway + Supabase Micro),
outils `tests/charge/` ; aucune mesure en production hors observation passive.
- **Avant (sans code)** : la série du seuil, `CHARGE_PLAFOND` 123, 308, 615 puis la campagne
  vers 1 000 déjà mesurée ; un scan de contrôle avant chaque campagne ; 10 min entre deux.
- **Après (code t37)** : mêmes paliers + 1 000 + **5 000 et 16 000 appareils** (le réseau
  entier, impossible avant).
- **Quoi mesurer** : scans pendant la campagne (médiane, p99, max, vus du pilote) ; temps des
  requêtes base (méd., max) ; requêtes base par appareil réveillé ; durée de la campagne ;
  temps de réponse au clic ; avancement exact après `SIGTERM` puis après arrêt brutal.
- **Seuils de réussite** :
  - caisse pendant toute campagne : médiane ≤ 450 ms, **p99 ≤ 1 s, max ≤ 2 s** ;
  - requêtes base, méd. ≤ 300 ms pendant la campagne (aucune file) ;
  - clic du marchand : réponse ≤ 1 s ;
  - avec b1 : ≤ 2,5 requêtes base par appareil (contre 5,1) ;
  - durée : N / débit à ± 10 % ;
  - reprise : aucun appareil oublié ; au plus un lot de pushes Apple en double ; zéro
    message Google en double ; second clic refusé (409).
- **En local d'abord** (`npm test`, imitateur d'Apple et de Google) : la logique (lots,
  reprise, verrou, arrêt, quota), pas la capacité de Supabase.

### 8. Calendrier réaliste (à partir du feu vert)

| Quand | Quoi | Environnement de test |
|---|---|---|
| sem. du 12/10 | série du seuil AVANT (1 journée) ; relevé des réglages Supabase des deux projets | **rallumé** (Yass prévenu avant) |
| 13 → 20/10 | code a + c + b1 + d2 : migration (table des campagnes), boucle, reprise, verrou, écran ; filet local | éteint |
| ≈ 21/10 | revue, migration en production avant le push, push, contrôles | éteint |
| 22 → 24/10 | série APRÈS sur le test (paliers, 5 000, 16 000, coupures) | **rallumé** |
| après | b2 (ligne 24, vrai iPhone), d1 (étape 23) | — |

**Ça tient avant le 31/10 pour a + c + b1, de justesse**, si la série « avant » se joue la
semaine du 12/10 et que chaque push est validé sans retour. **b2 ne tiendra pas** avant le
31/10 avec ses tests sur vrai iPhone. **Recommandation : garder l'environnement jusqu'au
15/11** (≈ 5 $ de plus) pour la marge et la mesure de b2. **Mesure manquante** : la série du
seuil « avant » ; elle demande de rallumer les services : je préviens avant.

### Avant le premier marchand à ≈ 1 000 porteurs / ce qui peut attendre

**Avant** : a (lots, avancement, reprise, verrou, réponse immédiate), c (file avec priorité
aux caisses), b1 (carte en une requête), d2 (débit partagé avec le cron), la mise à jour des
cartes par lot, l'écran d'avancement.
**Peut attendre** : b2 (ligne 24), d1 (étape 23, Google vers iPhone), b3, b4, le compte rendu
en clients (étape 26).

### Hypothèses et limites

- Une seule instance Railway (deux instances enverraient deux fois sans la prise de campagne
  par instance).
- Le débit de départ (5 iPhone par seconde) vient de la production (≈ 170 retours sans file)
  ; il sera calé par la série du seuil.
- Comportement d'iOS sur une réponse 503 de `/v1/passes` (levier c, mode « refus ») non
  vérifié : préférer l'attente en mémoire, bornée.
- Quotas de l'API Google par projet : non relevés.

## 15 septvicies. t37 : CODÉ EN LOCAL (09/10, NON POUSSÉ, migration 054 non exécutée)

**Décisions de Yass (09/10)** : a + c + b1 + d2 ensemble ; plus de plafond de 1 000
DESTINATAIRES de campagne (les listes du dashboard restent dans 21) ; quota compté au clic ;
écran : seul le texte de la réponse au clic change (« Campagne en cours d'envoi. »), ni
compteur ni bouton, aucune requête en plus ; en attente : b2 (parking), b3, b4, d1 (23).
Débit de départ : 50 iPhone par 10 s, réglable.

**Livré (local)** :
- `database/migration_054_campagnes.sql` : table `campagnes` (avancement par curseurs
  `device_tokens.id` et `passes.id`, `maj_le`, `instance`) ; index unique partiel « une seule
  en cours par marchand » ; `lancer_campagne` (quota + `notification_logs` + campagne, une
  transaction ; second clic → `en_cours`, rien écrit) ; `avancer_campagne` (curseurs, fin de
  voie, compteurs de `notification_logs`, une requête) ; `reprendre_campagnes` (prise
  atomique des campagnes orphelines). **À exécuter en production AVANT le push.**
- `src/services/campagnes.js` (a) : envoi en arrière-plan, deux voies. Apple : lot lu par
  curseur, message posé sur les cartes DU LOT, un jeton du débit avant chaque push, puis
  registre et avancement (envoi PUIS curseur : au pire un lot reçoit un second push
  silencieux). Google : curseur PUIS envoi (au pire un lot perd son message, jamais de
  doublon), 5 appels à la fois, un lot par 10 s. Reprise UNE fois au démarrage, après 60 s
  (l'ancien serveur finit son lot pendant un redéploiement), des campagnes sans avancement
  depuis 45 s. Arrêt propre : plus de nouveau lot. 6 erreurs de base de suite → campagne
  « interrompue » (le verrou est libéré), journalisé.
- `src/services/debit.js` (d2) : un débit unique, en mémoire, pour les pushes Apple en masse
  (campagnes ET cron, `workers/cron.js`) ; file servie dans l'ordre d'arrivée : les deux
  avancent ensemble, le total ne dépasse jamais le débit. Pas concernés : les pushes d'un seul
  événement (scan, bienvenue, ajustement, avis) et Google (ne rappelle pas notre serveur).
- `src/middleware/fileAppleWallet.js` (c) : au plus 10 requêtes `/v1/*` traitées à la fois
  (`/v1/log` exclu) ; les suivantes attendent en mémoire au plus 15 s, puis 503 avec
  `Retry-After: 30` ; au-delà de 2 000 en attente, 503 tout de suite. Les caisses n'y passent
  jamais.
- `src/routes/apple-wallet.js` (b1) : carte, client et marchand en UNE requête (jointure) ;
  mêmes colonnes ; 304 inchangé (une requête).
- `src/routes/notifications.js` : le clic appelle `lancer_campagne` et répond **202** tout de
  suite (409 si une campagne est en cours, 429 quota inchangé).
- `public/dashboard/index.html` : texte de la réponse au clic seulement.
- `src/index.js` : branchement de la file, de la reprise différée et de l'arrêt.
- **Le scan ne change pas** (`scan.js` hors du diff).

**Réglages (variables Railway, toutes facultatives)** : `CAMPAGNE_IPHONE_PAR_LOT` (50),
`CAMPAGNE_LOT_MS` (10000), `DEBIT_RAFALE` (débit d'une seconde), `CAMPAGNE_GOOGLE_PAR_LOT`
(50), `CAMPAGNE_GOOGLE_SIMULTANES` (5), `CAMPAGNE_REPRISE_DELAI_MS` (60000),
`CAMPAGNE_INACTIF_MS` (45000), `FILE_V1_EN_VOL` (10), `FILE_V1_ATTENTE_MS` (15000),
`FILE_V1_MAX` (2000).

**Requêtes** : aucune régulière. Une seule au démarrage (+ 60 s, reprise). Par lot Apple :
lecture, mise à jour des cartes du lot, avancement, registre (4) ; par lot Google : lecture,
curseur, compteurs, registre (4). Au clic : profil + `lancer_campagne` (2), au lieu de 7.

**Preuves (local, 09/10)** :
- `npm test` **192/192** (172 avant t37). §17 : débit partagé (cron et campagne ensemble,
  toute fenêtre respectée) ; campagne de 1 200 appareils et 1 200 cartes Google : un envoi
  chacun, au débit réglé, historique 1 200 / 1 200, message posé sur les 1 200 cartes,
  2 400 lignes de registre ; verrou (second lancement refusé, quota non compté) ; arrêt
  propre au milieu puis reprise au curseur : aucun iPhone oublié, exactement un lot Apple en
  double, zéro message Google en double, un lot Google perdu (arrêt brutal imité en base) ;
  clic 202 en moins d'1 s, quota compté au clic ; double clic 409 ; quota 429 ; carte en UNE
  requête (304 aussi), client et marchand bien lus ; file : 30 retours d'iPhone, au plus 5
  requêtes de carte à la fois vers la base, scan en 200 pendant ce temps, 503 + Retry-After
  au-delà de l'attente.
- **Contre-épreuve** (ancien `src/`, même migration et mêmes tests) : 10 KO (clic 200 au lieu
  de 202, pas de verrou, 3 requêtes par carte, 30 requêtes de carte en même temps, modules
  absents). Le test « scan pendant la file » passe AUSSI sur l'ancien code : à cette échelle
  locale le scan n'est pas encore gêné ; ce qui distingue est le nombre de requêtes en vol.
- **Scan inchangé** (120 scans en série, délai base 100 ms, deux tours) : p50 327-328 ms
  avant et après, 5,25 et 5,00 requêtes base par scan (5,01 : l'unique lecture de reprise,
  faite 60 s après le démarrage pendant la mesure).
- **Banc local** (`tests/charge/banc-local.js`, 100 000 porteurs, palier 615, campagne vers
  le marchand plafond, processeur local, PAS Supabase) :

  | | avant | t37 |
  |---|---|---|
  | clic du marchand | 2 316 ms (200) | 370 ms (202) |
  | pushes Apple | 519 d'un coup | 561 en ≈ 112 s |
  | scans pendant : méd. / p99 / max | 442 / 5 885 / 5 885 ms | 428 / 512 / 512 ms |
  | requêtes base par iPhone réveillé (2,7 cartes / appareil) | 6,8 | 4,7 |
  | boucle max ; mémoire | 411 ms ; 274 Mo | 85 ms ; 205 Mo |

  Les 304 restants (1 517) sont les autres cartes de chaque appareil : b2 (parking).
  `CHARGE_CAMPAGNE_S` doit couvrir la durée de l'envoi (130 s ici), sinon le banc s'arrête
  avant la fin.

**Hypothèses et limites** :
- Une seule instance Railway (le débit et la file sont en mémoire ; deux instances
  doubleraient le débit). La reprise, elle, est sûre à deux (prise atomique).
- Comportement d'iOS sur 503 + `Retry-After` non vérifié sur un vrai iPhone (la carte se met à
  jour plus tard).
- Pendant l'envoi, l'historique (route existante, lue seulement à l'ouverture de l'onglet)
  montre l'avancement partiel « x/N reçues » : libellé d'avant t37 (audit 05 §4.3), non
  modifié (seul le texte du clic était admis) ; à décider.
- Une page du dashboard ouverte AVANT le déploiement lit l'ancienne réponse : le clic affiche
  une erreur alors que la campagne part ; un nouveau clic reçoit 409 (pas de doublon).
- La campagne pose son message sur le marchand (`notification_message`) au début, comme
  avant, même sans appareil.
- Clés i18n `appleLine`, `googleLine`, `noDevices` du dashboard devenues inutiles, laissées.

**Décisions hors pilotage (09/10)** :
- Le débit partagé compte les pushes **Apple** (cause des retours d'iPhone) ; Google a sa
  propre cadence (un lot de 50 par 10 s, 5 à la fois).
- Statut « interrompue » après 6 erreurs de base de suite, pour ne pas bloquer le marchand
  (409 sans fin).
- Reprise différée de 60 s et seuil d'orphelin de 45 s (chevauchement des serveurs pendant un
  redéploiement Railway).
- 409 : message « A campaign is already being sent. Please wait until it is finished. »,
  affiché tel quel par l'écran (comme les autres erreurs du serveur).

**Mesures sur l'environnement de test (à faire, rien lancé)** : série « avant » 123 / 308 /
615 sur le code de production (`claude/keen-goldberg-MXslu`, qui porte `tests/charge/`), puis
« après » sur une branche de test portant t37 (migration 054 sur la base de TEST d'abord).
Seuils de réussite (§15 sexvicies, 7) : caisse p99 ≤ 1 s et max ≤ 2 s pendant toute
campagne ; requêtes base méd. ≤ 300 ms ; clic ≤ 1 s ; ≤ 2,5 requêtes base par appareil au
profil de la production (≈ 1 carte) ; reprise sans oubli ni doublon Google.

## 15 octovicies. t37 : CORRECTIONS DU 09/10 ET SÉRIE « AVANT » (LOCAL, NON POUSSÉ)

**Décisions de Yass (09/10)** :
1. Historique des notifications : plus de chiffre « x/N reçues » ; « En cours d'envoi »
   pendant l'envoi, « Envoyée » à la fin. Texte seulement, aucune requête en plus.
2. Une campagne « interrompue » reprend seule quand la base revient (tentatives espacées,
   aucune requête quand il n'y a rien à reprendre) + ligne d'alerte « [campagne] INTERROMPUE ».
3. **Validées** : cadence Google séparée d'Apple, reprise 60 s après le démarrage, orpheline
   à 45 s (ces trois points sortent des « décisions hors pilotage » du §15 septvicies).
4. La série « après » compte les 503 de la file des iPhone ; **seuil : zéro au débit
   nominal (50 / 10 s)**.
- ~~Feu vert : basculer les trois services de test sur `claude/keen-goldberg-MXslu`~~ (remplacé
  le 09/10 par la branche de test `campagne/etape37`, §15 novovicies) et lancer la série « avant ». Pour plus tard : pousser t37 sur une branche de
  TEST (jamais la production) et exécuter la 054 sur la base de TEST, pour la série « après ».

**Livré (local)** :
- `GET /api/notifications` : chaque ligne porte `etat` (`en_cours` tant que sa campagne
  n'est pas `terminee`, interrompue comprise ; sinon `envoyee`), lu par jointure
  `campagnes(statut)` dans la MÊME requête. Les compteurs restent dans la réponse, l'écran ne
  les affiche plus (`public/dashboard/index.html`, `renderNotifHistory`). Clés i18n
  `received` et `noDevicesShort` devenues inutiles, laissées.
- `src/services/campagnes.js` : une voie en panne arrête l'autre (`c.stop`), la campagne
  passe en « interrompue » avec la ligne `[campagne] <id> INTERROMPUE (marchand …) : … ;
  nouvelle tentative dans N s`, puis reprend seule au curseur après 1, 2, 5, 10, 20 puis
  toutes les 30 min, tant qu'elle n'est pas finie (une requête par tentative ; les minuteries
  n'existent que pour une campagne interrompue ; l'arrêt du serveur les annule, et la reprise
  au démarrage prend alors le relais).
- Migration 054 (pas encore exécutée nulle part, modifiée en place) : le verrou couvre
  `en_cours` ET `interrompue` (un nouveau clic reçoit 409 pendant une interruption) ;
  `reprendre_campagnes` reprend aussi les interrompues et les remet « en cours ».
- **Correction trouvée à la relecture** : dans la première version, une voie en panne
  laissait l'autre tourner ; une reprise aurait fait tourner deux voies à la fois (doublons).

**Preuves** : `npm test` **197/197**. Nouveaux tests : panne de base sur `device_tokens`
pendant l'envoi → « interrompue », alerte au journal (au moins 2 tentatives ratées pendant
la panne), verrou gardé ; la base revient → reprise seule, campagne terminée, 1 200 iPhone et
1 200 cartes, aucun oubli ni doublon ; ensuite aucune minuterie et aucune requête pendant
1,5 s ; historique « en cours d'envoi » / « envoyée » avec le même nombre de lectures (3 par
ouverture). Contre-épreuve (première version de t37, `ec546e8`) : 5 KO (campagne laissée
« interrompue » avec 400 iPhone servis sur 1 200, pas d'état dans l'historique).

**Limite** : si la base reste en panne des heures, la campagne garde le verrou (409) et
journalise une alerte toutes les 30 min ; pas de fin automatique.

**Série « avant » : préparation (rien lancé)**. Vérifié par git : `claude/keen-goldberg-MXslu`
(production, `a3fadde`) et `campagne/etape15` portent tous deux `tests/charge/` et les
migrations 051 à 053 ; la base de test les a déjà (rejouées au geste 3 du 05/10). Le banc
local tourne avec le code de production (§15 septvicies). Après la bascule, **tout push en
production redéploie aussi les trois services de test** (et rejoue l'étape du pilote) : pilote
laissé en `attente`, serveur et imitateur arrêtés après la série.

## 15 novovicies. t37 : DATE LIMITE DE 24 H, BRANCHE DE TEST `campagne/etape37` (09/10)

**Décisions de Yass (09/10)** :
1. Campagne interrompue : reprise automatique gardée, avec une **date limite de 24 h après
   le clic**. Passé ce délai : statut final, plus de tentative ni d'alerte, verrou levé, quota
   toujours compté ; dernière ligne « [campagne] ABANDONNÉE après 24 h ». Aucune requête
   régulière en plus.
2. L'environnement de test ne suit PAS `claude/keen-goldberg-MXslu` (trop lié à la
   production). Branche de test **`campagne/etape37`**, créée depuis `a3fadde` (code de la
   production) et poussée (feu vert pour ce push seulement) : les trois services de test la
   suivront. t37 y sera poussé pour la série « après », sur feu vert.

**Livré (local, non poussé)** :
- `src/services/campagnes.js` : `limiteMs` = 24 h depuis `cree_le` (au clic, l'heure du
  serveur ; à la reprise, celle de la base). Une panne au-delà de l'échéance → `abandonner()` :
  ligne `[campagne] <id> ABANDONNÉE après 24 h (marchand …) : arrêt définitif, verrou levé,
  quota compté`, statut `abandonnee`, `fin_le`. Les tentatives sont plafonnées à l'échéance
  (la dernière tombe pile dessus). Si la base ne répond pas au moment d'écrire l'abandon :
  nouvel essai toutes les 30 min, sans alerte, jusqu'à ce que l'écriture passe.
- Migration 054 (toujours non exécutée, modifiée en place) : statut `abandonnee` ;
  `reprendre_campagnes(instance, inactif, limite)` abandonne au démarrage les campagnes
  orphelines dont le clic date de plus de 24 h, reprend les autres (les deux rendues, le
  statut dit lequel). Le verrou (`en_cours`, `interrompue`) ne couvre pas `abandonnee`.
- Une campagne qui avance normalement n'a pas de date limite (seules les interrompues et les
  orphelines sont concernées).

**Preuves** : `npm test` **200/200**. Nouveaux tests : panne persistante, date limite réglée
à 1,5 s → « abandonnee » avec `fin_le`, UNE ligne « ABANDONNÉE après … », puis aucune
tentative, aucune alerte, **aucune requête** pendant 1,5 s, nouvelle campagne acceptée
(verrou levé), ligne de quota gardée ; au démarrage, une campagne interrompue de 25 h est
abandonnée (« ABANDONNÉE après 24 h ») et une d'1 h reprend et se termine. Contre-épreuve
(version `a3020c4`, ancienne migration ET ancien code) : la campagne n'est jamais
abandonnée, ses tentatives continuent (8 requêtes en 1,5 s), le verrou reste (KO). Les
boucles d'attente des tests sont maintenant bornées (une contre-épreuve mal appariée,
nouvelle migration avec l'ancien code, avait bloqué le filet ; arrêtée à la main, code
actuel remis en place et vérifié).

**Branche de test** : `campagne/etape37` = `a3fadde` (vérifié par `git ls-remote`). Rien en
production. Tout push sur cette branche redéploie les trois services de test et rejoue
l'étape inscrite au pilote (`attente` au repos).

## 15 tricies. t37 : SÉRIE « AVANT » (09/10, environnement de test, code de production `a3fadde`)

**Faite par Yass le 09/10** sur `campagne/etape37` (= `a3fadde`), serveur et imitateur arrêtés
ensuite, pilote sur `attente`. Campagne vers le marchand plafond, scans au rythme ×3 pendant
45 s. Profil du test : ≈ 2,7 cartes par appareil (production ≈ 1).

| Palier (porteurs) | iPhone / Google | scan au calme méd. / max | clic | scans pendant | `/v1` |
|---|---|---|---|---|---|
| 123 | 88 / 50 | 377 / 564 ms | 1 993 ms | méd. 329, p99 = max 1 564 ms, tous 200 | passes 200×82, 304×240, **404×25** ; listes 200×94, **204×11** |
| 308 | 241 / 116 | 356 / 662 ms | 3 013 ms | méd. 319, max 2 566 ms (générateur) / 6 533 ms (serveur), 200×26, **503×2** | passes **404×120** |
| 615 | 504 / 211 | 400 / 1 070 ms | **33 143 ms** | 200×14, **503×11, 500×2**, max **17 654 ms** | passes 200×56, 304×243, **404×239** ; listes 200×142, **204×370** ; requêtes base max **23 386 ms** |

**Lecture, face aux seuils de t37** (caisse p99 ≤ 1 s et max ≤ 2 s ; clic ≤ 1 s ; zéro 5xx
de caisse) :
- 123 : déjà hors seuil (p99 1,56 s ; clic 2 s), sans erreur.
- 308 : hors seuil (max 2,6 à 6,5 s ; 2 scans refusés en 503 par les coupures à 5 s de
  l'étape 16, qui ont joué leur rôle : pas d'attente de 154 s).
- 615 : tempête (41 % des scans en erreur, clic 33 s, base 23 s).
- **Coude : entre ≈ 90 et ≈ 240 iPhone notifiés** (profil du test). La production a servi
  133 à 187 iPhone sans file, à ≈ 1 carte par appareil. **Le déclencheur « premier marchand à
  ≈ 500 porteurs » est trop haut** : à ≈ 300 porteurs (≈ 240 iPhone, le plus gros marchand
  actuel), une campagne gêne déjà la caisse au profil du test.
- Ce que t37 doit faire tomber : clic → < 1 s ; scans pendant → max ≤ 2 s, zéro 503 et 500 ;
  requêtes base → plus de file (max < 1 s) ; `/v1` → zéro 404 et 204 de coupure.

**Deux défauts trouvés par la série, corrigés dans t37 (local)** :
1. **Routes Apple sur coupure ou panne de base (CONFIRMÉ par le code et par la
   contre-épreuve)** : `apple-wallet.js` ne lisait pas l'erreur de la liste (`204` « rien de
   modifié ») et rendait `404` sur toute erreur de lecture de carte ; l'inscription
   rendait 404 puis 500, la désinscription 500. L'iPhone prenait ces réponses pour vraies et
   manquait la mise à jour. Correctif : toute erreur de base → **503 + `Retry-After: 30`** ;
   seul `PGRST116` (aucune ligne) reste 404.
2. **Les 2 scans en 500 du palier 615** : écriture `crediter_scan` coupée à 5 s
   (`scan.js`, erreur autre que 23505 → 500). Correctif : **503 `database_unavailable`**,
   journalisé (les deux tests de l'étape 11 « panne à l'écriture » attendent maintenant 503).
   **Crédit unique** : chaque scan du générateur porte une clé neuve et n'est jamais
   renvoyé (`generateur.js:96`), et `crediter_scan` est une seule transaction : chaque scan
   coupé est crédité 0 ou 1 fois, jamais 2 (index unique sur la clé). À compter sur la base
   de test (requête en lecture, ci-dessous) : `donnees.sql` ne pose aucune clé, donc les
   lignes avec clé sont celles du générateur depuis le chargement 615 : attendu 30 (contrôle)
   + 14 (200) + 0 à 2 (les 500), et autant de clés distinctes.
   ```sql
   SELECT count(*) AS scans_avec_cle, count(DISTINCT cle_idempotence) AS cles_distinctes
     FROM scans WHERE cle_idempotence IS NOT NULL;
   ```
   **Résultat (Yass, 09/10, base de test) : 46 scans, 46 clés distinctes** = 30 + 14 + 2 :
   les deux scans coupés en 500 ont été crédités, **une fois chacun** (PostgREST a fini la
   transaction, comme mesuré en local au §15 tervicies).

**Preuves** : `npm test` **205/205**. Nouveaux tests : base saine (inscription 201, liste 200,
carte inconnue 404) ; liste coupée à 5 s → 503 + Retry-After vers 5 s ; panne → carte,
inscription (deux lectures), liste et désinscription en 503 + Retry-After ; écriture du scan
en panne → 503. Contre-épreuve (sans ces deux correctifs) : 5 KO, avec exactement les codes
vus en série : 204, 404, 404 puis 500, 500, et 500 au scan.

**Série « après » : proposition** (feu vert déjà donné : push de t37 sur `campagne/etape37`,
migration 054 sur la base de TEST, rien d'autre). Débit nominal 50 / 10 s.
`CHARGE_CAMPAGNE_S` = durée d'envoi (iPhone ÷ 5) + 50 s environ :

| Essai | données | cible | iPhone ≈ | `CHARGE_CAMPAGNE_S` |
|---|---|---|---|---|
| A | 123 | plafond | 88 | 60 |
| B | 308 | plafond | 241 | 100 |
| C | 615 | plafond | 504 | 150 |
| D | 5000 | plafond | ≈ 4 050 | 870 |
| E | 5000 | reseau | ≈ 16 200 | 3 300 (55 min) ; redéploiement du serveur au milieu (reprise) |

Seuils : caisse p99 ≤ 1 s, max ≤ 2 s, zéro 503 et 500 ; clic ≤ 1 s ; requêtes base méd.
≤ 300 ms ; zéro 503 de la file `/v1` ; zéro 404 et 204 de coupure ; requêtes base par iPhone
réveillé ≈ 4,7 au profil du test (≤ 2,5 visé au profil de la production : b2 en parking) ; E :
reprise dans le journal (`[campagne] … reprise`), fin « terminée », compteurs complets.

## 15 untricies. t37 : SÉRIE « APRÈS », ESSAIS A À D (09-10/10, environnement de test, `a46a976`)

**Faite par Yass** sur `campagne/etape37` = `a46a976` (t37 complet), migration 054 sur la base
de TEST (vérification : 5 × true). Débit nominal 50 iPhone / 10 s. Profil du test : ≈ 2,7
cartes par appareil. Essai E : voir plus bas.

| Essai | pushes Apple | clic | scans pendant : méd. / p95 / p99 / max (n) ; erreurs | requêtes base : méd. la plus haute / max | `/v1` erreurs | durée |
|---|---|---|---|---|---|---|
| A (123) | 115 | 239 ms (202) | 369 / 1 095 / 1 242 / 1 242 ms (29) ; 0 | 193 / 468 ms | 0 | 69 s |
| B (308) | 272 | 221 ms | 319 / 656 / 758 / 758 ms (41) ; 0 | 253 / 557 ms | 0 | 109 s |
| C (615) | 567 | 245 ms | 397 / 1 238 / 1 344 / 1 344 ms (84) ; 0 | 163 / 684 ms | 0 | 158 s |
| D (5000) | **4 366** | 231 ms | 424 / 1 055 / 1 457 / **2 428** ms (462) ; 0 | 136 / 916 ms | 0 | 881 s (= 4 366 ÷ 5 s⁻¹) |

Scan au calme (contrôle, 30 scans) : méd. 336 à 365 ms, max 530 à 834 ms.

**Comparaison avec la série « avant »** (§15 tricies) :
- erreurs de caisse pendant une campagne : 2 (308) et 13 sur 27 (615) → **0 à tous les
  paliers**, D compris (462 scans) ;
- clic : 2 à 33 s → **≈ 230 ms**, constant ;
- requêtes base : max 23 s (file) → **max < 1 s**, médianes 135 à 250 ms : plus de file ;
- `/v1` : 404 et 204 de coupure (jusqu'à 239 et 370) → **0** ; aucun 503 de la file des iPhone
  au débit nominal (seuil du 09/10 tenu) ;
- **plafond levé** : D envoie 4 366 pushes (impossible avant : 1 000 au plus), au débit
  exact, sans erreur ; boucle max 32 ms, mémoire 324 Mo ;
- requêtes base par iPhone réveillé (D) : (4 319 listes + 15 733 cartes) ÷ 4 319 ≈ **4,6**
  (attendu 4,7) ; dont 2,6 vérifications « 304 » d'autres cartes, propres au profil du test
  (b2, parking).

**Face aux seuils** :
- tenus : zéro erreur de caisse, clic ≤ 1 s, base méd. ≤ 300 ms, zéro 503 de la file, zéro
  404/204 de coupure, requêtes par iPhone conformes ;
- **non tenus** : caisse **p99 ≤ 1 s** (A 1,24 ; C 1,34 ; D 1,46 s ; B 0,76 s tenu) et **max
  ≤ 2 s** en D (2,43 s, un scan sur 462). Cause lue dans les mesures : pas de file, mais une
  base plus chargée (≈ 20 à 25 requêtes base par seconde venues des iPhone) : chaque requête
  du scan passe de ≈ 100 à 300-500 ms au p95-p99, et un scan en enchaîne 3 à 4. Le contrôle
  au calme est déjà à 0,5-0,8 s de max.

**Leviers sans code, à décider** :
1. réviser le seuil : p99 ≤ 1,5 s et max ≤ 2,5 s pendant une campagne (au calme : max
   ≈ 0,8 s ; Dubaï ajoute ≈ 0,28 s) ;
2. ou baisser le débit : `CAMPAGNE_IPHONE_PAR_LOT=30` (3 iPhone / s, ≈ − 40 % de charge),
   campagnes ≈ 1,7 fois plus longues (4 000 iPhone : ≈ 22 min) ; à mesurer en rejouant C et D ;
3. au profil de la production (≈ 1 carte par appareil), ≈ 2 requêtes par iPhone au lieu de
   4,6 : la charge réelle sera ≈ moitié de celle du test (HYPOTHÈSE, non mesurée).

**Essai E (10/10, 22:19 → 23:14 UTC) : réseau, 16 230 inscriptions iPhone, redéploiement du
serveur au milieu (22:33:58).**
- Campagne `terminee` toute seule : `fin_le` 23:14:52, 55 min 22 s pour 16 230 (≈ 4,9 / s,
  pause de reprise comprise). Compteurs complets : Apple 16 230 tentés, 16 075 acceptés
  (165 refus simulés par l'imitateur, ≈ 1 %) ; Google 7 205 / 7 205.
- **Reprise prouvée** : ligne `[campagne] 0e5ca25b-… reprise (marchand 4e3871ed-…)` du
  nouveau serveur, colonne `instance` posée (seule la reprise l'écrit), `maj_le` qui avance
  après le redémarrage, un appel `rpc/reprendre_campagnes`.
- Scans pendant (générateur, redémarrage compris) : **1 761 / 1 761 en 200**, méd. 455, p95
  1 114, **p99 1 669, max 2 616 ms**. Clic 139 ms. Requêtes base max 1,09 s (pas de file).
  `/v1` : 0 erreur, p99 1 s. Boucle max 71 ms, mémoire 234 Mo.
- Même campagne SANS plafond à l'étape 15 (avant t37) : 68 scans coupés sur 82, max 150 s,
  boucle bloquée 37 s, 3,1 Go, 35 % d'échecs Apple.
- **Doublons Google : 0** (7 205 envois, 7 205 cartes).
- **Apple : 16 230 envois pour 12 622 jetons distincts. Ce n'est PAS un doublon de reprise.**
  Un iPhone a UN jeton de push pour toutes ses cartes ; au profil du test, des appareils
  portent plusieurs cartes du réseau, donc plusieurs lignes `device_tokens`. La campagne
  envoie un push par ligne, comme avant t37 (`notifications.js:81` d'origine). La requête
  de doublons devait compter les couples (jeton, carte) : à relancer (ci-dessous).
- **Piste nouvelle (non codée)** : un seul push par appareil et par campagne (même jeton) :
  ici 12 622 au lieu de 16 230, soit ≈ − 22 % de pushes et de retours d'iPhone (un iPhone
  réveillé revérifie de toute façon toutes ses cartes). Gain nul au profil de la production
  (≈ 1 carte par appareil), réel pour un réseau dont les clients ont plusieurs cartes.
- Seuils : tenus sauf **caisse p99 ≤ 1 s et max ≤ 2 s** (1,67 et 2,62 s), comme en D : charge
  de la base, pas de file. Les essais C' et D' (débit 30 / 10 s) le diront.

**Essai C' (11/10, 10:02 UTC) : palier 615, débit 30 / 10 s (`CAMPAGNE_IPHONE_PAR_LOT=30`).**
604 pushes Apple, 332 messages Google. Clic 218 ms (202). Scans pendant : **121 / 121 en 200,
méd. 301, p95 500, p99 617, max 779 ms** : **tous les seuils tenus** (C à 50 / 10 s : p99
1 344 ms). Requêtes base : méd. la plus haute 98 ms, max 387 ms (C : 163 / 684 ms). `/v1` : 0
erreur, p99 370 ms. Boucle max 56 ms, mémoire 218 Mo. Réserve : la base de test était aussi
plus rapide au calme ce matin-là (scan de contrôle méd. 351 ms) : une part de l'écart peut
venir de l'heure. D' (palier 5000) dira si l'effet tient sur la durée.

**Essai D' (11/10, 10:35 → 11:01 UTC) : palier 5000, débit 30 / 10 s.** 4 663 pushes Apple
en 1 528 s (≈ 3 / s, le débit réglé), 2 657 messages Google. Clic 214 ms. Scans pendant :
**822 / 822 en 200, méd. 318, p95 580, p99 1 124, max 1 947 ms**. Requêtes base : méd. la plus
haute 118 ms, max 939 ms, p95 ≈ 170 ms (D à 50 / 10 s : ≈ 310 ms). `/v1` : 0 erreur, p99
382 ms. Boucle max 81 ms, mémoire 242 Mo.

| | D (50 / 10 s) | D' (30 / 10 s) | seuil |
|---|---|---|---|
| caisse p99 | 1 457 ms | **1 124 ms** | ≤ 1 s |
| caisse max | 2 428 ms | **1 947 ms** | ≤ 2 s |
| erreurs | 0 / 462 | 0 / 822 | 0 |
| durée pour ≈ 4 500 iPhone | ≈ 15 min | ≈ 26 min | — |

**Lecture.** À 30 / 10 s, le max tient sur 25 min de campagne, le p99 dépasse d'≈ 0,1 s (le
calme est à 0,56 s). À 50 / 10 s, p99 et max sont dépassés. Au profil de la production (≈ 1
carte par appareil, ≈ 2 requêtes base par iPhone au lieu de 4,6), la charge réelle serait
≈ moitié (HYPOTHÈSE non mesurée). **Proposition** : débit de production 30 / 10 s
(`CAMPAGNE_IPHONE_PAR_LOT=30`, variable Railway, sans code), seuil de caisse pendant
campagne p99 ≤ 1,2 s et max ≤ 2 s. À décider par Yass.


## 15 duotricies. t37 : DÉCISIONS DE CLÔTURE (11/10) ET RÈGLE « UNE SEULE INSTANCE »

**Décisions de Yass (11/10), sur la synthèse de la série « après »** :
1. **Débit : 30 iPhone / 10 s, valeur par défaut DANS LE CODE** (`debit.js`, `campagnes.js` ;
   50 avant). `CAMPAGNE_IPHONE_PAR_LOT` reste possible pour ajuster. `npm test` 205/205.
2. **Seuil de caisse pendant une campagne : p99 ≤ 1,2 s, max ≤ 2 s** (validé ; tenu à
   30 / 10 s en C' et D').
3. **t37 part en production** (gestes sur feu vert ; migration 054 d'abord).
4. Parking : « un push par appareil et par campagne » ; b2, b3, b4, d1 / étape 23.
5. Environnement de test gardé jusqu'au 31/10 : variable de débit retirée, serveur et
   imitateur arrêtés, pilote sur `attente`.
6. Requête « couples » de l'essai E : à terminer, ne bloque pas la mise en production.

**RÈGLE (contrat) : le serveur de production tourne en UNE SEULE instance Railway.** Le débit
partagé (`debit.js`) et la file des iPhone (`fileAppleWallet.js`) sont en mémoire : deux
instances doubleraient le débit et la file, sans que rien ne le signale. La reprise des
campagnes, elle, resterait sûre (prise atomique en base). Toute mise à l'échelle horizontale
exige d'abord de déplacer débit et file hors de la mémoire.

**MISE EN PRODUCTION (11/10)** : migration 054 exécutée sur la base de PRODUCTION par Yass
(vérification 5 × true), PUIS push en avance rapide `a3fadde..f49b44b` sur
`claude/keen-goldberg-MXslu`. **Contrôles en production OK (Yass)** : déploiement vert,
journal de démarrage, scan test et annulation, petite campagne sur le marchand de test (clic
immédiat « Campagne en cours d'envoi. », historique « En cours d'envoi » puis « Envoyée »,
iPhone de Yass mis à jour), scan pendant la campagne sans erreur. **t37 est en production.**
Requête « couples » de l'essai E (Yass, 11/10) : **envois = couples**, aucun push Apple en
double malgré le redémarrage au milieu de la campagne. Environnement de test : variable de
débit retirée, serveur et imitateur arrêtés, pilote sur `attente` ; gardé jusqu'au 31/10.
**t37 clos.**

## 15 tertricies. ÉTAPE 22 + CRON DE L'ÉTAPE 21 : DIAGNOSTIC ET PROPOSITION (11/10, rien codé)

Base : production `f49b44b`, `src/workers/cron.js`. Chiffres « avant » : mesures de
l'étape 15 (§15 G : 57 min au palier 50 000, requête base ≈ 107 ms, 2 849 relances
d'inactifs prévues dont 1 105 vers des actifs).

### 1. Comment chaque smart notification choisit ses destinataires

Le cron n'en a que trois (un seul passage à 08:00 UTC, `cron.js:25`). La demande d'avis
(`services/avis.js`) n'est pas du cron : minuteur de 30 min après une récompense, déjà
dédoublonné en mémoire. Elle est hors du périmètre. « Boost » n'existe pas dans le code :
le workflow le plus proche est `near_reward`.

| Workflow | Sélection aujourd'hui | Où ça casse |
|---|---|---|
| **inactive** `cron.js:68-124` | 3 lectures par marchand : scans depuis N jours (`:91`), tous les clients (`:92`), relances des 7 derniers jours (`:93`). Le tri se fait en JS (`:97-99`). | (a) Les 3 listes sont **coupées à 1 000** : des clients actifs sont relancés dès ≈ 33 scans par jour ; les clients après le 1 000ᵉ ne sont jamais évalués ; le dédoublonnage coupé produit des relances en double. (b) **Scans annulés comptés** comme visites (`:91`, pas de `annule_le IS NULL`). (c) **Nouveaux clients relancés** : un inscrit sans scan est « inactif » dès le lendemain (aucun critère sur `created_at`). (d) **Relance chaque semaine sans fin** : dédoublonnage de 7 j contre une absence de 30 j. Un absent reçoit environ 4 relances par mois. **Sur iPhone, ces relances 2, 3, 4 ne s'affichent pas** : le texte de `notification_message` est identique (aucun scan entre-temps), donc iOS ne voit aucun changement (même mécanisme que B3, `avis.js:129-133`). Le registre les compte pourtant « ok ». |
| **near_reward** `cron.js:129-189` | Clients avec `stored_value` dans [max − seuil, max[, plus les relances des 7 derniers jours. | Les deux listes sont coupées à 1 000 (895 envois d'un coup mesurés). Même relance hebdomadaire muette sur iPhone tant que le solde ne bouge pas. |
| **birthday** `cron.js:201-267` | **Tous** les clients ayant une date de naissance, puis tri `MM-JJ` en JS. | Liste coupée à 1 000 : au-delà de 1 000 dates connues, des anniversaires manqués **au hasard** (aucun ordre). |

Défauts communs :
- **3 requêtes en série par client** : mise à jour de la carte (`:276`), lecture des
  jetons (`:283`), écriture du dédoublonnage (`:106/173/256`). C'est l'essentiel des
  57 min.
- **Google appelé pour tous les clients** (`:296-300`), y compris ceux qui n'ont pas de
  carte Google. Cela donne un appel inutile, un 404 et une fausse erreur dans le
  registre. C'est le même défaut que celui corrigé dans les campagnes par t37.
- **Dédoublonnage écrit APRÈS l'envoi**, erreur seulement journalisée : si l'écriture
  échoue, la relance repart le lendemain (doublon).
- **Aucun verrou** : `POST /api/admin/workflows/trigger` (`routes/workflows.js:60-66`)
  pendant le passage de 08:00 lit le même dédoublonnage vide, ce qui donne des doublons.
- **Erreur de la lecture des marchands non lue** (`:80/141/214`) : une base en panne
  donne « 0 marchand » et un passage « ok » dans `cron_passages`.
- **Aucune règle entre types** : un même client peut recevoir inactive + near_reward +
  birthday le même jour (aujourd'hui déjà, dans un seul passage). Sur iPhone, seul le
  dernier texte reste dans la carte.

### 2. Proposition : sélection juste DANS LA BASE

Une migration (055), une fonction `reserver_relances(p_marchand_id, p_type, p_lot,
p_params jsonb, p_limite int)`. En UNE transaction :
1. Un verrou consultatif par (marchand, type) (`pg_advisory_xact_lock`) : deux appels
   simultanés (cron + bouton admin) passent l'un après l'autre et le second voit les
   réservations du premier.
2. La sélection, sans plafond de lecture (tout se passe dans la base) :
   - **inactive** : client non effacé, avec carte, dont la **dernière activité** est plus
     ancienne que N jours. La dernière activité est le dernier scan NON annulé
     (`annule_le IS NULL`), ou l'inscription s'il n'a jamais scanné. Anti-jointure sur
     les scans du marchand depuis N jours (index existant `idx_scans_marchand_date`).
   - **near_reward** : même filtre de solde qu'aujourd'hui.
   - **birthday** : `to_char(date_anniversaire, 'MM-DD')` = jour UTC.
   - Dans les trois cas : dédoublonnage du type (7 j ; année pour birthday). On exclut
     aussi les clients **sans aucun canal** (ni jeton Apple, ni carte Google).
   - Plus la règle « une smart notification par client et par jour » (point 6).
3. `INSERT` dans `workflow_executions` des élus (avec `lot`) **AVANT l'envoi** : un
   crash ou un redéploiement perd au pire ce lot (perte silencieuse, jamais de doublon).
   C'est la règle « curseur avant envoi » de Google dans t37.
4. Retour : `client_id, prenom, serial, stored_value, google (bool), jetons text[]` (les
   push tokens de `device_tokens`), au plus `p_limite` lignes (500 < plafond de 1 000
   de l'API).

Pas de curseur : les élus étant inscrits, l'appel suivant tombe sur les suivants. On
boucle jusqu'à une page vide ou jusqu'au **plafond par marchand et par passage**.

**Plafond par épisode** (règle 8, §15 G « 22 ») : au plus **1 000 clients par marchand,
par type et par passage** (proposé ; à trancher). Le reste part au passage suivant,
puisqu'il reste éligible. Cela protège du premier passage après mise en production :
au palier 50 000, ≈ 20 000 inactifs d'un coup feraient ≈ 1 h 50 de pushes au débit
partagé.

**Index** : un seul nouvel index, `workflow_executions (marchand_id, executed_at)`.
- Il sert au dédoublonnage par type, à la règle « un par jour » et au futur rapport
  marchand.
- Taille : ≈ 10 à 15 Mo au palier 50 000 (≈ 3 300 lignes par jour × 90 j).
- L'ancien `idx_wf_exec_lookup` devient inutile. On le supprimera plus tard, après
  mesure. Rien d'autre : scans, clients et jetons ont déjà leurs index.

**Charge base de la sélection** : par page, ≈ 30 000 scans de 30 j relus par index plus
50 000 clients par index, chez le plus gros marchand. Estimation 50 à 300 ms
(**HYPOTHÈSE**, à mesurer), 2 à 3 pages par gros marchand et par jour, à 08:00.
Les caisses ne sont pas touchées : le scan ne change pas, et aucune requête régulière
n'est ajoutée.

### 3. Relances regroupées

Par page de 500 clients :
1. `rpc reserver_relances` : 1 requête (sélection, dédoublonnage, jetons).
2. `rpc poser_messages(p_serials text[], p_messages text[])` : 1 requête. Les textes
   restent construits en JS (i18n, `{prenom}`, `{nom}`, `{remaining}`), puis sont posés
   sur `passes.notification_message` en une seule écriture. Le déclencheur
   `trg_passes_updated_at` bouge `updated_at`, comme aujourd'hui.
3. Envois : Apple via le débit (point 4) ; Google seulement si le client a une carte
   Google, 5 en parallèle (comme les campagnes).
4. Registre : 1 insert pour toute la page (déjà groupé).

Requêtes base par client relancé : **3 → ≈ 0,006** (3 requêtes pour 500).
- Par jour au palier 50 000 (≈ 3 300 relances, HYPOTHÈSE §5) : ≈ 9 900 requêtes avant,
  ≈ 30 après.
- Stockage : inchangé par relance (une ligne `workflow_executions`, une par push dans le
  registre). Le volume total MONTE avec la sélection juste (plus de vrais inactifs),
  borné par le plafond.

### 4. Débit partagé (d2)

C'est déjà le cas depuis t37 : `debit.prendre()` passe avant chaque push Apple du cron
(`cron.js:289`). On le garde tel quel.

Conséquence à connaître : le débit (30 iPhone / 10 s = 3/s) devient **le** facteur de
durée du cron. Une campagne lancée à 08:00 partage ce débit et ralentit d'autant (ordre
d'arrivée).

Google reste hors débit : Google ne rappelle pas notre serveur. Les envois Google sont
bornés à 5 en parallèle.

### 5. Durée du cron, avant / après

**HYPOTHÈSES** :
- ≈ 40 % d'inactifs (palier 50 000 du banc : 20 138 / 50 000) ;
- relances inactifs ≈ inactifs / 7 par jour en régime établi (règle actuelle) ;
- near_reward ≈ 300 par jour à 50 000 ;
- ≈ 60 % de clients avec iPhone et ≈ 40 % avec Google ;
- 0,68 s par client aujourd'hui (57 min ÷ ≈ 5 000 envois mesurés) ;
- Google ≈ 0,2 s par appel.

| | 5 000 porteurs | 50 000 porteurs |
|---|---|---|
| Aujourd'hui (sélection fausse, coupée) | ≈ 4 à 6 min | **57 min mesurées** |
| Sélection juste SEULE, 3 requêtes par client | ≈ 4 min (330 relances par jour) ; premier jour ≈ 25 min | ≈ 37 min par jour ; **premier jour ≈ 4 h** (≈ 20 000 inactifs) |
| **Proposition** (SQL + groupé + débit + plafond 1 000) | **≈ 1 min** (≈ 200 iPhone ÷ 3/s ; base < 5 s) | **≈ 11 à 12 min** par jour (≈ 2 000 iPhone ÷ 3/s) ; premier jour borné par le plafond (≈ 6 min par gros marchand et par type) |

Avec la règle « une relance par absence » (point 8, décision) au lieu d'une par
semaine, les relances inactifs tombent à ≈ 1/4. Le cron passe alors à ≈ 4 min à
50 000.

Limite : `/health/cron` signale « pas_fini » à 60 min (`cron-passages.js:31`). Le
plafond par marchand garde le passage sous ce seuil jusqu'à ≈ 15 gros marchands. Au-delà,
il faudra un plafond global (noté, pas maintenant).

### 6. Un cron par type de smart notification (idée de Yass)

**Pour** :
- passages plus courts ;
- une panne de birthday n'empêche plus inactive (déjà vrai : chaque étape attrape son
  erreur) ;
- rapport et santé par type ;
- une heure adaptée à chaque message (anniversaire le matin, relance avant le déjeuner).

**Contre** : le risque « deux notifications le même jour » **existe déjà** dans le
passage unique (point 1). Séparer les heures ne le crée pas, il le rend seulement
visible. Autre coût : `cron_passages` et `/health/cron` supposent un seul passage à
08:00. Il faudrait une colonne `type`, une heure par type, et une santé par type
(migration + `cron-passages.js`).

**Recommandation** :
1. **Maintenant**, quel que soit le découpage : la règle **« au plus une smart
   notification par client et par jour (UTC) »**, dans la fonction SQL (anti-jointure
   sur `workflow_executions` depuis minuit, même index). Priorité par l'ordre de
   passage : birthday → near_reward → inactive. Coût nul en requêtes.
2. **Ensuite** (peut attendre) : un planificateur par type, dans le même worker (une
   table `type → heure`), une ligne `cron_passages` par type. Avec la règle 1, le
   découpage n'apporte aucun doublon.

Non couvert : une campagne manuelle le même jour qu'une relance. Les campagnes n'écrivent
pas par client. Le croiser demanderait une écriture par client et par campagne : non
proposé.

### 7. Ce qui doit rester enregistré (futur rapport marchand)

Gardé tel quel :
- `workflow_executions` : une ligne par client relancé, type, `executed_at`, purge à
  90 j ;
- `notification_envois` : une ligne par push, `source` = type, `lot` ;
- `cron_passages` : bilan global par type.

Ajouts proposés :
- **`workflow_executions.lot uuid`** (colonne nullable, migration 055). Elle relie
  chaque relance à ses lignes du registre, pour répondre à « relancé ET reçu par
  Apple ou Google ». Coût : 16 o par ligne.
- **Bilan par marchand** dans `cron_passages.bilan` (jsonb existant, aucune table) :
  `{ type: { total, par_marchand: { id: { eligibles, envoyes, reportes } } } }`.
  « reportés » (au-delà du plafond) n'existe qu'au moment du passage : sans ça, il est
  perdu. Taille : ≈ 100 o par marchand et par type, 1 ligne par jour.
- **Rien n'est perdu** du comportement actuel :
  - le dédoublonnage s'écrit avant l'envoi au lieu d'après ;
  - un client sans canal n'est plus inscrit. Il ne recevait rien de toute façon ; il
    reste compté dans « éligibles ».
- Limite : la purge à 90 j borne l'historique du rapport. À revoir avec l'écran du
  rapport, pas maintenant.

### 8. Plan de test

`npm test` (PostgreSQL + PostgREST locaux, **plafond de 1 000 comme Supabase**), une
section 18. Aucun besoin de l'environnement de test pour la justesse.

Cas à couvrir :
- plus de 1 000 scans récents : aucun actif relancé ;
- plus de 1 000 clients : tous évalués ;
- plus de 1 000 lignes de dédoublonnage : aucun doublon ;
- scan annulé : non compté ;
- nouvel inscrit : non relancé ;
- plafond par marchand : le reste part le lendemain ;
- règle « un par jour » entre types ;
- deux déclenchements simultanés (cron + bouton admin) : aucun doublon ;
- coupure entre réservation et envoi : aucun doublon ;
- Google seulement pour les cartes Google ;
- chaque push Apple passe par `debit.prendre()` ;
- registre écrit, `lot` renseigné ;
- bilan par marchand ;
- anniversaire au-delà de 1 000 dates ;
- contre-épreuve : les nouveaux tests échouent sur `f49b44b`.

Environnement de test (gardé jusqu'au 31/10), **optionnel, à demander avant** : un passage
du cron au palier 50 000 pour mesurer le « après » réel (57 min avant). Il demande 055 sur
la base de test. Hors 08:00-09:00 UTC.

### 9. Avant le premier marchand à ≈ 1 000 porteurs / ce qui peut attendre

**Avant** :
- sélection SQL et réservation avant envoi (points 2 et 3) ;
- annulations exclues ;
- nouveaux inscrits exclus ;
- Google filtré ;
- verrou ;
- erreur de la lecture des marchands lue ;
- plafond par marchand ;
- index `(marchand_id, executed_at)` ;
- règle « un par jour » ;
- colonne `lot` et bilan par marchand (ne rien perdre dès le premier jour).

**Peut attendre** :
- un planificateur par type ;
- plafond global du passage ;
- suppression de `idx_wf_exec_lookup` ;
- fuseau par marchand ;
- écran du rapport ;
- historique au-delà de 90 j.

**Décisions demandées au pilotage** :
1. relance inactive : une par absence (recommandé), ou une par semaine comme
   aujourd'hui (muette sur iPhone dès la 2ᵉ) ;
2. near_reward : même question ;
3. plafond par marchand, par type et par passage : 1 000 ?
4. nouveaux inscrits jamais scannés : relancés N jours après l'inscription (recommandé) ?
5. priorité du « un par jour » : birthday → near_reward → inactive ?

## 15 quatertricies. ÉTAPE 22 + CRON DE L'ÉTAPE 21 : CODÉ EN LOCAL (12/10, rien poussé)

**Décisions de Yass (12/10)** :
1. Inactifs : UNE relance par absence. Le client redevient éligible seulement après un
   nouveau scan suivi d'une nouvelle absence. Le délai reste celui de l'admin.
2. near_reward : une relance par palier ; de nouveau seulement quand le solde a bougé.
3. Plafond de 1 000 par marchand, par type et par passage ; le reste part le lendemain.
4. Clients jamais scannés exclus des inactifs (« au plus simple »).
5. Au plus une relance par client et par jour, dans l'ordre birthday → near_reward →
   inactive.

En parking : un cron par type, plafond global, fuseau par marchand, écran du rapport.

### Livré (local, non poussé)

- **`database/migration_055_relances_en_base.sql`** :
  - colonne `workflow_executions.lot` ;
  - index `idx_wf_exec_marchand_date (marchand_id, executed_at)` ;
  - fonction `reserver_relances(marchand, type, lot, modeles, limite, jours, min, max)`
    → jsonb `{ eligibles, clients: [{ client_id, serial, message, google, jetons }] }` ;
  - fonction `purger_workflow_executions(avant)`.
- **`reserver_relances`**, en une transaction :
  1. verrou consultatif par marchand (cron et bouton `/trigger` passent l'un après
     l'autre) ;
  2. sélection sans plafond de lecture, scans annulés exclus ;
  3. inscription dans `workflow_executions` AVANT l'envoi ;
  4. texte personnalisé posé sur `passes.notification_message` ;
  5. retour des jetons Apple et du drapeau « carte Google ».
- **Règles appliquées par la fonction** :
  - client sans aucun canal : non pris ;
  - « une par jour » : jour UTC, tous types ;
  - inactifs : dernier scan non annulé plus vieux que N jours, et aucune relance
    depuis ;
  - near_reward : aucune relance depuis `clients.updated_at` ;
  - birthday : une par année civile UTC.
- **`purger_workflow_executions`** : purge à 90 j, mais garde la dernière ligne de chaque
  (client, type). Sans elle, « une par absence » serait oubliée au bout de 90 j. Les
  lignes des clients effacés partent au même âge.
- **`src/workers/cron.js`** (réécrit autour de `relancerMarchand`) :
  - ordre des étapes birthday → near_reward → inactive → purge ;
  - pages de 500 clients, plafond de 1 000 ;
  - par page : 1 RPC, puis les envois, puis 1 insert du registre. Plus de requête par
    client (avant : 3) ;
  - Apple : `debit.prendre()` avant chaque push ;
  - Google : seulement si la carte existe, 5 à la fois ;
  - lecture des marchands en échec → l'étape lève, passage « erreurs » ;
  - un marchand en échec n'arrête pas les autres, mais marque l'étape en erreur ;
  - textes construits en JS (i18n), `{prenom}` remplacé en base. near_reward reçoit un
    texte par nombre de points restants (pluriel) ;
  - `purgeOldExecutions` exportée, `_pourTests` pour les envois.
- **`src/services/cron-passages.js`** : `details.par_marchand[type][marchand_id] =
  { eligibles, relances, reportes }` ou `{ erreur, relances }`.
- **`tests/scenarios.js`** :
  - section 18 : 17 contrôles. Les 15 cas du diagnostic, plus « une par palier » et la
    purge ;
  - deux contrôles de forme adaptés : le nombre de `creerLot(... { long: true })`, et le
    jeton du débit avant le push.

### Tests

- **`npm test` : 223/223 OK** (205 avant, 18 de plus en section 18).
- **Contre-épreuve** : mêmes tests sur `f49b44b` (code ET migrations d'alors) →
  **206/223**. Les 17 KO sont tous en section 18. Le contrôle « textes singulier et
  pluriel » passe aussi sur l'ancien code (non-régression voulue).
- **Ce que l'ancien code a montré dans la contre-épreuve** :
  - inactifs : 5 jamais-scannés et 5 sans canal relancés ;
  - scan récent annulé : non relancé, compté comme visite ;
  - plafond : 1 200 relancés d'un coup au lieu de 1 000 + 200 ;
  - deux déclenchements simultanés : 600 relances pour 300 clients ;
  - anniversaire + proche + inactif : 3 relances le même jour ;
  - lecture des marchands impossible : passage « ok ».

### Mesure (banc local, 4 cœurs, PostgreSQL 16)

Un marchand de 50 000 clients, 1,5 M scans (30 par client, plus lourd que la réalité).
Un appel `reserver_relances` (page de 500) prend :
- inactive : **≈ 1,9 à 2,4 s** (26 570 éligibles) ;
- near_reward : ≈ 0,1 s ;
- birthday : ≈ 0,06 s.

Le temps d'inactive vient de deux sondes par client sur `idx_scans_client` : « venu
depuis N jours » et « dernier scan ». Une variante qui lit les scans récents en un
bloc a été mesurée plus lente sur ce banc (2,8 à 3,1 s) : écartée.

**HYPOTHÈSE** : sur Supabase Micro, ×2 à ×3, soit ≈ 5 à 7 s par appel pour le plus gros
marchand, 1 à 2 appels par jour, à 08:00. C'est sous le délai de 30 s du client long.

Amélioration possible si la mesure réelle déçoit : un index partiel
`scans (client_id, date_scan) WHERE annule_le IS NULL`. **Non fait** : il ajoute une
écriture d'index à chaque scan de la caisse (règle : le scan ne change pas). À mesurer
avant d'y toucher.

Durée du cron : les estimations du §15 tertricies point 5 tiennent. Le débit partagé
(3 pushes Apple par seconde) reste le facteur principal.

### Hypothèses et limites

- **Coupure entre la réservation et l'envoi** (crash, redéploiement) : ces clients
  perdent leur relance (absence, palier ou anniversaire). Perte silencieuse, jamais de
  doublon.
- **« Le solde a bougé » = `clients.updated_at`** (déclencheur à chaque mise à jour de
  la fiche). Une correction du prénom compte aussi comme un mouvement : au pire une
  relance near_reward de plus.
- **Anniversaire au-delà de 1 000 le même jour chez un marchand** : le reste est perdu,
  le lendemain n'est plus le jour. Théorique : ≈ 140 par jour pour 50 000 porteurs.
- **Jour UTC** pour « une par jour » et l'anniversaire (fuseau par marchand : parking).
- **Premier passage après la mise en production** :
  - un absent qui n'a jamais été relancé, ou dont la relance a été purgée (plus de
    90 j), reçoit sa relance « de cette absence » ;
  - c'est au plus 1 000 par marchand et par jour : le plafond lisse la vague ;
  - near_reward : pas de vague. Les relances hebdomadaires récentes sont postérieures à
    `updated_at`.
- **Messages personnalisés** : `{nom}` et `{prenom}` sont désormais remplacés partout
  dans le texte (avant : la première occurrence). Un prénom vide donne une chaîne vide
  (avant : « null » ou « undefined »).
- **Lecture des marchands** : toujours plafonnée à 1 000 marchands (sans effet avant
  longtemps).
- **Bouton admin `/trigger`** : inactive et near_reward en parallèle, donc la priorité de
  « une par jour » n'y est pas garantie. Il n'y a pas de doublon (verrou).

### Correction du diagnostic (§15 tertricies)

`idx_wf_exec_lookup` n'est pas inutile : il sert les contrôles par client (« relance
depuis le dernier scan », palier, année, purge). Il est gardé.

### Mise en production (sur feu vert de Yass)

1. Exécuter `migration_055_relances_en_base.sql` dans Supabase PRODUCTION, puis la
   requête de vérification en bas du fichier : 5 × true. L'ancien code reste compatible
   avec 055 : colonne nullable, fonctions non appelées.
2. Dire « 055 PROD OK ».
3. Sur feu vert : push en avance rapide sur `claude/keen-goldberg-MXslu` (code, plus les
   commits de passation en attente).
4. Contrôles après le passage de 08:00 UTC :
   - `/health/cron` ok ;
   - dernière ligne de `cron_passages` : `details.par_marchand` présent ;
   - `workflow_executions` du jour avec `lot` renseigné ;
   - aucun client avec deux lignes le même jour.

Environnement de test : non nécessaire (justesse prouvée par `npm test`, base locale
coupée à 1 000 comme Supabase).

**Complément du 12/10 (question du pilotage).**
- **Client long :** la sélection passe déjà par le client long de 30 s (`cron.js:3`,
  `clientLong`), comme la purge.
- **Test ajouté :** `reserver_relances` est retenue 6,5 s par un relais et le passage
  aboutit (3 relances, aucune erreur). Total : **224/224**.
- **Contre-épreuve :** avec le client court de 5 s, ce test échoue (« délai de 5000 ms
  dépassé », 0 relance), soit 223/224.
- **Limite :** sur Supabase, une requête coupée côté serveur continue dans la base. Une
  réservation qui aboutit après la coupure fait perdre sa relance au client, sans
  doublon. Le client long rend ce cas improbable (5 à 7 s estimés pour 30 s permis).
- **Décisions hors pilotage validées par le pilotage le 12/10 :** date de modification
  pour near_reward, perte plutôt que doublon, plafond de 1 000 aussi pour les
  anniversaires, vague du premier passage.
- **Demande du pilotage :** après le premier passage de 08:00 UTC en production, montrer
  le bilan par marchand (éligibles, relancés, reportés). C'est la taille réelle de la
  vague.

## 15 quinquatricies. ÉTAPE 20 (NODE, EXPRESS, DÉPENDANCES) : DIAGNOSTIC (13/10, rien codé)

Demande du pilotage : avis sur la coupure 20a (Node 24 à jour) / 20b (Express 5), versions,
ampleur, dépendances en retard. Faits relevés le 13/10 (registre npm, nodejs.org,
`npm audit --omit=dev`, Docker Hub).

### Node

- Production : `node:24.10.0-trixie` épinglé par empreinte (`Dockerfile:15`). Le même
  `24.10.0` figure dans `package.json` (`engines`) et dans `.nvmrc`.
- Publications de sécurité de la branche 24 depuis 24.10.0 : **24.13.0 (12/01),
  24.14.1 (24/03), 24.17.0 (17/06), 24.18.1 (28/07)**. Il y en a quatre, pas deux.
- Dernière version de la branche : **24.21.0** (07/09/2026, LTS « Krypton »). Image
  `node:24.21.0-trixie`, empreinte
  `sha256:1278a37eb510ec1606fba0e80f554bcc941ae0b44f35ae373c4822ae7717c64d` (relevée le
  13/10).
- La nouvelle image renouvelle aussi les paquets Debian. On y trouve **openssl**, qui
  signe les cartes Apple (`apple-pass.js`, `execFile('openssl')`) : c'est le seul vrai
  risque fonctionnel de 20a.
- **Trou du filet découvert** : `npm test` tourne sous le Node de la machine (22.22.0
  ici), pas sous celui de la production. Le filet n'a jamais prouvé le comportement sous
  Node 24.

### npm audit (dépendances de production, 13/10) : 11 alertes

| Paquet | Gravité | Nous touche ? | Correctif |
|---|---|---|---|
| proxy-addr ≤ 2.0.7 (via express) | critique | **non** en pratique : la faille vise un `trust proxy` par sous-réseau ; nous comptons les relais (`trust proxy` 2, `index.js:30`) | 2.0.8, sans changement de version majeure |
| qs ≤ 6.15.3, body-parser ≤ 1.20.6 (via express) | moyenne | **oui** : tout client, sans connexion, envoie une chaîne de requête lue par qs (Express 4) ; risque de saturation de mémoire | express 4.22.3, body-parser 1.20.8, sans changement majeur |
| @opentelemetry/* (via @sentry/node) | moyenne | un peu : en-tête `baggage` entrant, borné par la limite d'en-têtes de Node (16 Ko) | sans changement majeur |
| morgan ≤ 1.12.0 | moyenne | journaux falsifiables (User-Agent) ; aucun effet sur le service | 1.12.1 |
| sharp ≤ 0.35.5-rc.1 (libvips, libheif, librsvg) | **haute** | limité : sharp ne lit que des images téléversées par l'ADMIN (`admin.js:718+`) et les images du stockage (`strip-generator.js`) | **0.35.5, version majeure** (0.33 → 0.35) |
| node-cron (via uuid), uuid < 11.1.1 | moyenne | **non** : la faille vise uuid v3/v5/v6 avec tampon ; nous n'utilisons que v4 (`clients.js:3`) | majeures, inutiles maintenant |

Hors audit :
- **multer 1.4.5-lts.2** est déprécié (« 1.x impacted by a number of vulnerabilities,
  patched in 2.x »). Un seul usage, l'envoi d'images par l'ADMIN (`admin.js:719-735`,
  `:842`), derrière `authAdmin`. Il faut un jeton admin pour l'atteindre. 2.x garde la
  même interface.
- Express 4 : 4.22.3 est sortie le 14/09/2026. Plus rien n'est prévu après la fin de
  maintenance du 01/10/2026.

### Express 5 dans notre code (inventaire)

| Point | Où | Changement |
|---|---|---|
| `router.get('*')` refusé (path-to-regexp 8) : le serveur ne démarre plus | `routes/scanner.js:26`, `routes/dashboard.js:24`, `routes/admin-ui.js:24` | `'/{*chemin}'` |
| expressions régulières dans les chemins refusées | `routes/clients.js:188`, `:256`, `:323` (`:id([0-9a-f\-]{36})`) | `:id` simple, plus un contrôle d'UUID dans la route : 404 pour un id malformé, comme aujourd'hui. L'ordre des routes ne change rien (`/export` est déclarée avant, `/admin/all` a deux segments). |
| `req.body` vaut `undefined` sans corps JSON (avant : `{}`) | 10 déstructurations sans repli, dont **`scan.js:22`** ; aussi `apple-wallet.js:38`, `notifications.js:59`, `merchants.js:11`, `clients.js:16`/`:258`, `admin.js:12`/`:176`/`:365`, `scanner-auth.js:19` ; plus 10 accès `req.body.x` directs | une ligne après `express.json` (`index.js:44`) : `req.body ??= {}`. Sinon, un appel sans corps donne 500 au lieu de 400. |
| analyseur de requête « simple » par défaut (avant : qs « étendu ») | toutes les routes | `app.set('query parser', 'extended')` pour garder le comportement, ou vérifier qu'aucune route ne lit `a[b]=` (aucune trouvée) |
| erreurs des fonctions `async` transmises d'office | 14 fichiers avec `asyncHandler` | rien à faire : `asyncHandler` reste valable |
| `res.status(n).send()`, `res.redirect(301, …)`, `express.static`, gestionnaire d'erreurs à 4 arguments (`index.js:214`) | — | compatibles |
| express-rate-limit 7.5.1, helmet 7.2.0, cors, Sentry | — | compatibles avec Express 5 ; **ne pas** monter express-rate-limit en 8 dans le même chantier (clés IPv6 changées) |

**Taille** : ≈ 20 à 40 lignes changées dans 6 fichiers, plus le fichier de verrouillage.
Compter ≈ ½ à 1 journée avec les tests à ajouter : appel sans corps → 400 au scan et
à la connexion ; id malformé → 404 ; routes d'écran (`/scanner/x`, `/dashboard/x`)
servies. Le filet (224) couvre déjà presque toutes les routes : un oubli se voit au
démarrage ou au premier test.

### Avis sur la recommandation du pilotage

- **Coupure 20a / 20b : d'accord.** Un ajout à 20a : y mettre aussi la **mise à jour
  sans changement majeur du fichier de verrouillage** (`npm audit fix` sans `--force`).
  Elle corrige qs et body-parser (seule faille joignable sans connexion), proxy-addr,
  morgan et OpenTelemetry. `package.json` ne change pas (les plages `^` l'autorisent),
  c'est du même ordre de risque que Node, et les mêmes contrôles servent.
- **20b** : Express 5, **multer 2** et **sharp 0.35**. Ce sont les trois montées de
  version majeure, chacune testée. Après 26 : d'accord, mais pas loin derrière. Le jour
  où Express 4 aura une faille, il n'y aura plus de correctif. sharp et multer ne sont
  joignables que par l'admin : ils peuvent attendre 20b.
- **Reste de t17 avant l'API (28)** : d'accord. Désinscrire un appareil suppose de
  connaître son identifiant d'appareil Apple (aléatoire), et le logo Google doit sortir
  avant de rendre le dépôt privé.
- **27 en fin de liste** : d'accord.

### Plan proposé pour 20a (sur feu vert)

**Fichiers à toucher :**
- `Dockerfile:15` : tag `24.21.0-trixie` et nouvelle empreinte, commentaire mis à jour ;
- `package.json` : `engines` à `24.21.0` ;
- `.nvmrc` : `24.21.0` ;
- `package-lock.json` : `npm audit fix` sans `--force` ;
- `tests/lancer.js` : le filet vérifie sous quel Node il tourne et le dit, et il doit
  passer sous 24.21.0.

**Ce qui change pour nous :** rien de visible. Ce sont des versions de maintenance de la
même branche 24 : fetch (undici), serveur http, OpenSSL interne de Node (jetons des
sessions).

**Risques :**
1. **Signature des cartes Apple** (openssl du système renouvelé dans l'image) : le filet
   local ne la couvre pas (pas de certificats Apple). Il faut une carte iPhone réelle
   après le déploiement.
2. Le délai par appel à la base (fetch, `AbortSignal`) et l'arrêt propre
   (`closeIdleConnections`) dépendent de Node : ils sont couverts par le filet, **à
   condition** de le jouer sous 24.21.0.
3. `npm ci` avec le npm de l'image (11.x) : même format de verrouillage.

**Tests :**
- `npm test` sous Node **24.21.0** (binaire officiel téléchargé dans le cache du filet) :
  224/224 attendu ;
- contre-épreuve sous 24.10.0 ;
- construction locale de l'image (Docker est présent sur la machine de session) :
  `node --version` et `openssl version` dans l'image.

**Environnement de test** : utile seulement pour la carte Apple signée par le serveur
avant la production. Il existe jusqu'au 31/10. Sans lui, contrôle immédiat en
production, et retour arrière en une minute (« Redeploy » du déploiement précédent).
**Je recommande la production directe** avec ce contrôle : le changement est
réversible et l'environnement de test n'apporte que la carte Apple, vérifiable tout de
suite en production.

**Contrôles après le déploiement :**
- `/health` affiche `"node":"v24.21.0"` (`index.js:142`) ;
- `/health/db` ;
- scan puis annulation ;
- ajout d'une carte iPhone et réception d'une mise à jour ;
- carte Google.

### Autres points relevés (e)

1. **Le filet ne tourne pas sous le Node de la production** : à corriger dans 20a (ci-dessus).
2. **Routine d'entretien, sans requête** : une fois par mois, `npm audit --omit=dev` et
   la liste des publications de sécurité de Node 24 (nodejs.org), notés dans la
   passation. Sans cela, on retrouvera le même retard de 12 mois.
3. Rien de plus urgent que 20a : la seule faille joignable sans connexion (qs et
   body-parser) est dans 20a.

## 15 sextricies. ÉTAPE 20a (NODE 24.21.0) : CODÉE EN LOCAL (13/10, rien poussé)

**Décisions du pilotage (13/10)** :
1. 20a validée : Node 24.21.0, `npm audit fix` sans `--force`, le filet sous le Node de
   la production. Pas d'environnement de test : production directe, retour arrière
   prêt.
2. 20b (Express 5, multer 2, sharp 0.35) juste APRÈS l'étape 26. express-rate-limit
   reste en 7.
3. Reste de t17 avant l'étape 28 ; étape 27 en fin de liste.
4. **Routine mensuelle validée**, sans aucune requête au serveur :
   - `npm audit --omit=dev` ;
   - la liste des publications de sécurité de Node 24 (nodejs.org/dist/index.json,
     champ `security`) ;
   - le résultat noté dans la passation (date, alertes, décision).

### Livré (commit local `fb4b4e8`)

- `Dockerfile` : `node:24.21.0-trixie@sha256:1278a37eb510ec1606fba0e80f554bcc941ae0b44f35ae373c4822ae7717c64d`
  (avant : `24.10.0`, `sha256:79784277…`). Commentaire mis à jour (openssl 3.5.7).
- `package.json` : `engines.node` à `24.21.0`. **Aucune autre ligne changée.**
- `.nvmrc` : `24.21.0`.
- `package-lock.json` (`npm audit fix` sans `--force`, npm 11.19.0) :
  - express 4.22.2 → 4.22.3 ;
  - body-parser 1.20.5 → 1.20.8 ;
  - qs 6.15.2 → 6.16.0 ;
  - proxy-addr 2.0.7 → 2.0.8 ;
  - morgan 1.11.0 → 1.12.1 ;
  - @opentelemetry/core, resources, sdk-trace-base 2.7.1 → 2.12.0, plus sdk-trace
    2.12.0 (nouveau, via Sentry) ;
  - side-channel 1.1.1, brace-expansion 5.0.12.
- `tests/lancer.js` : le filet refuse de tourner (code 2) si :
  - Dockerfile, `engines` et `.nvmrc` ne disent pas la même version ;
  - Node n'est pas exactement celui-là.

  Le message dit quelle version prendre. Chargé par `require()` (banc de charge), le
  fichier ne vérifie rien.

### Preuves

- Avant 20a, sous **24.10.0** (Node de la production d'alors) : **224/224**.
- Après 20a, sous **24.21.0** : **224/224** (« Node v24.21.0 (celui de la production) »).
- Après 20a, le filet sous 22.22.0 et sous 24.10.0 : **refusé**, code 2.
- `engines` faussé à 24.20.0 : refusé (« versions de Node différentes »).
- `npm audit --omit=dev` après : 3 alertes (avant : 11) :
  - **sharp** (haute) : 20b ;
  - **node-cron** et **uuid** (moyennes) : la faille vise uuid v3/v5/v6, et nous
    n'utilisons que v4.

  Plus de critique. qs et body-parser, la seule faille joignable sans connexion, sont
  corrigés.
- **Image construite en local** (Docker 29.8.2) depuis la même empreinte :
  - `node v24.21.0`, `npm 11.19.0`, `OpenSSL 3.5.7 9 Jun 2026` ;
  - sharp fonctionne (libvips 8.15.3), resvg fonctionne ;
  - **signature des cartes** : la commande d'`apple-pass.js` (smime -sign -binary
    -md sha256 -outform DER) avec des certificats de TEST donne une signature vérifiée
    (« CMS Verification successful », sha256) ;
  - le serveur démarre dans l'image (« Workflows planifiés »), et `/health` répond
    `"node":"v24.21.0"`.
- Avertissement de npm 11.19 à `npm ci` : « sharp@0.33.5 install scripts not yet covered
  by allowScripts ». Sans effet, sharp fonctionne dans l'image (prouvé ci-dessus). À
  revoir avec sharp 0.35 (20b).
- Limite de la preuve locale : pour passer le proxy de la session, la construction a
  utilisé une COPIE du Dockerfile où `npm ci` reçoit le certificat du proxy en secret
  de construction. Le Dockerfile du dépôt est inchangé à cette ligne près, et Railway
  n'a pas de proxy.

### Hypothèses et limites

- La signature réelle (certificats Apple de production) ne se prouve que sur un vrai
  iPhone : contrôle obligatoire après le déploiement.
- Le retour arrière par Railway (« Redeploy » du déploiement précédent) remet l'ancienne
  image. Le prochain push la remplacerait de nouveau : en cas de retour arrière, un
  commit `git revert` est à pousser ensuite (sur feu vert).

### En production (13/10)

- Poussé à **06:40:56 UTC** en avance rapide sur `claude/keen-goldberg-MXslu`
  (`925cb16` → `3d2f687`). Fenêtre fixée par le pilotage : push et contrôles avant
  07:30 UTC, sinon retour arrière avant le cron de 08:00.
- Contrôles de Yass, tous bons :
  - déploiement vert ;
  - `/health` affiche `v24.21.0` ;
  - `/health/db` affiche `{"status":"ok"}`, soit 200 (le code ne s'affiche pas sur la
    page ; les erreurs répondent 503 `"status":"error"`) ;
  - scan puis annulation ;
  - carte iPhone ajoutée, puis mise à jour sur un vrai iPhone (signature par
    openssl 3.5.7 prouvée).
- **Carte Google non vérifiée sur un téléphone** (pas d'Android). Contrôle de
  remplacement proposé : aucune erreur Google dans les journaux Railway depuis le
  déploiement (l'inscription crée l'objet Google, le scan le met à jour), ou carte
  ouverte dans wallet.google.com depuis un ordinateur.
- Retour arrière préparé et NON poussé : commit `9c532de` (revert de `fb4b4e8`) sur la
  branche locale `retour-20a`. Il est sans objet si rien ne casse.

### Premier passage du cron de l'étape 22 (13/10, 08:00 UTC, sous Node 24.21.0)

- `/health/cron` ok.
- **Vague réelle : 55 relances, toutes « inactive »** :
  - Dinapoli 35, Boucherie République 11, Hilal Kebab 4, Pizz'Amore 4, Wam N Fade 1 ;
  - 0 chez les 12 autres marchands ;
  - 0 reporté, 0 erreur.
- Anniversaires : 0 (3 marchands). **near_reward : 0 chez les 13 marchands.**
- Contrôle : 55 relances du jour, 55 avec `lot`, **0 double relance**.
- **À vérifier (ouvert)** : near_reward à 0 partout est suspect. Deux hypothèses :
  1. bénigne : les clients de la zone ont tous été relancés après leur dernier scan ;
  2. défaut : le déclencheur `trg_clients_updated_at` est absent en production, donc
     `updated_at` est figé et un client déjà relancé ne l'est plus jamais.

  Trois requêtes en lecture seule ont été données à Yass (déclencheur, clients dans la
  zone, registre Google du jour). Le correctif, s'il le faut, est une migration qui crée
  le déclencheur, proposée avant tout code.
- **Tranché le 13/10 (requêtes de Yass) : bénin.**
  - `trg_clients_updated_at` est présent et actif en production (`O`).
  - 43 clients dans la zone chez 8 marchands, **0 éligible** : tous ont été relancés
    après leur dernière modification (au plus tard le 11/10, déjà relancés par l'ancien
    code).
  - « Une relance par palier » fonctionne. Rien à corriger.
- **Registre du jour** : inactive, Apple 60 envois `ok` (200) ; Google 55 envois `ok`
  (200). La chaîne Google fonctionne sous Node 24.21.0 : carte Google validée.
- **CORRECTION d'une affirmation de l'étape 22 (§15 quatertricies)** : « Google seulement
  pour les clients qui ont une carte Google » ne filtre **rien** en production.
  - Le filtre repose sur `passes.google_pass_url`, or ce lien est créé pour TOUTES les
    cartes (audit 05 §4.3). D'où 55 messages Google pour 55 relancés, iPhone compris.
  - Pas de régression : l'ancien code envoyait à tous.
  - Reste à faire à l'**étape 23** (« message Google envoyé aux cartes iPhone ») : savoir
    si le client a réellement enregistré sa carte Google (état de l'objet chez Google,
    ou retour de Google à l'enregistrement). Diagnostic à faire.
  - Coût aujourd'hui : des appels Google inutiles, qui comptent dans les limites de
    Google (3 messages par 24 h, 10 par objet).

## 15 septtricies. ÉTAPE 26 + APERÇU CALCULÉ EN BASE : DIAGNOSTIC ET PROPOSITION (13/10, rien codé)

Base : production `3d2f687`. Ce rapport reprend l'audit 05 (§3, §4.1 à 4.5), revérifié
sur le code d'aujourd'hui. Les mesures sont faites sur un banc local (PostgreSQL 16,
base jetable supprimée ensuite) avec deux marchands :
- 5 000 porteurs, 40 000 scans sur un an, dont 11 600 sur 30 jours ;
- 50 000 porteurs, 400 000 scans, dont 115 000 sur 30 jours (≈ 3 800 par jour, plus
  lourd que la réalité).

### 1. Chaque statistique aujourd'hui

**Aperçu** : `GET /api/merchants/me/stats`, trois lectures par l'API de données, calcul
en JS (`src/routes/merchants.js:67-92`), affichage `public/dashboard/index.html:1318-1325`.

| Chiffre | Calcul | Juste ? |
|---|---|---|
| Clients au total | comptage exact, clients non effacés (`merchants.js:71`) | oui |
| Scans aujourd'hui | comptage exact depuis **minuit UTC** (`:72`, `toISOString().split('T')[0]`) | jour UTC, pas le jour local (point 6) |
| Actifs 30 j | clients distincts d'une **liste** de scans (`:73`, `:76-77`) | **faux au-delà de 1 000 scans en 30 j** (≈ 33 par jour) : liste coupée, chiffre sous-estimé et instable |
| Taux de rétention | (clients avec ≥ 2 scans dans la liste) ÷ **toute la base** (`:79-83`) | **biaisé** (point 3), et coupé à 1 000 comme Actifs |
| Visites moyennes | scans de la liste ÷ actifs (`:84`) | coupé à 1 000 |
| En panne | les erreurs ne sont pas lues : « – » ou **0 / 0 % / 0x** (point 5) | faux |

**Onglet Réseau** : `GET /me/group-stats` → `group_stats` (migration 039), calcul en
base, sans plafond ; affichage `index.html:1218-1300`.

| Chiffre | Calcul | Juste ? |
|---|---|---|
| Porteurs, Actifs 30 j, mobilité (90 j) | comptages en base | oui (la fenêtre de 90 j de la mobilité n'est pas dite) |
| Nouveaux ce mois | inscrits depuis le 1er à 00:00 (fuseau de la base, UTC) | oui, en UTC |
| Taux de retour | actifs du mois (entamé) ∩ actifs du mois précédent (complet) ÷ actifs du mois | **juste** : c'est la part des clients de ce mois déjà venus le mois dernier, le mois précédent doit rester complet |
| **Barre de fréquence** (répartition des passages) | scans par porteur **depuis le 1er du mois** (`039:84-93`) | **biaisée** : en début de mois, tout le monde tombe dans la première tranche (audit 05 D1 : le 05/09, 45/0/0 au lieu de 0/60/0) |
| Par boutique : scans, clients, récompenses | depuis le 1er du mois | oui (mois entamé, affiché comme tel) |
| Par boutique : « vs mois préc. » | mois entamé ÷ mois précédent **complet** (`039:62-67`, `:108`) | **faux** : toute boutique stable paraît en baisse, en rouge (−85 % le 5 du mois) |
| Scans non attribués | depuis le 1er | oui |
| En panne | la route répond 500 avec `error.message` (`merchants.js:102`) ; l'écran lit le corps sans le statut (`index.html:1223-1225`) : **réseau vide affiché**, gardé en mémoire | faux |

### 2. Mois en cours contre les mêmes jours du mois précédent (décision de Yass)

Règle : fenêtre précédente = [1er du mois précédent, 1er du mois précédent + temps
écoulé depuis le 1er de ce mois), **bornée au 1er de ce mois**. Le 31 mars se compare
donc à tout février, pas au-delà.

**Où l'appliquer** :
- **« vs mois préc. » par boutique** (`group_stats`, `scans_prec`) : c'est le chiffre
  faux d'aujourd'hui ;
- **Nouveaux ce mois**, si une comparaison est affichée (« 147, contre 185 aux mêmes
  jours du mois dernier ») : proposé, à décider ;
- **pas au taux de retour** : il ne compare pas des volumes, il regarde si les clients
  de ce mois étaient là le mois dernier, qui doit rester complet ;
- **pas à la barre de fréquence** : ce n'est pas une comparaison. Proposition : la
  calculer sur **30 jours glissants** (audit 05 D1 : 0/60/0 juste tous les jours), avec
  le libellé « passages sur 30 jours ».

### 3. Rétention : les deux calculs (exemple chiffré pour Yass)

Marchand qui grandit : 100, 150, 200, 250, 300 et 350 inscrits par mois. La part des
clients revenus (≥ 2 passages en 30 jours) dépend de l'ancienneté :
- 15 % pour les inscrits du mois ;
- 45 % à un mois ;
- 40 % à deux mois ;
- 35 % à trois mois ;
- 32 % à quatre mois ;
- 30 % au-delà.

| Mois | Base | Inscrits depuis ≥ 30 j | Revenus | dont anciens | **(a) revenus ÷ toute la base** (aujourd'hui) | **(b) revenus anciens ÷ inscrits depuis ≥ 30 j** |
|---|---|---|---|---|---|---|
| M1 | 100 | 0 | 15 | 0 | 15 % | — (pas encore de recul) |
| M2 | 250 | 100 | 68 | 45 | 27 % | 45 % |
| M3 | 450 | 250 | 138 | 108 | 31 % | 43 % |
| M4 | 700 | 450 | 222 | 185 | 32 % | 41 % |
| M5 | 1 000 | 700 | 322 | 277 | 32 % | 40 % |
| M6 | 1 350 | 1 000 | 436 | 383 | 32 % | 38 % |

Lecture :
- **(a)** monte de 15 à 32 % : le marchand croit que sa fidélité progresse. C'est
  l'arrivée de nouveaux qui fait bouger le chiffre ; leur faible taux de début tire vers
  le bas, puis se dilue.
- **(b)** baisse de 45 à 38 % : c'est la vraie tendance de la clientèle installée (elle
  s'érode doucement).
- Pour un marchand qui ne grandit plus, (a) baisse sans fin : les partis ne quittent
  jamais le dénominateur (audit 05 §4.1).
- **(b)** n'affiche rien le premier mois (« pas encore de recul »).
- Mesuré au banc (5 000 / 50 000 porteurs, inscriptions étalées sur un an) : (a) 51 et
  49 %, (b) 46 et 45 %.

**À trancher par Yass** (le numérateur, « ≥ 2 passages en 30 jours », reste le même
dans les deux cas).

### 4. Aperçu calculé en base

**Proposition** : une fonction `apercu_stats(p_marchand_id)` en lecture seule, migration
056. Elle rend en UN jsonb, pour TOUT marchand (mono-boutique ou réseau) :
- porteurs ;
- scans aujourd'hui ;
- actifs 30 j ;
- visites moyennes ;
- rétention (a ou b) ;
- nouveaux du mois, et aux mêmes jours du mois précédent ;
- taux de retour ;
- répartition des passages sur 30 jours.

**Aucune donnée par boutique** (exclusion du Socle : pas de comparaison entre
boutiques).

`group_stats` garde sa signature et prend son bloc « réseau » **dans `apercu_stats`** :
les deux écrans affichent les mêmes chiffres par construction. Elle garde son tableau
par boutique (écran Réseau déjà décidé), avec la correction du point 2.

**Coût** :
- 1 appel RPC au lieu de 3 lectures à l'ouverture de l'Aperçu, à la demande
  uniquement ;
- aucune requête régulière, aucun index nouveau (`idx_scans_marchand_date`,
  `idx_clients_marchand` suffisent) ;
- rien ne change pour le scan.

| Prototype (banc local, 3 essais) | 5 000 porteurs | 50 000 porteurs |
|---|---|---|
| `apercu_stats` (toutes les mesures ci-dessus, fuseau compris) | **28 à 32 ms** | **112 à 163 ms** |
| `group_stats` actuel, pour comparaison | 42 ms | 340 ms |

Facteur production de ×1 à ×6 (calage de l'audit 05, HYPOTHÈSE) : au pire ≈ 1 s à
50 000. **Le client court (5 s) suffit** : marge ×5. Le client long garderait le
marchand devant un écran figé 30 s en cas de panne. Je ne le propose que si la mesure
réelle dépasse 2 s.

### 5. Une panne affichée comme une panne

**Serveur** :
- `/me/stats` (puis `apercu_stats`) et `/me/group-stats` lisent `error` ;
- base injoignable ou délai dépassé → **503 `database_unavailable` + Retry-After**,
  comme le scan (étape 16) ;
- plus de `error.message` brut dans la réponse (`merchants.js:102` aujourd'hui).

**Écran** :
- `loadOverview` et `loadReseau` regardent `res.ok` ;
- en cas d'échec : un message « Statistiques indisponibles pour le moment » avec un
  bouton Réessayer ;
- **rien n'est gardé en mémoire** (`S.stats` / `S.reseau` restent vides) : le retour
  sur l'onglet redemande ;
- jamais de 0 ni de « – » trompeur.

Coût : aucune requête de plus.

### 6. Fuseau

**Tout est compté en UTC** :
- « aujourd'hui » de l'Aperçu (`merchants.js:72`) ;
- mois de `group_stats` (`date_trunc('month', now())`, fuseau de la base, UTC chez
  Supabase) ;
- quota des campagnes (`notifications.js:10-12`, heure du serveur, UTC sur Railway) ;
- export (`clients.js:165`) ;
- cron (08:00 UTC) ;
- anniversaires (étape 22).

**Effets** :
- **Dubaï (UTC+4)** :
  - la journée « d'aujourd'hui » commence à **04:00** heure locale ;
  - un scan à 01:00 heure locale le 1er du mois compte dans le **mois précédent** ;
  - le quota de campagnes repart le 1er à 04:00 ;
  - « scans aujourd'hui » affiché à 02:00 locales montre encore la veille.
- **Lyon (UTC+1 en hiver, +2 en été)** : la journée commence à 01:00 ou 02:00 locales.
  Effet faible, sauf pour un commerce ouvert après minuit (scans de 00:00 à 02:00
  comptés la veille).

**Proposition (sans coder)** :
- colonne `marchands.fuseau` (nom IANA : `Europe/Paris`, `Asia/Dubai`), par défaut
  `Europe/Paris`, réglée dans l'admin ;
- `apercu_stats` et `group_stats` calculent leurs bornes avec
  `date_trunc(..., now() AT TIME ZONE fuseau) AT TIME ZONE fuseau` : prouvé au
  prototype, sans coût mesurable ;
- les index servent toujours, les bornes restant des constantes ;
- même colonne, plus tard, pour le quota, l'export et les heures du cron (parking
  « fuseau par marchand »).

**Décision demandée** :
- la liste des marchands de Dubaï, pour régler leur fuseau à la migration ;
- ou tout à `Europe/Paris`, avec réglage à la main.

### 7. Plan de test (`npm test` sous Node 24.21.0)

**Section 19 du filet** :
- **Actifs, visites et rétention justes au-delà de 1 000 scans en 30 jours** :
  1 200 clients, 2 scans chacun ;
- scans annulés exclus ;
- **rétention (a) et (b)** sur une base fabriquée : inscrits de 10 et de 60 jours ;
- **mêmes jours du mois précédent** : horloge figée par paramètre de test, et une
  boutique stable donne 0 % (audit 05 D1) ;
- passages sur 30 jours glissants ;
- **Aperçu et Réseau identiques** sur un réseau ;
- un mono-site sans boutique ;
- **panne** : relais en panne → 503 + Retry-After, et l'écran ne garde rien ;
- **fuseau** : un scan à 23:30 UTC compte « aujourd'hui » pour Dubaï le lendemain, pas
  pour Paris ;
- les droits : `apercu_stats` fermée à `anon` ;
- contre-épreuve sur `3d2f687`.

Environnement de test : **pas nécessaire** (lecture seule, coût mesuré au banc).

### 8. Avant le premier marchand à ≈ 1 000 porteurs / ce qui peut attendre

**Avant** :
- Aperçu en base (Actifs coupé à 1 000 scans) ;
- panne lue ;
- « vs mois préc. » à jours égaux ;
- répartition sur 30 jours ;
- la définition de la rétention choisie.

**Peut attendre** :
- fuseau par marchand (sauf si un marchand de Dubaï lit ses chiffres la nuit) ;
- comparaison des nouveaux ;
- graphique par jour.

**Décisions demandées** :
1. rétention (a) ou (b) ;
2. répartition sur 30 jours glissants ;
3. afficher « nouveaux » avec la comparaison aux mêmes jours ;
4. fuseau : liste de Dubaï, ou `Europe/Paris` par défaut ;
5. quels chiffres de `apercu_stats` montrer à un mono-site (aujourd'hui 5 cartes ; la
   fonction en donne 9).

## 15 octotricies. ÉTAPE 26 : CODÉE EN LOCAL (13/10, rien poussé)

**Décisions de Yass (13/10)** :
1. Rétention (b) : revenus ÷ inscrits depuis au moins 30 jours. Rien n'est affiché tant
   qu'il n'y a pas 30 jours de recul.
2. Barre de fréquence sur 30 jours glissants.
3. « vs mois préc. » par boutique et « nouveaux ce mois » comparés aux mêmes jours du
   mois précédent. Le taux de retour est inchangé.
4. Mono-boutique : les mêmes chiffres qu'un réseau, sans rien qui compare ou détaille
   des boutiques.
5. Fuseau : tout en UTC, sujet clos.
6. Panne : 503 + Retry-After ; à l'écran, « Statistiques indisponibles » + Réessayer ;
   rien gardé en mémoire.
7. Écran de connexion du dashboard : message lisible au lieu de `database_unavailable`.
   Le scanner n'est pas touché.

De plus : la vague des marchands activés le 13/10 est laissée telle quelle (décision de
Yass).

### Livré (commit local `06e5494`)

- **`database/migration_056_apercu_stats.sql`** :
  - `apercu_stats(p_marchand_id, p_maintenant DEFAULT now())`, lecture seule,
    `SET timezone = 'UTC'`, lectures bornées à `p_maintenant` (sans effet en
    production). Elle rend :
    - `porteurs`, `scans_aujourdhui`, `actifs_30j`, `visites_moyennes` ;
    - `retention` (b, NULL sans recul) ;
    - `nouveaux_ce_mois`, `nouveaux_mois_prec_memes_jours` ;
    - `taux_retour` (inchangé) ;
    - `distribution` (30 jours glissants).
  - `group_stats(uuid)`, même signature et mêmes clés qu'avant :
    - `reseau` et `distribution` sont tirés d'`apercu_stats`, et la clé `apercu`
      est ajoutée ;
    - `scans_prec` par boutique compte les mêmes jours du mois précédent.
  - `REVOKE` de `group_stats` à PUBLIC, anon, authenticated (hors pilotage, voir §17).
- **`src/routes/merchants.js`** :
  - `/me/stats` appelle `apercu_stats` (client court, 5 s) ;
  - `/me/stats` et `/me/group-stats` répondent 503 `database_unavailable` +
    `Retry-After: 30` en cas d'erreur (avant : `/me/group-stats` renvoyait 500 avec le
    message brut).
- **`public/dashboard/index.html`** :
  - `statsBlocHtml` : un seul bloc, pour l'Aperçu (tous les marchands) et pour l'onglet
    Réseau ;
  - `statsPanneHtml` : le message de panne et le bouton Réessayer ;
  - `loadOverview` et `loadReseau` regardent `res.ok`, et ne gardent rien en cas
    d'échec ;
  - connexion : 503 ou `database_unavailable` donnent « Service momentanément
    indisponible. Réessayez dans un instant. » ;
  - libellés de la répartition : « (30 jours) », « passages en 30 jours ».
- **Tests** :
  - `tests/scenarios.js`, section 19 : 13 contrôles ;
  - `tests/lancer.js` : `api()` rend aussi `retry` (en-tête Retry-After) ;
  - `tests/navigateur/apercu_ecrans.js` : 6 contrôles et 5 captures. Hors `npm test`,
    car il faut Playwright.

### Ce qui s'affiche (Aperçu, identique pour une mono-boutique et pour un réseau)

1. Clients au total.
2. Scans aujourd'hui.
3. Actifs (30 jours).
4. Visites moy. / client actif (30j).
5. Taux de rétention, avec la note « clients inscrits depuis 30 jours ou plus, revenus
   au moins 2 fois en 30 jours ». Sans recul : « – » et « disponible après 30 jours ».
6. Taux de retour, avec la note « clients du mois déjà venus le mois dernier ».
7. Nouveaux ce mois, avec la note « aux mêmes jours du mois préc. : N ».
8. Répartition des passages (30 jours), en 3 tranches selon les seuils du marchand.

Rien par boutique, pas de mobilité. L'onglet Réseau (réseaux seulement) affiche le même
bloc, puis la mobilité et le tableau par boutique (« vs mois préc. » aux mêmes jours).

### Preuves

- `npm test` sous Node 24.21.0 : **237/237** (224 + 13).
- Navigateur (Chromium, Playwright) : **6/6**, soit 243/243 avec le filet. Captures :
  1. Aperçu mono-boutique ;
  2. Aperçu d'un réseau ;
  3. onglet Réseau ;
  4. Aperçu en panne ;
  5. connexion, base indisponible.
- **Contre-épreuve** : nouveaux tests sur `3d2f687` (sans 056) → **225/237**, soit 12
  échecs, dont « boutique stable : −57 % » avec l'ancien calcul. Le contrôle « mono :
  rien par boutique » passe aussi sur l'ancien code (non-régression).
- Coût mesuré au prototype (§15 septtricies) : 28 à 32 ms à 5 000 porteurs, 112 à
  163 ms à 50 000 (banc local).

### Hypothèses et limites

- **Onglets restés ouverts pendant le déploiement** : l'ancien écran lit les anciennes
  clés de `/me/stats`. Il affiche donc « – » jusqu'au rechargement de la page (les
  clés ont changé ; aucun alias gardé).
- **Entre la migration et le push** : l'ancien écran Réseau reçoit déjà la répartition
  sur 30 jours et « vs mois préc. » aux mêmes jours, sous les anciens libellés
  (« mensuels »). Sans gravité, quelques minutes.
- « Actifs 30 j » compte, comme avant, les scans des clients effacés (RGPD). La
  rétention (b) ne compte que les clients non effacés.
- `p_maintenant` n'est passé que par les tests. Une valeur fausse ne peut venir que du
  serveur (service_role).

**Correction d'écran avant le push (pilotage, 13/10)** :
- **Carte « Taux de retour » retirée** de l'Aperçu et de l'onglet Réseau (bloc commun),
  car deux chiffres pour la même idée étaient confus. Le calcul reste dans
  `apercu_stats` et `group_stats` (clé `reseau.taux_retour_reseau`, que l'ancien écran
  lisait, et le test « taux de retour inchangé »). Migration 056 inchangée.
- **Note de la rétention** : « inscrits depuis plus de 30 jours, revenus au moins 2 fois
  sur les 30 derniers jours ». Le texte demandé disait « ce mois-ci » ; le calcul porte
  sur 30 jours glissants, la note dit donc ce que mesure le chiffre (choix signalé au
  pilotage).
- « Nouveaux ce mois » passe en demi-largeur, à côté de la rétention : la grille reste
  pleine.
- Aperçu : **6 cartes** et la répartition sur 30 jours.
- Tests : `npm test` **237/237**, navigateur **6/6** (243/243).

**Un passage = un JOUR avec scan (décision de Yass, 13/10)** :
- **La règle de l'audit 05 « une visite = un scan » est REMPLACÉE par « une visite = un
  jour avec au moins un scan non annulé ».**
- `apercu_stats` : `count(DISTINCT date_trunc('day', date_scan))`, en UTC, au lieu de
  `count(*)`. Cela s'applique à la répartition des passages et aux visites moyennes par
  client actif.
- Seuils de la barre : toujours réglables par marchand (5 / 10 par défaut).
- **Le crédit des points ne change pas** : chaque scan crédite toujours. Seules les
  statistiques changent. Les colonnes « Scans » de l'onglet Réseau comptent toujours
  des scans.
- **Hors pilotage, signalé** : la rétention (« revenus au moins 2 fois ») compte aussi
  des jours, car elle lit le même nombre de passages. Deux scans le même jour ne font
  pas un client « revenu ».
- Test ajouté : un client scanné 2 fois le même jour = 1 passage (visites moyennes 1,5
  au lieu de 2 ; non « revenu »).
- Totaux : `npm test` **238/238**, navigateur 6/6 (244/244). Contre-épreuve sur
  `3d2f687` : 225/238.

### En production (13/10)

- Migration 056 exécutée en production par Yass, vérification 4 × true.
- Poussé à **13:07:36 UTC** en avance rapide sur `claude/keen-goldberg-MXslu`
  (`3d2f687` → `53a27d3`, 10 commits).
- Contrôles de Yass, tous bons :
  - déploiement vert, `/health` v24.21.0, `/health/db` ok ;
  - Aperçu mono-boutique : 6 cartes et la répartition sur 30 jours ;
  - réseau : Aperçu et onglet Réseau identiques ;
  - scan puis annulation.
- **Étape 26 close.**

## 15 novemtricies. ÉTAPE 20b (EXPRESS 5, MULTER 2, SHARP 0.35) : PLAN (13/10, rien codé)

Diagnostic d'Express 5 : §15 quinquatricies, inventaire toujours valable sur `53a27d3`.
Complément relevé le 13/10 :

- **sharp** : 6 appels.
  - `strip-generator.js:797-801` : logo des tampons, `trim`, `resize`, `png`.
  - `strip-generator.js:831-833` : image statique en 3 tailles.
  - `admin.js:432-438` : contrôle de transparence du logo, `metadata`, `ensureAlpha`,
    `raw`.

  Des fonctions stables entre 0.33 et 0.35. Le risque est dans le rendu (libvips
  8.15 → 8.17) : pixels du bandeau, détourage du logo.
- **multer** : un seul usage, `admin.js:718-735` et `:842` (envoi d'images par l'admin,
  5 Mo, images seulement). En 2.x, la même interface.
- **Le filet ne couvre ni sharp ni l'envoi d'images** (0 test).

**Plan proposé** (en un chantier, sur feu vert) :
1. **Tests d'abord**, écrits et verts sur le code actuel avant tout changement :
   - rendu d'un bandeau (`strip-generator.render`) : un PNG aux bonnes dimensions pour
     les 3 tailles ;
   - **empreinte de référence des pixels** prise sous sharp 0.33 ;
   - contrôle de transparence ;
   - envoi d'image admin : une image passe, un non-image donne 400, plus de 5 Mo donne
     400, et un corps multipart mal formé donne 400 sans faire tomber le serveur.
2. Express 5 :
   - routes `'*'` → `'/{*chemin}'` (`scanner.js:26`, `dashboard.js:24`,
     `admin-ui.js:24`) ;
   - `:id` avec contrôle d'UUID dans la route (`clients.js:188`, `:256`, `:323`) ;
   - `req.body ??= {}` après `express.json` ;
   - `query parser` étendu ;
   - express-rate-limit reste en 7.
3. multer 2.x, puis sharp 0.35.x. Pour sharp, l'écart de pixels avec l'empreinte est
   mesuré et montré : identique, ou écart chiffré avec captures avant/après du bandeau.
4. `npm audit --omit=dev` après : il doit ne rester que node-cron et uuid (sans effet).
5. Image construite en local (Node, sharp et libvips dans l'image), contre-épreuve sur
   `53a27d3`, captures du bandeau.

Taille estimée : ≈ 1 jour avec les tests. Pas d'environnement de test.

## 15 quadragies. ÉTAPE 20b : CODÉE EN LOCAL (13/10, rien poussé)

Feu vert du pilotage pour coder 20b en local (13/10). Plan : §15 novemtricies.

### Livré

**Tests d'abord** (commit `e90f554`) : section 20 du filet, 12 contrôles, **verts sur
l'ancien code (250/250) avant toute montée de version**.
- Bandeaux :
  - 3 tailles (thème logo, thème icône, image statique) ;
  - le logo est réellement dessiné ;
  - logo des tampons détouré (60 px, alpha) ;
  - appels sharp du contrôle de transparence (la route télécharge le logo et refuse
    les adresses internes : non joignable au filet).
- Envois d'images par l'admin, via un second serveur derrière un relais qui imite le
  stockage :
  - image de palier stockée à l'identique ;
  - refus 400 pour un fichier qui n'est pas une image, pour plus de 5 Mo, et sans
    fichier ;
  - corps multipart mal formé : 400 et serveur toujours vivant ;
  - image statique.
- Routes touchées par Express 5 :
  - écrans `/scanner/…`, `/dashboard/…`, `/admin/…` ;
  - fiche client à identifiant malformé : 404 ;
  - appels sans corps JSON : 400, jamais 500 (scan, connexions).

**Montée de version** (commit `801102d`) :
- `express` 5.3.0, `multer` 2.4.0, `sharp` 0.35.5 (libvips 8.18.7). `express-rate-limit`
  reste en 7.5.1 (décision du 13/10).
- `src/routes/scanner.js`, `dashboard.js`, `admin-ui.js` : `router.get('*')` devient
  `router.get('/{*chemin}')`.
- `src/routes/clients.js` : `:id([0-9a-f\-]{36})` devient `:id`, avec
  `siIdentifiant()`. Le filtre est fait AVANT `authMarchand` et renvoie
  `next('route')`, donc même comportement : 404 « Route not found », même sans jeton.
- `src/index.js` :
  - `req.body` vaut `{}` sans corps JSON ;
  - `query parser` étendu (comme Express 4) ;
  - `app.listen` relance l'erreur d'écoute (Express 5 la passe au rappel).

### Preuves

- `npm test` sous Node 24.21.0 : **250/250** (238 + 12).
- **Contre-épreuves ciblées sous Express 5** :
  - sans la ligne `req.body` : 249/250 (« appel sans corps » → 500, 500, 500) ;
  - sans les corrections de chemins, le serveur ne démarre pas
    (`PathError: Unexpected ( at index 4: /:id([0-9a-f\-]{36})`).
- **Bandeaux, empreintes de pixels** : 9 rendus (logo, icône et image statique, chacun
  en 3 tailles) **identiques au pixel près** entre sharp 0.33.5 (libvips 8.15.3) et
  0.35.5 (libvips 8.18.7).
- **Tests navigateur sous les nouvelles versions** : scanner, onglet scanner, caisse
  (ensemble), fiche client (seule, 13/13), Aperçu (seul, 6/6).
- **Dette découverte, sans lien avec 20b** : les 4 tests navigateur joués À LA SUITE
  bloquent sur la fiche client (attente de 30 s dépassée). C'est **pareil sur l'ancien
  code** (`e90f554`, Express 4.22.3), donc antérieur à 20b. Probablement la limite
  globale de requêtes par adresse (300 / 15 min), épuisée par la série. Chacun passe
  seul. À traiter avec le banc des tests, pas en production.
- `npm audit --omit=dev` : **2 alertes**, node-cron et uuid (moyennes, sans effet : uuid
  v4 seulement). Avant 20a : 11.
- **Image construite en local** (même empreinte Node 24.21.0) :
  - versions : Node v24.21.0, OpenSSL 3.5.7, express 5.3.0, multer 2.4.0, sharp 0.35.5,
    libvips 8.18.7 ;
  - sharp fonctionne ; serveur démarré ; `/health`, `/scanner/x`, `/dashboard/x` et
    `/admin/x` répondent 200 ;
  - plus d'avertissement de sharp ni de multer à `npm ci`.

### Hypothèses et limites

- **Un JSON mal formé répond 500, avant comme après** : le gestionnaire d'erreurs
  global ignore le statut 400 du lecteur de corps. Ce n'est pas une régression ; dette
  notée, à corriger à part (une ligne : renvoyer `err.status` s'il vaut 4xx).
- Le contrôle de transparence n'est pas testé par sa route (garde anti-SSRF) : ses
  appels sharp le sont.
- Pas de migration.

### En production (13/10)

- Feu vert de Yass. Poussé à **13:58:16 UTC** en avance rapide sur
  `claude/keen-goldberg-MXslu` (`53a27d3` → `a586e5e`).
- Contrôles de Yass, tous bons :
  - déploiement vert, `/health` v24.21.0, `/health/db` ok ;
  - scanner, dashboard et admin s'affichent ;
  - scan puis annulation ;
  - fiche client ;
  - carte iPhone mise à jour, avec le même bandeau ;
  - envoi d'image admin.
- **Étape 20b close.** Étape 20 terminée (20a et 20b en production).

## 15 unquadragies. RESTE DE L'ÉTAPE 21 : CODÉ EN LOCAL (13/10, rien poussé)

**Décision du pilotage (13/10)** : le reste de l'étape 21 passe avant l'étape 23
(troncature silencieuse de données que le marchand voit et exporte ; Pizz'Amore :
384 porteurs, +133 par mois). Diagnostic et code enchaînés sans attendre, arrêt
seulement sur une décision produit (aucune rencontrée, voir « Choix »).

**Table `consentements`** (question du pilotage) :
- une ligne par coordonnée donnée (email, téléphone, date d'anniversaire), avec
  `valeur = true` et l'horodatage ;
- écrite à l'inscription du client sur la **landing premium** (`POST /api/clients`,
  `clients.js:67-77`) quand il remplit le champ ;
- **lue par aucun code**, supprimée seulement par l'effacement RGPD ;
- écriture non vérifiée : un échec est invisible (dette t40 §7.1, toujours ouverte).

### Ce qui cassait (avant, `a586e5e`)

- **Liste** (`GET /api/clients`) : une seule lecture, coupée à **1 000** par l'API de
  données.
  - Au-delà, des clients sont introuvables et le compteur reste bloqué à 1 000.
  - La recherche se faisait dans le navigateur sur ces 1 000 seulement.
- **Export** (`GET /api/clients/export`) : une seule lecture coupée à 1 000, **sans
  le dire**. Les clients les plus anciens manquaient.
- **JSON mal formé** : 500 « Internal server error » (le gestionnaire global ignorait
  le 400 du lecteur de corps).
- Panne de base : liste et export répondaient 500 avec le message brut.

### Livré (commit local `3fc9ee8`)

- **`src/routes/clients.js`** :
  - `GET /api/clients?debut=&limite=&q=` : pages de 100 par défaut, 200 au plus.
    - Ordre : points décroissants, puis identifiant (stable d'une page à l'autre).
    - **Recherche dans la base** : prénom contenant le texte, sans tenir compte de la
      casse ; `%`, `_` et `\` sont cherchés tels quels.
    - Total dans l'en-tête **`X-Total-Count`**. La réponse reste un tableau (même
      forme qu'avant : un onglet ouvert pendant le déploiement continue de
      marcher).
    - Page au-delà de la fin : page vide. Panne : 503 `database_unavailable` +
      `Retry-After`.
  - `GET /api/clients/export` : lu par **pages de 1 000** (curseur sur la date
    d'inscription puis l'identifiant), **écrit au fil de l'eau**. Il est complet,
    sans plafond, et la mémoire reste bornée.
    - Même contenu, mêmes colonnes, même ordre (plus récent d'abord), même BOM,
      même neutralisation des formules.
    - Panne avant la première ligne : 503.
    - **Panne en cours : la connexion est coupée**, le téléchargement échoue, jamais
      un fichier tronqué qui aurait l'air complet.
  - Client court (5 s) par page : aucune page ne dépasse 1 000 lignes.
- **`src/index.js`** : les erreurs 4xx du lecteur de corps sont rendues telles quelles.
  - JSON mal formé : **400 `invalid_json`** ; corps trop gros : 413.
  - Elles ne sont plus journalisées comme des erreurs serveur. Le reste : 500,
    inchangé.
- **`public/dashboard/index.html`** (onglet Clients) :
  - total réel (« 2500 clients ») ;
  - 100 clients, puis un bouton **« Afficher plus »** (+100) ;
  - recherche envoyée au serveur 300 ms après la dernière frappe ; une recherche
    plus récente l'emporte sur une réponse en retard ;
  - la recherche est remise à zéro à la déconnexion ;
  - l'initiale de l'avatar est échappée (`esc`), comme le prénom.
- **Tests** :
  - `tests/scenarios.js`, section 21 : 9 contrôles. La liste et l'export tournent
    contre un **second PostgREST plafonné à 1 000 lignes, comme Supabase** (le
    PostgREST principal du filet n'a pas de plafond : un test de liste ou d'export
    n'y aurait rien prouvé).
  - `tests/lancer.js` : plusieurs PostgREST possibles (un relais par PostgREST, un
    fichier de configuration chacun), et `demarrerPostgrest` exposé aux scénarios.
  - `tests/navigateur/clients_liste.js` : 4 contrôles et 2 captures.

### Preuves

- `npm test` sous Node 24.21.0 : **259/259** (250 + 9).
- **Contre-épreuve** : nouveaux tests sur `a586e5e` → **251/259**, soit 8 échecs.
  - Liste : 1 000 clients sur 2 500.
  - Export : 1 001 lignes, soit 1 000 clients sur 2 500.
  - Recherche « zo » : Zoé introuvable.
  - Pannes : 500.
  - Export coupé : « fichier reçu ».
  - JSON mal formé : 500.
- **Navigateur** : onglet Clients 4/4. Il affiche le total réel et 100 clients ;
  « Afficher plus » donne 200 ; la recherche « zo » trouve Zoé au-delà des 1 000
  premiers ; le bouton CSV télécharge 2 501 lignes. La fiche client (13/13) passe
  toujours.
- **Mesure locale, 50 000 clients** (PostgREST plafonné à 1 000) :
  - **export complet : 50 000 lignes, 3,1 Mo, 1,6 s** ; mémoire du serveur de 93 Mo
    avant à **144 Mo au pic** ;
  - première page de la liste : 36 ms ;
  - recherche : 86 ms.

  Aucun index nouveau (`idx_clients_marchand` suffit).

### Choix (hors pilotage, signalés)

- Pages de 100 et un bouton « Afficher plus », plutôt que des numéros de pages.
- Total dans un en-tête plutôt qu'un changement de forme de la réponse.
- Une panne pendant l'export coupe la connexion. Je n'ajoute ni ligne de fin ni
  marqueur dans le fichier : son contenu ne change pas.
- 503 au lieu de 500 pour une panne de base (règle des étapes 16 et 26).

### Hypothèses et limites

- Un client modifié entre deux pages de la liste peut changer de place (tri par
  points) : doublon possible à l'écran (filtré par identifiant au chargement) ou
  client sauté jusqu'au prochain « Actualiser ». L'export, lui, est trié par date
  d'inscription : il est stable.
- Pas de migration.

### En production (13/10)

- Feu vert de Yass. Poussé à **15:17:28 UTC** en avance rapide sur
  `claude/keen-goldberg-MXslu` (`a586e5e` → `da9313c`).
- Contrôles de Yass, tous bons :
  - déploiement vert, `/health` v24.21.0, `/health/db` ok ;
  - onglet Clients de Pizz'Amore : le total égale l'Aperçu, « Afficher plus », la
    recherche fonctionne ;
  - **export réel complet**, accents corrects dans Excel ;
  - scan puis annulation.
- **Étape 21 close** : plus aucune lecture coupée à 1 000 lignes visible du marchand.
  - Le cron (étape 22), l'Aperçu (étape 26), la liste et l'export sont tous passés en
    base ou par pages.
  - Seule reste la lecture des marchands par le cron, plafonnée à 1 000 marchands
    (sans effet avant longtemps).

## 15 duoquadragies. ÉTAPE 23 (GOOGLE) : DIAGNOSTIC (13/10, rien codé)

**Décision D2 de Yass (29/09)** : ne plus envoyer le message Google aux clients dont la
carte est sur iPhone. Précisions du pilotage (13/10) :
- un client qui change de téléphone et perd sa carte du « bon » côté est un risque
  ACCEPTABLE ;
- la piste « plateforme utilisée » a la préférence si elle est fiable ;
- un client qui a les DEUX cartes ne doit rien perdre.

### 1. Comment on « sait » aujourd'hui qu'un client a une carte Google

- **Rien ne le dit.** `passes.google_pass_url` est écrit pour CHAQUE client :
  - **à l'inscription**, quel que soit le téléphone (`clients.js:89-98`,
    `generateGoogleWalletUrl` puis `update({ google_pass_url })`) ;
  - par `GET /google-wallet/pass/:serial` (`google-wallet.js:27-36`).
- `generateGoogleWalletUrl` **crée l'objet Google** chez Google (POST
  `/loyaltyObject`, `google-pass.js:384-388`) **avant tout clic**. Tout client a donc un
  objet Google, et un `addMessage` sur l'objet d'un client iPhone répond 200 (registre
  du 13/10 : 55 sur 55 « ok »).
- Le lien du bouton « Google Wallet » de la landing est le lien `pay.google.com`
  **direct** (`landing.html:959-960` redirection Android, `:1016-1017` et `:1060-1061`
  boutons). Le serveur ne voit jamais le clic.
- Les filtres qui croient trier n'excluent personne :
  - `campagnes.js:180` (`.not('google_pass_url', 'is', null)`) ;
  - `reserver_relances` (migration 055, `google = google_pass_url IS NOT NULL`).
- **Côté Apple, on sait** : une carte installée sur un iPhone s'inscrit
  (`device_tokens`) et se désinscrit quand on la retire
  (`DELETE /v1/devices/...`, `apple-wallet.js`).

**Surfaces qui envoient vers Google :**

| Surface | Appels Google | Où |
|---|---|---|
| Scan | **2 par scan** (mise à jour des points + message), APRÈS la réponse à la caisse, pour TOUS les clients | `scan.js:215`, `:294-315` (et `:381` renvoi) |
| Ajustement du solde | 2 | `clients.js:453-461` |
| Demande d'avis | 1 | `avis.js:155-158` |
| Campagne | 1 par client | `campagnes.js:171-213` |
| Cron (relances) | 1 par client relancé | `cron.js` (`envoyer`) |

Le scan est de loin le plus gros volume.

### 2. Les deux pistes

**a. Retours de Google Wallet (callbacks d'enregistrement et de suppression, fiche t16)**
- **Réglage** : pas de console. L'adresse de retour se pose sur la CLASSE
  (`callbackOptions.url`), par notre code (`createOrUpdateLoyaltyClass`). Il faut ensuite
  repousser les classes de tous les marchands (un geste admin existant).
- **Ce que Google envoie** : un message signé (protocole ECv2SigningOnly) à chaque
  enregistrement (« save ») et suppression (« del ») d'une carte, avec l'identifiant
  de l'objet.
- **Vérification de la signature** : clés publiques de Google, renouvelées, puis
  chaîne clé intermédiaire → message. C'est faisable avec `crypto` de Node, mais il
  faut ≈ ½ à 1 jour avec les tests (clés de test fabriquées).
- **Coût** : aucune requête régulière ; 1 requête entrante et 1 écriture par
  enregistrement ou suppression. **HYPOTHÈSE** : Google ne garantit pas la livraison
  de chaque retour (au mieux).
- **Clients existants** : aucun historique. Il faudrait lire chaque objet chez Google
  (`GET /loyaltyObject/…`, champ `hasUsers`) une fois : ≈ 1 700 appels en une fois, pas
  réguliers. **HYPOTHÈSE** : `hasUsers` reste vrai après une suppression, donc il penche
  vers « envoyer », sans risque de perte.
- **Fiabilité** : la meilleure (enregistrement réel), si les retours arrivent.

**b. Plateforme utilisée (préférée par le pilotage)**
- **Signal Apple** : une ligne `device_tokens` pour la carte prouve une carte installée
  sur un iPhone, et retirée quand elle est supprimée. Il existe déjà, il est fiable.
- **Signal Google, à créer** : le bouton et la redirection Android de la landing
  passent par `GET /api/passes/:serial/google`.
  - Cette route note `passes.google_ouvert_le = now()` (première fois), puis renvoie
    (302) vers le même lien `pay.google.com`. Pour le client, c'est la même
    destination, invisible.
  - Coût : 1 lecture + 1 écriture, **seulement quand un client clique** sur Google.
  - Migration 057 : une colonne nullable.
- **Règle d'envoi Google** : envoyer si `google_ouvert_le IS NOT NULL` OU si le client
  **n'a aucun jeton Apple**.
  - Client iPhone seul : plus de Google.
  - Client Android : Google comme aujourd'hui (pas de jeton Apple).
  - Client sans aucune carte : Google comme aujourd'hui (sans effet).
- **Fiabilité** :
  - « a ouvert le lien Google » ne prouve pas l'enregistrement, mais penche vers
    « envoyer » (aucune perte) ;
  - **Google Wallet n'existe pas sur iPhone** : un client iPhone qui a un jeton Apple
    n'a de carte Google que s'il possède aussi un Android.
- **Changement de téléphone** (risque accepté) :
  - iPhone → Android : la carte Apple disparaît, Apple désinscrit → plus de jeton →
    Google reprend tout seul ;
  - Android → iPhone avec ajout de la carte Apple : Google continue si le lien Google a
    été ouvert. Envoi inutile mais sans perte.
- **Limite** : les liens Google déjà gardés dans le navigateur du client (écran
  « re-bienvenue », `localStorage`) pointent encore vers `pay.google.com` en direct. Ils
  ne seront pas comptés, ce qui n'a d'effet que pour un client iPhone qui ouvrirait un
  vieux lien Google.

**Recommandation : b**, avec la règle ci-dessus (simple, aucune requête régulière,
signal Apple déjà fiable).
- On ajoute en option, **une seule fois**, la lecture `hasUsers` de la piste a, pour
  les seuls clients existants qui ONT un jeton Apple (ceux qu'on cesserait de servir
  côté Google).
  - C'est ce qui protège les clients existants qui ont les deux cartes.
  - Coût : environ autant d'appels Google que de clients iPhone, une seule fois, par
    script lancé par Yass.
- La piste a complète (retours signés) n'apporte pas assez pour son coût aujourd'hui.

### 3. Gain chiffré

Mesure du 26/09 (A §5.1) : **63 %** des messages Google acceptés visaient une carte
iPhone. Ordre de grandeur avec la règle :

| Surface | Aujourd'hui | Après (≈ −63 %) |
|---|---|---|
| Cron du 13/10 | 55 messages Google | ≈ 20 |
| Campagne type (1 679 clients au total) | 1 679 messages | ≈ 620 |
| **Scan** (si inclus) | 2 appels Google par scan | 2 appels pour ≈ 37 % des scans seulement |

- **Temps du cron** : quasi inchangé. Il est fixé par le débit Apple (3 iPhone par
  seconde) ; Google part 5 à la fois, à côté.
- **Temps d'une campagne** : la voie Google raccourcit d'environ 60 %.
- **Surtout** : on cesse de consommer les limites Google (3 messages par 24 h et 10
  messages par objet) sur des objets que personne ne regarde.
- Chiffres exacts par marchand : requête en lecture seule donnée à Yass (la part des
  clients avec et sans jeton Apple, sur les envois Google des 7 derniers jours).

### 4. Client qui a les DEUX cartes

- **Nouveaux clients et clients qui rouvrent le lien Google** : `google_ouvert_le`
  posé, donc il reçoit Apple ET Google. Rien de perdu.
- **Clients existants qui ont déjà les deux cartes** : aucun historique de clic.
  - Sans la lecture `hasUsers` unique, ils **perdraient le message Google** tant qu'ils
    ne rouvrent pas le lien. Rare (il faut un iPhone ET un Android).
  - Avec elle, rien de perdu.

### 5. Plan de test (`npm test`, Node 24.21.0)

- **Règle de sélection** :
  - client avec jeton Apple seul : pas de Google (cron, campagne, avis, ajustement, et
    scan si inclus) ;
  - client sans jeton : Google ;
  - client avec jeton ET `google_ouvert_le` : Apple et Google.
- **Route `/api/passes/:serial/google`** : 302 vers le lien stocké, `google_ouvert_le`
  posé une fois (pas réécrit au second clic) ; serial inconnu → 404 ; panne de base →
  503.
- **Landing (navigateur)** : sur Android, la redirection automatique passe par la route
  et aboutit au même lien Google ; le bouton Google aussi.
- **Changement de téléphone** : jeton Apple supprimé → Google reprend.
- **Scan, si inclus** : réponse à la caisse identique, aucune requête de plus, Google
  sauté pour un client iPhone seul.
- **Contre-épreuve** sur `da9313c`.
- **Script `hasUsers`, si retenu** : essayé contre un faux Google local.

### Décisions demandées au pilotage (produit)

1. **Inclure le scan ?** Un client iPhone seul ne reçoit plus la mise à jour Google ni
   le message Google après un scan.
   - C'est le plus gros gain, avec aucune requête de plus : le scan lit déjà les jetons
     Apple pour le push iPhone (`scan.js:270-275`).
   - La réponse à la caisse ne change pas.
   - L'objet Google d'un client iPhone ne serait plus tenu à jour : sans effet, sauf si
     ce client ajoute plus tard la carte Google. Elle se mettrait alors à jour au
     scan suivant.
2. **Lecture `hasUsers` unique** pour protéger les clients existants qui ont les deux
   cartes : oui (recommandé), ou accepter le risque.

## 15 tresquadragies. ÉTAPE 23 (GOOGLE, D2) : CODÉE EN LOCAL (13/10, rien poussé)

Décisions de Yass (13/10) : piste b (le clic sur le bouton Google) ; scan inclus ;
vérification unique auprès de Google, étalée, jamais entre 07:30 et 09:00 UTC, bilan
au journal, même signal que le clic ; pas de mesure « avant » (gain mesuré après la
mise en production). Le risque d'un client qui change de téléphone est accepté.

### Règle D2

Google est servi si `passes.google_ouvert_le` est posé, OU si le client n'a aucun jeton
Apple (`device_tokens`). Google Wallet n'existe pas sur iPhone : un client avec un jeton
Apple et sans signal est un iPhone seul. Le client qui a les deux cartes garde les deux
dès qu'il a cliqué sur le bouton Google ou que la vérification unique l'a trouvé.

### Livré (commit local `cfe796b`)

- **Migration 057** (`database/migration_057_google_d2.sql`) :
  - colonne `passes.google_ouvert_le` ;
  - `reserver_relances` recréée (même signature que 055), drapeau `google` selon D2 ;
  - `cartes_google_campagne(marchand, après, limite)`, la voie Google des campagnes ;
  - `cartes_google_a_verifier(après, limite)`, la liste de la vérification unique ;
  - fonctions fermées à PUBLIC, anon et authenticated, ouvertes au serveur ;
  - requête de contrôle (4 × true) et retour arrière en fin de fichier.
- **`GET /api/passes/:serial/google`** : pose `google_ouvert_le` (une seule fois),
  puis 302 vers le même lien Google. Carte inconnue ou sans lien : 404 ; lecture en
  panne : 503 + Retry-After.
- **Inscription** : `google_wallet_url` renvoyé à la landing pointe vers cette route.
  La landing elle-même n'est pas modifiée.
- **Règle d'envoi sur toutes les surfaces** (`services/canal-google.js`) :
  - scan (et parrain) : une seule lecture des jetons, qui ramène aussi le signal, pour
    Apple et Google ; aucune requête de plus, réponse de la caisse inchangée ;
  - ajustement et annulation (`syncPassAfterAdjustment`), avis : même lecture ;
  - cron : `reserver_relances` ;
  - campagnes : `cartes_google_campagne`.
- **Vérification unique** (`services/verification-google.js`) :
  - lit l'objet Google (`lireObjet`) de chaque carte de la liste ; `hasUsers` vrai, le
    signal est posé ;
  - une carte toutes les 500 ms, par pages de 100 ;
  - refusée, ou interrompue, entre 07:30 et 09:00 UTC ;
  - bilan au journal :
    `[verif-google] finie : N vérifiée(s), M ont une carte Google, X sans, E erreur(s)` ;
  - lancée par l'admin : bouton « Vérifier les cartes Google (une fois) » sous les
    chiffres, route `POST /api/admin/google-wallet/verification`, avec les réponses
    202, 409 (en cours), 423 (fenêtre du cron) ou 503 (Google non configuré).

### Preuves

- `npm test` (Node 24.21.0) : **274/274**, dont la section 22 (15 contrôles).
- Contre-épreuve, les nouveaux tests sur `da9313c` : **261/271**.
  - Les 10 échecs sont tous dans la section 22 : Google servi à la carte iPhone seule
    (cron, campagne, scan, ajustement), route et vérification absentes.
  - Les sections 0 à 21 passent sur l'ancien code.
- Section 17 : ses 1 200 cartes ont les deux (jeton Apple et lien Google). Le
  signal y est posé si la colonne existe, sinon elles seraient devenues des iPhone
  seuls.
- L'ajustement est vérifié dans le processus du test, avec un Google imité : dans le
  filet, Google n'est pas configuré et l'ajustement n'y écrit aucune ligne Google.

### Hypothèses et limites

- **Hypothèse** : un jeton Apple veut dire iPhone. Un client qui passe d'iPhone à
  Android garde son ancien jeton jusqu'au désenregistrement par Apple. Sans clic ni
  carte trouvée par la vérification, il ne reçoit plus Google (risque accepté).
- **Limite** : les landings déjà ouvertes avant la mise en production gardent en
  mémoire (localStorage) l'ancien lien Google direct. Un clic depuis cette mémoire ne
  pose pas le signal. La vérification unique couvre ces clients.
- **Limite** : la route admin `/api/google-wallet/pass/:serial` renvoie toujours le
  lien direct. Elle ne sert qu'à l'admin.
- **Limite** : sur Android, la landing redirige seule vers le bouton, donc le signal
  est posé même si le client n'enregistre pas la carte. C'est sans effet : un client
  sans jeton Apple est servi de toute façon.
- **Limite** : un clic n'est pas un enregistrement. Un iPhone qui clique sur le bouton
  Google est servi en Google (envoi inutile, comme avant).
- **Provisoire** : la vérification unique reste dans le code. Une deuxième vérification
  ne relit que les cartes encore sans signal. Le bouton pourra être retiré quand le
  bilan sera noté ici.
- Gain : non mesuré avant, à mesurer après (lignes Google de `notification_envois`).

### En production (13/10)

- Migration 057 exécutée par Yass : 4 × true.
- Feu vert de Yass. Poussé à **16:46:08 UTC** en avance rapide sur
  `claude/keen-goldberg-MXslu` (`da9313c` → `88899f1`).
- Contrôle 3, scan d'une carte iPhone seule (hamza-salon, « Test Docker », 1 jeton
  Apple, sans signal Google) :
  - scan de 14:02 UTC (ancien code) : 1 ligne apple et 2 lignes google ;
  - scan de 16:50 UTC (`88899f1`) : 1 ligne apple, aucune ligne google. OK.
- Vérification unique (13/10, soir) : 1 640 cartes à vérifier au comptage.
  - Bilan : `[verif-google] finie : 1645 vérifiée(s), 2 ont une carte Google,
    1643 sans, 0 erreur(s)`. L'écart de 5 avec le comptage vient des cartes créées
    entre les deux.
  - Seuls 2 clients avec une carte iPhone ont aussi une carte Google. Les 1 643
    autres ne reçoivent plus de message Google.
  - Le suivi de l'admin a affiché « Failed to fetch » (ordinateur en veille) ; la
    vérification, côté serveur, a continué.
  - Le bouton reste dans l'admin : une relance relirait les 1 643 cartes sans signal.
    À ne pas relancer sans raison ; à retirer plus tard.
- `/health` ok (Yass).
- Clic sur le bouton Google d'une landing (Yass, 13/10) : signal posé.
  - 4 cartes avec `google_ouvert_le` entre 17:08 et 17:32 UTC : les 2 trouvées par la
    vérification et les clics de test.
  - Dernière carte : `c4d4477f…`, à 17:32:47 UTC.
- **Étape 23 close.** Gain à mesurer dans quelques jours : lignes google de
  `notification_envois` par source, avant et après le 13/10.

## 15 quatuorquadragies. CAMPAGNES PAR SEGMENT ET VRAIS CLIENTS : DIAGNOSTIC (13/10)

Demande du pilotage (13/10). Prérequis : le marchand ne voit que ses vrais clients.
Règle de Yass : visible = au moins un scan non annulé, OU un jeton Apple, OU le
signal Google. Aucun statut affiché, rien supprimé en base. Ensuite, un segment par
campagne : inactifs 15, 30 ou 60 jours ; les plus fidèles ; clients d'une boutique
(réseaux).

**Décision de Yass** : le segment « clients d'une boutique » est une exception
voulue à l'exclusion « pas de notifications par boutique » du Socle. C'est le
réseau qui envoie.

### Fait en local (rien poussé)

- `database/requetes/vrais_clients_par_marchand.sql` : la requête de lecture du
  point a. Par marchand : clients aujourd'hui, après masquage, masqués, sauvés par
  le signal Google, masqués à vérifier.
- **Migration 058** (`c2691af`) : `cartes_google_a_verifier` rend les cartes qui
  seraient masquées (lien Google, sans signal, sans jeton Apple, jamais scannées,
  client non effacé). Aucun code à déployer : le bouton admin appelle déjà cette
  fonction.
  - Filet : 274/274.
  - Contre-épreuve sur `88899f1` : 271/274. Les 3 échecs portent sur la
    vérification étendue.
- Filet, section 17 : la date limite du test « campagne abandonnée » passe de 1,5 s
  à 4 s (`ea3236b`).
  - Avant, le premier lot Google pouvait finir après la date limite. La campagne
    était alors abandonnée sans avoir été interrompue : échec 1 fois sur 3.
  - L'ancien code avait la même course.

### Tenue à long terme (50 000 porteurs, plusieurs années)

- **Indicateur plutôt que calcul.** Une colonne `clients.visible`, tenue par des
  déclencheurs en base :
  - un scan l'allume ;
  - un jeton Apple l'allume ;
  - `google_ouvert_le` l'allume ;
  - une annulation de scan ou un jeton supprimé la recalculent pour ce seul client.

  Les lectures (liste, recherche, export, statistiques) filtrent alors sur une
  colonne. Leur coût ne dépend pas du nombre de scans accumulés. Calculer la règle
  à chaque lecture (EXISTS sur les scans pour chaque client, à chaque page et à
  chaque comptage) grossirait avec l'historique.
- **Accumulation** : aucune table nouvelle, donc aucune purge à prévoir.
  - Colonnes ajoutées : `clients.visible`, segment sur `campagnes` et sur
    `notification_logs`.
  - Une ligne client change une fois dans sa vie (de masqué à visible).
  - Au scan, le déclencheur ne réécrit rien quand le client est déjà visible.
- **Segments** : évalués au moment de l'envoi, par lot, par rapport à l'heure du
  clic.
  - Les lectures sont bornées par la fenêtre du segment : `idx_scans_marchand_date`
    pour les fenêtres, `idx_scans_client` pour « déjà venu ».
  - Aucun index nouveau.
  - Pas de table de destinataires figée : elle grossirait de N lignes par campagne.
- **Apple et Google** : la charge baisse.
  - Les cartes Google jamais finalisées (objet Google sans utilisateur) ne
    reçoivent plus de messages, ni par campagne ni par relance.
  - Les segments envoient à des sous-ensembles.
  - Le compteur de destinataires ne coûte aucun appel à Apple ou à Google : c'est
    une lecture en base, faite à la demande.
- **Entretien**
  - Un nouveau signal de carte (un autre portefeuille) devra allumer `visible`
    dans un déclencheur.
  - Une future API marchand devra lire les clients visibles : prévoir une vue, un
    seul endroit.
  - Un segment nouveau = une branche dans une seule fonction SQL, partagée par le
    compteur et les deux voies d'envoi.
- **Où appliquer la règle**, sans requête régulière en plus :
  - `src/routes/clients.js:139` (liste et recherche) ;
  - `src/routes/clients.js:185` (export) ;
  - `apercu_stats`, CTE `cl` (migration 056) ;
  - `reserver_relances`, CTE `base` (057) ;
  - `cartes_google_campagne` (057) ;
  - voie Apple : `src/services/campagnes.js:133`. Pour elle, seul le segment
    compte, puisqu'un jeton Apple rend le client visible.
  - Le scanner n'est pas filtré : un client masqué qui présente sa carte est scanné
    et devient visible.

### Décisions de Yass (13/10)

- Inactifs = venus au moins une fois, plus depuis N jours.
- Client d'une boutique = au moins un passage dans cette boutique sur 90 jours.
- Exclusion des clients relancés le jour même : seulement pour les campagnes
  ciblées. « Tous les clients » et le cron sont inchangés.
- Nombre de destinataires affiché avant l'envoi ; une campagne ciblée compte dans le
  quota comme une autre.

### En production : migration 058 et vérification étendue (13/10)

- Migration 058 exécutée par Yass.
- Bilan de la vérification étendue :
  `[verif-google] finie : 333 vérifiée(s), 104 ont une carte Google, 229 sans, 0 erreur(s)`.
- Requête du point a, chiffres définitifs : 230 clients seraient masqués au total.
  - Les démos en comptent 117 (WinWin Card DEMO 78, Demo Winwin Card 36, Démo France
    2, Ray Test 1).
  - Pizz'Amore : 22 masqués sur 388, 25 sauvés par Google. Les clients à 0 point qui
    ont la carte dans leur Wallet restent visibles.

### Livré en local : masquage et segments (commit `44bffab`, rien poussé)

- **Migration 059** (`database/migration_059_vrais_clients_segments.sql`) :
  - `clients.visible`, remplie une fois, puis tenue par des déclencheurs :
    - un scan non annulé, un jeton Apple (insertion ou mise à jour) ou le signal
      Google (à l'insertion ou à la mise à jour de la carte) l'allument ;
    - l'annulation d'un scan ou la suppression d'un jeton déclenchent un recalcul
      complet, pour ce seul client ;
  - `trg_clients_updated_at` ne fait plus avancer `updated_at` quand seule la
    colonne `visible` change. Sinon, le remplissage aurait relancé tous les vrais
    clients au cron suivant, via near_reward (« le solde a bougé »). Toute autre
    mise à jour garde son comportement d'avant ;
  - masquage dans `apercu_stats` (CTE `cl`), `reserver_relances` (CTE `base`) et
    `cartes_google_campagne` (gardée pour l'ancien code) ;
  - segments :
    - `client_dans_segment` est la seule définition, évaluée à l'heure du clic ;
    - `segment_valide` vérifie les jours permis et la boutique du marchand, et
      complète le segment avec le nom de la boutique ;
    - `compter_segment` compte les personnes joignables : jeton Apple ou carte
      Google ;
    - `lancer_campagne` accepte un 5e paramètre facultatif ;
    - `campagne_lot_apple` et `campagne_lot_google` sont les voies d'envoi, avec
      le même curseur que t37 ;
  - colonne `campagnes.segment`.
- **Code**
  - Liste, recherche et export : `.eq('visible', true)` (`src/routes/clients.js`).
  - `GET /api/notifications/destinataires?segment=…` ; `POST /api/notifications`
    accepte `segment` ; l'historique renvoie le segment de chaque campagne.
  - Voies d'envoi : `src/services/campagnes.js`, par les deux fonctions de lot.
  - Dashboard : menu « Destinataires » dans l'onglet Notifications. Le compteur est
    lu à chaque choix, jamais en boucle. Le segment apparaît dans l'historique.
  - Texte de confirmation du bouton admin mis à jour.
- **Compatibilité** : l'ancien code fonctionne après 059. Le masquage s'applique déjà
  aux statistiques, aux relances et à la voie Google ; la liste et l'export ne
  masquent qu'avec le nouveau code.

### Preuves

- `npm test` : **287/287**. Section 23 : 14 contrôles. La section 17 vise la nouvelle
  lecture Apple quand elle simule une panne. Les sections 18, 19 et 21 marquent
  leurs clients de test comme vrais clients.
- Test navigateur `tests/navigateur/segments_ecran.js` : 3/3 (menu, compteur 10, 3,
  1 et 2, historique). Capture vérifiée.
- Contre-épreuve sur `88899f1` : 272/287. Les 15 échecs sont tous dans les sections
  22 (058) et 23 (059).

### Hypothèses et limites

- Une carte supprimée de l'iPhone efface le jeton. Le client reste visible s'il est
  venu au moins une fois ; s'il n'est jamais venu, il redevient masqué. C'est la
  règle telle quelle ; **question posée à Yass le 13/10**.
- Le segment est évalué lot par lot, par rapport à l'heure du clic : un scan fait
  pendant l'envoi ne change rien. Seule exception, l'exclusion des relances du jour
  porte sur toute la journée UTC : une relance du cron arrivée pendant l'envoi
  exclut le client des lots suivants.
- « Les plus fidèles » utilise le `freq_seuil_haut` du marchand au moment de l'envoi.
- Ancienne fonction `cartes_google_campagne` : à supprimer quand plus aucun code ne
  l'appelle.
- Un nouveau signal de carte devra allumer `visible` dans un déclencheur.

### En production : migration 059 et code (14/10)

- Yass a donné son accord sur les chiffres (point e) et validé la règle de la carte
  supprimée : masquée seulement si le client n'est jamais venu.
- Migration 059 exécutée par Yass : 5 × true, 230 clients masqués.
- Feu vert. Poussé à **07:11:27 UTC** en avance rapide sur
  `claude/keen-goldberg-MXslu` (`88899f1` → `28ab331`).
- Contrôles de Yass (14/10) : déploiement vert, `/health` ok, Pizz'Amore affiche 366
  clients.
- Restent ouverts : l'export, le menu des segments, la campagne ciblée de test chez
  hamza-salon, et l'absence de vague near_reward au cron du 14/10 (requête sur
  `workflow_executions` du jour).

### Dette observée

- Une fois sur quatre passages du filet, « fetch failed » sur le premier appel de
  la section 22, après environ 5 s sans requête.
  - Hypothèse non prouvée : une connexion gardée ouverte, que le serveur ferme
    pendant que le client la réutilise.
  - Sans effet en production.

## 15 quinquadragies. BLOC « MES SMART NOTIFICATIONS » : CODÉ EN LOCAL (14/10, rien poussé)

Demande du pilotage (14/10). Les marchands ne savent pas que les smart notifications
existent : Yass les règle depuis l'admin. Un bloc, sous l'historique des campagnes de
l'onglet Notifications, les leur fait connaître, d'après leurs réglages réels.

### Livré (commit local `4fa2413`)

- `GET /api/merchants/me/smart-notifications` (`src/routes/merchants.js`) :
  - deux lectures courtes en parallèle : les réglages du marchand, et le nombre de
    `workflow_executions` des 7 derniers jours (glissants) ;
  - le compte passe par l'index `(marchand_id, executed_at)`, qui existe depuis 055 :
    aucun index, aucune migration ;
  - mêmes règles que le cron :
    - forfaits Pro et Pro+ (sinon `eligible: false`) ;
    - anniversaire seulement avec la landing premium ;
    - boost seulement si seuil < récompense ;
    - une smart notification désactivée est absente ;
  - unité « points » ou « tampons » selon le programme.
- Dashboard : bloc `#smart-notifs`, chargé à l'ouverture de l'onglet, avec une seule
  requête et rien de régulier.
  - Textes de Yass : « boost », jamais « reçu ».
  - Singulier ou pluriel pour les jours, les points ou tampons et les notifications.
  - Version anglaise ajoutée.
- Rien ne change pour la caisse.

### Preuves

- `npm test` : 292/292, dont la section 24 (5 contrôles).
- Test navigateur `tests/navigateur/smart_notifications_ecran.js` : 3/3, trois
  captures vérifiées : landing premium en points, sans landing premium, tampons.
- Contre-épreuve sur `28ab331` : 287/292. Les 5 échecs sont tous dans la section 24
  (route absente).

### Choix hors pilotage

- Bloc caché si aucune smart notification n'est active, ou si la lecture échoue :
  il est seulement informatif, donc pas de message d'erreur.
- Compte des 7 jours = lignes de `workflow_executions`, soit une par client et par
  relance réservée, même si l'envoi a échoué ensuite.

## 15 unquinquagies. f15 ET f17 (BLOC NOTIFICATIONS, SUITE) : DIAGNOSTIC (14/10, rien codé)

### f15 : le marchand règle ses relances

- Aujourd'hui, les réglages sont des colonnes de `marchands` (`workflow_*`), et
  seul l'admin les modifie (`PATCH /api/admin/workflows/:id`, `src/routes/workflows.js`).
- **Coût** : une écriture par enregistrement. Le cron lit `marchands` une fois par
  jour, à 08:00 UTC. Des réglages changés souvent ne coûtent donc aucune requête
  régulière, et ils prennent effet au passage suivant.
- **Anti-spam déjà en place, et indépendant des réglages** :
  - une relance par jour et par client, tous types confondus ;
  - une relance par absence (inactivité) ;
  - une par palier (boost : `updated_at`) ;
  - une par an (anniversaire).

  Changer le texte ne renvoie rien. Baisser le délai d'inactivité (30 → 7 jours)
  produit une grosse première vague, puis plus rien.
- **Google, 3 notifications par carte et par 24 h** : les surfaces qui notifient
  sont le scan (à chaque scan), l'ajustement, l'avis, le cron et la campagne. Une
  relance n'ajoute au plus qu'une notification par jour : f15 n'augmente pas le
  risque.
- **Défaut admin conservé** : colonnes marchand séparées, nulles par défaut ; valeur
  effective = marchand, sinon admin. Le marchand peut « revenir au réglage WinWin ».

### f17 : cases du pass

- Apple : seul le champ du dos `notification_txt` a un `changeMessage`. Les zones
  `primaryFields` et `auxiliaryFields` sont vides
  (`src/services/apple-pass.js:346, 360`).
- iOS ne notifie que si la valeur change : un message identique au précédent est
  silencieux.
- Google : `addMessage` empile les messages sur l'objet, sans jamais en retirer
  (`google-pass.js:499`).

## 15 duoquinquagies. f15 : LE MARCHAND RÈGLE SES RELANCES (14/10, codé en local, rien poussé)

### Décisions de Yass (14/10)

- Colonnes « marchand » séparées, vides par défaut : la valeur du marchand s'il en a
  mis une, sinon celle de l'admin. Un bouton « Revenir au réglage WinWin ».
- Le marchand n'active ni ne désactive aucune relance (réponse b).
- Réglages modifiables :
  - délai d'inactivité, de 7 à 90 jours ;
  - seuil du boost, de 1 à récompense − 1 ;
  - message de la relance d'inactivité : obligatoire, 150 caractères maximum,
    sans lien.
- Textes du boost et de l'anniversaire fixes. Forfaits Pro et Pro+.
- La vague unique quand le marchand baisse le délai est acceptée, sans rien à
  l'écran.
- La demande d'avis Google figure dans le bloc et dans le compteur, sans réglage.
- f17 : on n'y touche pas (recadré côté pilotage).

### Contrôle du cron du 14/10 (avant le push de `f746b0b`)

- 31 relances near_reward, contre 1 à 13 les jours précédents.
- Explication prouvée en base : elles viennent de 3 marchands nouvellement activés
  par Yass (Nails By Ness 27, Bangkok Factory 2, Maybach 2), et aucun client n'a
  été modifié pendant la migration 059.

### Livré (commit local `36af671`)

- **Migration 060** :
  - colonnes `marchand_inactive_days`, `marchand_inactive_message` et
    `marchand_near_reward_threshold` ;
  - contrainte `marchands_reglages_smart_check` (bornes en base) ;
  - fonction `smart_notifications_7j` : relances
    (`workflow_executions`) + cartes ayant reçu une demande d'avis
    (`notification_envois`, source `avis`, cartes distinctes), sur 7 jours, par
    les index existants.
- **Cron** (`src/workers/cron.js`) : valeur du marchand s'il en a une, sinon celle de
  l'admin, pour le délai, le message et le seuil.
- **Route** (`src/routes/merchants.js`) :
  - `GET /me/smart-notifications` renvoie les valeurs utilisées, celles de l'admin,
    l'avis et `personnalise` ;
  - `PATCH /me/smart-notifications` règle, ou revient au réglage WinWin avec
    `{ winwin: true }`.
  - Sont refusés : une relance désactivée par l'admin, un boost que le seuil de
    l'admin rend inerte (sinon le marchand l'activerait), et le forfait Basic.
  - Lien détecté : `http(s)://`, `www.`, ou un nom de domaine courant.
- **Dashboard** : bouton « Régler mes relances » dans le bloc. Le formulaire ne
  montre que les relances actives. Erreurs lisibles. Une écriture par
  enregistrement, aucune lecture régulière.
- Les réglages du marchand ne touchent pas aux cartes : `marchands.updated_at`
  n'est lu nulle part.

### Preuves

- `npm test` : 300/300. Section 24 : 13 contrôles, dont le cron qui applique le
  réglage du marchand (10 jours, son message, seuil 4).
- Test navigateur : 4/4, quatre captures vérifiées (dont le formulaire).
- Contre-épreuve sur `f746b0b` : 290/300. Les 10 échecs sont tous dans la section
  24.

### Limites

- Le message du marchand peut contenir `{prenom}` et `{nom}`, remplacés comme pour
  le message de l'admin.
- Si l'admin baisse ensuite la récompense sous le seuil du marchand, le boost n'est
  plus envoyé et disparaît du bloc. Seul l'admin peut corriger.
- L'admin ne voit pas encore les réglages du marchand dans son écran. À ajouter si
  besoin.

### En production : bloc smart notifications et f15 (14/10)

- Migration 060 exécutée par Yass vers 08:40 UTC : 3 × true.
- Feu vert de Yass à 08:43 UTC, après le passage du cron : la fenêtre 07:30–09:00
  a été levée explicitement par Yass.
- Poussé à **08:43:04 UTC** en avance rapide sur `claude/keen-goldberg-MXslu`
  (`28ab331` → `45a72b2`) : le bloc (`f746b0b`) et f15 ensemble.
- Contrôles de Yass (14/10) : déploiement vert, contrôles bons.
- Constat de Yass : la fiche marchand de l'admin affiche toujours le réglage WinWin.
  - Cause : le formulaire ne lit que `workflow_*` (`public/admin/index.html:1280`).
    Les colonnes `marchand_*` n'y figurent pas.
  - Risque : l'admin croit régler un marchand alors que c'est la valeur du marchand
    qui part.
  - Décision de Yass (14/10) : **voir et effacer** (option a). L'admin ne modifie
    pas le réglage du marchand.
  - Codé en local (`707e8d5`, rien poussé) :
    - fiche admin : bloc orange « Réglages faits par le marchand », avec la valeur
      WinWin en regard, lu dans la fiche déjà chargée (aucune requête de plus) ;
    - bouton « Effacer les réglages du marchand » →
      `POST /api/admin/workflows/:id/effacer-reglages-marchand`, réservé à l'admin
      (403 avec un jeton marchand, 404 si le marchand est inconnu) ;
    - texte d'aide : les champs sont le réglage WinWin, par défaut.
  - Preuves : `npm test` 301/301. Test navigateur avec capture de la fiche admin.
    Contre-épreuve sur `45a72b2` : 300/301, le seul échec est le nouveau contrôle.
  - Pas de migration. Mise en production : un push.
  - Capture validée et feu vert de Yass. Poussé à **09:05 UTC** en avance rapide
    sur `claude/keen-goldberg-MXslu` (`45a72b2` → `87c8a20`). Contrôles de Yass
    (14/10) : déploiement vert, contrôles bons.

## 15 tresquinquagies. f10 NOTIFICATION GÉOLOCALISÉE : DIAGNOSTIC (14/10, rien codé)

Décisions de Yass :
- adresses et horaires saisis par Yass dans l'admin, sans restriction de forfait ;
- texte = prénom + produit favori ; à défaut, le solde (comme le texte du boost) ;
- active uniquement aux heures d'ouverture.

État du code, prouvé par grep :
- aucun champ `locations`, `relevantText` ou `relevantDates` dans
  `src/services/apple-pass.js` ;
- aucune colonne de coordonnées, d'horaires ou de produit favori. Seule existe
  `marchands.adresse` (texte, migration 014).

Ce que disent les documentations (non vérifié sur un vrai iPhone) :
- **Apple** :
  - `locations` : 10 au maximum par carte, chacune avec son propre
    `relevantText`. C'est une suggestion passive sur l'écran verrouillé, pas une
    notification sonore.
  - `relevantDates` (iOS 18) : tableau de fenêtres de dates d'au plus un jour
    chacune. Rien ne confirme que la carte de fidélité (storeCard) les respecte,
    ni qu'elles se combinent avec les lieux.
- **Google** : « Passes à proximité » (release notes d'octobre 2025) :
  - `merchantLocations`, 10 par classe et 10 par objet ;
  - Google choisit la distance, la durée et le texte ;
  - aucun réglage d'horaires.

La carte Apple est déjà régénérée à chaque mise à jour poussée, donc à chaque scan :
`relevantText` peut contenir le solde à jour sans aucun envoi supplémentaire.
Le rapport à Yass comporte les options et la recommandation.

## 15 quatuorquinquagies. f18 « RETOUCHES MES SMART NOTIFICATIONS » (14/10, codé en local, rien poussé)

### Demande de Yass

1. Message du boost modifiable par l'admin et par le marchand, comme le message
   d'inactivité :
   - 150 caractères maximum, sans lien ;
   - mot réservé `{reste}` obligatoire, singulier et pluriel gérés ; prénom en
     option ;
   - le texte actuel devient le texte WinWin par défaut.
2. Bloc plus léger :
   - une phrase courte ;
   - une ligne courte par smart notification ;
   - compteur sur une ligne ;
   - réglages derrière « Modifier » ;
   - place prévue pour « À proximité » (f10).

### Livré (commit local `4402c0c`)

- **Migration 061** : `workflow_near_reward_message` (admin) et
  `marchand_near_reward_message` (marchand). Contrainte
  `marchands_message_boost_check` : 1 à 150 caractères et `{reste}` présent.
- `src/services/smart-messages.js` : la seule définition, partagée par le cron, le
  dashboard et l'admin.
  - Lien interdit, 150 caractères, `{reste}` obligatoire.
  - Texte WinWin du boost ; `reste(n)` → « 1 tampon » / « 2 points »
    (en : point / stamp).
- Cron : message du marchand, sinon celui de l'admin, sinon le texte WinWin.
  `{reste}` et `{nom}` sont remplacés ; `{prenom}` l'est client par client par la
  base.
- Bloc du dashboard :
  - « Envoyées automatiquement à vos clients. » ;
  - « Relance · après 21 j », « Boost · à 2 tampons », « Anniversaire »,
    « Avis Google » ;
  - compteur et bouton « Modifier » ;
  - le formulaire contient le délai, le message de relance, le seuil et le
    message du boost.
  - `proximite` est prévu dans la réponse (faux tant que f10 n'existe pas).
- Admin :
  - champ « Message du boost » dans la fiche, contrôlé par la route admin (400
    lisible) ;
  - le bloc orange affiche aussi le message du boost réglé par le marchand ;
  - « Effacer » et « Revenir au réglage WinWin » effacent aussi ce message.

### Preuves

- `npm test` : 304/304.
- Test navigateur : 6/6, captures vérifiées (bloc, formulaire ouvert, sans
  premium, tampons, fiche admin). Le rapport est vérifié au singulier, à zéro et
  au pluriel.
- Captures validées par Yass, avec une modification : le libellé du compteur.

### En production (14/10)

- Migration 061 exécutée par Yass : 2 × true.
- Feu vert. Poussé à **10:35:28 UTC** en avance rapide sur `claude/keen-goldberg-MXslu`
  (`87c8a20` → `a0e044b`).
- Contrôles de Yass (14/10) : déploiement vert, contrôles f18 bons.
- Contre-épreuve sur `87c8a20` : 297/304. Les 7 échecs portent tous sur f18.

### Décisions de Yass pour la suite de f10 (14/10)

- **iPhone ET Android.** La décision « iPhone uniquement » est **annulée** par
  Yass le même jour, au vu des chiffres : environ 670 cartes Google actives, et 10
  à 300 appels Google par jour chez les marchands actifs.
- **Android** :
  - `merchantLocations` posé sur la classe du marchand, une classe par marchand
    (`classId` dans `google-pass.js:50`) ;
  - adresses ajoutées à l'ouverture et retirées à la fermeture : 2 appels par
    jour et par marchand ;
  - texte choisi par Google ;
  - mêmes appels Google que le reste, jamais en rafale.
  - Condition posée par Yass : on arrête si le risque de surcharge ou de
    scalabilité est réel (évaluation dans le rapport du 14/10).
- **iPhone** : inchangé. `locations` et `relevantText` (prénom + produit favori,
  sinon solde, façon boost), et `relevantDates` si le test iPhone le valide.
- Produit favori : saisi uniquement par le client sur la landing, plus tard avec
  f06. Sinon, et pour toutes les cartes existantes, le message de repli.
- Horaires par boutique, saisis par Yass en admin.
- Ligne « À proximité » dans « Mes smart notifications » : mentionnée, sans
  compteur.
- Prochaine étape : la carte de test iPhone seule (feu vert de Yass), puis un test
  Android équivalent.
- **Mise à jour (14/10, plus tard) : Android est mis de côté** par Yass (« trop de
  restrictions » : texte imposé par Google, localisation permanente obligatoire,
  test de la notification parasite). f10 se fait **sur iPhone seulement**.
- Fuseau horaire : au plus simple. Yass saisit les horaires d'ouverture déjà
  convertis en heure UTC ; aucun fuseau n'est stocké.
- **Carte de test iPhone (14/10, provisoire)** : `carteTestGeo` dans
  `src/services/apple-pass.js`.
  - Elle n'agit que si la variable Railway `CARTE_TEST_GEO` désigne exactement le
    numéro de série de la carte : celle de Test Docker chez hamza-salon,
    `1fdd5493-3b78-42e0-8072-38e2fe0a7a61`.
  - La carte reçoit alors `locations` (1 adresse, avec le texte de repli prénom +
    solde) et `relevantDates` (1 créneau).
  - Toute autre carte est inchangée (filet, section 25).
  - Retour arrière : supprimer la variable, puis un scan.
  - **À retirer au code définitif de f10.**
  - Feu vert de Yass. Poussé à **11:26:32 UTC** en avance rapide sur
    `claude/keen-goldberg-MXslu` (`a0e044b` → `4446e38`). Créneau proposé :
    11:45–12:15 UTC.
  - **Résultat du test sur l'iPhone de Yass (14/10)** :
    - rien jusqu'à 15:52 (Dubaï). La localisation de l'app Cartes (Wallet) était
      désactivée sur l'iPhone ; Yass l'a activée en « lorsque l'app est active » ;
    - la carte est ensuite apparue sur l'écran verrouillé, sur place, dans le
      créneau, avec le texte de repli ;
    - elle s'est retirée vers 16:17, soit environ 2 minutes après la fin du
      créneau (16:15) ; Yass avait aussi fermé l'app Cartes ;
    - elle n'est pas revenue en rouvrant l'app, hors créneau.
  - **Conclusion** :
    - sur une carte de fidélité, `locations` + `relevantDates` fonctionnent sur cet
      iPhone : l'affichage est limité au créneau ;
    - limite : il faut que la localisation de l'app Cartes soit activée, ce qui
      n'était pas le cas par défaut chez Yass ;
    - constat de Yass : ce n'est pas une notification. La suggestion ne se balaie
      pas et reste affichée tant qu'on est sur place dans le créneau (« très
      collante »). Décision produit posée à Yass.
  - **Décisions de Yass (14/10, après le test)** :
    - pas de réduction du rayon ;
    - le test est une réussite, mais il reste à refaire **en se déplaçant** :
      Yass a dû ouvrir et refermer l'app, ce qui fausse un peu le rendu ;
    - f10 peut être mis en place, **comme un workflow activable ou non par
      marchand depuis l'admin**.

## 15 quinquinquagies. f10 « À PROXIMITÉ » SUR IPHONE : CODÉ EN LOCAL (14/10, rien poussé)

### Décisions de Yass (14/10)

- iPhone seul ; Android mis de côté.
- Activable par marchand depuis l'admin, sans restriction de forfait.
- Pas de réduction du rayon.
- Horaires saisis en UTC.
- Union des horaires de tous les lieux : une boutique fermée peut apparaître
  pendant qu'une autre est ouverte (marge d'erreur acceptée).
- Pas de classement des boutiques par fréquentation.
- Mise à jour mensuelle automatique acceptée : elle est sans risque de surcharge.
- Texte : produit favori plus tard (f06), sinon le repli prénom + solde.
- Ligne « À proximité » sans compteur.

### Livré (commits locaux `b6533a4`, filet tolérant ensuite)

- **Migration 062** :
  - `marchands.geo_actif` ;
  - `marchands.geo_lieux` (jsonb, 10 au plus : nom, lat, lng, horaires
    `{"1".."7": ["HH:MM-HH:MM"]}` en UTC) ;
  - source `geo` ajoutée au registre `notification_envois`.
- `src/services/geo.js` :
  - `validerLieux` ;
  - `creneaux` : union des horaires, plages fusionnées, 60 jours, créneaux
    terminés retirés, 24:00 → 23:59:59 ;
  - `texteProximite` (repli) ;
  - `champsPass` : rien si f10 inactif, sans lieu ou sans horaire ;
  - `rafraichir` : par lots de 30, `passes.updated_at` avancé (sinon l'iPhone
    reçoit 304), un push silencieux par iPhone au débit partagé, registre
    `geo` ;
  - `rafraichirTous`.
- Carte Apple (`apple-pass.js`) : `locations` et `relevantDates` ajoutés si f10
  est actif. Colonnes lues avec la carte, dans la même requête
  (`apple-wallet.js`, `passes.js`).
- **Carte de test provisoire retirée** : la variable `CARTE_TEST_GEO` n'a plus
  d'effet, Yass peut la supprimer.
- Cron : le 1er du mois à 02:00 UTC, `rafraichirTous`, arrêté avec la
  planification.
- Admin :
  - section « Notification à proximité » : interrupteur, lieux, 7 jours en UTC ;
  - route contrôlée (400 lisible) ;
  - mise à jour des cartes en arrière-plan **seulement si** l'interrupteur ou les
    lieux ont réellement changé, car la fiche renvoie tous les champs à chaque
    enregistrement.
- Dashboard : `proximite` dans le bloc ; ligne « À proximité » sans compteur.

### Preuves

- `npm test` : 313/313. Section 25 : 10 contrôles (lieux, créneaux, carte, admin,
  bloc, mise à jour silencieuse et mensuelle).
- Test navigateur : 8/8, dont la fiche admin (capture) et le bloc tampons avec
  « À proximité ».
- Contre-épreuve sur `4446e38` : 304/305. Le seul échec est l'absence de
  `services/geo.js`.

### Vérifications demandées par Yass avant la 062 (14/10)

- **Droits** : la 062 ne crée ni table, ni fonction, ni vue (grep : aucun
  `CREATE TABLE`, `CREATE FUNCTION` ou `GRANT`). Elle ajoute deux colonnes à
  `marchands` et change la contrainte de `notification_envois`. Les droits de
  `service_role` sur ces tables existantes couvrent les nouvelles colonnes : il
  n'y a pas de piège 028/030 ici.
- **Retour arrière réel** : l'ancien code `4446e38` a été joué sur une base qui
  porte la 062 (62 fichiers rejoués, section 0 des droits comprise) : **306/306**.
- **Point d'attention** : `4446e38` contient encore la carte de test provisoire.
  En cas de retour arrière, la variable `CARTE_TEST_GEO` doit avoir été supprimée,
  sinon la carte de Test Docker retrouverait l'adresse et le créneau du test.

### En production (14/10)

- Migration 062 exécutée par Yass : 3 × true.
- Feu vert. Poussé à **13:26:30 UTC** en avance rapide sur
  `claude/keen-goldberg-MXslu` (`4446e38` → `70caa3c`).
- f10 éteint chez tout le monde (`geo_actif` à false) jusqu'au test de Yass en se
  déplaçant, chez hamza-salon.
- Contrôles de Yass (14/10) : déploiement vert, `CARTE_TEST_GEO` supprimée,
  section admin visible.
- Test en se déplaçant (14/10, soir) :
  - f10 activé chez hamza-salon, avec un lieu à 1 km de chez Yass ;
  - créneau d'abord saisi en « 22-23 » (confusion UTC / heure de Dubaï), corrigé
    en `14:30-15:30` UTC tous les jours ;
  - journal : `[geo] mise à jour (admin) … : 2 iPhone, 0 erreur(s)` (cartes Test
    Docker et Yacine) ;
  - créneau final : `14:00-17:00` UTC (18:00–21:00 à Dubaï) ;
  - observations de Yass :
    - arrivé sur place à 19:10, sans ouvrir l'app Cartes ;
    - la carte de **Test Docker seulement** est apparue vers **19:40**, soit
      environ 30 minutes plus tard ;
    - elle **est repartie alors que Yass était toujours sur place**, dans le
      créneau, contrairement au premier test où elle restait « collante » ;
    - la carte Yacine n'est pas apparue ;
  - conclusion : le déclenchement **réel, sans toucher au téléphone, fonctionne**.
    Mais iOS décide seul du moment, de la durée et de la carte affichée (une sur
    deux). C'est une suggestion « au mieux », pas une notification garantie. À
    présenter ainsi aux marchands.
  - contrôle « hors créneau » : la suggestion n'est plus là, rien après le créneau.
    Bon.
  - Question de Yass : le créneau rend-il la fonction moins efficace ? Personne
    ne sait (Apple ne documente pas ce cas).
  - Test proposé, sans code : `00:00-24:00` tous les jours chez hamza-salon,
    2 ou 3 passages, en notant le délai et la durée. Si le comportement est le
    même, c'est iOS ; sinon, comparer avec une carte sans créneau (petite
    modification du code).
- Leçon : la saisie en UTC prête à confusion. À surveiller (aide de saisie
  possible : afficher l'heure de Dubaï correspondante).

### Hypothèses et limites

- **Hypothèse** : iOS respecte `relevantDates` sur une carte de fidélité,
  vérifié une fois chez Yass. Le test en se déplaçant reste à faire.
- Il faut que l'app Cartes ait accès à la localisation, ce qui est hors de notre
  main. La portée réelle sera donc plus faible que le nombre de cartes iPhone.
- **Il n'y a pas de limite documentée** au nombre de créneaux par carte. Avec 2
  plages par jour, une carte en porte environ 120 sur 60 jours.
- Une carte est fabriquée avec les créneaux des 60 prochains jours ; la mise à
  jour mensuelle les prolonge. Si elle échoue un mois, les clients actifs restent
  couverts par leurs scans, les inactifs le mois suivant.
- La suggestion « colle » sur l'écran verrouillé tant qu'on est dans la zone,
  pendant un créneau (constat de Yass).
- La ligne « À proximité » n'apparaît qu'aux forfaits Pro et Pro+, comme tout le
  bloc ; f10 fonctionne pourtant pour tous les forfaits.

## 15 sexquinquagies. f17 CARTES À THÈME : DIAGNOSTIC (14/10, rien codé)

Demande du pilotage :
- un onglet « Ma carte » en self-service, réservé à Pro+ ;
- le marchand voit l'aperçu de la carte standard et de chaque thème préparé
  pour lui ;
- un thème = couleurs + logo préfabriqué + texte court sous le prénom ;
- le marchand fixe des dates de début et de fin ;
- notification à l'ouverture, retour silencieux à la fin ;
- un seul thème à la fois ;
- les nouveaux inscrits reçoivent le thème ;
- ni rafale, ni effet sur la caisse ;
- le thème s'applique aussi aux cartes Google.

Constats prouvés dans le code :
- La bannière (strip) est peinte sur `couleur_fond`
  (`strip-generator.js:276`, `bgSvg`). Le cache des bannières est indexé par
  (slug, `strip_config_version`, état) (`strip-cache.js:31`). Un thème qui change
  le fond oblige donc à redessiner les bannières : la progression reste la même,
  seul l'arrière-plan change.
- Apple : la ligne sous le prénom (`auxiliaryFields`) est vide. La notification
  existe déjà, par `notification_txt` et `changeMessage`, comme pour les
  campagnes.
- Google :
  - le logo (`programLogo`) et le fond (`hexBackgroundColor`) sont portés par la
    classe, une par marchand. Une mise à jour de la classe suffit donc, en un seul
    appel ;
  - mais l'objet surcharge le fond quand `couleur_fond_reward` est défini, ou en
    état de récompense (`google-pass.js:292`). Ces cartes demandent une mise à
    jour objet par objet ;
  - la bannière Google (hero) est la même bannière peinte sur le fond ;
  - l'admin réécrit la classe entière (`createOrUpdateLoyaltyClass`) : elle devra
    tenir compte du thème en cours.
- Le mécanisme d'envoi existe déjà : lots, débit partagé, cartes marquées
  modifiées, registre (campagnes t37, `rafraichir` de f10).
- Environnement de test `winwin-campagne-15` : il existe encore, supprimé au plus
  tard le 31/10. Il n'a pas les clés Apple : on y teste la charge (pas de
  rafale, caisse non ralentie), pas le rendu sur un iPhone.

Rapport, recommandations et décisions demandées : envoyés au pilotage le 14/10.

**Réponses du pilotage (14/10)** :
- feu vert sur le diagnostic ;
- fond de la bannière : redessinée sur le fond du thème, mise en cache (option a) ;
- le doré de la récompense garde la priorité pendant un thème ;
- la notification d'ouverture ne compte pas dans le quota, et son texte est préparé
  par nous avec le thème ;
- pas de test de charge dédié : la bascule réutilise le débit t37. Validation par
  le filet et par le rendu réel sur un marchand de test. Tenue combinée revue au
  réaudit t41.

**Coût et risques, mesurés avant le code (14/10)** :
- Une bannière générée (3 variantes) pèse **14 Ko** mesurés pour un thème simple,
  et environ 60 Ko au plus avec des pastilles chargées. Un thème complet :
  - en tampons (seuil 10) : 11 états ;
  - en points : 21 paliers ;
  - soit 0,2 à 1,3 Mo de bannières, plus les logos (moins de 0,5 Mo), plus la
    configuration (environ 1 Ko).
- Tout cela vit dans Supabase Storage (bucket `passes`), pas sur le disque de la
  base. Les bannières d'un thème terminé sont purgées par la même méthode que
  `strip-cache.js` (purge par lots, sans rafale).
- Endroits qui fabriquent une carte et devront lire le thème :
  - `apple-pass.js` : `generateApplePass` et `buildPassJson`, appelés par
    `apple-wallet.js` (mises à jour iPhone) et `passes.js` (téléchargement) ;
  - `strip-cache.js` : `getOrGenerate` et `getPublicUrl` (Apple et la bannière
    Google) ;
  - `google-pass.js` : `buildLoyaltyClass` (appelée par
    `createOrUpdateLoyaltyClass`, 5 appels dans `admin.js`, et par
    `generateGoogleWalletUrl`), `buildLoyaltyObject` (inscription,
    `clients.js:93` et `google-wallet.js`) et `updateLoyaltyObjectPoints`
    (scan, ajustement) ;
  - aperçu de bannière (`admin.js:448`) et le futur aperçu « Ma carte ».
  - Ils lisent la fiche marchand par environ 7 `select` distincts : une seule
    colonne `theme_actif` (instantané du thème en cours) à ajouter à chacun, et
    un test du filet par point d'entrée.
- Dashboard : `public/dashboard/index.html`, 155 Ko et 2 790 lignes, un seul
  `<script>` en ligne, 7 onglets. Une erreur de syntaxe n'importe où casse tout le
  dashboard.
  - Le service worker sert les fichiers JS « cache d'abord » (`sw.js`) : un fichier
    séparé doit être versionné.
  - Aujourd'hui, `npm test` ne charge pas le JavaScript du dashboard. Les tests
    navigateur (hors `npm test`) couvrent l'Aperçu, le Réseau, les Clients, la
    fiche client, les Notifications et la caisse, mais pas l'onglet Scans.

## 15 septquinquagies. f17 CARTES À THÈME : CODÉ EN LOCAL (14/10, rien poussé, migration 063 non exécutée)

Feu vert du pilotage : « Chiffrage validé, feu vert : tu codes », avec trois
non-négociables (tous livrés, voir plus bas) et la validation par le filet plus un
rendu réel sur un marchand de test.

### Livré (commits locaux)

- **Migration 063** (`database/migration_063_themes.sql`) :
  - table `themes_marchand` : nom, 3 couleurs, logo Apple, logo Google, texte de la
    case (40 car.), message d'ouverture (150 car.). RLS sans politique ; droits
    SELECT, INSERT, UPDATE, DELETE pour `service_role` seulement ;
  - `marchands.theme_actif` : copie du thème choisi + `debut`, `fin` (jours UTC),
    `etat` (`programme` | `en_cours`) ; garde-fou en base sur la forme ;
  - `marchands.theme_bascule` : avancement de la mise à jour des cartes ;
  - fonction `theme_lot_google` : cartes Google réelles (règle D2) avec prénom et
    solde, par lots ;
  - source `theme` ajoutée au registre `notification_envois` (CLAUDE.md).
- **`src/services/themes.js`** :
  - `appliquerTheme(marchand)` : **la seule fonction qui applique le thème**. Rend la
    fiche aux couleurs du thème quand `etat = en_cours`, la fiche telle quelle sinon.
    Idempotente (marqueur `_theme`) ;
  - `apercu`, `avecTheme` : aperçu « Ma carte » ;
  - `validerTheme`, `validerDates` ;
  - bascule : `ouvrir` (avec message), `fermer` (silencieuse), `lancer`, `passage`
    (cron), `planifierReprise` (démarrage du serveur).
- **Les 6 points d'entrée** qui fabriquent une carte appellent `appliquerTheme` :
  1. carte Apple (`generateApplePass` et `buildPassJson`). Le texte du thème va dans
     `auxiliaryFields`, la case sous le prénom, vide hors thème ;
  2. bannières (`strip-cache.js`, `getOrGenerate` et `getPublicUrl`), rangées dans
     `marchands/<slug>/theme/<id>/v<version>_<empreinte>/`, purgées à la fin du thème ;
  3. classe Google (`buildLoyaltyClass`) : fond, logo carré, texte du thème
     (`textModulesData` de la classe) ;
  4. carte Google à l'inscription (`buildLoyaltyObject`) ;
  5. mise à jour Google (`updateLoyaltyObjectPoints` : scan, ajustement, bascule) ;
  6. aperçu « Ma carte » (`themes.apercu`).
  Le filet vérifie chacun (section 26).
- **Colonne `theme_actif` ajoutée aux lectures** de la fiche : retour d'un iPhone
  (liste partagée, `services/colonnes-carte.js`), téléchargement (`passes.js`), scan
  (2 lectures), inscription et ajustement (`clients.js`), Google (`google-wallet.js`).
  L'admin lit déjà `*`. Aucune requête de plus.
- **Bascule** (ouverture et fin) :
  - la fiche change d'abord : toute carte fabriquée ensuite a le bon visuel (scan,
    nouvel inscrit, retour d'un iPhone) ;
  - puis les cartes installées, par lots :
    - iPhone : lots de 30, cartes marquées modifiées, message d'ouverture posé sur la
      carte (ouverture seulement), un push par iPhone au **débit partagé t37** ;
    - Google : la classe une fois, puis chaque carte réelle par lots de 50 toutes les
      10 s (comme les campagnes) : fond et bannière, plus le message à l'ouverture ;
  - avancement écrit après chaque lot. Reprise au curseur après un redémarrage : une
    fois au démarrage du serveur (après 60 s), puis au passage du cron ;
  - la bascule la plus récente remplace celle en cours ;
  - à la fin : bannières du thème purgées par lots.
- **Cron** : étape `themes` du passage de 08:00 UTC. Elle ouvre les thèmes dont le
  début est arrivé, ferme ceux dont la fin est passée et reprend les bascules
  inachevées. Le passage ne les attend pas.
- **Routes du marchand** (Pro+) :
  - `GET /api/merchants/me/themes` : carte standard + chaque thème avec son aperçu,
    thème choisi, bascule en cours ;
  - `POST /api/merchants/me/theme {theme_id, debut, fin}` : dates contrôlées (pas dans
    le passé, fin après début, début dans l'année, 3 mois au plus). Ouverture
    immédiate si le début est aujourd'hui. 409 si un thème est déjà en cours ;
  - `DELETE /api/merchants/me/theme` : arrêt ou annulation, retour silencieux.
- **Routes de l'admin** : thèmes d'un marchand (liste avec aperçus, création,
  modification, suppression, envoi des logos Apple et Google). Un thème choisi ne se
  modifie ni ne se supprime (409).
- **Dashboard** : onglet « Ma carte » (Pro+, `data-min-plan="pro_plus"`), tout son
  code dans **`public/dashboard/ma-carte.js`** (versionné `?v=1`). L'`index.html`
  ne reçoit que le panneau, le bouton, deux libellés, une ligne dans `switchTab` et la
  balise `<script>`. Si le fichier ne charge pas, l'onglet affiche « Onglet
  momentanément indisponible » et les autres fonctionnent. Monolithe non refactoré.
- **Admin** : section « Thèmes de carte » de la fiche marchand (Pro+).
- **Filets** (font partie de la livraison) :
  - **contrôle de syntaxe dans `npm test`** (`tests/syntaxe.js`) : compile sans les
    exécuter les scripts en ligne du dashboard, de l'admin et de la caisse, et
    chaque fichier JS du dashboard ;
  - **test navigateur « tous les onglets »** (`tests/navigateur/onglets.js`) :
    - chaque onglet s'ouvre sans erreur de page ni de console ;
    - « Ma carte » : choix, activation, arrêt ;
    - barre de 7 onglets à 375 px ;
    - `ma-carte.js` remplacé par un fichier invalide : seul cet onglet le dit.
  - filet section 26 : la fonction unique, les 6 points d'entrée, routes, dates,
    bascule (lots, D2, registre, reprise au curseur, fin silencieuse).

### Résultats

- `npm test` : **335/335**. Avec le test navigateur « tous les onglets » :
  **339/339**.
- Contre-épreuve sur le code de production `70caa3c` (filet neuf) : **316/317**. Le
  seul KO est « module services/themes.js présent » ; tout le reste passe sur
  l'ancien code, y compris le contrôle de syntaxe.
- Captures envoyées à Yass : `f17-1` à `f17-5`.

### Hypothèses (ce qui ferait casser) et limites

- Les dates sont des **jours UTC**. Ouverture au passage de 08:00 UTC du jour de
  début, ou tout de suite si le début est aujourd'hui. Fin au passage de 08:00 UTC
  du lendemain du jour de fin.
- La notification iPhone n'apparaît que si le message diffère du dernier message de
  la carte (iOS compare les valeurs). Réactiver le même thème ne renotifie pas les
  cartes qui l'ont déjà reçu.
- Google : `addMessage` est limité par Google à 3 par carte et par 24 h. Le texte du
  thème est posé sur la classe : **sa place exacte sur Android est à vérifier au
  rendu réel**.
- Après la fin, le message d'ouverture reste au dos de la carte iPhone jusqu'au
  prochain message (même comportement que les campagnes).
- Une seule bascule à la fois par marchand, dans un seul processus (règle « une
  seule instance », §15 duotricies).
- Les cartes à image fixe (`images_tiers`, `image_strip_url`) gardent leur image :
  le thème change leurs couleurs et leur logo, pas la bannière.
- Les aperçus « Ma carte » génèrent les bannières du thème dans Storage dès le
  premier affichage (environ 14 Ko par thème et par état affiché). Elles ne sont
  purgées qu'à la fin d'un thème activé : les thèmes jamais activés gardent leurs
  aperçus.
- L'aperçu de bannière de l'admin (`strip-preview`) reste celui de la carte
  standard : il sert à régler la carte standard.

### Reprise de l'aperçu « Ma carte » (14/10, demande du pilotage)

Retour du pilotage : les rectangles de l'aperçu ne montraient pas la carte. Le reste
de la livraison est validé tel quel.

- L'aperçu est désormais **la vraie carte**, disposée comme dans Wallet (maquette
  3 Poivres) :
  - logo à gauche, nom du marchand à droite ;
  - la **vraie bannière** (même cache, même générateur, même progression d'exemple),
    sur le fond du thème ;
  - CLIENT et PROGRESS, avec les libellés de la vraie carte ;
  - le texte de la case ;
  - un QR d'exemple.
- La bannière est servie dans la réponse (`data:` PNG, environ 5 à 20 Ko par carte).
  L'aperçu ne dépend donc pas de la lecture publique de Storage.
- Le logo est celui que la carte Apple affiche : celui du thème, sinon le logo de
  base. Le navigateur le charge depuis son adresse.
- Le filet vérifie que chaque bannière d'aperçu est générée et peinte sur le fond de
  sa carte, avec le bon logo et la progression.
- Le test navigateur vérifie que logo, bannière et QR sont chargés dans chaque
  aperçu. Les logos y sont servis par interception, faute de Storage dans le filet.
- Fidélité : couleurs, logo, bannière et textes sont les vrais. La mise en page
  imite Wallet sans en être une copie au pixel (polices, tailles).

### « La caisse prime » : aperçus préparés en admin (14/10, demande du pilotage)

- Côté marchand, `GET /me/themes` **lit le cache seulement** (`strip-cache.lireCache` :
  mémoire, puis Storage, jamais de génération). Une bannière absente du cache
  s'affiche « Aperçu de la bannière en préparation par WinWin ». Le QR d'exemple est
  calculé une fois par serveur, puis gardé en mémoire.
- Le calcul se fait en admin (`themes.preparerApercus`, carte standard puis chaque
  thème, l'un après l'autre, jamais en rafale) :
  - à la création ou à la modification d'un thème ;
  - à l'envoi d'un logo ;
  - à l'enregistrement de la fiche d'un marchand Pro+ (la version de bannière, les
    couleurs ou le logo ont pu changer) et à l'écriture des images par palier ;
  - à l'ouverture des thèmes dans la fiche admin (calcul synchrone, la liste
    affichée est donc prête).
- À la fin d'un thème, la purge de ses bannières **garde sa bannière d'aperçu** : le
  marchand la revoit sans recalcul.
- Filet : un thème posé sans passer par l'admin n'est jamais calculé côté marchand
  (ni à la 1re ni à la 2e ouverture) ; il l'est à l'ouverture de la fiche admin.
- `npm test` + test navigateur : **342/342**. Contre-épreuve sur `70caa3c` : 316/317 (seul KO attendu : module f17 absent).
- Limite (hors aperçu, inchangée, décision 1) : l'activation d'un thème fait
  générer les bannières des vraies cartes, à la bascule et au retour des iPhone.
  C'est en arrière-plan et une fois par état, pas sur une ouverture d'écran. On
  pourrait aussi les précalculer en admin (tous les états), mais cela coûte
  0,2 à 1,3 Mo de stockage par thème, même jamais activé.

### Précalcul de tous les états et interrupteur admin (14/10, demande du pilotage)

Le pilotage donne le feu vert au push : la fonction arrive dormante en production.
La mise en service chez de vrais marchands (thèmes, logos, ouverture) viendra plus
tard.

- **Option (b) : tous les états des vraies cartes sont précalculés en admin**, à la
  préparation (`themes.preparerApercus`, voir plus haut pour les moments
  déclencheurs) :
  - d'abord les aperçus, puis pour chaque thème chaque solde, avec les 3 variantes
    (Apple 2x, 3x, Google) ;
  - l'un après l'autre, avec une pause entre deux rendus ; une préparation à la
    fois par marchand ;
  - les bannières périmées du thème (ancienne version de bannière, ancienne
    empreinte de couleurs ou de logo) sont purgées à la préparation suivante.
- À l'activation, la bascule et le retour des iPhone ne font que **lire le cache**.
- Fin de thème : **plus de purge**. Les bannières restent pour une réactivation
  sans calcul (0,2 à 1,3 Mo par thème). Elles partent à la suppression du thème
  dans l'admin.
- **Limite, mode points** : la bannière dépend du solde exact (`valeurAffichee`,
  une image par valeur), il n'y a donc pas de liste finie d'états. On précalcule
  0 et les soldes détenus par les clients au moment de la préparation (1 000
  lignes lues au plus). Un solde apparu entre la préparation et l'activation est
  dessiné à la demande (environ 24 ms), comme la carte standard à chaque scan
  aujourd'hui. **Hypothèse : préparer (ou rouvrir la fiche admin) peu avant
  l'activation d'un marchand en points.** En tampons : tous les états, de 0 au
  seuil.
- Autre limite : si une préparation n'est pas finie ou a échoué, la carte n'est
  jamais bloquée. Le rendu se fait alors à la demande, comme avant.
- **Interrupteur de l'admin `marchands.themes_actifs`** (migration 063, faux
  partout : fonction dormante), comme la landing premium :
  - la case « Ouvrir les cartes à thème à ce marchand » apparaît dans la section
    « Thèmes de carte » de la fiche (Pro+) et s'enregistre avec la fiche ;
  - onglet « Ma carte » et routes du marchand : Pro+ **et** interrupteur ouvert
    (`GET /me` renvoie `themes_actifs`, le dashboard cache l'onglet sinon) ;
  - décocher pendant un thème le termine, avec un retour silencieux. Le passage du
    cron referme aussi un thème dont le marchand n'est plus ouvert.
- Tests : `npm test` **340/340** ; avec le test navigateur **345/345**.
  Contre-épreuve sur `70caa3c` : **316/317** (seul KO attendu : module f17 absent).

### En production (15/10)

- Avant de lancer la 063, Yass a vérifié en production la contrainte
  `notification_envois_source_check` (les 10 sources de la 062) et l'absence de
  source hors liste.
- Migration 063 exécutée par Yass : 6 × true (dont `dormant_ok`).
- Feu vert. Poussé en avance rapide sur `claude/keen-goldberg-MXslu`
  (`70caa3c` → ce commit), le 15/10 vers 08:40 UTC. Aucun créneau n'était imposé
  (CLAUDE.md).
- Fonction dormante : `themes_actifs` est à false partout, et aucun thème n'est
  préparé.

### Reste à faire

- Contrôles de Yass après déploiement :
  - l'onglet « Ma carte » est absent du dashboard d'un Pro+ ;
  - les autres onglets fonctionnent ;
  - la section « Thèmes de carte » de la fiche admin d'un Pro+ apparaît, case
    décochée.
- Mise en service réelle, plus tard : thèmes, logos, ouverture par marchand, puis
  rendu réel sur hamza-salon (iPhone, Android, arrêt silencieux, registre
  `theme`).
- Rendu réel sur hamza-salon (comme f10) :
  - préparer un thème dans l'admin, l'activer depuis « Ma carte » ;
  - contrôler : iPhone (couleurs, case, bannière, notification), Android, arrêt
    silencieux, registre `theme`.

## 15 octoquinquagies. t43 : CLÉ D'IDEMPOTENCE OBLIGATOIRE (code `2ed79b6`, EN PRODUCTION le 18/10, clos)

**Livré (en local)** :
- `scan.js` : sans clé (absente, `null` ou vide), réponse `400 { error: 'cle_idempotence
  required' }` avant toute lecture en base, et une ligne `[scan] ALERTE cle_idempotence
  manquante : marchand …, boutique …, rôle …` (`console.warn`). Aucune requête de plus en caisse.
- Pas de migration. La branche « sans clé » de `crediter_scan` (051) reste en place, inutilisée.
- Tests : les outils de test envoient une clé neuve à chaque scan ; le scénario « TRANSITION
  sans clé » (2 crédits) devient « sans clé ou clé vide → 400, rien crédité, aucune ligne,
  une alerte par refus au journal ». `lancer.js` passe le journal du serveur principal aux
  scénarios (`journalServeur`).
- Filet : 341/341 ; contre-épreuve sur la production 340/340.

**Diagnostic** : les deux écrans (scanner `index.html:1204`, dashboard `index.html:1905`)
envoient une clé à chaque scan, et personne d'autre n'appelle `POST /api/scan`. Le service
worker sert le HTML par le réseau d'abord, et le serveur l'envoie en `no-cache`. Restent
deux risques : une page jamais rechargée depuis le 04/10 (session jusqu'à 365 jours) ou un
repli hors ligne sur un vieux cache. La requête D les verrait.
**WAM** (premier client) a peut-être un écran ancien : d'où la condition (b), en 0.4.

**Retour arrière** : `git revert 2ed79b6` (code et tests ensemble), ou redéployer
dans Railway le déploiement précédent. En une ligne dans le code : remettre le test
`if (cle_idempotence !== undefined && …)` autour de la vérification d'UUID.

**Hypothèse** (ce qui le ferait casser) : un appelant hors du dépôt, sans clé. Il n'en
existe aucun aujourd'hui. La future API (étape 28) devra envoyer une clé.

**Contrôle après le push** : journaux Railway, chercher `ALERTE cle_idempotence` (aucune
ligne attendue), puis un scan réel en 200.

## 15 novoquinquagies. t42 SANTÉ DU CODE — PHASE 1 : DIAGNOSTIC (18/10, rien codé)

Banc : base locale au palier 50 000 (données de l'étape 15 : 100 000 porteurs dont le
marchand « plafond » à 50 000, 135 000 scans sur 90 j pour lui, 800 000 lignes de registre),
vrai serveur, PostgREST plafonné à 1 000 lignes, **100 ms ajoutées par appel à la base**
(trajet Amsterdam–Paris + passerelle, §15 decies). Script : non versionné (bloc de session).

### Volet 1 — Dashboard, onglet par onglet (palier 50 000)

| Onglet | À l'ouverture | Par action | Temps mesuré | Poids réponse |
|---|---|---|---|---|
| Aperçu | 4 en parallèle : `/me/stats` (rpc `apercu_stats`), `/me/qrcode`, `/me`, `/me/points-de-vente` ; gardé en mémoire ensuite | « Réessayer » : les 4 | stats 297 ms (plafond), 178 ms (réseau 20 000) ; autres 110–134 ms | 5 Ko |
| Réseau | 1 : `/me/group-stats` | renommer / couper une boutique : 1 | 666 ms (réseau 15 boutiques), **1 271 ms** (plafond) | 3 Ko |
| Clients | 1 page de 100 (`count exact`) | recherche (300 ms d'attente) : 1 ; page suivante : 1 ; fiche : 1 (4 lectures) ; prénom, solde, annulation, effacement : 1 chacun ; export : 1 lecture par 1 000 | page 155–177 ms, recherche 162–241 ms, fiche 213 ms, **export complet 6,3 s** (49 pages) | 19 Ko la page ; export 1,4 Mo |
| Scans | 1 : `/api/scan` (100 à 200 derniers) | rafraîchir : 1 | 109 ms | 23 Ko |
| Scanner | aucune (caméra) | 1 scan : 1 (+ renouvellement de session au besoin) | 331 ms (comme la caisse) | — |
| Notifs | 3 : historique, `/me/smart-notifications`, comptage `/destinataires` | changer de segment : 1 comptage ; envoyer : 1 | historique 108 ms, smart 119 ms, comptage « tous » **1,7 s**, **comptage ciblé : 503 après 5 s** (voir plus bas) | < 1 Ko |
| Ma carte | 1 : `/me/themes` (lecture du cache des bannières) | choisir / arrêter : 1 | 225 ms (3 thèmes) | 3 Ko + bannières |

Poids de page (dashboard) :
- `index.html` : 157 Ko brut, 40 Ko compressé (CSS 24 Ko, script en ligne 113 Ko) ;
- `ma-carte.js` : 15 Ko brut, 5 Ko compressé ;
- jsQR (CDN), chargé dans `<head>` sans `defer`, donc **bloquant à chaque ouverture**,
  même sans aller sur l'onglet Scanner ;
- **aucune compression côté Express** (pas de middleware) : à vérifier si Railway compresse
  (non vérifiable depuis le conteneur).
- Le HTML est en `no-cache` ; `ma-carte.js` est revalidé (304) à chaque chargement.

**Constat majeur (à remonter)** : les segments ciblés (inactifs 15/30/60 j, fidèles) ne
passent pas l'échelle.
- Coût direct en base (`compter_segment`) :

  | Taille du marchand | tous | inactifs | fidèles |
  |---|---|---|---|
  | 50 000 porteurs | 1,7 s | ≈ 40 s | 182 s |
  | 20 000 porteurs (réseau) | — | 6,8 s | 29,6 s |
  | 357 porteurs | — | 20 ms | 23 ms |
- Les lots d'envoi passent par la même fonction. Un lot « fidèles » (fidèles rares) prend
  118 s au palier 50 000.
- Deux causes, toutes deux par client :
  1. « pas relancé aujourd'hui » relit toutes les relances du jour du marchand (filtre sur
     `idx_wf_exec_marchand_date`) ;
  2. le plan générique de « fidèles » croise `idx_scans_client` avec `idx_scans_marchand_date`
     et relit les 45 000 scans du mois du marchand.
- Le coût croît comme le carré de la taille. Seuil de casse (503 à 5 s) : **≈ 8 000
  porteurs pour « fidèles »**, **≈ 15 000 pour « inactifs »**. Aucun marchand actuel n'en
  approche.
- **Correctif testé sur la base jetable** : deux index, `workflow_executions (client_id,
  executed_at)` et `scans (client_id, date_scan)`.
  - Résultat au palier 50 000 : tous les segments en ≈ 1,7–2 s, lot « fidèles » 2,2 s.
  - Coût : une entrée d'index de plus à chaque scan (négligeable, à mesurer au filet).
  - Migration à faire en `CREATE INDEX CONCURRENTLY`. **Proposition, rien fait.**

**Dette de §0.5 périmée** : `/me/stats` n'est plus tronqué (rpc `apercu_stats`, étape 26),
et la liste des clients est paginée avec un total exact (étape 21 ; 48 839 mesurés). Les deux
points « dette de justesse silencieuse » de §0.5 sont donc soldés.

**Lot EN PRODUCTION le 18/10** (`665f57a`, poussé dans `54a7768..c523bb3` à 16:12 UTC ; 064 exécutée avant, 065 après, 3 × true chacune ; contrôle de Yass bon) :
- migrations 064 (index, avant ou après le push) et 065 (`segment_valide` à 60 j
  seulement, **APRÈS** le push) ;
- menu du dashboard : Tous / Inactifs 60 j / Fidèles / boutiques ;
- filet 342/342 (deux fois), `segments_ecran.js` vert.
- Décision de Yass (18/10) : inactifs 60 j seulement. Le code proposait 15, 30 et 60
  jours (pas 30 et 90) : 15 et 30 sont retirés.

### Volet 2 — f17 à l'échelle

- **Débit partagé** : il ne couvre que les pushes Apple (`debit.js`). La voie Google d'une
  bascule a son propre rythme, 50 cartes par 10 s et 5 appels à la fois, **par marchand**.
  - Les ouvertures sont datées : le passage du cron ouvre tous les thèmes du jour d'un coup
    (`passage()` lance chaque bascule sans attendre la précédente).
  - Avec N marchands le même jour (fête nationale, Ramadan) : **N × 5 appels Google
    simultanés**, sans plafond global. **C'est la rafale qu'on s'interdit**, côté Google
    (quota de l'API Wallet non mesuré) et côté sorties réseau du serveur.
  - Côté Apple, pas de rafale. Mais une ouverture chez tous les marchands du banc (81 000
    inscriptions) occupe la file **7,5 h** à 30 par 10 s. Pendant ce temps, les campagnes et
    relances du cron attendent derrière, dans l'ordre d'arrivée.
- **Bascules répétées (activer / arrêter / réactiver)** :
  - aucune limite. Chaque ouverture renvoie le message à toutes les cartes, **hors quota**
    (décision 3) ;
  - un marchand peut donc notifier tous ses clients sans limite, gratuitement ;
  - chaque arrêt rebascule aussi toutes les cartes (en silence) ;
  - une demande pendant une bascule la remplace, et le curseur repart de zéro.
- **Modes points et tampons** :
  - tampons : 11 états par thème ;
  - points : une bannière par solde exact jusqu'à 5 000, soit jusqu'à ≈ 500 états par thème
    au seuil 500 (500 soldes distincts mesurés sur le réseau du banc) ;
  - rendu : 34 ms (tampons), 54 ms (points), 3 formats, sur le pool de 4 fils de `sharp`
    partagé avec le reste du serveur ;
  - préparation d'un thème en points : ≈ 27 s de rendu, 1 500 dépôts dans Storage,
    ≈ 37 Mo ;
  - les soldes absents de la préparation (lecture limitée à 1 000 clients) sont dessinés
    pendant la bascule, jusqu'à 5 à la fois par marchand, sur le serveur de la caisse ;
  - le cache mémoire des bannières (`MAX_LRU = 120`, commun à tous les marchands) sera vite
    saturé. Au-delà, chaque bannière est relue dans Storage (+ ≈ 100 ms par carte Apple
    servie).
- **ma-carte.js, interrupteur OFF puis ON** :
  - chargé dans les deux cas (balise en fin de page) : 5 Ko compressés, une revalidation ;
  - interrupteur OFF : l'onglet est caché, `/me/themes` n'est jamais appelé ;
  - interrupteur ON : 1 requête à l'ouverture de l'onglet seulement (225 ms) ;
  - **aucun effet sur les autres onglets ; aucun sur la caisse** (le scanner ne charge pas
    ce fichier). Côté serveur, seul effet en OFF : `appliquerTheme` (en mémoire) et 1
    lecture par jour au cron.
- **Double envoi shop-by-ness (98 envois Apple pour ≈ 49 cartes, 16/10)** : aucun doublon
  possible pour un même appareil et une même carte (unique `(device_id, serial_number)`).
  Trois causes possibles, à départager par la requête ci-dessous :
  - (a) **deux appareils par carte** (iPhone + Apple Watch, ou ancien téléphone resté
    inscrit) : envois légitimes ;
  - (b) **un même appareil porte plusieurs cartes du marchand** (cartes de test) : le
    jeton de push est le même pour toutes les cartes d'un appareil, et un seul push suffit
    (l'iPhone redemande alors toutes ses cartes modifiées). Correctif : un push par jeton
    distinct dans un lot ;
  - (c) **bascule exécutée deux fois en parallèle** : contrairement aux campagnes
    (`reprendre_campagnes`, prise atomique), une bascule n'a pas de propriétaire en base.
    Pendant un redéploiement, l'ancien serveur la finit (`arret.suivre`) pendant que le
    nouveau la reprend au bout de 60 s (`planifierReprise`). Les deux envoient les mêmes
    lots.
  - **Sur le débit** : dans les trois cas, les pushes passent par le débit partagé. Il n'y a
    donc pas de rafale côté Apple : seulement une durée doublée et des allers-retours
    d'iPhone en plus (304 pour la plupart).
  - Requête (lecture seule, Supabase) :
    ```sql
    SELECT count(*) AS envois, count(DISTINCT serial_number) AS cartes, count(DISTINCT token_hash) AS appareils,
           min(envoye_le) AS debut, max(envoye_le) AS fin
      FROM notification_envois e JOIN marchands m ON m.id = e.marchand_id
     WHERE m.slug ILIKE '%shop%' AND e.source = 'theme' AND e.plateforme = 'apple'
       AND e.envoye_le >= '2026-10-16' AND e.envoye_le < '2026-10-17';
    ```
    Lecture : appareils ≈ 98 → (a) ; appareils bien inférieurs à 98 → (b) ; appareils ≈ 49
    et deux vagues dans le temps → (c).
  - **Test du 18/10 (hamza-salon, 2 clients, changement de thème à 12:46 UTC)** : 2 envois
    Apple, 2 couples appareil + carte, **1 envoi par couple**. Une activation normale n'est
    **pas doublée** : la cause (c) n'est pas reproduite. Elle reste possible seulement si un
    redéploiement tombe pendant une bascule (non testé).
    - La vague du 15/10 (08:48–08:56, 7 envois pour 2 couples) regroupe plusieurs
      activations et arrêts du test du mécanisme en 8 minutes : ce n'est pas un doublon.
    - Pour shop-by-ness, il reste à départager (a) et (b) avec la requête ci-dessus.

**Jetons Apple par carte (question du pilotage, 18/10)** : shop-by-ness donne 98 envois
pour 49 cartes et 98 jetons. Lecture du code :
- **toutes les surfaces** (scan via `lireCanaux`, relances `reserver_relances`, campagnes,
  thèmes, géoloc, avis) envoient à **toutes** les lignes `device_tokens` d'une carte ;
- **aucune colonne** ne distingue un jeton actif d'un jeton périmé ;
- **aucun traitement des 410** (`Unregistered`) : le code ne retire jamais un jeton mort.
  Seul le `DELETE` d'Apple (carte retirée de l'appareil) supprime une ligne ;
- l'unicité `(device_id, serial_number)` fait qu'une réinscription du même appareil met
  la ligne à jour. Un nouveau `device_id` (restauration, nouveau téléphone, montre) crée
  en revanche une ligne de plus, qui reste pour toujours.

Requête de diagnostic prête : statut du dernier envoi de chaque jeton
(`md5(push_token)` = `token_hash`) sur 60 jours, pour shop-by-ness, boucherie et
bluemoon. **Résultat du 18/10** :

| marchand | cartes iPhone | 1 inscr. | 2 inscr. | 3+ | multi toutes vivantes | multi avec jeton mort | inscr. mortes |
|---|---|---|---|---|---|---|---|
| bluemoon-boston | 32 | 21 | 8 | 3 | 11 | 0 | 0 |
| boucherie-republique | 188 | 145 | 32 | 11 | 43 | 0 | 0 |
| shop-by-ness | 52 | 39 | 9 | 4 | 13 | 0 | 0 |

- **Aucun jeton mort** (aucun 410 sur 60 jours) : l'hypothèse « envoi vers des jetons
  morts » est écartée pour ces marchands.
- 75 à 80 % des cartes ont une seule inscription ; les autres ont des appareils que
  Apple accepte (200) : environ 1 sur 4 inscrit en même temps (montre), les autres plus
  tard (nouveau téléphone, iPad).
- Limite : Apple peut accepter un temps le jeton d'un appareil qui ne sert plus.
- **Le chiffre du 16/10 n'est pas expliqué par les jetons.** Avec ≈ 1,35 inscription par
  carte, une bascule chez shop-by-ness ferait ≈ 70 envois Apple, pas 98 pour 49 cartes.
  À vérifier : deux bascules le même jour (un changement de thème = fin du thème en
  cours + ouverture du nouveau, chacune pousse tous les appareils). Requête par vague
  prête, à lancer pour shop-by-ness.
- **Vagues du 16/10 (shop-by-ness)** : **une seule bascule** (08:09:14 → 08:09:42), 98 envois
  Apple pour 98 couples appareil + carte (**1 par couple**) sur 49 cartes, plus 4 Google. Pas
  de double bascule.
  - Requête « disparus » (18/10) : **les 98 inscriptions sont toujours là, toutes en 200** le
    16/10 et depuis. Aucun jeton mort, aucune inscription disparue. Mon estimation d'≈ 70
    inscriptions aujourd'hui était fausse : la colonne « 3 et plus » cachait le total.
  - Explication : 39 cartes × 1 + 9 × 2 = 57 ; les 4 cartes « 3 et plus » portent donc ≈ 41
    inscriptions (≈ 10 appareils chacune, sans doute des cartes de démonstration ou de
    l'équipe). La moyenne « 2 par carte » est un artefact de ces 4 cartes.
  - **Clos : pas de bug d'envoi, pas de rafale cachée.** Chaque envoi va à un appareil
    vivant qui porte la carte.
- **Dette latente, inchangée** : le code ne retire jamais un jeton déclaré mort (410).
  Rien à corriger aujourd'hui (0 mort), mais à traiter avec l'étape 23 de la synthèse
  (« jetons morts »).

### Volet 3 — Code mort (refait sur le code du 18/10)

Méthode : exports sans appelant, fonctions jamais appelées (src, écrans), routes sans
appelant dans les écrans ni chez un appelant externe connu (Apple, Google, cron, console
documentée), fonctions SQL sans appel.

| Candidat | Lignes | Preuve | Condition |
|---|---|---|---|
| `apns.sendPushNotification` | 11 | défini + exporté, 0 appel | aucune |
| `apple-pass.selectStripImageUrl` | 7 | 0 appel | aucune |
| `marchand-cache.viderTout` | 3 | défini + exporté, 0 appel | aucune |
| scanner `hide`, `timeAgo` ; landing `lighten`, `showSkeleton` | ≈ 18 | 0 appel dans leur page | aucune |
| `GET /api/clients/admin/all` | 15 | aucun écran, aucune doc | aucune |
| `GET /api/admin/google-wallet/diagnostic` + `getClassInfo` | 46 | aucun écran | Yass ne s'en sert pas en console |
| `GET /api/admin/debug/pass/:serial` | 42 | aucun écran, aucune doc | idem |
| `/api/google-wallet/pass/:serial` (+ montage) | 46 | aucun appelant (audit 04 §7.4 n° 4) | journaux Railway sans appel ; pas de P3 |
| `public/admin/preview.html` | 388 | aucun lien | Yass ne l'utilise pas |
| SQL `cartes_google_campagne` | ≈ 35 | « gardée pour l'ancien code » (059), plus appelée | migration `DROP` |

- **Total prouvable : ≈ 55 lignes sans condition, ≈ 560 avec conditions**, loin des
  ≈ 1 800 de l'audit. L'essentiel de ce chiffre était des « shrink » (refontes), pas des
  suppressions.
- Gardés : routes Apple `/v1/*`, `/api/passes/*` (lien des cartes),
  `/debug/certs`, re-synchronisation des classes et `workflows/trigger` (outils de console
  documentés), diagnostic caméra.
- Effort : ≈ 1 h pour le lot sans condition (filet + contre-épreuve) ; le lot conditionnel
  attend 3 réponses de Yass et un relevé des journaux.
- **Avis : pas un chantier à part.** Le lot sans condition peut entrer dans le découpage du
  dashboard, s'il touche les mêmes fichiers. Sinon on garde la liste.

### Recommandation : découpage par étapes, dashboard d'abord

1. **Préalables** (sinon le filet ne protège pas le découpage) : réparer les deux tests
   navigateur cassés (`fiche_annulation` 13b, `cle_ecrans`) et le test instable f17 (§16).
2. **Méthode** : le modèle de `ma-carte.js`.
   - Un fichier par onglet, en script simple (sans outil de construction), versionné
     (`?v=`), chargé à la première ouverture de l'onglet.
   - Le cœur reste dans `index.html` : état `S`, `api()`, `t()`, `esc()`, connexion,
     forfaits.
   - **Un onglet par push**, réversible seul, avec le filet + `onglets.js` à chaque fois.
3. **Ordre** : Notifs, Réseau, Scans, Clients (et fiche), Aperçu. **Scanner en dernier**,
   avec un module de clé d'idempotence commun au scanner et au dashboard (la règle est
   aujourd'hui recopiée dans les deux).
   - Au passage : jsQR chargé seulement par l'onglet Scanner, et compression des réponses.
4. **Hors périmètre pour l'instant** : la page scanner (règle n° 1, elle marche),
   `admin.js` et `strip-generator.js` (aucun gain marchand). À revoir après le dashboard.
- Pourquoi pas tout d'un coup : 2 800 lignes d'un bloc, impossible à relire ou à annuler
  proprement ; le pas à pas garde chaque push petit et réversible.

## 15 tricies sexagies. t42 DÉCOUPAGE DU DASHBOARD — ONGLET 1/6 : NOTIFICATIONS (18/10, `cfe7d42`)

**Modèle validé par le pilotage (vaut pour les 5 onglets suivants : Réseau, Scans, Clients,
Aperçu, Scanner en dernier ; ni la caisse ni l'admin) :**
- un fichier par onglet dans `public/dashboard/`, sur le modèle de `ma-carte.js` : HTML,
  style (préfixé `#tab-xxx`), textes FR/EN et logique ; une seule entrée globale
  (`window.Notifs`) ; n'écrit que dans son `#tab-xxx` ;
- le cœur (`index.html`) garde `api`, `esc`, `t`, `_lang`, `timeAgo`, `S`, la navigation, les
  forfaits, le style de base et les clés de texte partagées entre onglets (ex. `historyTitle`,
  aussi utilisée par Scans) ;
- **`?v=N` obligatoire** sur la balise, à changer à chaque modification du fichier : le
  service worker du dashboard sert les JS depuis son cache ;
- chargement en fin de page (pas à la première ouverture : à reconsidérer après les 6) ;
- `setLang` émet `ww-langue` : un onglet déjà construit refait ses textes (la langue n'est
  connue qu'au retour de `/me`, chargé par l'Aperçu) ;
- fichier en panne → seul l'onglet affiche « indisponible » (test dans `onglets.js`) ;
- un onglet par push ; contrôle à l'œil de Yass avant le suivant.

**Notifications** : `notifs.js` (≈ 460 lignes) ; `index.html` −304 lignes. Mêmes requêtes aux
mêmes moments (historique, comptage des destinataires, smart notifications). Correction du
plan : la clé `message` ne servait qu'à cet onglet, elle est partie avec lui.
- Tests : 424/424 (filet + 8 tests navigateur), dont trois nouveaux : syntaxe de
  `notifs.js`, langue changée après ouverture (textes refaits, saisie gardée, aucune
  requête), `notifs.js` cassé. Contre-épreuve sur la production : 342/342.
- Retour arrière : `git revert cfe7d42`.
- **Contrôle de Yass (18/10)** : déploiement vert, 6 points vérifiés à l'œil (onglet, menu à 60 j
  et comptage, compteur de caractères, historique, smart notifs « Modifier » / « Fermer »,
  saisie gardée et tout en français). **Onglet 1/6 validé.**
- Code mort repéré au passage, laissé tel quel : clés `noDevices`, `appleLine`,
  `googleLine`, `noDevicesShort` (et `received`) du dictionnaire, restes de l'affichage des
  campagnes d'avant t37.

**Onglet 2/6 : Réseau** (18/10, `4a73f06`) : `reseau.js` (`window.Reseau`) ; `index.html` −90 lignes.
- Restent au cœur, partagés avec l'Aperçu : `statsBlocHtml` / `statsPanneHtml` (mêmes cartes,
  vérifié par `apercu_ecrans.js`) et leurs clés `rsDistribTitle`, `rsLessThan`, `rsMoreThan`,
  `rsVisitsCaption`, `rsDistEmpty` ; la gestion des boutiques (`renderPdv`, `renamePdv`,
  `toggleActif`), affichée dans l'Aperçu, qui partira avec lui (5/6).
- **Fuite corrigée (décision du pilotage)** : la déconnexion n'oubliait pas `S.reseau`. Sans
  recharger la page, le compte réseau suivant voyait les chiffres du précédent. `Reseau.oublier()`
  à la déconnexion ; test dédié, qui échoue sur l'ancien dashboard.
- Tests : 428/428 (déconnexion puis autre réseau, tri par colonne, `reseau.js` cassé).
- Retour arrière : `git revert 4a73f06`.
- Code mort repéré : clés `rsPorteurs`, `rsActifs30`, `rsNouveaux`, `rsRetour`, `rsLoadError`.

**Onglet 3/6 : Scans** (18/10, `bf65066`) : `scans.js` (`window.Scans`) ; `index.html` −55 lignes.
- Restent au cœur : `timeAgo`, `colorFrom` (aussi Clients et fiche client), `S.maxValue`, les clés
  `historyTitle` (aussi Notifs), `scanAnnule` (aussi fiche client), `refresh`.
- Les trois relectures (scan depuis l'onglet Scanner, annulation ou ajustement dans la fiche
  client, déconnexion) appellent `Scans.oublier()` au lieu de `S.scans = null` : même
  comportement.
- Tests : 431/431 (relecture après un scan depuis l'onglet Scanner, `scans.js` cassé).
  Filet de la production : 344/344.
- Retour arrière : `git revert bf65066`.
- **Contrôle de Yass (18/10)** : onglet Scans validé à l'œil. (Réseau : le pilotage a enchaîné sur
  Scans après le contrôle, sans signaler de problème.)
- **Lieu et annulation depuis l'onglet Scans** (18/10, `abcede9`, chantier à part) :
  - `GET /api/scan?lieu=1` (dashboard seulement) ajoute `point_de_vente_id, points_de_vente(nom)`
    dans la même requête ; **la caisse lit sans ce paramètre : réponse inchangée** (testé) ;
  - « Annuler » réutilise l'annulation de la fiche client : même route, confirmation et refus ;
    bouton sur le dernier scan actif de chaque client ; garde-fous en base inchangés
    (`annuler_scan`, 052 : déjà annulé, plus le dernier mouvement, solde changé, verrou) ;
  - limite connue, inchangée : la date d'annulation est gardée (`annule_le`), pas son auteur
    (il faudrait une colonne, donc une migration ; non demandé) ;
  - tests 437/437 ; retour arrière : `git revert abcede9`.
- **Découpage en pause après cet onglet** (décision du pilotage) : Clients, Aperçu, puis Scanner
  la semaine suivante. Ensuite (chantier à part) : lieu de chaque scan et annulation depuis
  l'onglet Scans, en réutilisant l'annulation de la fiche client.

## 15 untriginta sexagies. API CAISSES — CADRAGE (19/10, rien codé)

**Nouveau cap (pilotage, 19/10)** : API caisses pour un premier client, **Black Tulip** (35 points
de vente, fleuristes, Dubaï, caisse maison). **t42 en pause** (3 onglets sur 6 découpés).
- Livrables dans **`docs/api/01-api-caisses-cadrage.md`** : A, brouillon du contrat (clé d'API
  par marchand, `POST /api/v1/ventes`, annulation par référence, idempotence par clé t43
  dérivée de la référence) ; B, 14 questions fermées pour leur technicien ; C, prérequis t17 et
  t23 (diagnostic).
- **Points durs à trancher** (pilotage) : conversion montant → points et plafond (99 §B2) ;
  **remboursement tardif** (`annuler_scan` n'annule que le dernier mouvement : il faudrait un
  mouvement inverse tracé, garde-fou d'argent qui change) ; récompense atteinte en caisse ;
  `CHECK` solde ≥ 0 ; colonne de canal. Plusieurs **migrations** (clés d'API, règle de
  conversion, canal, référence externe, `CHECK`).
- Briques : f02 et f03 couvertes, f05 en partie (dernier mouvement), f04 non nécessaire en
  variante 1.
- Prérequis : désinscription Apple à protéger (`verifyAppleToken`, petit, sans migration) ;
  quota manuel à valider (admin) ; t23 : copie des sauvegardes hors du compte Supabase (P4)
  avant l'ouverture, Point in Time (P5) à décider.
- **Aucun code** avant validation du contrat et réponses du technicien.

## 15 duotriginta sexagies. API CAISSES — DÉCISIONS, LOT 1 (PLAN) ET ADDENDUM f04 (19/10, rien codé)

**Décisions du pilotage (19/10)**, reportées dans `docs/api/01-api-caisses-cadrage.md` A.5 :
conversion montant → points par **règle propre au marchand** + **plafond par vente très élevé**
(garde-fou anti-saisie absurde) ; **pas de remboursement tardif** (annulation du dernier
mouvement seulement, **f05 tombe**) ; **`CHECK` solde ≥ 0** en base ; **colonne `canal`**
(`comptoir` / `caisse`). Deux questions ajoutées au technicien (B15 téléphone joint à la vente,
B16 export) et B9 complétée (refus d'annulation sans boucle).

**Lot 1, plan de code** (doc §C, à valider avant code) : t17 a, contrôle du jeton à la
désinscription Apple (une ligne, 401 sinon) ; t17 b, quota manuel entier de 0 à 1 000 (400
sinon, admin seul, écran admin aligné) ; t23, copie nocturne chiffrée (`pg_dump` + AES-256)
vers Backblaze B2 UE avec verrou 30 jours et clé en écriture seule, lancée par une tâche
planifiée GitHub Actions (hors du serveur), restaurée à blanc à chaque nuit pour contrôle.
Hypothèses et limites écrites au doc (P5 reporté, fichiers du stockage non copiés, branche par
défaut du dépôt = branche du site).
- Requête préalable, lecture seule : `database/requetes/prealables_lot1_api.sql` (quotas hors
  bornes, droit `BYPASSRLS` du rôle courant, soldes négatifs, téléphones déjà en base).

**Addendum f04** (doc §D) : aujourd'hui **aucune récupération** de carte hors du navigateur
d'origine (stockage local de la page d'inscription) ; changement de téléphone = nouvelle carte à
0. Proposition : `telephone_normalise` + index unique par marchand, source et date ; trois
chemins d'attache (joint à l'appel de vente de l'API, bouton « + numéro » au comptoir hors du
scan, import de paires) ; récupération au comptoir par numéro → prénom + solde vérifiés par le
caissier → QR de réinstallation à usage limité de la **même** carte. Code SMS / e-mail noté en
amélioration, pas en barrage. Limite : aucune clé commune entre leurs fiches et nos cartes, le
rattrapage se fait surtout au fil des ventes.

**Décisions hors pilotage** (à valider) : borne du quota à 1 000 ; Backblaze B2 (UE) et GitHub
Actions pour t23 ; verrou 30 jours, rétention 90 jours ; un numéro = une carte par marchand ;
pas de fusion automatique de cartes.

## 15 tritriginta sexagies. t17 : DÉSINSCRIPTION APPLE CONTRÔLÉE, QUOTA MANUEL BORNÉ (19/10, `34073a2`, poussé)

**Validé par le pilotage** (19/10) : plan du Lot 1 et les 4 choix (borne 1 000 ; Backblaze +
GitHub ; 30 j / 90 j ; un numéro = une carte sans fusion). Récupération de carte ouverte à
tous les forfaits. Requête préalable : 0 quota hors bornes, 0 solde négatif, 11 numéros sans
doublon.

**Livré (code)** :
- `src/routes/apple-wallet.js` : `DELETE /v1/devices/…/registrations/…` vérifie le jeton de la
  carte (`verifyAppleToken`), 401 sinon, rien d'effacé. La panne de base reste 503.
- `src/routes/admin.js` : `notification_quota_override` = `null` / vide (forfait) ou entier de 0
  à 1 000, sinon 400 « Quota notifs : entier de 0 à 1000 ». Un nombre en texte (« 5 ») est
  refusé : l'écran admin envoie un nombre (`quotaManuel`). Écran admin : `max="1000"`.
- Filet : 4 contrôles (`tests/scenarios.js`, §10 et §17). 349/349. **Contre-épreuve** : les
  mêmes tests sur le code en production → 347/349, les 2 nouveaux échouent (prod : quota
  [200,200,500,500,200,500], désinscription sans jeton 200). Suite complète (navigateur
  compris) : 441/441.

**Hypothèse** : Apple envoie l'en-tête `ApplePass` à la désinscription. Sinon : désinscription
refusée, jeton gardé, un envoi perdu (dette 410 connue). À surveiller : `DELETE /v1/devices`
en 401 dans les journaux Railway les jours suivants.

**Correction** : le `CHECK` solde ≥ 0 du contrat API existe déjà (migration 051) ; doc A.5-4
corrigé, plus de migration à prévoir pour ce point.

## 16. DETTE — MISE À JOUR (compléter §4)

### Petits correctifs à glisser plus tard (décision du pilotage, 13/10)

1. ~~**JSON mal formé → 500 au lieu de 400**~~ : **corrigé à l'étape 21** (`3fc9ee8`,
   §15 unquadragies). (`src/index.js`, gestionnaire d'erreurs global.)
   - Le lecteur de corps marque l'erreur 400 (`err.status`), et le gestionnaire
     répond toujours 500 « Internal server error ».
   - C'est pareil sous Express 4 et sous Express 5.
   - Correctif : renvoyer `err.status` quand il vaut 4xx (une ligne), avec un test
     « JSON mal formé → 400 ».
   - À glisser dans un prochain push qui touche `index.js`.
2. **Tests navigateur joués à la suite** : les 4 fichiers de `tests/navigateur/`
   enchaînés (`FILET_EN_PLUS=a,b,c,d`) bloquent sur la fiche client (attente de 30 s
   dépassée).
   - C'est pareil sous Express 4 (`e90f554`) ; chacun passe seul.
   - Cause probable : la limite globale de requêtes par adresse (300 / 15 min),
     épuisée par la série.
   - Correctif côté banc seulement : relever la limite pour le serveur du filet
     (variable d'environnement de test), ou un serveur neuf par fichier.
   - Rien à changer en production.

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
- ~~**`railway.toml` cesse d'être lu le 2026-12-01**~~ **CLOS le 04/10** (étape 8,
  push 2b, `5630092` ; les réglages ont été reposés dans le tableau de bord et vérifiés
  par Yass ; confirmé le 15/10). Texte d'origine :
  **ÉCHÉANCE ABSENTE DE L'AUDIT (découverte le 2026-09-29).** Documentation Railway (`railwayapp/docs`,
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

- **Filet instable et tests navigateur cassés : RÉPARÉS le 18/10** (préalable du découpage du
  dashboard). Causes réelles :
  - **les deux tests navigateur** recevaient des **429** : les scénarios épuisaient le limiteur
    global (300 / 15 min / adresse) avant eux. Désormais, chaque module `FILET_EN_PLUS` a son
    propre serveur neuf (`tests/lancer.js`). `onglets.js` prépare ses aperçus en admin sur ce
    serveur ;
  - **le test f17 « la caisse prime »** tourne sur un marchand à part (aucune préparation en
    arrière-plan en cours).
  - Preuve : 8 passages de suite à 342/342 ; suite navigateur complète **421/421** (8 modules).
  - Lancement de la suite complète, depuis `winwincard/backend` :
    `NODE_PATH=/opt/node22/lib/node_modules FILET_EN_PLUS=$(ls tests/navigateur/*.js | tr '\n' ',' | sed 's/,$//') npm test`
- **(historique) Filet instable (découvert le 17/10, t43)** : le scénario f17 « la caisse prime »
  (section 26) échoue environ 1 fois sur 3 à 4, **aussi sur le commit de production**
  (339/340). Cause probable : la préparation d'aperçus lancée en arrière-plan par la
  création admin des thèmes (`admin.js:994`, `suivre(preparerApercus)`) relit la liste
  après l'insertion du thème « Hiver » du test et le prépare. Rien en production. **À
  corriger avant la phase 2 du filet** (sinon fausse alerte en CI).
- **Tests navigateur cassés sur la production (17/10)** : `fiche_annulation.js`
  s'interrompt en 13b (`Cannot read properties of undefined (reading 'id')`) et
  `cle_ecrans.js` s'arrête sur une attente de 30 s (« scanner (tampons) »). Mêmes erreurs
  sur le commit de production, donc antérieures à t43. `caisse_erreurs.js` passe. Non
  examinés plus loin.

## 17. DÉCISIONS HORS PILOTAGE

Toute décision prise sans passer par le pilotage (Yass) se note ici : date, décision,
raison, effet constaté. Une entrée vaut aveu, pas justification — la règle reste le
contrat §7 (diagnostic, validation, puis code).

**2026-10-17 — t43, choix d'exécution** :
- une clé vide (`''`) ou `null` est traitée comme absente : 400 et alerte ;
- l'alerte du journal donne le marchand, la boutique et le rôle, sans la carte ;
- la requête WAM trouve WAM par son nom (`ILIKE '%wam%'`) : l'identifiant n'est
  pas dans le dépôt.

**2026-10-14 — f17, suite (précalcul, interrupteur)** :
- mode points : précalcul limité à 0 et aux soldes détenus au moment de la
  préparation (aucune liste finie n'existe) ;
- fin de thème : bannières gardées (réactivation sans calcul), purgées à la
  suppression du thème ;
- interrupteur `themes_actifs` : décocher termine le thème en cours.

**2026-10-14 — f17, choix d'exécution** (détail §15 septquinquagies) :
- pendant un thème, les couleurs manuelles de la bannière (pastilles, barre, titre)
  et le fond personnalisé de la bannière sont ignorés : la bannière reprend le
  calcul automatique de contraste sur le fond du thème. Sinon, des couleurs choisies
  pour le fond standard pourraient être illisibles ;
- l'icône de la carte iPhone (notification) garde la couleur standard ;
- le thème remplace aussi le logo Google (logo carré dédié, sinon le logo Apple du
  thème) ; le logo de récompense garde la priorité, comme le doré ;
- texte du thème sur Google : sur la classe (une écriture pour toutes les cartes) ;
- dates : jours UTC, 3 mois au plus, début dans l'année ; un thème en cours doit
  être arrêté avant d'en choisir un autre ; un thème programmé est remplacé ;
- un thème choisi ne se modifie ni ne se supprime dans l'admin ;
- bascule : iPhone puis Google (pas en parallèle), Google au rythme des campagnes
  (50 cartes / 10 s) ; reprise au démarrage du serveur et au cron ;
- les cartes Google « masquées » (non visibles, 059) ne sont pas mises à jour par la
  bascule : elles le seront à leur prochain scan ;
- test du filet « lecture des marchands impossible » : l'étape `themes` y figure
  désormais parmi les étapes en erreur (elle lit aussi les marchands).

**2026-10-14 — f10, choix d'exécution** (détail §15 quinquinquagies) :
- horizon des créneaux : 60 jours ; mise à jour le 1er du mois à 02:00 UTC ;
- un lieu sans horaire n'affiche rien, plutôt qu'une carte affichée à toute heure ;
- lieux saisis par marchand (10 au plus), sans lien avec la table des boutiques ;
- les mises à jour silencieuses sont tracées sous la source `geo`.

**2026-10-14 — f18, choix d'exécution** (détail §15 quatuorquinquagies) :
- **texte WinWin du boost en tampons** : un programme en tampons reçoit « Plus que
  2 tampons » (avant : « 2 points », même en tampons). Pour les programmes en
  points, le texte est identique. En anglais, « Only 2 points more to unlock »
  remplace « Only 2 more points to unlock ».
- `{reste}` contient le nombre ET l'unité (« 2 tampons »), pour gérer le pluriel
  sans autre mot réservé ;
- compteur des 7 jours : libellé de Yass « Rapport des 7 derniers jours : N smart
  notifications envoyées » (singulier et zéro : « … smart notification envoyée »).
  Il tient sur une ligne à partir d'environ 400 px de large ; sur un écran plus
  étroit (375 px), il passe sur deux lignes plutôt que de déborder de la carte.
- texte du boost dans la bonne unité (tampons ou points) et tournure anglaise :
  **validés par Yass** (14/10).

**2026-10-14 — f15, choix d'exécution** (détail §15 duoquinquagies) :
- un boost que le seuil de l'admin rend inerte ne peut pas être réglé par le
  marchand (sinon il l'activerait) ;
- « Revenir au réglage WinWin » efface les trois réglages ensemble ;
- détection de lien : `http(s)://`, `www.`, ou un nom de domaine courant.

**2026-10-14 — Bloc smart notifications, choix d'exécution** (détail §15 quinquadragies) :
- bloc caché si aucune smart notification n'est active ou si la lecture échoue ;
- deux lectures en parallèle dans une seule requête du dashboard, plutôt qu'une
  fonction SQL (pas de migration).

**2026-10-13 — Vrais clients et segments, choix d'exécution** (détail §15 quatuorquadragies) :
- `trg_clients_updated_at` est réécrit pour ignorer les changements de `visible`
  seul (sinon, une vague de relances near_reward) ;
- le compteur ne compte que les personnes joignables (jeton Apple ou carte Google) ;
- l'historique des notifications affiche le segment ;
- le signal Google allume aussi `visible` quand la carte est créée avec le signal.

**2026-10-13 — Vrais clients, choix d'exécution** (détail §15 quatuorquadragies) :
- la vérification étendue (058) ne redemande pas les cartes iPhone déjà vérifiées le
  13/10 : seulement les cartes qui seraient masquées ;
- le scanner n'applique pas le masquage (un scan rend le client visible).

**2026-10-13 — Étape 23, choix d'exécution** (détail §15 tresquadragies) :
- la vérification unique se lance depuis un bouton de l'admin (pas au démarrage du
  serveur ni par un script), pour que Yass choisisse le moment hors 07:30–09:00 UTC ;
- la route du bouton Google redirige même si l'écriture du clic échoue : le client
  obtient sa carte, le signal sera posé au clic suivant ou par la vérification ;
- si la lecture des jetons échoue, Google est servi (on préfère un envoi de trop à un
  client Google oublié) ;
- débit de la vérification : une carte toutes les 500 ms, pages de 100 ;
- section 17 du filet : signal posé sur ses cartes doubles.

**2026-10-13 — Étape 20b, choix d'exécution** (détail §15 quadragies) :
- le filtre d'identifiant des fiches client est fait avant l'authentification
  (`next('route')`), pour garder le 404 d'Express 4 même sans jeton ;
- `query parser` gardé en mode étendu (comme Express 4), plutôt que le mode simple
  d'Express 5 ;
- `app.listen` relance l'erreur d'écoute (comportement d'Express 4) ;
- un JSON mal formé répond toujours 500 : non corrigé, hors du périmètre de 20b, noté
  en dette.

**2026-10-13 — Étape 26, choix d'exécution** (détail §15 octotricies) :
- `group_stats` n'est plus exécutable par PUBLIC, anon, authenticated (migration 056).
  Seul le serveur l'appelait (service_role) ; avant, la clé publique pouvait lire les
  chiffres de n'importe quel réseau.
- `apercu_stats` prend un paramètre `p_maintenant` (défaut now()) pour figer l'horloge
  dans les tests ; ses lectures sont bornées à cet instant.
- Pas d'alias des anciennes clés de `/me/stats` : un onglet resté ouvert affiche « – »
  jusqu'au rechargement.
- Les notes sous les cartes sont en petit (style des libellés) après lecture des
  captures.

**2026-10-12 — Étape 22, choix d'exécution non tranchés en pilotage** (détail
§15 quatertricies) :
- « le solde a bougé » se lit sur `clients.updated_at` (toute mise à jour de la fiche) ;
- la purge de `workflow_executions` garde la dernière ligne de chaque (client, type) ;
  c'est nécessaire à « une relance par absence » ;
- clients sans aucun canal : non sélectionnés, aucune ligne écrite ;
- le plafond de 1 000 s'applique aussi aux anniversaires (le surplus d'un jour est
  perdu ; théorique) ;
- jour UTC pour « une par jour » ;
- une coupure entre la réservation et l'envoi perd la relance (jamais de doublon) ;
- un marchand en échec n'arrête pas les autres, et marque l'étape « erreurs » ;
- pas de nouvel index sur `scans` (le scan ne change pas) ; sélection mesurée à ≈ 2 s
  au banc.

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

*Mis à jour le 2026-10-07 par la session « SETUP 4 », seizième chantier (fin des mesures) :
cron complet à la taille cible en 57 min, sans gêner les caisses ; 4 413 pushes étalés,
sans gêne ; dashboard au palier 50 000 ≤ 1,5 s. Les 401 du rush sont un artefact du jeton
de 2 h du générateur. Série du seuil reportée au chantier « rythme des campagnes ». RAPPORT
FINAL au §15 vicies G. Mesures de l'étape 15 terminées.*

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

*Mis à jour le 2026-10-07 par la session « SETUP 5 », étape 17a (diagnostic, rien codé,
rien poussé) : environnement de test gardé pour 17a et t40, supprimé au plus tard le 31/10 ;
ligne 24 de la synthèse rattachée au chantier « rythme des campagnes » comme premier levier ;
inventaire des lecteurs d'adresse et limite de la garde au §15 unvicies.*
