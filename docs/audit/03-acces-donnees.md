# Audit WinWin — Segment 3 : accès et données

> Troisième segment de l'audit, après la photo de production (00a), la cartographie
> (00b), les notifications (01) et le scan/crédit (02). Question posée par le brief
> (§6) : **qui peut se connecter, voir, modifier, exporter quoi.** Trois niveaux :
> l'application (jetons, mots de passe, routes, interfaces), Supabase (rôles de l'API,
> fonctions, stockage, comptes), l'exploitation (accès aux comptes et au dépôt).
> Même règle que les rapports précédents : **tout constat est rattaché à une preuve**
> (fichier:ligne, commit, requête, démonstration). Ce qui n'a pas pu être prouvé est
> marqué comme tel et n'est jamais comblé par une reconstitution. Le dépôt étant
> public, le rapport décrit des constats et leurs preuves, **jamais un mode
> opératoire** (décision de pilotage du 26/09). La colonne « exposition » dit **qui**
> et **à quelles conditions**, jamais **comment**.

| | |
|---|---|
| **Date** | 2026-09-27 |
| **Commit audité** | `9993fde` (branche `claude/audit-segment-3-access-data-9xzca8`). Le code applicatif y est identique à `ca0579a`, en production depuis le 25/09 à 22:08 UTC (`git diff ca0579a 9993fde -- winwincard/` est vide : les commits suivants ne touchent que `docs/audit/`). |
| **Dernière migration du dépôt** | `047_avis_google` (+ `rgpd_effacement.sql`, hors numérotation) |
| **Périmètre** | `middleware/auth.js`, `middleware/rateLimiters.js`, `services/auth-utils.js`, `services/marchand-cache.js` ; la connexion et les droits dans `routes/merchants.js`, `routes/scanner-auth.js`, `routes/admin.js`, `routes/clients.js` (export, effacement, champs perso) ; `rgpd_effacement.sql` ; les 68 routes et leur contrôle d'accès ; les trois interfaces (dashboard, scanner, admin) et la landing ; les rôles de l'API Supabase, le stockage, les comptes ; les accès d'exploitation (GitHub, Railway, Supabase, Apple, Google). |
| **Méthode** | lecture du code et de l'historique git complet (243 commits) ; carte des 68 routes par extraction (annexe C) ; base de référence rejouée depuis le dépôt (PostgreSQL 16, 46 migrations + `rgpd_effacement.sql`, 0 échec) pour **démontrer** les droits réels des rôles publics (D1) et **tester** chaque requête ; requêtes Q1 à Q5 en lecture seule (`docs/audit/03-requetes.sql`), exécutées par Yass le 27/09 ; relevés R1 et R2 de Yass ; Ponytail appliqué à la main. **Aucune donnée n'a été envoyée à la production, pas même une inscription de test.** |
| **Limites de méthode** | aucun accès direct à la production depuis le conteneur ; le code applicatif n'a pas été exécuté (aucune dépendance installée) ; la documentation Supabase est bloquée par le proxy, citée par extraits et marquée comme telle ; la force de `JWT_SECRET` et d'`ADMIN_PASSWORD`, l'état de la double authentification, l'ouverture des inscriptions Supabase et la restriction réseau de la base **ne sont pas vérifiables** (R1, R2 : Yass ne dispose pas de l'information et a demandé de ne pas bloquer dessus) ; l'origine des adresses vues au segment 02 (§4.8) reste HYPOTHÈSE forte (R3 retiré, part à la synthèse). |

### Légende

| Marque | Sens |
|---|---|
| **PROUVÉ** | vérifiable par le fichier:ligne, le commit, la requête ou la démonstration cités |
| **HYPOTHÈSE** | raisonnement cohérent, non vérifié — ce qui le confirmerait est indiqué |
| **NON VÉRIFIABLE** | la preuve n'existe pas ou n'est pas accessible — la raison est donnée |

La **gravité** (colonne « G ») suit l'échelle du brief (§4), selon ce que l'accès
fausserait ou exposerait : **1** argent des clients · **2** trafic machine (projection) ·
**3** scan au comptoir · **4** données et accès · **5** notifications · **6** carte dans
le téléphone · **7** statistiques · **8** apparence. Un accès dont l'usage détourné
mène à l'argent est classé à l'impact (1), même si l'entrée est un accès (4) : la
colonne « escalade » le note.

---

## 1. En une page

**La plateforme n'a pas de brèche ouverte sur l'argent : tout chemin qui touche un
solde exige un jeton valide, le mot de passe admin, ou la clé publique de Supabase
avec des identifiants.** Aucun moyen de créditer, déplacer ou détruire des points
**sans aucun jeton** n'a été trouvé. La faiblesse est ailleurs : **l'accès repose sur
très peu de clés, dont deux dont on ne peut pas prouver la solidité**, et **une seule
identité — le compte GitHub — déverrouille toute l'exploitation.**

Le point rassurant, mesuré : **aucune exécution réussie du canal public de la base
n'a été observée depuis le 23/05** (Q2). L'accès `effacer_client` hérité de 00a est
réel, mais **aucun usage réussi n'y est observé** — sous deux réserves de méthode
(§11).

| # | Constat | G | Statut |
|---|---|---|---|
| 1 | **Une seule identité déverrouille tout l'accès d'exploitation.** Yass se connecte à Railway et Supabase via GitHub (R2) ; le dépôt est public. Le compte GitHub commande donc les secrets d'environnement (`JWT_SECRET`, `SUPABASE_SERVICE_KEY`, clés Apple et Google), la base, et le déploiement (un push = une mise en production). Sa double authentification n'est pas vérifiable. | 4 (escalade 1) | PROUVÉ (lien) / NON VÉRIFIABLE (2FA) |
| 2 | **`ADMIN_PASSWORD` : mot de passe unique de tout l'admin, choisi de tête, comparé de façon non constante** (`admin.js:14`). Prendre l'admin permet de reconfigurer un marchand, **de réinitialiser son mot de passe** (`admin.js:227`+`new_password`) donc d'accéder à son dashboard et d'ajuster n'importe quel solde, de créer/archiver des boutiques, de suspendre et de révoquer. Le limiteur (10/h) compte l'adresse du proxy (02 §4.8). | 4 (escalade 1) | PROUVÉ (unicité, comparaison) / NON VÉRIFIABLE (force) |
| 3 | **`JWT_SECRET` signe tout, sa force est inconnue.** Il signe les trois rôles, le jeton admin, et **le jeton d'authentification de chaque carte Apple** (00b ; `apple-pass.js` `computeAuthToken`). S'il est faible, il devient possible de fabriquer un jeton — admin compris — ou le jeton d'une carte Apple. Origine et longueur non connues de Yass (R1). | 3·4·6 | PROUVÉ (usage) / NON VÉRIFIABLE (force) |
| 4 | **`effacer_client` reste appelable par la clé publique de Supabase ; aucune exécution réussie n'a été observée.** Droit hérité (00a §5.3, 00b §10) : la fonction est `SECURITY DEFINER`, exécutable par le rôle `anon`. Q2 : **aucune ligne `anon`/`authenticated` depuis le 23/05** — aucune exécution réussie observée par le canal public, sous deux réserves (éviction, appel refusé — §11). La fonction détruit la carte d'un client (jetons, pass, consentements, numéro de série). | 1 | PROUVÉ (droit) / aucune exécution réussie observée (§4.3) / HYPOTHÈSE (exposition réelle) |
| 5 | **Couper ou archiver une boutique ne coupe que le scan.** L'historique (`scan.js:358`) et l'annulation d'un scan (`scan.js:381`) ne relisent jamais `actif`/`deleted_at` ; `authScanner` ne vérifie que le marchand. Un jeton scanner émis avant la coupure (durée jusqu'à 365 j) peut donc encore **lire les clients de la boutique et annuler un scan — ce qui modifie un solde.** | 1·4 | PROUVÉ (mécanisme) |
| 6 | **La carte complète (prénom, solde) est servie à qui connaît le numéro de série.** Routes publiques `/api/passes/:serial/apple` (`passes.js:8`) et `/api/google-wallet/pass/:serial` (`google-wallet.js:7`). Le numéro de série est une clé au porteur, **imprimée dans le lien de parrainage** `?ref=<série>` sur Apple (`apple-pass.js:396`) et Google (`google-pass.js:259`) ; la carte Apple n'interdit pas le partage. | 4 | PROUVÉ (hérité 00b §4.2) |
| 7 | **`GET /api/clients` renvoie e-mail, téléphone et date de naissance à tout jeton marchand** (`clients.js:99-109`), caisse mono-site comprise ; seul l'export CSV est réservé au Pro+ (`clients.js:119`). 45 marchands sur 48 ont une caisse à jeton marchand complet (Q4). Volume concerné faible aujourd'hui (Q5 : 9-10 clients). | 4 | PROUVÉ |
| 8 | **Le stockage des images est en réalité verrouillé, malgré des droits larges latents.** Q1 : bucket `passes` public (lecture par URL, voulu), RLS active, **0 policy** → seuls les rôles qui contournent la RLS (`service_role`, le backend) écrivent et listent. `anon`/`authenticated` ont les droits de table complets mais aucune policy : **inertes**. Aucun plafond de taille ni de type sur le bucket (risque backend seulement). | 4 (latent) | PROUVÉ |
| 9 | **La désinscription d'un appareil Apple ne vérifie pas le jeton de la carte** (`apple-wallet.js:65`), contrairement aux autres routes du service web. Qui connaît l'`device_id` et le numéro de série d'un appareil peut faire cesser ses mises à jour. | 6 | PROUVÉ |
| 10 | **Le rôle `authenticated` est inerte pour les données.** Q3 : il n'hérite de rien, `auth.users = 0` (Supabase Auth inutilisé), aucune table en temps réel. Son seul droit nominatif (`notification_logs`, 00a §5.2) est sous RLS sans policy. **L'ouverture éventuelle des inscriptions Supabase est donc sans conséquence** sur l'accès aux données — cela clôt l'angle mort laissé ouvert par 00a (§8). | 4 | PROUVÉ (complète 00a) |
| 11 | **La révocation est grossière et retardée à deux instances.** `token_version` révoque le dashboard **et** les caisses ensemble (`admin.js:385`), jamais un seul appareil (passation §15 ter) ; l'invalidation du cache ne touche qu'une instance (jusqu'à 60 s de retard le jour où il y en a deux). La révocation a déjà servi une fois (Q4, `tv>1` = 1). | 4 | PROUVÉ (hérité, relié) |
| 12 | **Les limiteurs anti-force-brute comptent l'adresse du proxy de Railway** (02 §4.8), pas le client : la protection du login admin, marchand et caisse est potentiellement partagée entre clients sans rapport et remise à zéro à chaque déploiement. | 3·4 | HYPOTHÈSE forte (02, → synthèse) |

**Ce que cela dit pour la roadmap.** Le verrouillage décidé par Yass après l'audit
(visibilité du dépôt, droits d'exécution des fonctions, clés) répond aux constats
1 à 4. Le constat 5 (coupure incomplète d'une boutique) est un défaut d'autorisation
propre à ce segment, dont Yass a **accepté le risque** (§12) : une boutique coupée n'a
plus accès à la plateforme, et l'effet possible se limite à l'annulation de son dernier
scan. Le futur modèle d'intégration machine du brief (§3)
— clés propres, révocation par clé — trouve ici sa justification : les jetons actuels
révoquent trop large (constat 11) et comptent trop mal (constat 12) pour servir une
borne ou une caisse.

---

## 2. Méthode

- **Code** : lecture intégrale du périmètre au commit `9993fde` ; carte des 68 routes
  par extraction du verbe, du chemin et du middleware d'authentification (annexe C),
  recoupée à la main.
- **Base de référence** rejouée depuis le dépôt (méthode 00a annexe B : `schema.sql`,
  migrations 002→047, `rgpd_effacement.sql`, PostgreSQL 16, 0 échec), complétée des
  `GRANT service_role` des 7 tables centrales (00a §5.1) et des rôles `anon`,
  `authenticated`, `service_role` (BYPASSRLS), `authenticator` recréés comme sur
  Supabase. Elle sert à **démontrer** les droits réels des rôles publics (D1) et à
  **tester** Q1 à Q5 avant envoi. `pg_stat_statements` y a été activé pour valider les
  deux points délicats de Q2.
- **Production** : Q1 à Q5 exécutées par Yass le 27/09 (résultats bruts : annexe A).
- **Relevés** : R1 (origine et longueur des deux secrets, jamais la valeur) et R2
  (comptes et accès, oui/non) fournis par Yass le 27/09 ; R3 retiré (déjà écarté au
  segment 02).
- **Ponytail** : commande d'audit lue et appliquée à la main au périmètre du segment ;
  rien d'installé ni d'exécuté.
- **Injection dans un écran privilégié et comparaison du mot de passe admin** :
  constatées **par lecture du code seul**, jamais mesurées ni envoyées à la production
  (décision de pilotage).

---

## 3. La carte des accès

### 3.1 Les acteurs et leurs clés

**PROUVÉ (code).**

| Acteur | Clé | Émise par | Durée | Stockage | Révocation |
|---|---|---|---|---|---|
| Marchand (dashboard) | jeton `role: marchand` | `merchants.js:32` (login slug/e-mail) | 7 j, ou 365 j si `remember_device` | `localStorage` du navigateur (`ww_dash_token`) | changer `token_version` (`admin.js:385`) ou suspendre ; effet ≤ 60 s hors invalidation directe |
| Caisse boutique | jeton `role: scanner` + `point_de_vente_id` | `scanner-auth.js:148` (login boutique) | 7 j / 365 j | `localStorage` (`ww_token`) | idem marchand (le jeton porte le `marchand_id`) ; **ou** couper la boutique — mais seulement pour le scan (constat 5) |
| Caisse mono-site | jeton `role: marchand` complet | `scanner-auth.js:201` / `merchants.js:32` | 7 j / 365 j | `localStorage` | idem marchand ; **porte les 14 routes du dashboard** (cas c, passation §15 ter) |
| Admin (Yass) | jeton `role: admin` | `admin.js:17` (mot de passe unique) | 24 h | `localStorage` (`ww_admin_token`) | **aucune** avant expiration, sauf changer `JWT_SECRET` (casse les cartes Apple) |
| Carte Apple | jeton `ApplePass` par carte | `apple-pass.js` `computeAuthToken` (HMAC-SHA256 du numéro de série avec `JWT_SECRET`, tronqué à 32 hex) | illimitée | dans la carte installée | changer `JWT_SECRET` (global) |
| Public (landing, liens) | aucune | — | — | — | — |
| Backend → base | `SUPABASE_SERVICE_KEY` (rôle `service_role`, contourne la RLS) | Supabase | — | variable Railway | rotation de la clé (00b) |
| API publique → base | clé `anon`/publishable (rôle `anon`) | Supabase | — | n'apparaît dans aucune page servie (00a §5.3) | rotation / retrait des clés historiques (00b, fin 2026) |

Deux secrets non applicatifs commandent l'ensemble : `JWT_SECRET` (tous les jetons
ci-dessus sauf `service_role`) et `ADMIN_PASSWORD` (l'admin). Leur force est l'objet
des constats 2 et 3.

### 3.2 Les 68 routes par niveau d'accès

**PROUVÉ (annexe C).** 66 routes de routeur + `/demo` + `/health`.

| Niveau | Nombre | Routes (résumé) |
|---|---|---|
| **Public, sans aucun jeton** | 13 | `POST /api/clients` (inscription, limitée), `GET /api/merchants/:slug/public`, `GET /api/passes/:serial/apple`, `GET /api/google-wallet/pass/:serial`, `GET /avis/:serial`, `GET /l/:slug`, `POST /api/diag/camera` (limitée), les 3 logins (`admin`, `merchants`, `scanner`), et 3 des 5 routes du service web Apple (désinscription, liste des enregistrements, log — voir §3.3) |
| **Jeton de carte Apple** | 2 | `GET /v1/passes/:type/:serial` (`:107`) et `POST /v1/devices/:id/registrations/:type/:serial` (enregistrement, `:26`) — jeton `ApplePass` vérifié |
| **Jeton marchand** (`authMarchand`) | 14 | `merchants.js` `/me*` (7), `clients.js` (`GET /`, `GET /export`, `GET /:id`, `PATCH /:id`, `DELETE /:id` — 5), `notifications.js` (2) |
| **Jeton scanner ou marchand** (`authScanner`) | 3 | `POST /api/scan`, `GET /api/scan`, `POST /api/scan/:id/annuler` |
| **Jeton admin** (`authAdmin`) | 28 | `admin.js` (23, tout sauf `/login`), les 3 de `workflows.js`, `clients.js` `GET /admin/all`, `diag.js` `GET /resultats` |
| Pages et icônes (statiques) | 6 | service des PWA `admin-ui`, `dashboard`, `scanner` (une icône + un « catch-all » chacun) |

Total : 66 routes de routeur (13 + 2 + 14 + 3 + 28 + 6) + `/demo` + `/health` = 68.

**Dans l'autre sens** : tous les appels des fronts visent une route existante
(vérifié en 00b F10). Aucune route de modification de solde n'est accessible sans
jeton (§4.1).

### 3.3 Le service web Apple — deux routes sans vérification de jeton

**PROUVÉ (`apple-wallet.js`).** Le service web Apple comporte 5 routes. **Deux**
vérifient le jeton `ApplePass` de la carte (`verifyAppleToken`, comparaison à temps
constant, `apple-wallet.js:8-16`) : l'enregistrement d'appareil (`:26`, jeton vérifié
avant l'`upsert`) et le téléchargement du pass (`:107`). **Trois ne le vérifient pas** :
- `DELETE /v1/devices/:deviceId/registrations/:type/:serial` (`:65`, **constat 9**) :
  supprime la ligne `device_tokens` sans contrôle. La spécification Apple authentifie
  pourtant la désinscription comme l'enregistrement : c'est un contrôle manquant, pas un
  choix de la spec. **Exposition** : qui connaît l'`device_id` (opaque, propre à
  l'appareil) et le numéro de série d'une carte peut faire cesser ses mises à jour.
  Gravité 6, borné : ni solde ni donnée touchés, l'appareil se ré-enregistre au prochain
  rafraîchissement.
- `GET /v1/devices/:deviceId/registrations/:type` (`:80`) : la liste des numéros de
  série mis à jour. Non authentifiée **conformément à la spécification Apple** (c'est le
  téléchargement du pass qui porte le jeton). Sans donnée personnelle en réponse (des
  numéros de série seulement).
- `POST /v1/log` (`:209`) : journalise le corps envoyé par Apple. Sans conséquence.

### 3.4 Pour chaque donnée : qui lit, modifie, exporte, supprime

**PROUVÉ (code).**

| Donnée | Lit | Modifie | Exporte | Supprime |
|---|---|---|---|---|
| Solde d'un client (`clients.stored_value`) | marchand (fiche, liste, stats), caisse (résultat de scan) | scan (`increment_stored_value`), annulation (`annuler_scan`), ajustement dashboard (`clients.js:219`), parrainage (`credit_referral`) | export CSV (Pro+) | — (soft-delete via `effacer_client`) |
| Coordonnées (e-mail, tel, naissance) | **tout jeton marchand** (`GET /api/clients`, constat 7) | ajustement dashboard (prénom), inscription | export CSV (Pro+) | `effacer_client` (anonymise) |
| Carte (prénom, solde) au porteur | **public par numéro de série** (constat 6) | — | — | — |
| Configuration marchand | public partiel (`/:slug/public`), marchand (`/me`), admin (tout) | **admin seul** (`admin.js:227`) | — | — |
| Mot de passe marchand (empreinte) | jamais renvoyé (vérifié : `select` ciblés, jamais `password_hash` vers le front) | admin (`new_password`), marchand (aucune route de changement de son propre mot de passe) | — | — |
| Images des cartes (Storage) | **public par URL** (bucket public) | backend seul (`service_role`, constat 8) | — | backend |
| Journal des scans | marchand/caisse (historique, scoping boutique) | annulation (marque `annule_le`) | — | jamais (conservé à vie) |

### 3.5 Les accès qui ne passent pas par l'application

**PROUVÉ (R2, 00b).** Ils échappent à tous les jetons de §3.1.

| Accès | Qui | Ce qu'il ouvre | Coupure |
|---|---|---|---|
| Compte GitHub (SSO Railway + Supabase, R2) | Yass | dépôt (public), variables Railway (tous les secrets), base Supabase, déploiement | mot de passe GitHub + 2FA (non vérifiée) |
| Railway | Yass (via GitHub) | variables d'environnement, journaux (numéros de série visibles, 02 §4.8), redéploiement | idem |
| Supabase | Yass (via GitHub) | toute la base, le Storage, les clés, les réglages | idem |
| Apple Developer, Google Cloud, registraire du domaine | Yass (R2, « accès seul ») | signature des cartes, API Wallet, zone DNS | 2FA (non vérifiée) |

**Le compte GitHub est le point de concentration** (constat 1) : il est l'identité de
connexion de Railway et de Supabase, donc il commande indirectement les secrets, la
base et la production. Le dépôt étant public, il n'y a rien à deviner sur *quoi*
protéger — seulement *ce* compte à protéger.

### 3.6 Ce que donne une clé perdue

Repris de 00b §4.1, sous l'angle accès :

| Clé perdue | Ce qu'elle ouvre | Ce que la révoquer casse |
|---|---|---|
| `SUPABASE_SERVICE_KEY` | lecture/écriture de toute la base, tout marchand | tout le serveur jusqu'au redéploiement avec la nouvelle clé |
| `JWT_SECRET` | fabriquer n'importe quel jeton (admin compris) et le jeton Apple de toute carte | **toutes les sessions et toutes les cartes Apple installées** (00b) |
| `ADMIN_PASSWORD` | tout l'admin (constat 2) | rien ; mais un jeton admin déjà émis ne se coupe qu'en changeant `JWT_SECRET` |
| Clé/certificat Apple, compte Google | signer/pousser au nom de WinWin | la génération/mise à jour des cartes (segment 6) |
| Compte GitHub | tout ce qui précède, par transitivité (§3.5) | — |

### 3.7 Les moyens de couper un accès (Q4)

**PROUVÉ (Q4, code).**

| Levier | Effet | Portée aujourd'hui |
|---|---|---|
| Suspension marchand (`actif=false`) | 403 à toutes les routes marchand et scanner (relu au cache 60 s) | 1 marchand suspendu |
| Révocation (`token_version++`) | invalide tous les jetons du marchand — dashboard **et** caisses | utilisée 1 fois ; grossière (constat 11) |
| Couper une boutique (`actif=false`) | bloque le **scan** suivant — **pas** l'historique ni l'annulation (constat 5) | 0 boutique coupée |
| Archiver une boutique (`deleted_at`) | retire de la facturation ; même trou que la coupure | 0 |
| Changer `JWT_SECRET` | coupe tout, casse les cartes Apple | jamais fait (romprait la production) |

**Deux angles morts de la coupure :** une boutique coupée garde ses identifiants
scanner (`boutiques_coupees_ou_archivees_avec_login` = 0 aujourd'hui, mais rien ne les
retire), et son jeton déjà émis reste utilisable pour lire et annuler (constat 5).

---

## 4. Santé : les constats

### 4.1 Aucune écriture de solde sans jeton — vérifié

**PROUVÉ (carte des routes, D1, Q2).** Recherche systématique des chemins qui écrivent
`clients.stored_value` : les quatre fonctions (`increment_stored_value`, `annuler_scan`,
`credit_referral`, l'ajustement `clients.js:219`) sont toutes derrière `authScanner` ou
`authMarchand`. Les routes publiques (§3.2) ne modifient aucun solde : l'inscription
crée un client à 0, la landing et les liens ne font que lire ou rediriger, le service
web Apple ne touche pas au solde.

**Le seul chemin de modification de données ouvert au rôle public de la base est
`effacer_client`** (constat 4), et il détruit une carte, il ne déplace pas un solde.
**Démonstration D1** (base rejouée, rôle `anon`) : `increment_stored_value`,
`annuler_scan`, `credit_referral`, `group_stats`, `admin_marchands_stats` échouent
toutes en « permission denied » (droits de l'appelant, `anon` n'a aucun droit sur les
tables) ; seule `effacer_client` (SECURITY DEFINER) s'exécute. C'est exactement le
tableau de 00a §5.3. **Aucun accès de gravité 1 hors de la liste héritée n'a été
trouvé** ; la règle d'alerte du cadrage n'avait pas à se déclencher.

### 4.2 Les deux secrets dont la force est inconnue (constats 2 et 3)

**`ADMIN_PASSWORD` — PROUVÉ (code, R1).** Un mot de passe unique protège tout l'admin
(`admin.js:14`, comparaison `password !== process.env.ADMIN_PASSWORD` : **non
constante**, un écart de temps théorique existe, sans portée pratique derrière un
limiteur mais noté comme garde-fou manquant). R1 : **choisi de tête** — donc
probablement de faible entropie ; sa longueur n'est pas connue. Ce que l'admin permet,
au-delà de la configuration : `admin.js:227` accepte `new_password`, donc **réinitialiser
le mot de passe de n'importe quel marchand** puis entrer dans son dashboard et **ajuster
n'importe quel solde** ; créer/archiver des boutiques ; suspendre ; révoquer. L'accès
est classé 4, mais **son escalade atteint la gravité 1**. Le jeton admin dure 24 h et
ne se révoque pas (§3.1). **Exposition** : qui connaît ou devine le mot de passe, depuis
n'importe où ; le limiteur de login (10/h) compte l'adresse du proxy (constat 12).

**`JWT_SECRET` — PROUVÉ (usage) / NON VÉRIFIABLE (force).** Il signe les trois rôles
(`auth.js:39`,`:66`,`:86`), le jeton admin (`admin.js:17`), et **le jeton
d'authentification gravé dans chaque carte Apple** (`apple-pass.js` `computeAuthToken`,
vérifié en `apple-wallet.js`). R1 : Yass **ne connaît ni son origine ni sa longueur**
(il est « logé dans Railway »). Conséquence : **la sécurité de l'ensemble du système de
jetons repose sur un secret dont la solidité n'est pas prouvée.** S'il était court ou
devinable, il deviendrait possible de forger un jeton (admin compris) ou de calculer le
jeton Apple d'une carte dont on connaît le numéro de série (numéro qui est une clé au
porteur, constat 6). C'est une **HYPOTHÈSE** — rien ne dit qu'il est faible — mais elle
n'est pas écartable en l'état. Le verrouillage post-audit devra la lever (générer un
secret long et aléatoire), en tenant compte du fait qu'une rotation casse toutes les
cartes Apple installées (00b) : ce n'est pas un simple changement de variable.

### 4.3 `effacer_client` : accès réel, aucun usage réussi observé (constat 4)

**PROUVÉ (00a §5.3, 00b §10, Q2).** La fonction est `SECURITY DEFINER` et le rôle
`anon` peut l'exécuter — droit hérité du privilège par défaut accordé à `PUBLIC`, que
le compteur « 0 fonction exposée » du tableau de bord ne voit pas (00b §10). Appelée,
elle supprime les jetons d'appareil, la carte et les consentements du client, anonymise
ses données et change son numéro de série (`rgpd_effacement.sql:29-54`) : **la carte du
client est détruite**, son solde reste en base mais n'est plus rattaché à une carte
utilisable.

**Ce qui borne l'exposition** (inchangé depuis 00a) : il faut la clé publishable/anon
(que Supabase conçoit pour être publique, mais qui n'apparaît dans aucune page servie),
l'identifiant du marchand (public, `merchants.js:179`) et l'identifiant du client visé.

**Ce que ce segment ajoute — PROUVÉ (Q2), avec deux réserves.** Sur la fenêtre du
23/05 à aujourd'hui (Q2c : `stats_reset` = 2026-05-23, soit toute la vie de la
plateforme), **aucune ligne n'est enregistrée pour les rôles `anon` et `authenticated`**
(Q2b : 0 ligne). J'ai vérifié sur la base d'essai qu'un appel **réussi** à cette
fonction par `anon` serait bien enregistré à son nom.

**Ce que cela établit, et ce que cela n'établit pas.** L'absence de ligne montre
qu'**aucune exécution réussie du canal public n'a été observée** depuis le 23/05,
`effacer_client` compris. Ce n'est pas une preuve d'absence d'usage : deux limites de
la méthode passent en angles morts (§11) —
1. `pg_stat_statements` plafonne (~5 000 entrées) et évince les moins fréquentes quand
   le plafond est atteint : une entrée `anon` isolée a pu disparaître (peu probable ici,
   la diversité de requêtes de la plateforme étant faible, mais non exclu) ;
2. un appel **refusé** (identifiants invalides) ne laisse **aucune trace** : une
   tentative infructueuse ne se verrait pas.

Conséquence pour les 48 effacements comptés par Q5 : **aucun n'est attribuable au canal
public** dans les statistiques (ils correspondent à la route `DELETE /api/clients/:id`
du dashboard, via `service_role`), **sous les mêmes réserves** — un usage légitime,
donc, autant qu'on puisse l'observer.

### 4.4 Couper une boutique ne coupe que le scan (constat 5)

**PROUVÉ (code).** Le durcissement multi-boutiques (passation §10) affirme une
« coupure immédiate » : le scan relit `actif`/`deleted_at` en base à chaque passage
(`scan.js:26-42`), donc le scan suivant d'une boutique coupée est refusé. Mais
`authScanner` (`auth.js:77-108`) ne vérifie que l'état du **marchand** (via
`refusAutorisation`), jamais celui de la **boutique**. Or deux autres routes portent
`authScanner` sans relire la boutique :
- `GET /api/scan` (`scan.js:358`) : historique scopé à la boutique du jeton, mais rendu
  même si la boutique est coupée → **lecture des prénoms et soldes des clients de la
  boutique** ;
- `POST /api/scan/:id/annuler` (`scan.js:381`) : vérifie que le scan appartient à la
  boutique du jeton (`scan.js:392-399`), **jamais que la boutique est encore active** →
  l'annulation restaure `stored_value_avant` (`annuler_scan`) : **elle modifie un
  solde.**

Le login boutique, lui, est bien refusé après coupure (`scanner-auth.js:145`,
`access_disabled`). Le trou ne concerne donc que les **jetons déjà émis**, dont la
durée va jusqu'à 365 j (`remember_device`). **Exposition** : une caisse dont l'appareil
s'est connecté avant la coupure garde, jusqu'à l'expiration de son jeton, la lecture de
l'historique de sa boutique et l'annulation de ses propres scans. L'impact sur le solde
est **borné** par les garde-fous de `annuler_scan` (doit être le dernier scan actif du
client, solde cohérent) : la boutique coupée peut défaire ses derniers scans, pas
créditer arbitrairement. **Gravité 1 par l'impact (un solde bouge), 4 par la lecture ;
exposition étroite.** Aucun cas observé (0 boutique coupée aujourd'hui, Q4). Ce n'est
pas un accès « sans jeton » : la règle d'alerte ne s'applique pas.

### 4.5 La carte au porteur et le numéro de série (constat 6)

**PROUVÉ (code, hérité 00b §4.2).** `/api/passes/:serial/apple` (`passes.js:8`) et
`/api/google-wallet/pass/:serial` (`google-wallet.js:7`) rendent la carte (prénom,
solde) à qui présente le numéro de série, sans authentification — c'est le modèle
Wallet (une carte s'installe depuis un lien). Le numéro de série est donc une **clé au
porteur**. Deux choses l'exposent plus que nécessaire :
- il est **imprimé dans le lien de parrainage** au dos de la carte, `…?ref=<série>`,
  sur Apple (`apple-pass.js:396`) et Google (`google-pass.js:259`) : partager ce lien,
  c'est partager la clé de sa propre carte ;
- la carte Apple **n'interdit pas le partage** (aucun `sharingProhibited` dans le
  `pass.json`, vérifié).

**Gravité 4** (donnée d'un tiers lisible : le prénom et le solde). Le parrainage est
coupé (00b §13), mais le lien reste gravé sur les cartes Google déjà créées
(`google-pass.js:256`, jamais réécrit — 00b §13). **Exposition** : qui obtient un
numéro de série (lien de parrainage partagé, capture d'une carte) lit la carte
correspondante.

### 4.6 Les coordonnées renvoyées à toute caisse (constat 7)

**PROUVÉ (code, Q5).** `GET /api/clients` (`clients.js:99-109`) renvoie `email`,
`telephone`, `date_anniversaire` à **tout jeton marchand**, sans gating de forfait.
Seul l'export CSV est réservé au Pro+ (`clients.js:119`). Comme 45 marchands sur 48
scannent avec un jeton marchand complet (Q4, cas c), la caisse a accès à ces
coordonnées via l'API — même si l'interface scanner ne les affiche pas. La fiche client
du dashboard, elle, ne les montre qu'au Pro+ (`dashboard/index.html:1969`), mais c'est
un choix d'affichage, pas une barrière d'API. **Volume aujourd'hui faible** (Q5 : 9
e-mails, 10 téléphones, 9 dates de naissance ; **0** donnée personnelle chez un
marchand qui n'est plus Pro+ — pas de résidu de rétrogradation). **Gravité 4.** À la
cible (100 000 porteurs, adoption de la landing premium), cette surface grossit.

### 4.7 Le stockage : verrouillé malgré des droits larges (constat 8)

**PROUVÉ (Q1).** Le bucket `passes` est **public** : tout fichier est lisible par qui
connaît son URL — voulu, Apple et Google vont chercher les images. Mais l'écriture et
le listing passent par la RLS de `storage.objects`, qui est **active avec zéro policy**
(Q1 : `policies_nb = 0`, Q1b : aucune ligne). Un rôle non-BYPASSRLS est alors refusé
par défaut. Donc, bien que `anon` et `authenticated` aient les droits de table complets
(`SELECT,INSERT,UPDATE,DELETE`), ils ne peuvent **ni écrire ni lister** : seuls les
rôles qui contournent la RLS (`service_role`, le backend) le peuvent. Le code n'écrit
d'ailleurs dans le Storage que via `service_role` (`admin.js` upload, `strip-cache.js`).

**Deux réserves, sans gravité aujourd'hui :**
- les droits de table larges de `anon`/`authenticated` sont **latents** : le jour où
  une policy permissive serait ajoutée (par exemple pour un usage public légitime), ils
  deviendraient actifs d'un coup. C'est un défaut sûr, pas un défaut présent ;
- le bucket n'a **ni plafond de taille ni restriction de type** (Q1) : un envoi
  volumineux ou d'un type inattendu n'est borné que par la limite de l'upload applicatif
  (`multer` 5 Mo, `admin.js`) — risque côté backend, pas côté public.

**Gravité 4, latent.** Bon état actuel, à consigner pour le verrouillage (ne pas
ajouter de policy permissive sans revoir les droits de table).

### 4.8 Le rôle `authenticated` est inerte — l'angle mort de 00a est clos (constat 10)

**PROUVÉ (Q3, 00a).** 00a (§8) laissait ouverte la question « les inscriptions Supabase
sont-elles ouvertes ? », parce qu'un compte `authenticated` aurait pu accéder à des
données. Q3 la referme : `authenticated` **n'hérite d'aucun rôle**, il n'y a **0 compte
`auth.users`** (Supabase Auth n'est pas utilisé, cohérent avec 00a §6.3 : aucun
`supabase.auth` dans le code), et **aucune table n'est publiée en temps réel**. Le seul
droit nominatif d'`authenticated` (lecture/écriture de `notification_logs`, 00a §5.2)
est sous RLS **sans policy** : inopérant. **Donc même si les inscriptions Supabase
étaient ouvertes (R2 q11, NON VÉRIFIABLE), un jeton `authenticated` obtenu ainsi ne
donnerait accès à aucune donnée applicative.** L'ouverture des inscriptions reste à
regarder pour l'hygiène (éviter des comptes inutiles), mais **ce n'est pas une voie
d'accès aux données**. Gravité 4, refermé.

### 4.9 Les interfaces : jetons en clair, données du public échappées

**PROUVÉ (code).**
- **Jetons dans le navigateur.** Les trois interfaces gardent leur jeton en
  `localStorage` (`ww_dash_token`, `ww_token`, `ww_admin_token`). Un jeton en
  `localStorage` est lisible par tout script exécuté sur la page — d'où l'importance du
  point suivant.
- **Données saisies par le public, affichées dans un écran à jeton.** Le prénom (saisi
  librement à l'inscription) s'affiche dans le dashboard, le scanner et la fiche client.
  **Les points qui affichent la valeur complète l'échappent** : `esc()`
  (`dashboard/index.html:2154`, `admin/index.html:1533`), `escapeHtml()`
  (`scanner/index.html:1303`), `esc()` (`admin/diag-resultats.html:94`). Les insertions
  vérifiées (liste clients `dashboard:1293`, historique `scanner:1341`, candidats de
  collision `scanner:1128` via `textContent`, page de résultats du diagnostic caméra
  alimentée par la route **publique** `POST /api/diag/camera`) passent toutes par un
  échappement ou `textContent`. Seule exception relevée : l'**initiale d'avatar**
  (`dashboard:1291`, la première lettre du prénom mise en majuscule, non échappée) —
  un caractère unique majuscule ne forme aucune balise, **ce n'est pas un vecteur**.
  **Aucune injection exploitable trouvée** dans le périmètre lu.
- **Facteurs aggravants, à consigner** (aucun n'est une faille à lui seul) : la
  protection CSP de `helmet` est **désactivée** (`index.js:29`, `contentSecurityPolicy:
  false`) — donc rien ne bloquerait un script injecté s'il en apparaissait un ; le
  décodeur de QR `jsQR` est chargé depuis un CDN **sans contrôle d'intégrité**
  (`dashboard/index.html:13`, `scanner/index.html:594`) — une compromission du CDN
  exécuterait du code dans le scanner et le dashboard, qui détiennent un jeton ; pages
  publiques et privilégiées partagent le même domaine (00b). **Gravité 4, latent** :
  l'échappement tient aujourd'hui ; ces facteurs rendraient chère la moindre erreur
  future. **Ne pas retirer l'échappement** (garde-fou).

### 4.10 L'e-mail marchand : identifiant de connexion arbitraire (constat, sans chantier)

**PROUVÉ (code, 02 S5, précision de Yass).** L'e-mail marchand est un identifiant de
connexion (`merchants.js:17` par `email_contact`, et repli du login caisse depuis le
16/08, `scanner-auth.js:176`). Il n'est **jamais vérifié**, Yass saisit une adresse au
hasard, et **3 adresses sont partagées** entre marchands (02 S5) — un login par e-mail
y est de toute façon ambigu (`.single()` échoue, dette #10). Conséquence d'accès : il
n'existe **aucun canal fiable pour joindre un marchand** (réinitialisation, alerte) ni
pour lui rendre l'accès sans passer par Yass (l'admin réinitialise le mot de passe,
§4.2). C'est noté dans la carte ; **ce n'est pas un chantier** (décision de Yass) — mais
c'est une dépendance de plus sur l'unique opérateur.

---

## 5. Comportement : ce que l'accès coûte et produit

**PROUVÉ (code).** L'authentification a un coût déjà chiffré ailleurs, rappelé ici sous
l'angle accès :
- **`scryptSync` à chaque connexion** (marchand, caisse, boutique) : 35 ms de boucle
  d'événements bloquée, mesuré dans le conteneur (00b §4.4). Le login est rare (jetons
  longue durée), donc négligeable aujourd'hui ; à surveiller si un jour les
  reconnexions se multiplient (vague de tablettes).
- **Le cache d'autorisation** (`marchand-cache.js`) évite une lecture par requête : une
  lecture par marchand et par minute (00a, passation §15 ter). C'est un comportement
  nécessaire (sans lui, chaque appel du dashboard relirait `marchands`).
- **La révocation et la suspension sont relues au plus toutes les 60 s** hors
  invalidation directe : à une instance, l'invalidation est immédiate ; à deux, l'autre
  instance sert jusqu'à 60 s une valeur périmée (constat 11). C'est un coût de
  **fraîcheur d'accès**, pas de calcul.

Rien dans le périmètre ne fait de travail invisible coûteux au sens du brief (§9) : les
lectures d'autorisation sont bornées (une ligne marchand). Le sujet « travail qui
grossit dans le vide » est celui des segments 1 et 2, pas celui-ci.

---

## 6. Projection : où l'on va (brief §3)

**HYPOTHÈSE (projection).**
- **Intégrations machine (bornes, caisses, e-commerce).** Le brief impose qu'elles
  aient « leurs propres clés et leur propre révocation, jamais un jeton marchand ». Le
  segment 3 établit pourquoi c'est nécessaire, pas optionnel : aujourd'hui la
  révocation est grossière (elle coupe dashboard + caisses ensemble, constat 11) et les
  limiteurs comptent l'adresse du proxy (constat 12). Une clé de borne doit pouvoir
  être coupée seule, et limitée par clé, pas par IP. Le modèle de jeton actuel ne sait
  faire ni l'un ni l'autre.
- **Le mot de passe admin unique** (constat 2) devient plus dangereux à mesure que la
  valeur sous gestion croît : à 100 000 porteurs et des marchands en points, un admin
  compromis atteint des soldes réels par réinitialisation de mot de passe marchand.
- **La surface de coordonnées** (constat 7) grossit avec l'adoption de la landing
  premium et le scénario e-commerce (porteurs créés sans passage en caisse, souvent
  avec e-mail). `GET /api/clients` la sert déjà à toute caisse ; à la cible, c'est une
  fuite potentielle de dizaines de milliers de coordonnées derrière un seul jeton
  marchand.
- **Le numéro de série comme clé au porteur** (constat 6) : à l'échelle e-commerce, les
  liens de parrainage circulent davantage, chacun portant la clé d'une carte.
- **La concentration sur le compte GitHub** (constat 1) ne s'améliore pas seule : plus
  la plateforme vaut, plus ce compte unique vaut.

**Aucune porte n'est fermée** au sens du brief : le modèle de clés par intégration
reste possible à construire. Mais il devra être **ajouté**, il n'existe pas.

---

## 7. Questions transversales

### 7.1 Deux serveurs, et au redémarrage

**PROUVÉ (code, hérité).** L'accès dépend de deux états en mémoire (00b F5) : le cache
d'autorisation (`marchand-cache.js`) et les compteurs des limiteurs. À deux instances,
une révocation ou une suspension n'est appliquée immédiatement que sur l'instance qui a
reçu l'appel admin ; l'autre sert jusqu'à 60 s un jeton qui devrait être coupé
(constat 11). Les limiteurs comptent par instance : les seuils de force-brute
(admin 10/h, etc.) sont **doublés** à deux instances, et remis à zéro à chaque
redéploiement. Aujourd'hui, une seule instance (00a §7.1) : sans effet, mais rien dans
le dépôt ne fixe ce nombre.

### 7.2 Le serveur sait faire, l'interface le demande-t-elle ?

**PROUVÉ (code).**

| Capacité serveur | Interface | État |
|---|---|---|
| Révoquer les sessions d'un marchand (`admin.js:385`) | admin | câblée (utilisée 1 fois, Q4) |
| Suspendre un marchand (`admin.js:360`) | admin | câblée |
| Couper une boutique (`merchants.js:158`) | dashboard | câblée — mais ne coupe que le scan (constat 5) |
| Couper une **seule** caisse/appareil | aucune | **impossible** : `token_version` coupe tout le marchand (constat 11) |
| Changer son propre mot de passe (marchand) | aucune | **absente** : seul l'admin réinitialise (`new_password`) |
| Restreindre l'accès direct à la base par réseau | Supabase | **NON VÉRIFIABLE** (R2 q12) |

### 7.3 Les changements de masse

Sous l'angle accès, un seul changement de masse compte : **la rotation de
`JWT_SECRET`**. Elle coupe toutes les sessions **et** invalide le jeton de toutes les
cartes Apple installées (00b), qui refusent alors les mises à jour jusqu'à
re-téléchargement. C'est pourquoi le verrouillage du constat 3 n'est pas un simple
changement de variable : il demande une bascule pensée (segment 6). La révocation de
masse par `token_version` a le même effet côté sessions, sans toucher les cartes.

### 7.4 Ponytail

**Méthode.** Commande d'audit de Ponytail appliquée à la main au périmètre du segment
(fichiers d'accès). **Liste de candidats, pas feu vert** ; un garde-fou n'est jamais
candidat sans protection équivalente ; une suppression ne se propose que sur preuve
d'usage nul.

1. `delete?` — **Les 8 policies RLS du dépôt sont inertes** (`schema.sql:192-229`).
   Elles filtrent `anon`/`authenticated` sur `marchands`, `clients`, `passes`,
   `device_tokens`, `scans` via `current_setting('app.marchand_id')`. Or (a) le backend
   passe par `service_role`, qui contourne la RLS et ne pose jamais ce réglage, et
   (b) `anon`/`authenticated` n'ont **aucun droit de table** sur ces tables (00a P4),
   donc même une policy `SELECT` ne peut rien accorder faute de droit de base. Elles ne
   protègent donc **rien aujourd'hui**. **Mais** ce sont le filet multi-tenant *voulu* :
   les lister comme candidat ne préjuge pas de leur suppression — le verrouillage
   post-audit décidera de les **compléter** (leur donner un sens) ou de les **retirer**.
   Statut : **candidat signalé, décision hors audit** (règle du brief : garde-fou).
2. `note` — **Le repli de login caisse par e-mail** (`scanner-auth.js:176`) : déjà
   examiné au segment 02 (§7.4 n°5), **décision de Yass : c'est une porte de connexion**
   (conservée). Non re-proposé.
3. `note` — L'export mort `viderTout` (`marchand-cache.js`) est déjà dans l'inventaire
   des liens morts (00b §6). Non re-listé ici.

**Net : aucun retrait proposé de mon chef dans ce périmètre.** Le seul candidat (les
policies inertes) est un garde-fou dont le sort revient au verrouillage.

---

## 8. Seuils de rupture

Chaque seuil dans l'unité qui le provoque (brief §3).

| Ce qui casse | Unité | Seuil | Aujourd'hui | Ce qui souffre | Statut |
|---|---|---|---|---|---|
| Force-brute du login admin | tentatives par adresse du proxy | 10 / h **par adresse du proxy**, doublées par instance | 1 instance | l'admin (escalade vers l'argent) | HYPOTHÈSE forte (02 §4.8) |
| Usage détourné d'`effacer_client` | présence de la clé publishable en de mauvaises mains | dès la première fois | aucune exécution réussie observée (Q2) | la carte d'un client | PROUVÉ (droit) / aucun usage réussi observé |
| Fuite de coordonnées | jeton marchand détenu | dès un jeton | 9-10 clients (Q5) | les coordonnées de tous les clients du marchand | PROUVÉ |
| Boutique coupée encore active | jeton scanner émis avant coupure, ≤ 365 j | dès la coupure | 0 boutique coupée | l'historique et les derniers soldes de la boutique | PROUVÉ (mécanisme) |
| Révocation trop large | appareils d'un marchand | tous à la fois | 1 révocation faite | toutes les caisses + le dashboard ensemble | PROUVÉ |
| Rotation de `JWT_SECRET` | cartes Apple installées | toutes : 1 287 (00b C4) | — | toutes les cartes et sessions | PROUVÉ |
| Compromission GitHub | 1 compte | dès la compromission | — | toute l'exploitation | PROUVÉ (lien) / NON VÉRIFIABLE (2FA) |

**Ce qui casse en premier** n'est pas un volume : c'est la **solidité de deux secrets**
(admin, JWT) et **d'une identité** (GitHub), qu'aucune croissance n'améliore et que
seul le verrouillage post-audit peut renforcer.

---

## 9. Propositions

Chaque proposition dit ce qu'elle retire, protège, son coût, ses limites. **Aucune
n'est un correctif** : l'audit ne corrige rien, Yass décide, et le verrouillage a été
renvoyé après l'audit.

**P1 — Retirer aux rôles publics le droit d'exécuter les fonctions** (surtout
`effacer_client`), le serveur n'utilisant que `service_role`.
- *Retire* : rien au produit. *Protège* : constat 4 (et le compteur du tableau de bord
  redevient vrai). *Coût* : une migration `REVOKE EXECUTE … FROM PUBLIC, anon,
  authenticated`. *Limites* : ne change rien tant que la clé publishable n'a pas fuité ;
  à faire dans le lot de verrouillage.

**P2 — Renforcer l'accès admin** : mot de passe long généré aléatoirement, comparaison
à temps constant, et (à terme) un second facteur.
- *Retire* : rien. *Protège* : constat 2, donc l'escalade vers l'argent. *Coût* : un
  changement de secret + quelques lignes. *Limites* : ne révoque pas un jeton admin déjà
  émis (24 h) ; un vrai modèle de session admin serait un chantier à part.

**P3 — Régénérer `JWT_SECRET` en secret long et aléatoire**, avec une bascule pensée.
- *Retire* : rien, mais *coûte* une rupture (toutes les cartes Apple à re-télécharger,
  toutes les sessions coupées) — d'où une bascule à préparer (segment 6). *Protège* :
  constat 3. *Limites* : ne se fait pas à chaud sans prévenir ; sépare idéalement le
  secret des jetons de session de celui des cartes Apple (deux secrets distincts).

**P4 — Relire l'état de la boutique dans `authScanner`** (ou dans l'historique et
l'annulation), pas seulement dans le scan. **Non prioritaire** : Yass a accepté le
risque du constat 5 (§12) ; proposition laissée pour mémoire.
- *Retire* : rien. *Protège* : constat 5. *Coût* : une lecture de plus (ou porter
  `actif`/`deleted_at` dans le cache d'autorisation). *Limites* : ne borne pas la durée
  du jeton déjà émis, mais coupe l'accès au passage suivant.

**P5 — Gater les coordonnées de `GET /api/clients` au Pro+**, comme l'export.
- *Retire* : l'accès API aux coordonnées pour les forfaits qui ne les affichent pas.
  *Protège* : constat 7. *Coût* : une condition de forfait. *Limites* : le Pro+ garde
  l'accès (légitime).

**P6 — Protéger le compte GitHub** (2FA) et, à terme, séparer l'identité de déploiement
des accès de gestion.
- *Retire* : rien. *Protège* : constat 1. *Coût* : un réglage. *Limites* : la
  concentration reste tant que Railway et Supabase se connectent via GitHub ; relève
  aussi du segment 6.

**P7 (préparatoire) — Un modèle de clés par intégration** pour les futures bornes et
caisses : clé propre, révocation par clé, limite par clé.
- *Retire* : rien aux caisses actuelles. *Protège* : constats 11 et 12 pour les
  machines. *Coût* : un chantier (après le filet de tests). *Limites* : dépend du modèle
  produit des intégrations (brief §3).

Les propositions P2, P3 et P6 sont dans le verrouillage déjà décidé par Yass ; P1, P4,
P5 et P7 sont proposées ici pour la roadmap.

---

## 10. Ce que ce segment transmet

| Segment | À instruire |
|---|---|
| **Synthèse** | constats 1, 2, 3 (identité et secrets) en tête du verrouillage post-audit ; constat 4 (aucun usage réussi observé, Q2) latent ; constat 5 (coupure de boutique incomplète) : **risque accepté par Yass, pas de traitement prioritaire** (§12) ; le modèle de clés par intégration (P7) comme préalable au trafic machine ; l'hypothèse forte des limiteurs par IP du proxy (02 §4.8) confirmée pertinente ici (login admin), reste HYPOTHÈSE |
| 1 — notifications | la désinscription Apple sans jeton (constat 9) touche `device_tokens`, donc les surfaces d'envoi |
| 2 — scan et crédit | constat 5 : une boutique coupée peut encore annuler un scan (modifie un solde) ; recoupe l'ajustement sans verrou et l'annulation déjà traités en 02 §4.5-4.6 |
| 4 — cartes | constat 6 : numéro de série clé au porteur, lien de parrainage `?ref=<série>`, pas de `sharingProhibited` ; le lien de parrainage reste sur les cartes Google déjà créées malgré la coupure (00b §13) |
| 5 — statistiques | `GET /api/clients` et les stats partagent les mêmes lectures ; le gating de forfait (constat 7) est un choix d'API à cadrer avec l'affichage |
| 6 — infrastructure | concentration sur GitHub (constat 1) et chaîne de déploiement ; rotation de `JWT_SECRET` = bascule à préparer (constat 3, §7.3) ; protection de branche du dépôt **NON VÉRIFIABLE** ici, à instruire ; restriction réseau de la base (R2 q12, NON VÉRIFIABLE) ; CSP désactivée et `jsQR` sur CDN sans intégrité (constat, §4.9) ; les 8 policies inertes à compléter ou retirer (§7.4) |

---

## 11. Hypothèses et angles morts

| Point | Statut | Comment trancher |
|---|---|---|
| Force de `JWT_SECRET` | NON VÉRIFIABLE (R1 : Yass ne sait pas) | inspection de la valeur par Yass seul, hors audit |
| Force d'`ADMIN_PASSWORD` | NON VÉRIFIABLE (choisi de tête, longueur inconnue) | idem |
| Double authentification GitHub / Railway / Supabase / Apple / Google | NON VÉRIFIABLE (R2 : « ne sais pas », ne pas bloquer) | vérification par Yass dans chaque compte |
| Inscriptions Supabase ouvertes | NON VÉRIFIABLE (R2 q11) — **mais sans conséquence** (constat 10) | réglage Supabase Auth |
| Restriction réseau de l'accès direct à la base | NON VÉRIFIABLE (R2 q12) | Supabase → Database → Network Restrictions |
| Protection de la branche de production sur GitHub | NON VÉRIFIABLE ici | API GitHub (segment 6) |
| Usage passé du canal public (dont `effacer_client`) | aucune exécution réussie observée (Q2) ; **deux limites** : (1) éviction possible des entrées peu fréquentes quand le plafond des statistiques est atteint, (2) aucune trace pour un appel refusé | aucune trace plus fine n'existe ; un envoi-diagnostic ou un journal déployé le trancherait |
| Origine des adresses vues par les limiteurs (celles du proxy de Railway plutôt que du client) | HYPOTHÈSE forte (02 §4.8, R3 retiré) | en-têtes `X-Forwarded-For` reçus (segment 6) |
| Occurrence réelle du constat 5 (boutique coupée qui annule) | non observé (0 boutique coupée) | aucune trace ; se surveille au registre si une coupure survient |
| Injection dans un écran privilégié | PROUVÉ absente dans le périmètre lu | lecture du code ; rien exécuté |

---

## 12. Décisions de pilotage et décisions hors pilotage

Sur instruction de Yass, ce segment ne modifie pas `PASSATION_TECHNIQUE.md` : ce qui
est livré, les décisions et la dette découverte sont consignés ici.

**Livré** : ce rapport et `docs/audit/03-requetes.sql` (Q1 à Q5). Aucun code modifié,
aucune migration, aucune donnée envoyée à la production.
**Dette découverte** : §1 (constats 5, 7, 9), §4, §7.

**Décisions de pilotage**

| Date | Décision | Où elle joue |
|---|---|---|
| 27/09 | Plan validé (trois niveaux, carte des accès, Ponytail, requêtes séparées) | structure |
| 27/09 | R3 retiré (déjà écarté en 02) ; l'hypothèse des limiteurs par IP du proxy reste HYPOTHÈSE et part à la synthèse | constat 12, §8, §11 |
| 27/09 | R1 borné à deux questions par secret (origine, longueur), jamais la valeur | §4.2 |
| 27/09 | Requêtes limitées à des comptages et métadonnées, résultats publiables | `03-requetes.sql`, §annexe A |
| 27/09 | Injection et comparaison du mot de passe admin : constatées par lecture du code, rien mesuré en production | §4.2, §4.9 |
| 27/09 | Verrouillage (dépôt, droits d'exécution, clés) traité **après** l'audit ; policies inertes listées comme candidat sans préjuger de la suppression | §1, §7.4, §9 |
| 27/09 | **Constat 5 (boutique coupée qui garde lecture d'historique et annulation) : risque accepté par Yass, pas de traitement prioritaire.** Une boutique coupée n'a plus accès à la plateforme, et l'effet possible se limite à l'annulation de son dernier scan. Le constat reste au rapport avec son statut et sa preuve (§4.4) ; il n'est pas un préalable à une coupure de boutique. | §1, §4.4, §9 (P4) |
| Antérieure | E-mail marchand : champ arbitraire, pas un chantier | §4.10 |

**Décisions hors pilotage** (prises par la session d'audit) :
- la base de référence a été complétée des `GRANT service_role` des 7 tables (00a §5.1)
  et des rôles Supabase pour que D1 et les tests soient représentatifs ;
  `pg_stat_statements` y a été activé pour valider les deux points de Q2 ; rien n'a été
  exécuté contre la production ;
- la démonstration D1 a été faite dans des transactions annulées (`ROLLBACK`) ; l'état
  de la base de référence est resté inchangé ;
- les requêtes Q1 à Q5 ont été testées sur cette base (et sur des mocks de forme pour
  les schémas `storage`/`auth` absents d'un rejeu du dépôt) avant envoi à Yass.

---

## Annexe A — Résultats bruts (production, 27/09)

**Q1 — stockage** : bucket `passes` public = true ; plafond de taille = aucun ; types
autorisés = tous ; buckets publics = 1 ; `storage.objects` RLS active = true ; droits
`anon` = SELECT,INSERT,UPDATE,DELETE ; droits `authenticated` = SELECT,INSERT,UPDATE,DELETE ;
policies = 0. **Q1b** : aucune ligne (0 policy).

**Q2 — usage du canal public** : `pg_stat_statements` installé = true (Q2a) ; **aucune
ligne pour `anon`/`authenticated`** (Q2b) ; `stats_reset` = 2026-05-23 22:34:06 UTC (Q2c).

**Q3 — rôles** : `anon` hérite de (rien) ; `authenticated` hérite de (rien) ; rôles
LOGIN = 9 (`authenticator, pgbouncer, postgres, supabase_admin, supabase_auth_admin,
supabase_etl_admin, supabase_read_only_user, supabase_replication_admin,
supabase_storage_admin` — tous des rôles standard de la plateforme, aucun rôle
applicatif inattendu) ; tables en temps réel = 0 ; comptes `auth.users` = 0.

**Q4 — coupure d'accès** : boutiques coupées/archivées avec login = 0 ; marchands
suspendus = 1 ; sessions révoquées (`token_version` > 1) = 1 ; marchands mono-site à
jeton complet = 45 ; marchands réseau (≥ 1 boutique provisionnée) = 3.

**Q5 — données personnelles** : e-mail = 9 ; téléphone = 10 ; date de naissance = 9 ;
donnée perso chez un marchand non-Pro+ = 0 ; effacements RGPD au total = 48.
**Q5b** : 2026-05 : 1 · 2026-06 : 35 · 2026-07 : 3 · 2026-08 : 5 · 2026-09 : 4. (Le lot
de juin s'explique vraisemblablement par un nettoyage de données de test — HYPOTHÈSE ;
tous ces effacements sont passés par le backend, pas par le canal public, §4.3.)

**R1** — `JWT_SECRET` : origine et longueur inconnues de Yass (logé dans Railway).
`ADMIN_PASSWORD` : choisi de tête ; longueur non communiquée.

**R2** — Yass a l'accès seul ; il se connecte via GitHub, relié aux comptes (Railway,
Supabase). Double authentification, ouverture des inscriptions Supabase et restriction
réseau : non communiquées (demande de ne pas bloquer). Traitées en NON VÉRIFIABLE.

---

## Annexe B — Démonstration D1 (base rejouée, hors production)

Base de référence rejouée depuis le dépôt (méthode 00a annexe B), complétée des GRANT
`service_role` (00a §5.1) et des rôles Supabase. Sous le rôle `anon`, dans des
transactions **annulées** :

| Fonction | Résultat sous `anon` |
|---|---|
| `increment_stored_value` | échec — permission denied for table clients (droits de l'appelant) |
| `annuler_scan` | échec — permission denied for table scans |
| `credit_referral` | échec — permission denied for table clients |
| `group_stats` | échec — permission denied for table marchands |
| `admin_marchands_stats` | échec — permission denied for table marchands |
| `effacer_client` (SECURITY DEFINER) | **s'exécute** (droits du propriétaire) |

Confirme 00a §5.3 : seul `effacer_client` est réellement exécutable par le rôle public,
et il détruit une carte, il ne déplace pas un solde. Vérifié aussi pour Q2 : un appel
réussi à `effacer_client` par `anon` est enregistré dans `pg_stat_statements` au nom du
rôle **appelant** ; un appel qui échoue n'y figure pas.

---

## Annexe C — Carte des routes (commande reproductible)

Depuis `winwincard/backend/`, au commit `9993fde` :

```bash
# Les 66 routes de routeur, avec leur verbe et le middleware d'authentification
grep -rhnE "router\.(get|post|put|patch|delete)\(" src/routes \
  | grep -oE "(get|post|put|patch|delete)\('[^']+'(, (authAdmin|authMarchand|authScanner|limiter[A-Za-z]+))*" \
  | sort
```

Chaque route a été rattachée à son niveau d'accès (§3.2) par lecture du middleware
posé sur la route et du montage dans `index.js` (préfixes et limiteurs de login). Le
contrôle de complétude : 66 routes de routeur trouvées = 66 classées, plus `/demo`
(`index.js:83`) et `/health` (`index.js:123`), soit 68 au total, cohérent avec 00b F10.
