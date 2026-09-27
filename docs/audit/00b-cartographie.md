# Audit WinWin — Segment 0 (00b) : la cartographie des liens

> Deuxième document de l'audit global, après la photo de production (00a). Question
> posée par le brief (§6) : **qu'est-ce qui est partagé entre les composants** — un
> secret, une identité, une table, le process, un certificat, une limite externe, la
> chaîne de déploiement — **et où ça casse**. Le segment produit aussi les
> **inventaires mécaniques** des familles de défauts connues (dix familles, F1 à F10),
> pour qu'aucune ne dépende d'une redécouverte, et signale ce qui n'entre dans aucun
> segment.
> Même règle que 00a et 01 : **tout constat est rattaché à une preuve** (fichier:ligne,
> commit, requête, relevé). Ce qui n'a pas pu être prouvé est marqué comme tel et n'est
> jamais comblé par une reconstitution. Le dépôt étant public, ce document décrit des
> constats et leurs preuves, **jamais un mode opératoire** (décision de pilotage du 26/09).

| | |
|---|---|
| **Date** | 2026-09-26 ; décisions de pilotage complétées le 27/09 (§13) |
| **Commit audité** | `185c640` (branche `claude/keen-goldberg-MXslu`). Le code applicatif y est identique à celui de `ca0579a`, en production depuis le 25/09 à 22:08 UTC : les cinq commits suivants ne touchent que la documentation (`git diff ca0579a 185c640 -- winwincard/` est vide). |
| **Dernière migration du dépôt** | `047_avis_google` |
| **Périmètre** | ce qui est partagé entre les composants ; inventaires F1 à F10 sur tout `src/` (36 fichiers, 6 486 lignes) et sur les appels des fronts ; liens morts ; éléments du dépôt hors de tout segment |
| **Méthode** | lecture intégrale du code serveur ; extraction syntaxique des appels, recoupée par `grep` (annexe C) ; lecture du code des bibliothèques Supabase à la version verrouillée ; base de référence rejouée depuis le dépôt (PostgreSQL 16) pour tester les requêtes et démontrer un comportement ; requêtes C1 à C7 en lecture seule (`docs/audit/00b-requetes.sql`) exécutées par Yass le 26/09, C8 ajoutée le 27/09 pour vérifier la coupure du parrainage (§13) ; relevés de Yass (Railway, Supabase, navigateur) ; API GitHub ; historique git complet (242 commits) |
| **Limites de méthode** | aucun accès direct à la production ; le code applicatif n'a pas été exécuté (aucune dépendance installée) ; la documentation Supabase est bloquée par le proxy du conteneur : elle est citée par extraits de moteur de recherche et par une discussion GitHub de Supabase, et marquée comme telle |

### Légende

| Marque | Sens |
|---|---|
| **PROUVÉ** | vérifiable par le fichier:ligne, le commit, la requête ou le relevé cité |
| **HYPOTHÈSE** | raisonnement cohérent, non vérifié — ce qui le confirmerait est indiqué |
| **NON VÉRIFIABLE** | la preuve n'existe pas ou n'est pas accessible — la raison est donnée |

La **gravité** (colonne « G ») suit l'échelle du brief (§4), selon ce que l'endroit
fausserait : **1** argent des clients · **2** trafic machine (projection) · **3** scan
au comptoir · **4** données et accès · **5** notifications · **6** carte dans le
téléphone · **7** statistiques · **8** apparence. « — » : sans conséquence ;
« hors échelle » : RGPD, hors périmètre (brief §11).

---

## 1. En une page

La plateforme repose sur **un petit nombre de liens partagés, dont chacun est un point
de rupture unique** : un process Node qui fait tout, une clé qui ouvre toute la base, un
secret qui signe tous les jetons et toutes les cartes Apple, une identité Apple et une
identité Google communes à tous les marchands, un domaine gravé dans chaque carte, une
branche git qui redéploie la production à chaque push.

| # | Constat | G | Statut |
|---|---|---|---|
| 1 | **Le journal du scan peut manquer alors que le solde a bougé.** Le solde est crédité, puis la ligne de `scans` est écrite hors transaction, sans lecture de son erreur (`scan.js:169-183`). Un échec laisse un solde crédité sans ligne : l'annulation, l'historique, les statistiques et la relance deviennent faux pour ce client. Aucune occurrence depuis le 25/09 17:18 (161 scans contrôlés, C7). Avant, non vérifiable : 97 soldes ne se déduisent pas du journal, avec un profil qui évoque des ajustements manuels plutôt que des scans perdus (HYPOTHÈSE). | 1 | PROUVÉ (mécanisme) / NON VÉRIFIABLE (avant le 25/09) |
| 2 | **Le crédit de parrainage peut faire perdre des points au parrain.** `credit_referral` plafonne le solde au seuil (`migration_015:33`). En mode points, un parrain au-dessus du seuil y perd son surplus : démontré sur la base rejouée, 530/500 devient 500. Deux marchands en points avaient le parrainage actif le 26/09 ; un crédit a déjà été versé chez eux. **Parrainage coupé par Yass le 27/09** (décision de pilotage, §13) : aucun nouveau crédit tant que la coupure tient, vérification par C8. | 1 | PROUVÉ (mécanisme) / NON VÉRIFIABLE (perte réelle) |
| 3 | **Un seul process fait tout** : API, cron, minuteurs d'avis, caches, génération des images, signature des cartes. Le cron a duré 80 s pour 66 cartes le 26/09, soit 1,2 s par carte : environ 3 h 20 à 10 000 cartes. Aujourd'hui il ne croise presque aucun scan (moins d'un scan par jour et par marché entre 8 h et 9 h UTC). | 5 | PROUVÉ (C5, C6) / HYPOTHÈSE (projection) |
| 4 | **`JWT_SECRET` signe tout** : les jetons marchand, caisse et admin, et le jeton d'authentification de chaque carte Apple installée. Le changer déconnecte tout le monde et bloque la mise à jour des cartes Apple des 1 287 appareils (C4) jusqu'à leur re-téléchargement. | 3 · 4 · 6 | PROUVÉ (code) |
| 5 | **Une seule clé, `SUPABASE_SERVICE_KEY`, ouvre toute la base.** Le dépôt documente le format des clés historiques, que Supabase annonce retirer d'ici fin 2026 : une échéance à inscrire au calendrier du segment 6. | 3 · 4 | PROUVÉ (usage) / HYPOTHÈSE (format, date) |
| 6 | **Plafond de 1 000 lignes** (réglage Supabase « Max rows » = 1000, relevé) : 13 lectures y sont exposées. La plus chargée est à 32 % aujourd'hui (Pizz'Amore, 322 scans sur 30 jours). Une lecture de plateforme est déjà dépassée (1 691 clients), mais sa route n'a pas d'appelant. À la cible, environ 1 000 porteurs par point de vente, la liste clients, l'export, le cron et les campagnes manuelles seront tronqués chez le marchand moyen. | 5 à 7 | PROUVÉ (C1) / HYPOTHÈSE (cible) |
| 7 | **74 appels Supabase sur 151 ne lisent jamais leur erreur** : une panne de base y devient « rien trouvé ». Au comptoir : « carte introuvable » ou « boutique coupée » (G3). Dans le cron : une lecture en échec retire les filtres et relance tous les clients du marchand (G5). Dans la campagne manuelle : le quota n'est plus vérifié (G5). | 1 à 8 | PROUVÉ |
| 8 | **Les 52 `.catch()`** : les 6 posés directement sur Supabase sont inertes, Storage compris (ce qui corrige le rapport 01) ; 21 sont posés sur des fonctions maison, dont 9 avalent elles-mêmes les erreurs de base, 2 de ces 9 sur un crédit de parrainage. | 1 à 6 | PROUVÉ |
| 9 | **Le dépôt est public.** Aucun des motifs de secret recherchés n'apparaît dans les 242 commits. Sa visibilité est pourtant un lien : la vitrine (GitHub Pages) et le logo de secours des cartes Google en dépendent. | 4 | PROUVÉ |
| 10 | **La chaîne de déploiement** : tout push, documentation comprise, redéploie la production. Le service worker de l'admin ne suit pas les déploiements : l'admin est à jour aujourd'hui, mais sera figé au prochain changement de sa page. La signature des cartes Apple dépend du programme `openssl` de l'image de construction, épinglé nulle part. | 5 · 6 | PROUVÉ (mécanisme) |
| 11 | **Liens morts** : la table `workflows` (0 ligne, jamais lue ni écrite), 7 routes sans appelant, Sentry installé mais inactif, `LANDING_BASE_URL` posée mais jamais lue, `/demo` qui mène à un marchand inexistant, 3 fonctions exportées jamais appelées. | — | PROUVÉ |
| 12 | **Rapports antérieurs corrigés ou complétés** : 01 §4 (Storage) ; A §5.1 (`google_pass_url` n'est pas un signal : les 1 691 cartes l'ont) ; 00a §5.3 (la clé publishable donne le même accès, et le compteur « 0 fonction exposée » ne reflète pas le droit réel) ; 00a §7.4 (le croisement cron / rush de midi à Dubaï n'est pas observé aujourd'hui). | — | PROUVÉ (détail et réserves au §10) |

---

## 2. Méthode

### 2.1 Un inventaire mécanique, un classement manuel

- **Lecture intégrale** des 36 fichiers de `src/`, repérage de tous les appels d'API
  dans les fronts (dashboard, scanner, admin, landing, diagnostic, aperçu), lecture des
  migrations nécessaires.
- **Extraction par analyse syntaxique** (analyseur acorn fourni avec Node 22) : chaque
  chaîne d'appel dont la racine est `supabase`, chaque `.catch()`, chaque boucle
  contenant `await`, chaque `Promise.all` sur une liste de taille variable, chaque
  variable d'état de niveau module, chaque variable d'environnement (y compris les
  accès dynamiques `process.env[x]`), chaque route. Les comptes principaux sont
  recoupés par `grep` : même résultat (annexe C).
- **Contrôle de complétude** : pour chaque famille, le nombre d'occurrences trouvées
  est égal au nombre d'occurrences classées. Une session future relance la commande
  et voit ce qui a changé.

### 2.2 Le comportement des bibliothèques, lu dans leur code

`@supabase/supabase-js`, `@supabase/postgrest-js` et `@supabase/storage-js` sont
verrouillés en **2.107.0** (`package-lock.json`). Leur code a été téléchargé par
`npm pack --ignore-scripts`, sans installation ni exécution. Les empreintes sha512 des
archives sont identiques à celles du `package-lock.json` (annexe E).

### 2.3 Des requêtes testées avant envoi

Base de référence rejouée depuis le dépôt (PostgreSQL 16 : `schema.sql`, migrations
002 à 047, `rgpd_effacement.sql` — 48 fichiers, 0 échec, méthode de 00a annexe B).
Les requêtes C1 à C7 y ont été exécutées à vide, puis sur deux jeux de données
fabriqués dont les résultats étaient connus d'avance : tous les résultats étaient
conformes. C8, ajoutée le 27/09, a suivi la même méthode : 2 cas sur 2 conformes.
La même base a servi à **démontrer** le comportement de `credit_referral` (§5, F8). Le clone de session étant partiel, l'historique a été complété
(`git fetch --unshallow`, 242 commits) avant toute recherche dans l'historique.

---

## 3. La carte

### 3.1 Les composants

| Composant | Où il tourne | Ce qu'il fait |
|---|---|---|
| API Express | process Node unique, Railway, 1 instance, Californie (00a §7) | 68 routes : scan, inscription, dashboard, admin, service web des cartes Apple |
| Cron | **même process** (`cron.js:17`, chargé par `index.js:152`) | relance, boost, anniversaire, purge — 08:00 UTC |
| Minuteurs d'avis | **même process** (`services/avis.js:53`, `:97`) | demande d'avis 30 min après une récompense remise |
| Caches | **même process** | état des marchands (60 s), images de strips (120 entrées), jetons APNs et Google (45 min) |
| Génération des cartes Apple | **même process** + programme `openssl` de l'image (`apple-pass.js:290`) | à chaque installation et à chaque mise à jour |
| Génération des images | **même process** (rendu SVG synchrone, `strip-generator.js:818`) | strips et bannières |
| Base + Storage | Supabase, Paris | 14 tables, bucket public `passes` |
| Apple | APNs + appels des iPhone vers le service web | poussée silencieuse, puis re-téléchargement de la carte |
| Google | API Wallet + OAuth | classes, objets, messages |
| Fronts | navigateurs ; servis par le même process ; 3 service workers | dashboard, scanner, admin, landing, diagnostic |
| Vitrine | GitHub Pages, branche par défaut du dépôt (relevé) | `winwin-card.com` |
| Déploiement | GitHub → Railway (Nixpacks) | chaque push sur la branche de production |
| Sentry | installé, **inactif** (`SENTRY_DSN` non posée, relevé) | — |

### 3.2 Le schéma des liens

```
   iPhone (Wallet)              Android (Google Wallet)            Navigateurs
   service web + APNs           API Wallet (Google)                fronts + 3 service workers
          │                            │                                  │
          ▼                            ▼                                  ▼
 ┌──────────────────── process Node unique (Railway, Californie, 1 instance) ────────────────────┐
 │ API (68 routes) · cron 08:00 UTC · minuteurs d'avis · caches · images · signature (openssl)   │
 │ secrets : SUPABASE_SERVICE_KEY · JWT_SECRET · certificat Apple · clé APNs · compte Google     │
 └───────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                                 │ environ 213 ms par requête (00a §7)
                                                 ▼
                         Supabase Paris : base (14 tables) + Storage (bucket « passes »)
```

---

## 4. Les liens partagés

### 4.1 Les secrets

**PROUVÉ (code et relevé des variables Railway du 26/09).**

| Secret | Qui l'utilise | Sa fuite ouvre | Le changer casse | Statut |
|---|---|---|---|---|
| `SUPABASE_SERVICE_KEY` | les 151 appels à la base et au Storage, via un client unique (`supabase.js:8-14`) ; contourne la RLS | lecture et écriture de toutes les données de tous les marchands | le serveur ne lit qu'une valeur : un changement passe par un redéploiement, et tout s'arrête si l'ancienne clé est révoquée avant | PROUVÉ (usage) |
| `JWT_SECRET` | vérification des 3 rôles (`auth.js:39`, `:66`, `:86`) ; émission (`merchants.js:37`, `scanner-auth.js:48`, `:98`, `admin.js:17`) ; **jeton de chaque carte Apple** (`apple-pass.js:24-30`, gravé en `:326`) | fabriquer n'importe quel jeton, admin compris ; calculer le jeton Apple de toute carte dont on connaît le numéro de série | **toutes les sessions** (dashboard 7 ou 365 j, caisses jusqu'à 365 j, admin 24 h) **et toutes les cartes Apple installées** : le service web les refuse (`apple-wallet.js:30`, `:111`) jusqu'à ce que chaque porteur retélécharge sa carte | PROUVÉ (code) / HYPOTHÈSE (comportement de l'iPhone) |
| `ADMIN_PASSWORD` | un mot de passe unique pour tout l'admin (`admin.js:14`, comparaison non constante → segment 3) ; jeton admin de 24 h (`admin.js:17`) | l'admin entier | rien ; mais un jeton admin émis ne se révoque qu'en changeant `JWT_SECRET` | PROUVÉ |
| `APPLE_SIGNER_CERT_B64`, `APPLE_SIGNER_KEY_B64`, `APPLE_WWDR_CERT_B64`, `APPLE_PASS_PHRASE` | signature de **toutes** les cartes Apple, à l'installation et à chaque mise à jour (`apple-pass.js:50-56`, `:260-292`) | signer des cartes au nom de WinWin | à l'expiration du certificat, la génération des cartes (segment 6) | PROUVÉ |
| `APPLE_APN_KEY_B64`, `APPLE_APN_KEY_ID`, `APPLE_TEAM_ID` | toutes les poussées, toutes surfaces (`apns.js:29-57`) | pousser vers les cartes WinWin | les mises à jour de toutes les cartes Apple | PROUVÉ |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_WALLET_ISSUER_ID` | tous les appels Google et tous les liens « ajouter à Google Wallet » (`google-pass.js:39-57`, `:103-133`, `:394-406`) | modifier toutes les cartes Google | toutes les cartes Google | PROUVÉ |

**Deux traitements du matériel de signature à transmettre au segment 3** (PROUVÉ,
code) : la clé privée de signature est écrite dans le répertoire temporaire à chaque
génération de carte (`apple-pass.js:268`, supprimée en `:523`) ; la phrase de passe
passe en argument de la commande `openssl` (`apple-pass.js:287`), donc visible dans la
liste des process du conteneur pendant l'exécution. La route admin
`/api/admin/debug/certs` (`admin.js:552-635`) affiche les dates de validité des
certificats et si la clé est chiffrée : c'est la source des dates pour le calendrier
du segment 6.

**Deux réglages non secrets mais porteurs** (PROUVÉ, code et relevé) :
- `NODE_ENV` choisit l'APNs de production ou le bac à sable (`apns.js:65-67`). En
  production il vaut `production` (relevé). Une autre valeur ferait échouer toutes les
  poussées Apple, visibles seulement comme refus dans le registre.
- `API_BASE_URL` vaut `https://app.winwin-card.com` (relevé) : c'est l'adresse gravée
  dans chaque carte Apple (§4.2).

**Variables posées contre variables lues** — PROUVÉ (relevé Railway du 26/09 et
extraction de toutes les lectures de `process.env`, annexe C) :

| | Variables |
|---|---|
| Posées et lues (17) | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `ADMIN_PASSWORD`, `APPLE_PASS_TYPE_IDENTIFIER`, `APPLE_TEAM_ID`, `APPLE_PASS_PHRASE`, `APPLE_SIGNER_CERT_B64`, `APPLE_SIGNER_KEY_B64`, `APPLE_WWDR_CERT_B64`, `APPLE_APN_KEY_ID`, `APPLE_APN_KEY_B64`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_WALLET_ISSUER_ID`, `API_BASE_URL`, `NODE_ENV`, `PORT` |
| **Posée, jamais lue** | `LANDING_BASE_URL` — lien mort. Les 8 variables ajoutées par Railway ne sont pas lues non plus, ce qui est normal. |
| **Lues, jamais posées** | `SENTRY_DSN` : Sentry est inactif (`instrument.js:11-21`, `index.js:132-134`) — lien mort. `AVIS_DELAI_MS` : réglage de test, le défaut de 30 min s'applique, comme voulu. `APPLE_SIGNER_CERT`, `APPLE_SIGNER_KEY`, `APPLE_WWDR_CERT`, `APPLE_APN_KEY` : chemins de fichiers de secours pour le poste de développement, ignorés en production parce que les variantes `_B64` sont posées (`apple-pass.js:42-48`, `apns.js:29-38`). |
| Écart de documentation | `.env.example` ignore les variantes `_B64` qui font réellement tourner la production, et `SENTRY_DSN`. Il décrit encore les domaines `winwincard.fr` et « l'espace Yacine ». |

**Quelle clé Supabase le serveur utilise-t-il ?** Le code attend « la clé
service_role » (commentaire de `supabase.js:7`). Il n'en contrôle pas le format :
supabase-js 2.107.0 transmet la valeur telle quelle (en-têtes `apikey` et
`Authorization`, `fetchWithAuth`, `dist/index.cjs:922-940`). Le seul format documenté
dans le dépôt est celui d'une clé historique (`.env.example:3`, valeur commençant par
`eyJ`). **HYPOTHÈSE** : la production utilise la clé historique `service_role`.
*Ce qui trancherait, sans rien communiquer* : Yass regarde seul le début de la valeur ;
`eyJ` signifie clé historique, `sb_secret_` nouvelle clé. Deux conséquences :
- si la clé est historique, **les clés historiques sont forcément actives** (le serveur
  fonctionne), clé `anon` historique comprise ;
- la documentation Supabase annonce le retrait des clés historiques d'ici fin 2026
  (**HYPOTHÈSE forte** : extrait de moteur de recherche, page non lisible depuis le
  conteneur). Ce jour-là, un serveur resté sur la clé historique perdrait l'accès à
  toute la base. **Échéance à dater par le segment 6.**

### 4.2 Les identités

| Identité | Où elle est gravée | Ce qui en dépend | Statut |
|---|---|---|---|
| Pass Type ID `pass.com.winwincard.loyalty` | variable ; repli en dur (`apns.js:91`, `apple-pass.js:322`) | toutes les cartes Apple de tous les marchands ; sujet APNs ; **un jeton par appareil couvre toutes ses cartes WinWin** (01, cause B) | PROUVÉ |
| Team ID | variable ; repli en dur `LTW34ARCX2` (`apple-pass.js:324`) | signature, jeton APNs | PROUVÉ |
| Émetteur Google | `GOOGLE_WALLET_ISSUER_ID` | préfixe de chaque classe et de chaque objet (`google-pass.js:50-57`) | PROUVÉ |
| `slug` du marchand | base | classe Google (`google-pass.js:50-53`), adresse de la landing, dossiers Storage des strips (`strip-cache.js:30-51`), lien de parrainage de chaque carte. Le renommer orpheline la classe Google et le cache d'images (passation §3.4). | PROUVÉ |
| Numéro de série | base, immuable | QR (`apple-pass.js:411`), carte Apple, objet Google, code de secours (6 derniers caractères), lien d'avis `/avis/<série>`, lien de parrainage. C'est aussi une **clé au porteur** : la route publique `/api/passes/:serial/apple` rend la carte (prénom, solde) à qui connaît la série (`passes.js:8-68`, segment 3). | PROUVÉ |
| `marchand_id` | base | chaque jeton ; public par `/api/merchants/:slug/public` (`merchants.js:179`) | PROUVÉ |
| Domaine `app.winwin-card.com` | `API_BASE_URL` + 7 replis en dur (F9) | adresse du service web **gravée dans chaque carte Apple** (`apple-pass.js:325`), liens de parrainage et d'avis, seule origine CORS admise (`index.js:33`) | PROUVÉ |
| Domaine `winwin-card.com` | DNS | vitrine sur GitHub Pages (relevé). Même zone DNS que l'API : **perdre le domaine arrête les mises à jour de toutes les cartes Apple.** | PROUVÉ (relevé) / HYPOTHÈSE (conséquence) |

**Mesure de l'identité Apple partagée (C4) — PROUVÉ.** 1 287 appareils portent au
moins une carte ; **23 portent des cartes de plusieurs marchands**, jusqu'à **31
cartes** sur un même appareil ; 28 jetons de poussée servent à plusieurs cartes.
Combiné au filtre inerte de la liste « mises à jour depuis » (01, cause C ; passation
dette #11), une poussée vers une carte fait revérifier toutes les cartes de
l'appareil, jusqu'à 31.

### 4.3 Les tables partagées

**PROUVÉ (extraction, annexe A ; volumes C2).**

| Table | Lignes (C2) | Écrite par | Lue par | Point de contention |
|---|---|---|---|---|
| `marchands` | 48 | admin (7 endroits), campagne (`notifications.js:98`), workflows (`workflows.js:39`) | 37 endroits + le cache marchand | source de toute la configuration |
| `clients` | 1 739 (1 691 actifs) | inscription (`clients.js:44`), ajustement (`:219`), parrainage (`:321`) ; fonctions `increment_stored_value`, `annuler_scan`, `credit_referral`, `effacer_client` | 20 endroits | **`stored_value`, voir ci-dessous** |
| `scans` | 2 178 | scan (`scan.js:174`), `annuler_scan` | historique, fiche, stats, cron (7 endroits) ; `group_stats`, `admin_marchands_stats` | le journal de l'argent |
| `passes` | 1 691 | 10 endroits | 6 endroits | **`notification_message`, voir ci-dessous** |
| `device_tokens` | 1 366 | service web Apple (`apple-wallet.js:43`, `:68`) ; `effacer_client` | 7 surfaces d'envoi | un jeton par appareil, partagé entre marchands (C4) |
| `workflow_executions` | **2 874** | cron (`cron.js:67`, `:134`, `:217`), purge (`:268`) | cron (déduplication) | **plus grosse table** : plus de lignes que `scans` |
| `notification_envois` | 656 en 29 h | registre (`notif-registre.js:91`), purge (`cron.js:277`) | aucun code (lue en SQL) | environ 540 lignes par jour |
| `notification_logs` | 51 | campagne (`notifications.js:150`) | quota et historique (`notifications.js:20-27`, `:65`) | le quota se compte sur cette table |
| `points_de_vente` | 9 | admin, dashboard | scan, connexion caisse, listes | relue à chaque scan |
| `consentements` | 25 | inscription (`clients.js:62`) ; `effacer_client` | aucun code | preuve RGPD |
| `referral_credits` | 1 | parrainage (`scan.js:310`) | aucun code (l'index unique fait office de lecture) | ticket anti-doublon |
| `avis_clics` | 1 | clic d'avis (`avis.js:62`) | aucun code (lue en SQL) | mesure |
| `diagnostics_camera` | 15 | outil de diagnostic (`diag.js:66`) | page de résultats admin (`diag.js:86`) | instrument temporaire |
| `workflows` | **0** | **aucun** | **aucun** | table morte (§6) |

**Colonnes disputées — PROUVÉ (code).**
- **`clients.stored_value` a cinq écrivains.** Trois fonctions verrouillent la ligne
  (`FOR UPDATE`) : l'incrément du scan, l'annulation, le crédit de parrainage.
  L'ajustement du dashboard écrit une **valeur absolue sans verrou ni relecture**
  (`clients.js:219-226`) : un scan passé entre l'affichage et l'enregistrement est
  écrasé. `effacer_client` ne touche pas au solde. → segment 2.
- **`passes.notification_message` est écrit à sept endroits du code** : scan,
  parrainage, ajustement (et annulation, qui passe par le même code), campagne, cron,
  avis, bienvenue (`scan.js:170`, `:336` ; `clients.js:262` ;
  `notifications.js:102` ; `cron.js:237` ; `services/avis.js:133` ;
  `apple-wallet.js:184`). Le dernier qui écrit gagne (passation dette #13). La
  campagne réécrit en **une seule instruction toutes les cartes du marchand**
  (`notifications.js:102-104`). Pendant ce temps, le scan du même marchand attend son
  propre verrou de ligne avant de répondre (`scan.js:169-183`, attendu).
  **HYPOTHÈSE** sur la durée, qui dépend du nombre de cartes (267 chez Dinapoli
  aujourd'hui).
- `passes.updated_at` est posé par un déclencheur à chaque mise à jour (`schema.sql`,
  `trg_passes_updated_at`) et relu par le service web Apple (en-tête
  `If-Modified-Since`).

### 4.4 Le process Node

**Tout ce qui vit dans le process** (PROUVÉ) : l'API, le cron (chargé après
l'ouverture du port, `index.js:149-156`), les minuteurs d'avis, 6 limiteurs de débit
avec leurs compteurs en mémoire, 3 caches (marchands, strips, jetons), la session
HTTP/2 vers Apple, les processus `openssl` lancés à chaque carte. L'inventaire de
l'état en mémoire et de ce qu'il devient au redémarrage ou à deux instances est F5.

**Une seule boucle d'événements pour tout le monde.** Un calcul synchrone y bloque
toutes les requêtes en cours, scans compris :
- `scryptSync` à chaque connexion marchand, caisse ou boutique (`auth-utils.js:5`,
  `:11`) : **35 ms par appel, mesuré** dans le conteneur d'audit (médiane de 10 ; la
  machine de production est différente : HYPOTHÈSE sur la valeur exacte) ;
- le rendu SVG en PNG est **synchrone** (`strip-generator.js:818`) et appelé trois fois
  par image générée (`:868-870`), à chaque image absente du cache : après un
  changement de design, à chaque nouvelle valeur de tampons. Durée **non mesurée**
  (bibliothèque non installée).

**Le cron dans ce process — PROUVÉ (C6, C5).** Le 26/09, le passage de 08:00 UTC a
écrit son dernier lot à **08:01:21** : **66 cartes notifiées en 80 s, soit environ
1,2 s par carte**. Ce chiffre comprend les trois allers-retours avec la base (environ
0,64 s, 00a §7.4) et les appels à Apple et à Google, faits un par un
(`cron.js:47-69`, `:108-136`, `:188-219`). Entre 8 h et 9 h UTC, la plateforme reçoit
aujourd'hui **0,8 scan par jour pour les marchands anglophones et 0,8 pour les
francophones** (C5). Les pointes sont ailleurs : 10 h-12 h UTC et 15 h-20 h UTC pour
les francophones, 15 h-17 h UTC pour les anglophones. **Le croisement signalé par 00a
(§7.4) n'est donc pas observé aujourd'hui.** Projection (**HYPOTHÈSE**, extrapolation
linéaire) : à 1,2 s par carte, un passage de 6 000 cartes finirait vers 10 h UTC, en
pleine pointe de midi en France.

### 4.5 Certificats, clés et comptes : qui dépend de quoi

Les dates relèvent du calendrier du segment 6. Ici, seulement la dépendance.

| Élément | En dépendent | Ce qui casse | Où lire l'échéance |
|---|---|---|---|
| Certificat de signature Pass Type ID et WWDR | génération de toutes les cartes Apple, installation et mise à jour | nouvelles cartes et mises à jour (HYPOTHÈSE sur l'effet exact côté iPhone) | `/api/admin/debug/certs` (`admin.js:552-635`) |
| Clé APNs (.p8) | toutes les poussées Apple | les mises à jour silencieuses | compte Apple Developer |
| Adhésion Apple Developer | certificat, Pass Type ID, clé APNs | tout le canal Apple | compte Apple |
| Compte de service Google | toute l'API Wallet, liens de sauvegarde | tout le canal Google | console Google Cloud |
| Clés d'API Supabase | tout le serveur (§4.1) | toute la plateforme si la clé historique est retirée | tableau de bord Supabase, documentation |
| Domaine `winwin-card.com` | vitrine, API, adresse gravée dans chaque carte Apple | tout, cartes installées comprises | registraire |
| Certificats TLS | Railway (`app.`), GitHub Pages (apex) | l'accès HTTPS | renouvellement automatique (HYPOTHÈSE) |

### 4.6 Les limites externes

| Limite | Valeur | Qui la partage | Ce qui casse | Statut |
|---|---|---|---|---|
| Lignes par lecture | **Max rows = 1000** | les 28 lectures de listes (F1) | troncature silencieuse | PROUVÉ (relevé) |
| Durée d'une requête | 8 s (rôle `authenticator`) | toutes les requêtes du serveur | les agrégats qui grossissent avec le stock | HYPOTHÈSE (00a §6.5) |
| Relances automatiques | GET et HEAD relancés 3 fois (1 s, 2 s, 4 s) sur erreur réseau ou réponse 503/520 ; écritures jamais relancées | toutes les lectures | une lecture en échec au scan attend jusqu'à 7 s de plus avant l'erreur | PROUVÉ (`postgrest-js dist/index.cjs:7-29`, `:115-120`, `:286-306`) |
| Délai maximal côté client | **aucun** : `supabase.js:8-14` n'en fournit pas, supabase-js n'en impose pas (`dist/index.cjs:1270-1276`) | toutes les requêtes | une connexion bloquée n'est bornée que par Node | PROUVÉ (absence) / HYPOTHÈSE (délais par défaut de Node) |
| Connexions à la base | 60 (00a) ; pool de l'API « configuré automatiquement » (relevé) | serveur | — | PROUVÉ (relevés) |
| Notifications Google | 3 par carte et par 24 h | toutes les surfaces d'envoi Google | messages écrêtés sans trace | PROUVÉ (A §5.2, documentation) |
| Quotas de l'API Google | inconnus | tous les appels Google | refus en rafale (campagne) | NON VÉRIFIABLE ici (console Google) |
| APNs | 1 session par process, 10 s par poussée, 1 relance | toutes les surfaces Apple | — | PROUVÉ (`apns.js:69-84`, `:150-155`, `:163-180`) |
| Limiteurs de débit | mémoire du process, clé = adresse IP ; global 300 requêtes / 15 min (`index.js:42-47`), inscription 20/h, connexions 10 à 20/h, diagnostic 30/h (`rateLimiters.js:4-51`) | tous les appareils derrière une même adresse (tablettes d'une boutique, Wi-Fi d'un commerce, réseau d'opérateur) | refus 429 au comptoir ou à l'inscription | PROUVÉ (réglages) |
| Adresse IP vue par le serveur | `app.set('trust proxy', 1)` (`index.js:25`), posé avant tout limiteur | les limiteurs | si le proxy Railway fait plus d'un saut, tout le monde partage la même adresse et les limites deviennent globales | PROUVÉ (réglage explicite) / HYPOTHÈSE (nombre de sauts chez Railway) |
| Décodeur de QR du scanner | `jsQR` chargé depuis `cdn.jsdelivr.net` (`dashboard/index.html:13`, `scanner/index.html:594`, `scanner/sw.js:23`) | le scan caméra | premier chargement sans CDN = pas de lecture de QR ; ensuite servi par le cache du scanner | PROUVÉ (code) |
| Images des marchands | téléchargées à chaque génération de carte Apple, 5 s d'inactivité au plus (`apple-pass.js:61`, `:111`) ; le même logo deux fois (`:449-450`) | toutes les cartes Apple | carte générée sans logo | PROUVÉ |

### 4.7 La chaîne de déploiement

**PROUVÉ (relevé Railway, code, git).**

1. **Un push sur `claude/keen-goldberg-MXslu` redéploie la production, documentation
   comprise** : c'était le cas de `185c640` ; le champ « Watch Paths » de Railway est
   vide (relevé du 26/09). Yass accepte les redémarrages causés par l'audit.
2. **Un redémarrage efface tout l'état en mémoire** (F5) : demandes d'avis en attente,
   caches, compteurs des limiteurs, session APNs ; un passage de cron en cours
   s'interrompt sans trace (rapport A §3). Aujourd'hui, l'avis n'est actif que chez
   **Hamza Salon**, dont le lien de la recette du 26/09 est resté en place (C3), et le
   passage du cron dure environ 80 s.
3. **Construction** : Nixpacks, sans `nixpacks.toml`. La version de Node n'est pas
   bornée (00a §7.5). La signature des cartes Apple dépend du **programme `openssl` de
   l'image** (`apple-pass.js:290`) depuis `75e1a39` (28/05), qui a remplacé la
   bibliothèque cassée par Node 22. La version majeure de Node ne pilote donc plus la
   signature ; l'image, si. Rien dans le dépôt n'épingle `openssl` (HYPOTHÈSE sur la
   conséquence d'une mise à jour de l'image).
4. **Les fronts sont servis par le même process** (HTML en `no-cache`,
   `index.js:73-80`) et par trois service workers :

   | Front | Stratégie | Suit les déploiements ? |
   |---|---|---|
   | Scanner | réseau d'abord pour la page (`scanner/sw.js:46-59`), corrigé le 18/07 (`7795411`) | oui |
   | Dashboard | réseau d'abord (`dashboard/sw.js:21-33`) | oui |
   | **Admin** | **cache d'abord pour tout** (`admin/sw.js:8-11`), fichier inchangé depuis sa création (`f1db844`, 26/05) | **non** |

   **Le cache admin daté du 26/09 à 22:20:42 GMT (relevé) s'explique par le code.**
   Le gestionnaire de requêtes de l'admin n'écrit jamais dans le cache
   (`admin/sw.js:8-11`). Seule l'installation du service worker le remplit
   (`admin/sw.js:2-4`). Une date récente signifie donc que le service worker s'est
   installé à ce moment-là : première visite dans ce navigateur, données du site
   effacées, ou outils de développement (**HYPOTHÈSE** sur la cause). **Conclusion :**
   - **Aujourd'hui, l'admin n'est pas figé** : son cache est postérieur à la dernière
     modification de sa page (`ca0579a`, 25/09).
   - **Il le deviendra au prochain déploiement qui modifie `public/admin/index.html`.**
     Le navigateur continuera de servir la version du 26/09 tant que le service worker
     n'est pas réinstallé, et aucun déploiement ne le réinstalle tant que `sw.js` ne
     change pas.
   - Un rechargement forcé affiche une fois la nouvelle version sans mettre le cache à
     jour : la visite normale suivante ramène l'ancienne.
   - **Conséquence possible** : un admin figé avant le 25/09 renverrait
     `landing_premium = false` en enregistrant un marchand Pro, défaut corrigé ce
     jour-là (passation §17).
5. **La vitrine et le logo de secours Google dépendent du dépôt.** GitHub Pages sert
   `winwin-card.com` depuis la branche par défaut `claude/winwin-card-landing-ohS22`
   (relevé ; API GitHub : `has_pages`, `default_branch`). Le logo de secours de chaque
   classe Google est une adresse `raw.githubusercontent.com` de cette même branche
   (`google-pass.js:65`) : il suppose le dépôt public et la branche intacte. La
   branche de production porte aussi à sa racine une copie de la vitrine (`index.html`,
   `CNAME`, images), qui n'est pas servie (§6).
6. **Le dépôt est public** (API GitHub : `visibility: public`). Recherche sur tout
   l'historique (242 commits, commande en annexe C) :
   - **aucune occurrence** des motifs de clé privée, de jeton JWT complet, de clé
     Supabase ou Stripe, de phrase de passe ou de mot de passe renseigné ;
   - **aucun fichier** `.pem`, `.p8`, `.p12`, `.key` ni `.env` n'a jamais été commité ;
   - seul le modèle de `.env.example` apparaît (en-tête JWT tronqué).

   Rendre le dépôt privé couperait le logo de secours Google et, selon l'offre GitHub,
   la vitrine (**HYPOTHÈSE** : Pages exige un dépôt public sur l'offre gratuite).

---

## 5. Les inventaires mécaniques

Chaque famille est définie par une commande reproductible (annexe C). Le nombre trouvé
égale le nombre classé.

### F1 — Les lectures exposées au plafond de 1 000 lignes

**Définition** : une lecture de table sans `range()`, sans `limit()`, sans
`single()`/`maybeSingle()` et sans comptage en tête. **Décompte** : 151 appels
Supabase, dont **90 lectures de table** : 49 à une ligne, 7 comptages, 6 avec
`limit`, **28 listes sans borne**. Sur les 28 : **13 grossissent avec l'activité ou
le stock**, 8 portent sur les marchands ou les boutiques (hors d'atteinte à la cible),
7 sont bornées par nature (jetons d'une carte, cartes d'un appareil, correspondances
d'un code de secours). **PROUVÉ (code, C1, relevé Max rows = 1000).**

| Code | Lecture | Ce qu'elle ramène | Unité | Max aujourd'hui (C1) | Ce que la troncature fausserait | G |
|---|---|---|---|---|---|---|
| L1 | `cron.js:52` | scans de la fenêtre d'inactivité (30 j par défaut) | activité | 297 (Pizz'Amore) | des clients venus récemment sont relancés « tu nous manques » | 5 |
| L2 | `cron.js:53` | clients du marchand | stock | 267 (Dinapoli) | des clients ne sont jamais examinés par la relance | 5 |
| L2 | `clients.js:100` | liste clients du dashboard, triée par solde décroissant | stock | 267 | les plus petits soldes disparaissent de l'écran : ni fiche, ni ajustement, ni effacement depuis l'interface | 7 |
| L2 | `clients.js:123` | export CSV | stock | 267 | export amputé sans avertissement | 7 |
| L3 | `cron.js:54` | relances « inactif » des 7 derniers jours | stock d'inactifs | 150 (WinWin Card DEMO) | déduplication incomplète : relance quotidienne au lieu de tous les 8 jours | 5 |
| L4 | `cron.js:115` | clients proches de la récompense | stock | 29 (Nails By Ness) | boost jamais envoyé à une partie des clients | 5 |
| L5 | `cron.js:120` | boosts des 7 derniers jours | stock | 12 (Magic Cleaning) | déduplication du boost | 5 |
| L6 | `cron.js:190` | clients avec date de naissance | stock | 3 | anniversaires jamais souhaités | 5 |
| L7 | `cron.js:195` | anniversaires envoyés depuis le 1er janvier | stock | 1 | doublon possible seulement si deux passages le même jour | 5 |
| L8 | `merchants.js:63` | scans des 30 derniers jours (statistiques du dashboard) | activité | 322 (Pizz'Amore) | clients actifs, rétention et fréquence sous-estimés, et différents d'un chargement à l'autre (passation §12, §16) | 7 |
| L9 | `clients.js:331` | tous les clients de la plateforme | stock | **1 691 : déjà au-delà** | liste admin tronquée ; **route sans appelant** (§6) | 7 |
| L10 | `notifications.js:80` | jetons Apple du marchand | stock | 256 (Dinapoli) | campagne manuelle limitée à 1 000 appareils, choisis sans ordre défini | 5 |
| L11 | `notifications.js:84` | cartes Google du marchand | stock | 267 (Dinapoli) | idem côté Google | 5 |
| L12 | `admin.js:38`, `:652`, `:696` ; `cron.js:32`, `:93`, `:165` | marchands | stock | 48 | hors d'atteinte à la cible (≈ 100) | 7 / 5 |
| L13 | `merchants.js:121` ; `admin.js:86` | boutiques du réseau | stock | 5 (Pizz'Amore) | hors d'atteinte | 7 |

Bornées par nature, pour mémoire (PROUVÉ, code) :
- jetons d'une carte : `scan.js:239`, `clients.js:276`, `services/avis.js:143`,
  `cron.js:244`, `admin.js:520` ;
- cartes d'un appareil : `apple-wallet.js:84` ;
- correspondances d'un code de secours : `scan.js:73`.

**Immunisés contre le plafond, mais pas contre le délai de 8 s** : les 7 comptages
(`merchants.js:61`, `:62` ; `notifications.js:27`, `:65` ; `admin.js:498-500`, dont
deux comptent toute la plateforme) et les deux fonctions d'agrégat (`group_stats`,
`admin_marchands_stats`).

**Famille cherchée et absente** : les filtres `.in()` dont la liste grossirait avec
le stock. Il n'y en a que trois, sur une liste constante de deux forfaits
(`cron.js:35`, `:96`, `:168`).

### F2 — Les `.catch()`

**Décompte** : 57 lignes contiennent `.catch(`, dont 5 commentaires : **52 appels**,
chiffre confirmé par l'analyse syntaxique. **PROUVÉ (code ; comportement des
bibliothèques lu à la version verrouillée).**

**Pourquoi un `.catch()` posé sur Supabase ne sert à rien.** À la version 2.107.0 :
- `postgrest-js` ne rejette jamais une requête : même une panne réseau revient en
  `{ error }` (`dist/index.cjs:312-355`) ;
- `storage-js` fait de même : toute erreur d'API ou de réseau est un `StorageError`,
  rendu en `{ data: null, error }` (`dist/index.cjs:74-77`, `:119`, `:308-320`,
  `:468-486`).

Le rapport 01 (§4) et la passation (§15 quater) tenaient les `.catch()` sur Storage
pour légitimes. **C'est inexact** (§10).

| Catégorie | Nombre | Verdict | Détail |
|---|---|---|---|
| Posés directement sur un appel Supabase | 6 | **tous inertes**. Aux 4 endroits Storage, l'erreur est ignorée volontairement : sans conséquence, sauf un fichier orphelin possible (`admin.js:872-874`). Ailleurs : l'erreur est lue dans le `.then` au clic d'avis (`avis.js:62-65`) ; à l'insertion des consentements, elle n'est jamais lue (`clients.js:62-64`, hors échelle) | annexe B |
| Posés sur une fonction maison qui appelle Supabase | 21 | **9 aveugles** aux pannes de base, en tout ou en partie. Dont 2 de gravité 1 : crédit du parrain (`scan.js:198`) et liaison du filleul (`clients.js:71`). 10 efficaces, 2 sans objet | annexe B |
| Posés sur un appel extérieur (Google, APNs, images, sharp) ou le filet d'Express | 25 | légitimes : ces fonctions lèvent bien | annexe B |

C3 : **1 client** a des données personnelles sans ligne de consentement. Deux
explications possibles (**HYPOTHÈSE**) :
- l'insertion muette de `clients.js:62` a échoué ;
- ce client a été créé entre le 03/06 et le 04/06, quand le formulaire collectait déjà
  les coordonnées (`80e205c`) mais que le consentement n'était pas encore enregistré
  (`f09a12c`).

Sujet RGPD, hors périmètre.

### F3 — Les appels qui ne lisent pas leur erreur

**Définition** : un appel réseau à Supabase dont le résultat n'est pas examiné pour
`error`. **Décompte** : 151 appels, dont 3 sans réseau (`getPublicUrl`) ; parmi les
148 autres, **74 ne lisent pas leur erreur**. **PROUVÉ (code).** Détail des 74 en
annexe A. Effet commun : **une panne de base se lit comme une absence**.

| G | Nombre | Les cas qui comptent |
|---|---|---|
| 1 | 5 | **`scan.js:174`** : ligne de scan non vérifiée après le crédit (§1, constat 1). Parrainage : une panne fait perdre en silence le crédit du parrain. À l'inscription, le filleul n'est jamais lié (`clients.js:311`, `:321`) ; au premier scan, le crédit est sauté (`scan.js:284`, `:294`) ; son déclencheur revient au cycle suivant en tampons, mais en mode points seulement après une remise à zéro manuelle. |
| 3 | 8 | au comptoir, une panne devient « boutique coupée » (`scan.js:28`), « carte introuvable » (`scan.js:65`, `:73`), « annulation refusée » (`scan.js:386`), « identifiants invalides » à la connexion caisse ou dashboard (`scanner-auth.js:30`, `:63`, `:69` ; `merchants.js:18`) |
| 4 | 2 | le durcissement réseau (`scan.js:43`, `scanner-auth.js:84`) : une panne **laisse passer** un jeton marchand sur un réseau |
| 5 | 20 | **cron** : une lecture en échec **retire les filtres au lieu d'arrêter l'envoi** (`cron.js:52` : tous les clients du marchand relancés, même ceux venus la veille ; `:54`, `:120`, `:195` : déduplication éteinte) ; workflows entiers sautés en silence (`:32`, `:93`, `:165`). **Campagne** : quota non vérifié (`notifications.js:57`, `:65`), texte non réécrit sur les cartes (`:102`) : les poussées partent, iOS n'affiche rien |
| 6 | 16 | carte non installable (`clients.js:53`, 0 occurrence en C3), refusée à Apple (`apple-wallet.js:34`, `:135`, `:141`), **carte iPhone non rafraîchie après un scan ou un crédit de parrainage** (`scan.js:170`, `:336` : `updated_at` non avancé, Apple reçoit 304), resynchronisation abandonnée (`clients.js:245`, `:276`), liste Apple vide (`apple-wallet.js:84`) |
| 7 | 9 | statistiques du dashboard (`merchants.js:61-63`), compteurs admin (`admin.js:498-500`), quota affiché (`notifications.js:26`, `:27`), export refusé à tort (`clients.js:113`) |
| 8 | 9 | outils admin ; numéro de version des images remis à 2 (`admin.js:334`, `:775`) |
| — | 4 | Storage, erreur ignorée volontairement |
| hors échelle | 1 | consentements (`clients.js:62`) |

### F4 — Le travail lancé sans attendre

**Décompte : 18 lancements sans `await`**, plus le minuteur d'avis
(`scan.js:230-234`) et le cron lui-même. Tous se perdent si le process s'arrête
avant leur fin, **sans trace**. **PROUVÉ (code).**

| Endroit | Ce qui part | Perdu au redémarrage | G |
|---|---|---|---|
| `scan.js:197` | crédit du parrain (ticket, puis crédit) | entre le ticket et le crédit : crédit perdu, jamais doublé (choix assumé, passation §2 [5]) | 1 |
| `clients.js:70` | liaison du filleul au parrain | filleul non lié : parrain jamais crédité | 1 |
| `scan.js:186`, `:187`, `:342`, `:344` | poussées Apple et Google après un scan ou un parrainage | carte non rafraîchie | 6 |
| `clients.js:232` ; `scan.js:408` | resynchronisation après un ajustement ou une annulation | carte non rafraîchie | 6 |
| `admin.js:221`, `:354`, `:793` | mise à jour de la classe Google | classe périmée (dette #4) | 6 |
| `apple-wallet.js:59` | poussée de bienvenue, **après la réponse** | pas de bienvenue | 5 |
| `scan.js:230` → `services/avis.js:97-101` | demande d'avis, 30 min plus tard | demande perdue (accepté) | 5 |
| `notifications.js:150` | ligne de `notification_logs` | quota non décompté, historique incomplet | 5 |
| `avis.js:62` | comptage du clic, **après la redirection** | clic non compté | 7 |
| `clients.js:62` | preuve de consentement | preuve perdue | hors échelle |
| `admin.js:872` ; `strip-cache.js:191` | suppressions de fichiers Storage | fichiers orphelins | — |
| `cron.js:17` | le passage quotidien | fin du passage reportée au lendemain (rapport A §3) | 5 |

### F5 — L'état en mémoire : au redémarrage, et avec deux instances

**PROUVÉ (code).** Le brief (§7) demande ce qui casse ou se duplique à deux serveurs.

| État | Où | Au redémarrage | Avec deux instances | G |
|---|---|---|---|---|
| Planification du cron | `cron.js:17` | passage interrompu, repris le lendemain | **deux passages à 08:00** : chacun lit la déduplication avant que l'autre n'écrive, **chaque client notifié l'est deux fois**. C3 : 0 doublon aujourd'hui, cohérent avec une instance unique. | 5 |
| Minuteurs d'avis | `services/avis.js:53`, `:97` | demandes en attente perdues | chaque instance garde les siennes ; la déduplication par carte ne vaut que par instance | 5 |
| Cache marchand (suspension, révocation) | `marchand-cache.js:36`, `:41` | vide, relu | l'invalidation ne touche qu'une instance : **jusqu'à 60 s** de suspension ou de révocation non appliquée sur l'autre (passation §15 ter) | 4 |
| 6 limiteurs de débit | `index.js:42` ; `rateLimiters.js:4`, `:13`, `:22`, `:33`, `:45` | compteurs remis à zéro | limites **par instance** (effectivement doublées) | 4 |
| Session APNs et jeton APNs | `apns.js:43-44`, `:69-70` | nouvelle session | une session et un jeton par instance (HYPOTHÈSE : accepté par Apple) | — |
| Jeton OAuth Google | `google-pass.js:100-101` | nouveau jeton | un jeton par instance | — |
| Cache des strips (120 entrées) et purge | `strip-cache.js:16`, `:27`, `:79` | vide : relu depuis Storage | une même image générée deux fois, sans conséquence | — |
| Polices écrites dans `/tmp` au démarrage | `strip-generator.js:67-93` | réécrites | par instance | — |

### F6 — Les appels extérieurs et leur délai maximal

**PROUVÉ (code et bibliothèques).**

| Appel | Délai maximal | Attendu par | Effet d'un blocage |
|---|---|---|---|
| Supabase (148 appels) | **aucun côté client** ; 8 s côté base (HYPOTHÈSE, 00a) ; lectures relancées jusqu'à 3 fois | tout : scan, landing, dashboard, admin, cartes Apple | lecture en échec au scan : jusqu'à 7 s d'attente de plus avant l'erreur |
| OAuth Google (`google-pass.js:120`) | **aucun** | inscription, campagne, cron, scan (après la réponse) | inscription, campagne ou cron suspendus |
| API Google Wallet (`google-pass.js:138`) | **aucun** | idem ; **2 à 4 appels l'un après l'autre dans chaque inscription** (`clients.js:79-86` → `google-pass.js:367-392`) | **un client iPhone attend Google pour recevoir sa carte** : le lien Google est fabriqué pour tous (C3 : 1 691 cartes sur 1 691 l'ont) |
| APNs (`apns.js:150`) | 10 s, puis 1 relance | cron (un par un), campagne (dans la requête), scan (après la réponse) | au plus 20 s par jeton dans le cron |
| Images des marchands (`apple-pass.js:111`) | 5 s d'inactivité | chaque génération de carte Apple | carte sans logo (repli uni) |
| Résolution DNS (`apple-pass.js:101`) | aucun | idem | — |
| `openssl` (`apple-pass.js:290`) | **aucun** | chaque génération de carte Apple | la demande d'Apple reste pendante |
| Décodeur `jsQR` (CDN) | navigateur | premier chargement du scanner | pas de lecture de QR |

### F7 — Les boucles dont le coût grossit

**PROUVÉ (code) ; coûts mesurés quand indiqué.**

| Boucle | Où | Grossit avec | Coût |
|---|---|---|---|
| Cron : marchands × clients notifiés × jetons, **un par un** | `cron.js:47`→`:62`, `:108`→`:130`, `:188`→`:212`, `:245` | le stock de clients notifiés chaque jour | **1,2 s par carte, mesuré** (C6) |
| Campagne manuelle : **tous les envois en parallèle, sans borne, dans la requête HTTP** | `notifications.js:108-122` | porteurs du marchand (au plus 1 000 à cause de F1) | la requête dure autant que l'envoi le plus lent (aucun délai côté Google) |
| Diagnostic Google (admin) : un appel par marchand, en parallèle | `admin.js:655` | marchands | 48 appels simultanés |
| Synchronisation de toutes les classes Google (admin), un par un | `admin.js:699` | marchands actifs | — |
| Envoi par jeton d'une carte | `scan.js:250`, `clients.js:283`, `services/avis.js:146`, `cron.js:245` | jetons par carte (1 à 3) | faible |
| Registre, par tranches de 500 lignes | `notif-registre.js:88` | envois d'un lot | faible |
| Purge des anciennes images | `strip-cache.js:93-116` | versions × pages | une fois par changement de design |

### F8 — Les écritures en plusieurs temps, sans transaction

**PROUVÉ (code).**

| Séquence | Où | Ce qui peut rester à mi-chemin | G |
|---|---|---|---|
| **Scan** : incrément (validé) → [message de la carte ∥ ligne de scan], non vérifiés → poussées → parrainage → avis | `scan.js:121-235` | **solde crédité sans ligne de scan** (C7 : aucune occurrence depuis le 25/09) | 1 |
| **Parrainage** : ticket → crédit → message → poussées | `scan.js:310-348` | ticket sans crédit : crédit perdu, jamais doublé (assumé) | 1 |
| **Crédit de parrainage lui-même** : `LEAST(solde + bonus, seuil)` | `migration_015:33`, seule définition, jamais revue après le report du surplus de juillet (`022`/`023`) | en mode points, **perte du surplus** (530 → 500, démontré). En tampons à 10/10, bonus absorbé, alors que la notification l'annonce (`scan.js:333`) | 1 |
| **Inscription** : client → carte (non vérifiée) → consentements (non vérifiés) → liaison parrain (sans attente) → Google (2 à 4 appels) → lien Google (non vérifié) | `clients.js:23-95` | client sans carte installable (C3 : 0) ; lien Google absent (C3 : 0) | 6 |
| **Campagne** : texte du marchand + texte de toutes ses cartes (non vérifiés) → envois → registre → ligne de quota (sans attente) | `notifications.js:96-159` | poussées envoyées sans texte à afficher ; quota non décompté | 5 |
| **Cron** : texte de la carte → poussées → ligne de déduplication | `cron.js:62-69`, `:234-259` | déduplication absente : relance le lendemain (erreur désormais journalisée) | 5 |
| Ajustement : valeur absolue → resynchronisation (sans attente) | `clients.js:219-233` | carte non rafraîchie ; scan concurrent écrasé | 6 / 1 |
| Admin : lecture de version → mise à jour → classe Google (sans attente) | `admin.js:331-356`, `:774-795` | classe périmée (dette #4) | 6 |
| Admin, image fixe du strip : envoi → mise à jour, **sans changement de version ni de classe Google** | `admin.js:845-863` | classe Google non resynchronisée (segment 4) | 6 |

**Démonstration de `credit_referral`** (base rejouée, fonction du dépôt, identique à la
production selon 00a §4) : un parrain à 530 dans un programme au seuil de 500 reçoit
un bonus de 1 et retombe à 500 ; un parrain à 10/10 en tampons reste à 10. Exposition
(C7) : **2 marchands en points ont le parrainage actif, 1 crédit y a été versé**. Si le
parrain était alors au-dessus du seuil, il a perdu son surplus : **NON VÉRIFIABLE**
aujourd'hui, car le crédit ne journalise pas son avant/après. L'écart de ce parrain
entre son solde et son journal le trancherait (requête de suivi proposée au segment
2, §11).

### F9 — Les identités écrites en dur

**PROUVÉ (code).** Chaque occurrence rend plus coûteuse une seconde identité, par
exemple la structure UAE avec ses propres comptes, ou un changement de domaine. C'est
une **porte fermée** au sens du brief (§3).

| Endroit | Valeur en dur | Remarque |
|---|---|---|
| `index.js:33` | `https://app.winwin-card.com` | seule origine CORS admise en production |
| `clients.js:74`, `merchants.js:107`, `apple-pass.js:325`, `:396`, `services/avis.js:35` | idem | repli si `API_BASE_URL` manque |
| `google-pass.js:259` | idem | **pas de variable du tout** : le lien de parrainage Google ignore `API_BASE_URL`, contrairement à Apple |
| `apns.js:91`, `apple-pass.js:322` | `pass.com.winwincard.loyalty` | repli du Pass Type ID |
| `apple-pass.js:324` | `LTW34ARCX2` | repli du Team ID |
| `google-pass.js:164` | `countryCode: 'AE'` | tous les marchands déclarés aux Émirats, France comprise |
| `google-pass.js:65` | logo sur `raw.githubusercontent.com`, branche de la vitrine | dépend du dépôt public (§4.7) |
| `strip-cache.js:10` ; `admin.js:744-872` | bucket Storage `passes` | un seul bucket |

### F10 — Les routes et leurs appelants

**68 routes** (66 routes de routeur, plus `/demo` et `/health`). **PROUVÉ (code des
fronts ; recherche dans tout le dépôt).**

| Appelant | Routes |
|---|---|
| Admin (`admin/index.html`, `preview.html`, `diag-resultats.html`) | 20 |
| Dashboard | 17 (dont `POST /api/scan` et `GET /api/scan`, partagés avec le scanner) |
| Scanner, en propre | 2 (`/api/scanner/login`, `/api/scan/:id/annuler`) |
| Landing | 3 (`/api/merchants/:slug/public`, `POST /api/clients`, `/api/passes/:serial/apple`) |
| iPhone (service web Apple) | 5 (`/v1/…`) |
| Liens imprimés ou envoyés | 2 (`/l/:slug`, `/avis/:serial`) + `/demo` |
| Railway | 1 (`/health`) |
| Pages et icônes des PWA | 6 |
| Page de diagnostic | 1 |
| **Console, par procédure documentée** | 3 (`/api/admin/google-wallet/class/:id`, `/classes/sync`, `/api/admin/workflows/trigger`) |
| **Aucun appelant dans le dépôt** | **7** (§6) |

Dans l'autre sens, tous les appels des fronts visent une route qui existe. Côté
serveur, une capacité n'est demandée par aucune interface : l'envoi d'une
notification visible (`apns.js:199-209`, jamais appelé).

---

## 6. Les liens morts

Ponytail (brief §10) sera appliqué aux segments 1 à 6, sur le code de leurs
fonctions. Pour le segment 0, dont le périmètre est les liens, il est remplacé par cet
inventaire des **liens morts** : ce qui est déclaré, posé ou branché, mais ne sert à
rien. Comme la sortie de Ponytail, c'est une **liste de candidats**, pas un feu vert :
toute suppression serait un chantier testé, décidé par Yass.

| Élément | Preuve | Statut |
|---|---|---|
| Table `workflows` | 0 ligne (C2) ; aucune lecture ni écriture dans le code ni dans les fonctions SQL ; créée par `schema.sql:124`. C'est l'une des 7 tables sans droits `service_role` dans le dépôt (00a §5.1). | PROUVÉ |
| `GET /api/google-wallet/pass/:serialNumber` | aucun appelant ; route **publique** qui crée classe et objet Google à la demande (`google-wallet.js:7-33`) → segment 3 | PROUVÉ |
| `GET /api/clients/admin/all` | aucun appelant ; déjà tronquée (L9) | PROUVÉ |
| `GET` et `PATCH /api/admin/workflows/:marchandId` | aucun appelant : l'admin règle les workflows par `PATCH /api/admin/marchands/:id` | PROUVÉ |
| `/api/admin/debug/pass/:serial`, `/api/admin/debug/certs`, `/api/admin/google-wallet/diagnostic` | aucun appelant, aucune procédure écrite. Outils manuels ; `debug/certs` sert au segment 6 | PROUVÉ |
| `/demo` → `/l/demo` | aucun marchand `demo` (C3 : 0) | PROUVÉ |
| `sendPushNotification` | `apns.js:199-209`, jamais appelée. Une poussée avec texte ne s'applique pas aux cartes Wallet (HYPOTHÈSE) | PROUVÉ (inutilisée) |
| Exports `viderTout`, `enAttenteCount` | `marchand-cache.js`, `services/avis.js` : jamais importés ailleurs | PROUVÉ |
| Sentry | dépendance `@sentry/node`, `instrument.js`, `index.js:132-134`, mais `SENTRY_DSN` n'est pas posée (relevé) | PROUVÉ |
| `LANDING_BASE_URL` | posée dans Railway, jamais lue | PROUVÉ |
| Copie de la vitrine à la racine de la branche de production | `index.html`, `CNAME`, `assets/`, images : GitHub Pages sert la branche par défaut (relevé) | PROUVÉ |
| Création du bucket avant chaque envoi | `strip-cache.js:136` (trois fois par image générée), `admin.js:744`, `:849` : bucket existant, réponse ignorée | PROUVÉ |
| Téléchargement complet d'une image pour tester son existence | `strip-cache.js:214`, à chaque mise à jour Google en mode tampons sans image fixe | PROUVÉ |
| Logo téléchargé deux fois par carte Apple | `apple-pass.js:449-450` | PROUVÉ |

---

## 7. Ce qui n'entre dans aucun segment

| Élément | Lien avec la plateforme | Statut |
|---|---|---|
| **Vitrine** `winwin-card.com` (GitHub Pages, branche par défaut `claude/winwin-card-landing-ohS22` : pages, CGV, démo du dashboard réseau) | même domaine que l'API ; source du logo de secours Google (`google-pass.js:65`) | PROUVÉ (relevé, API GitHub) |
| Copie de la vitrine à la racine de la branche de production | aucun (non servie) | PROUVÉ |
| `scripts/load-test.js` | son mode d'emploi vise la production (`BASE_URL=https://app.winwin-card.com`, un vrai marchand, un vrai jeton). Lancé ainsi, il crée **20 vrais clients et 20 vrais scans crédités** (en-tête du fichier, lignes 4-6 et 14-18) | PROUVÉ (code) |
| `scripts/test-pass.js`, `test-google-pass.js`, `test-strip-generator.js` | tests manuels ; lisent des certificats locaux et `JWT_SECRET` | PROUVÉ |
| `database/seed.sql` | marchands de démonstration à identifiants fixes, à ne jamais jouer en production | PROUVÉ |
| `database/requetes/avis_et_ouverture_pro.sql` | requêtes de recette | PROUVÉ |
| Outil de diagnostic caméra : `public/diag/` (dont du code tiers : jsQR, lecteur zxing en WebAssembly), `routes/diag.js`, `diagnostics_camera`, `admin/diag-resultats.html` | « instrument temporaire (palier 0.5) » (`diag.js:8-15`) ; le plus proche du segment 2 | PROUVÉ |
| Les 3 service workers | aucun segment ne les nomme : le scanner relève du segment 2, le dashboard et l'admin du segment 6 (déploiement) | — |
| Textes des notifications (`src/i18n/messages.js`) | segment 1 | — |
| Autres branches | `claude/epic-dijkstra-4pnlu9` (PR #1 ouverte) et `claude/winwin-card-setup-3-eifixu` : ancêtres de la production, sans rien de propre | PROUVÉ (git) |
| Branche `claude/food-packaging-b2b-site-ioa77w` | autre projet de Yass, sans lien avec WinWin : non instruit | — |

**Affectation des fichiers du dépôt aux segments** (128 fichiers suivis) :

| Segment | Fichiers |
|---|---|
| 1 — notifications | `workers/cron.js`, `services/apns.js`, `services/notif-registre.js`, `services/avis.js`, `routes/notifications.js`, `routes/workflows.js`, `routes/avis.js`, `i18n/messages.js` |
| 2 — scan et crédit | `routes/scan.js`, `routes/scanner-auth.js`, `utils/backup-code.js`, `public/scanner/*`, onglet scanner du dashboard, fonctions `increment_stored_value`, `annuler_scan`, `credit_referral` |
| 3 — accès et données | `middleware/auth.js`, `middleware/rateLimiters.js`, `services/auth-utils.js`, `services/marchand-cache.js`, `routes/clients.js` (export, effacement), `rgpd_effacement.sql`, `routes/admin.js` (connexion, droits) |
| 4 — cartes | `services/apple-pass.js`, `services/google-pass.js`, `services/strip-generator.js`, `services/strip-cache.js`, `services/illustrations/*`, `routes/apple-wallet.js`, `routes/passes.js`, `routes/google-wallet.js`, `public/landing.html`, `routes/landing.js`, `public/admin/preview.html` |
| 5 — statistiques | `routes/merchants.js` (stats), fonctions `group_stats`, `admin_marchands_stats`, `public/dashboard/index.html` (écrans de stats) |
| 6 — infrastructure | `index.js`, `instrument.js`, `services/supabase.js`, `utils/asyncHandler.js`, `routes/dashboard.js`, `routes/scanner.js`, `routes/admin-ui.js` (service des pages), `railway.toml`, `package.json`, `package-lock.json`, `.nvmrc`, `.env.example`, `.gitignore`, `database/schema.sql`, 46 migrations, les 3 `sw.js` et `manifest.json` |
| Partagés entre segments | `routes/admin.js` (3 : connexion ; 4 : configuration des cartes et images ; 6 : outils de diagnostic) ; `public/admin/index.html` (3, 4) ; `public/dashboard/index.html` (1 : campagne ; 2 : onglet scanner ; 5 : statistiques) ; `routes/clients.js` (2 : ajustement du solde ; 3 : export, effacement ; 4 : inscription) |
| Aucun (§7) | vitrine à la racine (`index.html`, `CNAME`, `assets/`, 5 images), `scripts/*`, `seed.sql`, `requetes/*.sql`, outil de diagnostic |
| Documentation | `CLAUDE.md`, `PASSATION_TECHNIQUE.md`, `docs/audit/*` |

---

## 8. Les faits hérités de 00a, reliés

| Fait de 00a | Ce qu'il touche dans la carte |
|---|---|
| **Une seule instance Railway** (00a §7.1) | les 8 états en mémoire de F5. Ce qui se duplique à deux : le cron (doublons pour chaque client notifié). Ce qui retarde : la suspension et la révocation (60 s). Ce qui double : les limites de débit. Rien dans le dépôt ne fixe le nombre d'instances. |
| **Serveur en Californie, base à Paris, environ 213 ms par requête** (00a §7.2) | chaque requête faite l'une après l'autre coûte environ 213 ms. Cron : 3 requêtes par carte, soit environ 0,64 s des 1,2 s mesurées (C6). Inscription : 3 requêtes plus 2 à 4 appels Google (`clients.js:23-86`). Téléchargement d'une carte Apple : 3 requêtes (`apple-wallet.js:113-145`) plus les images, prises dans le Storage de Paris. |
| **Cron dans le process de l'API à 08:00 UTC** (00a §6.3, §7.4) | durée mesurée : 80 s (C6). Heure calme aujourd'hui (C5) : le croisement avec le rush de midi à Dubaï n'est pas observé. Un redémarrage pendant le passage l'interrompt (F4, F5). |
| **Node 24, sans borne haute** (00a §7.5) | la signature Apple ne dépend plus de Node depuis `75e1a39` : elle dépend du `openssl` de l'image (§4.7). Restent sensibles à Node : `fetch` (Google, Supabase), `sharp` 0.33.5 et `@resvg/resvg-js` 2.6.2 (modules compilés ; HYPOTHÈSE : interface binaire stable entre versions majeures). |
| **Droits `service_role` absents du dépôt sur 7 tables** (00a §5.1) | au rejeu, toutes les routes authentifiées tombent, puisque le cache marchand relit `marchands` à chaque requête (`marchand-cache.js:53`), ainsi que la landing, le scan et les cartes. L'une des 7 est la table morte `workflows`. Supabase ne donne plus ces droits d'office aux nouvelles tables : option proposée à la création des projets depuis le 28/04/2026, défaut pour tout nouveau projet depuis le 30/05/2026, étendue aux projets existants le 30/10/2026 (discussion GitHub Supabase #45329). Un nouveau projet (structure UAE, restauration) rejoué depuis le dépôt reproduirait donc le cas décrit par 00a (**HYPOTHÈSE forte, renforcée**). |

---

## 9. Seuils de rupture des liens partagés

Chaque seuil est exprimé dans l'unité qui le provoque (brief §3).

| Lien | Unité | Seuil | Aujourd'hui | Ce qui souffre en premier | Statut |
|---|---|---|---|---|---|
| Lectures liées à l'activité (L1, L8) | scans par marchand sur 30 j | 1 000, soit **≈ 33 scans par jour** | 322 (Pizz'Amore, ≈ 10,7 par jour) | relances de clients actifs ; statistiques du dashboard | PROUVÉ (C1) |
| Lectures liées au stock (L2, L10, L11) | porteurs par marchand | 1 000 | 267 (Dinapoli) | campagne manuelle (1 000 destinataires au plus) ; liste, export, relances | PROUVÉ (C1) |
| Idem, à la cible | porteurs par point de vente | ≈ 1 000 en moyenne (100 000 / 100) | — | un marchand à plusieurs boutiques dépasse le seuil dès l'arrivée | HYPOTHÈSE |
| Déduplication (L3) | relances par marchand sur 7 j | 1 000 | 150 | relance quotidienne au lieu de tous les 8 jours | PROUVÉ (C1) |
| Durée du cron | cartes notifiées par jour | 1,2 s par carte : 3 000 → 1 h ; 6 000 → 2 h (fin vers 10 h UTC, pointe de midi en France) ; 10 000 → 3 h 20 | 66 cartes, 80 s | le scan du matin, le passage suivant | PROUVÉ (mesure) / HYPOTHÈSE (projection) |
| Campagne manuelle | cartes du marchand | aucun délai ; tous les envois en parallèle | 256 à 267 | la requête du dashboard, le quota Google, le verrou des cartes | HYPOTHÈSE |
| Limiteur global | requêtes par adresse IP | 300 par 15 min, soit 20 par minute | — | une boutique à plusieurs tablettes ; une **borne** (trafic machine) serait refusée puis relancerait | PROUVÉ (réglage) / HYPOTHÈSE (usage) |
| Limiteur d'inscription | inscriptions par IP et par heure | 20 | — | un événement en boutique sur le Wi-Fi du commerce | HYPOTHÈSE |
| Changement de `JWT_SECRET` | appareils Apple | tous : 1 287 (C4) | — | toutes les cartes Apple et toutes les sessions | PROUVÉ |
| Cartes par appareil | cartes WinWin sur un même iPhone | aucun | 31 au plus | chaque poussée fait revérifier toutes les cartes de l'appareil | PROUVÉ (C4) |
| Connexions simultanées | connexions caisse | environ 35 ms de boucle bloquée par connexion : 100 reconnexions ≈ 3,5 s | — | les scans en cours pendant une vague de reconnexions | HYPOTHÈSE (mesure faite dans le conteneur) |
| Registre des envois | lignes par jour | rétention de 90 j | ≈ 540 par jour (656 en 29 h) | — : environ 49 000 lignes au rythme actuel | PROUVÉ (C2) |
| Déduplication des workflows | lignes sur 90 j | — | **2 874, plus que les 2 178 scans** | la relance écrit plus de lignes que les passages en caisse | PROUVÉ (C2) |

---

## 10. Corrections et compléments aux rapports antérieurs

Ces rapports ne sont pas modifiés ; la correction est consignée ici.

| Rapport | Ce qu'il disait | Ce qui est établi | Statut |
|---|---|---|---|
| 01 §4 ; passation §15 quater | les `.catch()` sur `supabase.storage` sont légitimes, Storage rejette | à la version 2.107.0, Storage ne rejette pas non plus (§5 F2). Aucune conséquence aux endroits concernés, où l'erreur est ignorée volontairement. La règle de la passation §3.9 s'étend à Storage. | PROUVÉ |
| A §5.1 | `passes.google_pass_url` dit si un objet Google existe ; la campagne manuelle applique déjà le bon filtre | **1 691 cartes sur 1 691 ont un `google_pass_url`** (C3). L'objet Google est créé à l'inscription pour chaque client, iPhone compris (`clients.js:79-83`, `google-pass.js:384-392`). Le filtre de `notifications.js:84-88` ne filtre donc rien, et `google_pass_url` ne dit pas si la carte est installée sur un Android. Seuls les rappels (callbacks) de Google le diraient. | PROUVÉ |
| A §3 | durée du cron non mesurée | 80 s pour 66 cartes le 26/09, soit environ 1,2 s par carte (C6) | PROUVÉ |
| A §4 | le plus gros marchand compte environ 200 clients | 267 (Dinapoli, C1) | PROUVÉ |
| 00a §7.4 | croisement du cron et du rush de midi à Dubaï, signalé sans conclusion | non observé aujourd'hui : 0,8 scan par jour entre 8 h et 9 h UTC chez les marchands anglophones, pointe à 16 h-17 h UTC (C5 ; la langue sert d'indicateur de marché, HYPOTHÈSE) | PROUVÉ (données) |
| 00a §6.5 | plafond de lignes non relevé | Max rows = 1000 (relevé) | PROUVÉ |
| 00a §5.3 | `anon` peut exécuter les 8 fonctions, dont `effacer_client` ; exposition dépendant de la clé `anon` | **Complété.** Le tableau de bord affiche « 0 fonction exposée sur 8 », mais : (1) le droit d'exécution de `anon` vient du droit par défaut accordé à `PUBLIC` (00a P5), que le réglage d'exposition de Supabase ne retire pas (discussion GitHub Supabase #45329) ; (2) le schéma `public` est bien servi par l'API, puisque le serveur y appelle ses fonctions à chaque scan ; (3) la clé publishable donne le même rôle que la clé `anon` historique (documentation Supabase, par extrait). **`effacer_client` est donc appelable par l'API avec l'une ou l'autre clé**, aux deux autres conditions de 00a §5.3 (identifiant du marchand, identifiant du client). Le compteur du tableau de bord ne voit pas le droit hérité de `PUBLIC`. Il ne compte pas non plus le droit nominatif d'`authenticated` sur `notification_logs` (00a §5.2) : sa définition exacte n'est pas documentée. Aucune clé Supabase n'apparaît dans le dépôt ni dans son historique. → segment 3. | PROUVÉ (droit, service de l'API) / HYPOTHÈSE (définition du compteur, rôle de la clé publishable) |

---

## 11. Ce que la carte transmet à chaque segment

| Segment | À instruire |
|---|---|
| **Synthèse, gravité 1** | les deux constats d'argent (§1, constats 1 et 2) en tête de roadmap ; le constat 2 est neutralisé tant que le parrainage reste coupé, et le sort de la fonction est décidé par Yass après l'audit (§13). **La base jetable du filet de tests** (brief §8) devra recevoir les droits des 7 tables (00a §5.1), et se rejouer sur un projet dont les droits par défaut sont connus (§8). |
| 1 — notifications | L1 à L7, L10, L11 ; cron qui retire ses filtres au lieu de s'arrêter en cas de panne (F3) ; durée mesurée (C6) ; campagne en parallèle sans borne ni délai, avec réécriture en masse des cartes (F7, §4.3) ; `google_pass_url` n'est pas un signal (§10) ; doublement du cron à deux instances (F5) ; avis actif chez Hamza Salon (C3) ; poussée qui fait revérifier toutes les cartes d'un appareil (C4) |
| 2 — scan et crédit | `scan.js:169-183` et `credit_referral` (gravité 1) ; **requête de suivi** : pour chaque parrain crédité, comparer l'écart entre son solde et son journal au bonus versé (un écart inférieur au bonus signe l'effet du plafond) ; lister les ruptures de chaîne du journal (C7 : 45, la dernière le 26/09) ; pannes lues comme « carte introuvable » ou « boutique coupée » (F3, G3) ; relances automatiques des lectures (jusqu'à 7 s) ; l'incrément n'est jamais relancé, mais une réponse perdue suivie d'un nouvel essai de la caissière double le crédit (dette #9) ; ajustement en valeur absolue sans verrou (§4.3) ; `scryptSync` à chaque connexion (§4.4) ; décodeur QR sur CDN (§4.6) ; limiteur par adresse IP (§4.6) |
| 3 — accès et données | `JWT_SECRET` à quatre usages (§4.1) ; `ADMIN_PASSWORD` comparé de façon non constante (`admin.js:14`) ; **empreinte du mot de passe renvoyée au navigateur de l'admin** (`admin.js:69-75`, `:198-223`, `:348-356`, `select('*')`) ; clé de signature écrite dans le répertoire temporaire, phrase de passe en argument de commande (§4.1) ; dépôt public (§4.7) ; portée complétée de `effacer_client` et clés historiques actives (§10, §4.1) ; routes publiques par numéro de série (`/api/passes/:serial/apple`, `/api/google-wallet/pass/:serial`) ; durcissement réseau qui laisse passer en cas de panne (F3, G4) ; `trust proxy` et limiteurs (§4.6) |
| 4 — cartes | identités partagées (§4.2) ; **l'inscription attend Google, y compris pour un client iPhone** (F6) ; carte iPhone non rafraîchie quand l'écriture de `updated_at` échoue après un scan ou un crédit de parrainage (`scan.js:170`, `:336`, F3) ; objets Google créés pour tous (§10) ; logo de secours sur GitHub ; `countryCode: 'AE'` ; lien de parrainage Google en dur (F9) ; images téléchargées à chaque génération (§4.6, §6) ; test d'existence par téléchargement complet (`strip-cache.js:214`) ; image fixe du strip sans resynchronisation de la classe (F8) ; plafond de messages par objet Google non vérifié (`addMessage` empile) ; poussée qui fait revérifier toutes les cartes (C4) |
| 5 — statistiques | L8, liste et export (L2) ; comptages exacts et délai de 8 s ; « aujourd'hui » calculé en date UTC (`merchants.js:62`) et mois du quota à l'heure du serveur (`notifications.js:12-15`) : décalés pour Dubaï (UTC+4) |
| 6 — infrastructure | chaîne de déploiement (§4.7) : service worker de l'admin, `openssl` de l'image, Node ; **échéance des clés historiques Supabase** ; route des dates de certificats (`admin.js:552-635`) ; 7 tables et droits par défaut des nouveaux projets (§8) ; Sentry inactif ; variables d'environnement (§4.1) ; dépôt public et GitHub Pages ; `trust proxy` et proxy de Railway |

---

## 12. Hypothèses et angles morts

| Point | Statut | Comment trancher |
|---|---|---|
| Occurrences du constat 1 (solde sans ligne de scan) avant le 25/09 | **NON VÉRIFIABLE** : avant le registre, un ajustement manuel ne laisse aucune trace. Les 97 écarts ne se distinguent pas d'une ligne manquante. | aucune trace n'existe ; depuis le 25/09, C7 (a) le tranche |
| Perte réelle due au plafond de `credit_referral` | NON VÉRIFIABLE aujourd'hui | requête de suivi (§11, segment 2) |
| Coupure effective du parrainage (annoncée par Yass le 27/09) | HYPOTHÈSE tant que C8 n'est pas exécutée | C8 : `marchands_parrainage_actif` = 0 |
| Cause de l'installation du service worker admin le 26/09 à 22:20 | HYPOTHÈSE | état du service worker dans les outils du navigateur |
| `trust proxy = 1` donne-t-il la vraie adresse du client ? | HYPOTHÈSE | nombre de sauts du proxy Railway (documentation, ou adresse en tête d'une ligne de journal) |
| Format de `SUPABASE_SERVICE_KEY` en production | HYPOTHÈSE (clé historique) | Yass regarde seul le début de la valeur |
| Date de retrait des clés historiques Supabase | HYPOTHÈSE forte (documentation par extrait) | page « API keys » de Supabase |
| Définition du compteur « fonctions exposées » ; rôle de la clé publishable | HYPOTHÈSE | documentation Supabase |
| Cause du client sans consentement (C3 : 1) | HYPOTHÈSE | date de création de ce client (hors périmètre, RGPD) |
| Durée du rendu synchrone des images | non mesurée | mesure au segment 4 ou 6 |
| `scryptSync` en production | HYPOTHÈSE (35 ms dans le conteneur) | mesure sur Railway |
| Délais par défaut de `fetch` dans Node 24 | HYPOTHÈSE | code de Node 24 |
| Quotas de l'API Google Wallet | NON VÉRIFIABLE ici | console Google Cloud |
| Plafond de messages par objet Google | non vérifié | documentation Google (segment 4) |
| GitHub Pages sur un dépôt privé | HYPOTHÈSE (selon l'offre) | offre GitHub du compte |
| Version d'`openssl` dans l'image Nixpacks | non relevée | journaux de construction Railway (segment 6) |
| Effet d'un certificat Apple expiré sur les cartes installées | non instruit | segment 6 |
| Langue « en » = marché de Dubaï | HYPOTHÈSE | aucune colonne pays en base |
| Les 8 variables ajoutées par Railway | non listées | sans objet : le code ne les lit pas |

## 13. Décisions de pilotage et décisions hors pilotage

Sur instruction de Yass (27/09), ce segment ne modifie pas `PASSATION_TECHNIQUE.md` :
ce qui est livré, les décisions et la dette découverte sont consignés dans ce rapport.
**Livré** : ce rapport et `docs/audit/00b-requetes.sql` (C1 à C8). Aucun code modifié.
**Dette découverte** : §1, §5 et annexes A et B.

**Décisions de pilotage**

| Date | Décision | Où elle joue |
|---|---|---|
| 26/09 | Plan validé : inventaires F1 à F10, détail de F3 en annexe, requêtes dans un fichier séparé | structure du rapport |
| 26/09 | Ponytail remplacé, pour le segment 0, par l'inventaire des liens morts ; il sera appliqué dans les segments suivants | §6 |
| 26/09 | La branche `claude/food-packaging-b2b-site-ioa77w` est un autre projet, hors périmètre ; la vitrine et la branche par défaut sont documentées comme liens seulement | §7 |
| 26/09 | Les redémarrages causés par l'audit sont acceptés : demandes d'avis en attente perdues, cron coupé hors de la fenêtre de 08:00 UTC | le push de ce rapport redéploie la production (§4.7) |
| 26/09 | Gravité 1 de `scan.js:169-183` : pas de correction pendant l'audit, en tête de la roadmap ; C7 cherche les traces passées | §1 constat 1, C7 |
| 26/09 | Dépôt public : le rapport est poussé ; la visibilité du dépôt et les droits d'exécution des fonctions seront traités après l'audit ; 00b décrit des constats et leurs preuves, jamais un mode opératoire | introduction, §4.7, §10 |
| 27/09 | **Parrainage coupé manuellement par Yass.** Fonction secondaire, de celles que le brief permet de questionner (§5) ; son sort sera décidé après l'audit | ci-dessous |

**Ce que la coupure arrête, et ce qu'elle n'arrête pas** — PROUVÉ (code). Le drapeau
`marchands.referral_enabled` est le seul interrupteur du parrainage dans le code
(case de l'admin, `admin.js:252`, ou écriture en base) :
- **elle arrête tout nouveau crédit de parrain**, dès le scan suivant : le drapeau est
  relu à chaque scan, sans cache (`scan.js:60`, `:196`). Le constat 2 (`credit_referral`)
  et les chemins de gravité 1 du crédit (F3 : `scan.js:284`, `:294` ; F2 : `scan.js:198`)
  ne peuvent plus rien fausser tant qu'elle tient ;
- elle masque l'invitation à parrainer sur la landing après l'inscription
  (`landing.html:1030`) et retire le texte de parrainage des cartes Apple à leur
  prochaine génération (`apple-pass.js:393`) ;
- **elle n'arrête pas la liaison à l'inscription** : la landing transmet toujours le
  paramètre `ref` d'un ancien lien (`landing.html:755`, `:908`), et le serveur lie le
  filleul sans consulter le drapeau (`clients.js:69-72`). Ces liaisons ne rapportent
  rien tant que la coupure tient. **Si le parrainage était rallumé**, chaque filleul
  lié et jamais crédité créditerait son parrain une fois, au premier scan où son solde
  part de 0 (`scan.js:196`) ;
- **elle ne retire pas le texte de parrainage des cartes Google déjà créées** : il est
  posé à la création de l'objet (`google-pass.js:256`), un objet existant n'est jamais
  recréé (`google-pass.js:384-392`), et la mise à jour n'envoie jamais ce texte
  (`updateLoyaltyObjectPoints`, `google-pass.js:412-487`). Ces cartes continuent
  d'afficher le lien de parrainage.

**Vérification** : C8. Attendu : `marchands_parrainage_actif` = 0. Le second chiffre,
`filleuls_lies_sans_credit`, n'a pas de valeur attendue : il mesure ce que rallumer le
parrainage déclencherait, pour la décision d'après l'audit. **Statut de la coupure :
annoncée par Yass, non vérifiée tant que C8 n'est pas exécutée.**

**Décisions hors pilotage** (prises par la session d'audit, sans passer par pilotage) :
- la documentation Supabase est citée par extraits de moteur de recherche et par la
  discussion GitHub #45329, la page étant bloquée par le proxy du conteneur ; elle est
  marquée HYPOTHÈSE forte là où elle porte un constat (§4.1, §10, §12) ;
- le script d'extraction syntaxique n'est pas versé au dépôt : la reproductibilité
  repose sur les commandes de l'annexe C, qui redonnent les mêmes comptes ;
- les requêtes ont été testées, et `credit_referral` démontré, sur une base rejouée
  dans le conteneur (PostgreSQL 16). Rien n'a été exécuté contre la production.

---

## Annexe A — F3 : les 74 appels qui ne lisent pas leur erreur

« Si la base répond une erreur » : ce que fait alors le code. Chemins relatifs à
`winwincard/backend/src/`.

| # | Endroit | Appel | Si la base répond une erreur | G |
|---|---|---|---|---|
| 1 | `routes/admin.js:101` | marchand (création de boutique) | 404 « marchand introuvable » | 8 |
| 2 | `routes/admin.js:192` | slug existant ? | continue ; la contrainte d'unicité du slug refuse un doublon à l'insertion (erreur lue en `:218`) | 8 |
| 3 | `routes/admin.js:334` | version des images | version remise à 2 | 8 |
| 4 | `routes/admin.js:498` | comptage des marchands | compteur vide | 7 |
| 5 | `routes/admin.js:499` | comptage des clients | compteur vide | 7 |
| 6 | `routes/admin.js:500` | comptage des scans | compteur vide | 7 |
| 7 | `routes/admin.js:652` | marchands (diagnostic Google) | liste vide | 8 |
| 8 | `routes/admin.js:680` | marchand (resynchronisation d'une classe) | 404 | 8 |
| 9 | `routes/admin.js:696` | marchands (resynchronisation de toutes les classes) | « 0 synchronisé » | 8 |
| 10 | `routes/admin.js:744` | création du bucket | ignoré volontairement | — |
| 11 | `routes/admin.js:775` | version des images (paliers) | version remise à 2 | 8 |
| 12 | `routes/admin.js:849` | création du bucket | ignoré volontairement | — |
| 13 | `routes/admin.js:872` | suppression d'un fichier | fichier orphelin | — |
| 14 | `routes/apple-wallet.js:34` | carte, à l'enregistrement d'un appareil | 404 à Apple : appareil non enregistré | 6 |
| 15 | `routes/apple-wallet.js:84` | cartes de l'appareil | « rien de neuf » : pas de mise à jour cette fois | 6 |
| 16 | `routes/apple-wallet.js:135` | client, au téléchargement par Apple | 404 à Apple | 6 |
| 17 | `routes/apple-wallet.js:141` | marchand, idem | 404 à Apple | 6 |
| 18 | `routes/apple-wallet.js:173` | marchand, bienvenue | pas de bienvenue | 5 |
| 19 | `routes/apple-wallet.js:184` | texte de bienvenue | bienvenue non affichée | 5 |
| 20 | `routes/clients.js:53` | création de la carte à l'inscription | client sans carte installable (C3 : 0) | 6 |
| 21 | `routes/clients.js:62` | consentements | preuve perdue (C3 : 1 cas, cause en HYPOTHÈSE) | hors échelle |
| 22 | `routes/clients.js:83` | lien Google | campagne sans Google pour cette carte (C3 : 0) | 5 |
| 23 | `routes/clients.js:113` | forfait (export) | 403 « réservé Pro+ », trompeur | 7 |
| 24 | `routes/clients.js:245` | marchand (resynchronisation) | abandon, journalisé « marchand introuvable » : carte non rafraîchie | 6 |
| 25 | `routes/clients.js:276` | jetons (resynchronisation) | pas de poussée | 6 |
| 26 | `routes/clients.js:311` | parrain (liaison) | filleul non lié : parrain jamais crédité | 1 |
| 27 | `routes/clients.js:321` | liaison filleul-parrain | idem ; le journal affiche « referral linked » malgré l'échec | 1 |
| 28 | `routes/google-wallet.js:10` | carte (route sans appelant) | 404 | 6 |
| 29 | `routes/google-wallet.js:19` | client (idem) | 404 | 6 |
| 30 | `routes/google-wallet.js:22` | marchand (idem) | 404 | 6 |
| 31 | `routes/google-wallet.js:33` | lien Google (idem) | lien non enregistré | 6 |
| 32 | `routes/merchants.js:18` | connexion dashboard | 401 « identifiants invalides » | 3 |
| 33 | `routes/merchants.js:61` | comptage des clients | statistique vide | 7 |
| 34 | `routes/merchants.js:62` | scans du jour | statistique vide | 7 |
| 35 | `routes/merchants.js:63` | scans de 30 jours | statistiques à zéro | 7 |
| 36 | `routes/merchants.js:98` | slug (QR code) | 404 | 8 |
| 37 | `routes/notifications.js:26` | forfait (affichage du quota) | forfait « pro » par défaut | 7 |
| 38 | `routes/notifications.js:27` | quota consommé (affichage) | 0 | 7 |
| 39 | `routes/notifications.js:57` | forfait (envoi) | « pro » par défaut : **un Basic peut envoyer** | 5 |
| 40 | `routes/notifications.js:65` | quota consommé (envoi) | **quota non vérifié** | 5 |
| 41 | `routes/notifications.js:84` | cartes Google | campagne sans Google | 5 |
| 42 | `routes/notifications.js:98` | texte du marchand | texte non enregistré | 5 |
| 43 | `routes/notifications.js:102` | texte de toutes les cartes | poussées envoyées, **iOS n'affiche rien** | 5 |
| 44 | `routes/passes.js:24` | client (premier téléchargement) | 404 : carte non installable à ce moment | 6 |
| 45 | `routes/passes.js:29` | marchand (idem) | 404 | 6 |
| 46 | `routes/scan.js:28` | boutique | **403 « accès coupé »** | 3 |
| 47 | `routes/scan.js:43` | réseau provisionné ? | **jeton marchand accepté sur un réseau** | 4 |
| 48 | `routes/scan.js:65` | client (QR) | **404 « carte introuvable »** | 3 |
| 49 | `routes/scan.js:73` | client (code de secours) | 404 | 3 |
| 50 | `routes/scan.js:170` | texte et `updated_at` de la carte après le crédit | `updated_at` non avancé : Apple reçoit 304 (`apple-wallet.js:131`), la carte iPhone garde l'ancien solde jusqu'à la mise à jour suivante ; Google non concerné | 6 |
| 51 | `routes/scan.js:174` | **ligne de scan après le crédit** | **solde crédité sans ligne** | 1 |
| 52 | `routes/scan.js:239` | jetons (poussée après scan) | carte non rafraîchie | 6 |
| 53 | `routes/scan.js:284` | parrain du filleul | crédit du parrain sauté ; le déclencheur (`avantScan === 0`) revient au cycle suivant en tampons, seulement après une remise à zéro manuelle en points | 1 |
| 54 | `routes/scan.js:294` | carte du parrain | idem | 1 |
| 55 | `routes/scan.js:336` | texte et `updated_at` de la carte du parrain | même effet que la ligne 50 : carte iPhone du parrain non rafraîchie (304), ni message ni nouveau solde | 6 |
| 56 | `routes/scan.js:386` | boutique du scan à annuler | 403 : annulation refusée | 3 |
| 57 | `routes/scan.js:405` | prénom (annulation) | message sans prénom | 8 |
| 58 | `routes/scanner-auth.js:30` | boutique (connexion caisse) | bascule sur la connexion marchand, puis 401 | 3 |
| 59 | `routes/scanner-auth.js:63` | marchand par slug | 401 | 3 |
| 60 | `routes/scanner-auth.js:69` | marchand par e-mail | 401 | 3 |
| 61 | `routes/scanner-auth.js:84` | réseau provisionné ? | **jeton marchand délivré sur un réseau** | 4 |
| 62 | `services/strip-cache.js:136` | création du bucket | ignoré volontairement | — |
| 63 | `workers/cron.js:32` | marchands (relance) | workflow sauté en silence | 5 |
| 64 | `workers/cron.js:52` | scans de la fenêtre | **tous les clients du marchand relancés** | 5 |
| 65 | `workers/cron.js:53` | clients | personne | 5 |
| 66 | `workers/cron.js:54` | déduplication | **relance de clients déjà relancés** | 5 |
| 67 | `workers/cron.js:93` | marchands (boost) | workflow sauté | 5 |
| 68 | `workers/cron.js:115` | clients proches du seuil | personne | 5 |
| 69 | `workers/cron.js:120` | déduplication du boost | boost répété | 5 |
| 70 | `workers/cron.js:165` | marchands (anniversaire) | workflow sauté | 5 |
| 71 | `workers/cron.js:190` | clients avec date | personne | 5 |
| 72 | `workers/cron.js:195` | déduplication annuelle | doublon possible le même jour | 5 |
| 73 | `workers/cron.js:237` | texte de la carte | poussée sans texte visible | 5 |
| 74 | `workers/cron.js:244` | jetons | pas de poussée Apple | 5 |

Répartition : G1 : 5 · G3 : 8 · G4 : 2 · G5 : 20 · G6 : 16 · G7 : 9 · G8 : 9 ·
sans conséquence : 4 · hors échelle : 1 — total 74.

## Annexe B — F2 : les 52 `.catch()`

Lignes : celle du `.catch`. L'annexe A donne la ligne où l'appel commence : `admin.js:872` et `:874` désignent le même appel.

**Posés directement sur un appel Supabase (6), tous inertes.**

| Endroit | Appel | Conséquence | G |
|---|---|---|---|
| `routes/admin.js:744` | création du bucket | aucune (erreur ignorée volontairement) | — |
| `routes/admin.js:849` | idem | aucune | — |
| `routes/admin.js:874` | suppression d'un fichier, sans attente | fichier orphelin possible | — |
| `services/strip-cache.js:136` | création du bucket, avant chaque envoi | aucune ; trois appels inutiles par génération, un par variante envoyée (`strip-cache.js:176-187`) | — |
| `routes/avis.js:65` | insertion du clic, après un `.then` qui lit l'erreur | aucune | — |
| `routes/clients.js:64` | insertion des consentements, `.then()` vide | **échec invisible** | hors échelle |

**Posés sur une fonction maison qui appelle Supabase (21).**

| Endroit | Fonction | Verdict | G si l'échec est caché |
|---|---|---|---|
| `routes/scan.js:186` | poussée Apple après scan | **aveugle** (jetons lus sans erreur) | 6 |
| `routes/scan.js:187` | mise à jour Google après scan | sans objet (Supabase n'y sert qu'au registre, qui ne rejette jamais) | — |
| `routes/scan.js:198` | crédit du parrain | **partiel** : voit le ticket et le crédit, aveugle aux lectures et au texte | 1 |
| `routes/scan.js:343` | poussée Apple au parrain | **aveugle** | 6 |
| `routes/scan.js:348` | mise à jour Google du parrain | sans objet | — |
| `routes/scan.js:409` | resynchronisation après annulation | **aveugle** | 6 |
| `routes/clients.js:71` | liaison filleul-parrain | **aveugle** | 1 |
| `routes/clients.js:233` | resynchronisation après ajustement | **aveugle** | 6 |
| `routes/apple-wallet.js:60` | poussée de bienvenue | **aveugle** à la base, voit APNs | 5 |
| `routes/workflows.js:63` | relance lancée à la main | **aveugle** | 5 |
| `routes/workflows.js:64` | boost lancé à la main | **aveugle** | 5 |
| `services/avis.js:100` | demande d'avis | efficace (erreurs lues à l'intérieur) | — |
| `services/strip-cache.js:165`, `:214` | lecture Storage | efficace | — |
| `services/strip-cache.js:185` | envoi Storage | efficace (lève sur erreur) | — |
| `services/strip-cache.js:192` | purge | efficace | — |
| `services/strip-cache.js:216` ; `services/apple-pass.js:483`, `:485` | génération d'image | efficace | — |
| `services/google-pass.js:81`, `:454` | adresse d'image | efficace | — |

**Posés sur un appel extérieur ou le filet d'Express (25), légitimes** :
téléchargement d'images (`admin.js:424`, `:476`, `:479` ; `apple-pass.js:448-450`,
`:477` ; `strip-cache.js:227`, `:233`) ; classe Google (`admin.js:221`, `:354`,
`:793`) ; `sharp` (`admin.js:428`, `strip-generator.js:850`) ; APNs (`clients.js:287`,
`scan.js:252`, `services/avis.js:149`, `cron.js:247`) ; mises à jour et messages Google
(`clients.js:297`, `:302` ; `scan.js:271`, `:276` ; `services/avis.js:158` ;
`cron.js:256`) ; filet des routes (`utils/asyncHandler.js:8`).

## Annexe C — Commandes reproductibles

Depuis `winwincard/backend/`, au commit `185c640`.

```bash
# Appels Supabase : 151 = 69 sur une ligne + 82 dont la chaîne continue à la ligne suivante
grep -rnoE "supabase\s*\.\s*(from|rpc|storage)\b" src | wc -l        # 69
grep -rnE "(^|[^.a-zA-Z_])supabase\s*$" src | wc -l                  # 82

# .catch() : 57 lignes, dont 5 commentaires → 52 appels
grep -rn '\.catch(' src | grep -vE ':\s*//|//[^:]*\.catch\(' | wc -l

# Variables d'environnement lues, accès dynamiques compris
grep -rnoE "process\.env(\.[A-Z_0-9]+|\[[^]]+\])" src | sort | uniq -c

# Routes : 66 déclarations de routeur
grep -rhoE "router\.(get|post|put|patch|delete)\(\s*'[^']+'" src/routes | wc -l

# Historique complet puis recherche de secrets (242 commits).
# Seules sorties : trois lignes du modèle .env.example (en-tête JWT tronqué par « ... »).
# La seconde commande ne rend rien : aucun fichier de clé ni .env n'a été commité.
git fetch --unshallow origin
git log --all -p --no-color | grep -nE -- "-----BEGIN ((RSA|EC|ENCRYPTED|OPENSSH) )?PRIVATE KEY-----|eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.|sk_live_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|\"private_key_id\": *\"[0-9a-f]{20,}\"|SUPABASE_SERVICE_KEY=ey[A-Za-z0-9_-]{30,}|JWT_SECRET=[^c\s][^\s]{15,}|ADMIN_PASSWORD=[^c\s][^\s]{7,}|APPLE_PASS_PHRASE=[^m\s][^\s]{3,}|sb_publishable_[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]{8,}"
git log --all --format='%h' -- '*.pem' '*.p8' '*.p12' '*.key' '.env' '**/.env' 'certs/*' '**/certs/*'
```

La **classification** (lecture de l'erreur, borne des listes, lancements sans attente,
boucles, état de module) a été faite par analyse syntaxique : l'analyseur acorn
fourni avec Node (`node --expose-internals`) parcourt chaque fichier de `src/`, et
retient les chaînes d'appel dont la racine est `supabase` et les motifs de chaque
famille. Ce script de travail n'est pas versé au dépôt ; sa sortie est l'annexe A et
les tableaux de F1 à F10. Toute nouvelle occurrence trouvée par les commandes
ci-dessus signale un endroit à classer.

## Annexe D — Résultats bruts (26/09)

**C1** — plafond de 1 000 lignes

| Lecture | Code | Ramène | Marchand du max | Max | Marge |
|---|---|---|---|---|---|
| L1 | `cron.js:52` | scans dans la fenêtre d'inactivité | Pizz'Amore | 297 | 703 |
| L2 | `cron.js:53` · `clients.js:100` · `clients.js:123` | clients non supprimés | Dinapoli | 267 | 733 |
| L3 | `cron.js:54` | relances inactif des 7 derniers jours | WinWin Card DEMO | 150 | 850 |
| L4 | `cron.js:115` | clients proches de la récompense | Nails By Ness | 29 | 971 |
| L5 | `cron.js:120` | boosts des 7 derniers jours | Magic Cleaning | 12 | 988 |
| L6 | `cron.js:190` | clients avec date de naissance | WinWin Card DEMO | 3 | 997 |
| L7 | `cron.js:195` | anniversaires depuis le 1er janvier (UTC) | MK Café | 1 | 999 |
| L8 | `merchants.js:63` | scans non annulés des 30 derniers jours | Pizz'Amore | 322 | 678 |
| L9 | `clients.js:331` | clients non supprimés, toute la plateforme | (plateforme) | 1 691 | −691 |
| L10 | `notifications.js:80` | jetons Apple du marchand | Dinapoli | 256 | 744 |
| L11 | `notifications.js:84` | cartes avec objet Google | Dinapoli | 267 | 733 |
| L12 | `admin.js:38` · `:652` · `:696` · `cron.js:32/93/165` | marchands, toute la plateforme | (plateforme) | 48 | 952 |
| L13 | `merchants.js:121` · `admin.js:86` | boutiques non archivées | Pizz'Amore | 5 | 995 |

**C2** — volumétrie : `workflow_executions` 2 874 (880 kB) · `scans` 2 178 (768 kB) ·
`clients` 1 739 (904 kB) · `passes` 1 691 (2 416 kB) · `device_tokens` 1 366
(856 kB) · `notification_envois` 656 (352 kB) · `notification_logs` 51 (48 kB) ·
`marchands` 48 (216 kB) · `consentements` 25 (32 kB) · `diagnostics_camera` 15
(80 kB) · `points_de_vente` 9 (96 kB) · `avis_clics` 1 (48 kB) · `referral_credits` 1
(72 kB) · `workflows` 0 (16 kB).

**C3** — marchands avec lien d'avis : 1 (Hamza Salon) · marchand `demo` : 0 · clients
sans ligne `passes` : 0 · cartes sans lien Google : 0 sur 1 691 · clients sans
consentement : 1 · relances doublées le même jour : 0.

**C4** — appareils : 1 287 · appareils multi-marchands : 23 · cartes au plus par
appareil : 31 · jetons partagés entre cartes : 28.

**C5** — scans par heure UTC, 30 jours (heure, langue, total, moyenne par jour, pire
heure) :

| Heure UTC | en | fr |
|---|---|---|
| 0 | 2 (0,1 ; 2) | — |
| 5 | 6 (0,2 ; 3) | — |
| 6 | 10 (0,3 ; 3) | — |
| 7 | 16 (0,5 ; 6) | — |
| **8** | **23 (0,8 ; 7)** | **23 (0,8 ; 9)** |
| 9 | 14 (0,5 ; 2) | 42 (1,4 ; 10) |
| 10 | 17 (0,6 ; 8) | 104 (3,5 ; 14) |
| 11 | 15 (0,5 ; 3) | 113 (3,8 ; 18) |
| 12 | 19 (0,6 ; 2) | 94 (3,1 ; 12) |
| 13 | 22 (0,7 ; 3) | 52 (1,7 ; 7) |
| 14 | 23 (0,8 ; 6) | 46 (1,5 ; 8) |
| 15 | 28 (0,9 ; 11) | 112 (3,7 ; 33) |
| 16 | 39 (1,3 ; 9) | 120 (4,0 ; 17) |
| 17 | 37 (1,2 ; 8) | 128 (4,3 ; 21) |
| 18 | 14 (0,5 ; 5) | 153 (5,1 ; 20) |
| 19 | 5 (0,2 ; 1) | 155 (5,2 ; 18) |
| 20 | 3 (0,1 ; 2) | 138 (4,6 ; 19) |
| 21 | — | 44 (1,5 ; 12) |
| 22 | — | 8 (0,3 ; 4) |
| 23 | 6 (0,2 ; 4) | 1 (0,0 ; 1) |

Total sur 30 jours : 299 scans (en) et 1 333 (fr), soit environ 54 par jour.

**C6** — 26/09 : 116 lignes, 11 lots, 66 cartes, premier lot écrit à 08:00:08, dernier
à 08:01:21, 80 s depuis 08:00.

**C7** — registre depuis le 25/09 17:18:19 · événements de scan : 161 · cartes et
événements sans ligne : 0 et 0 · clients actifs : 1 691 · soldes différents du
journal : 99, dont parrain crédité : 1, dont ajusté depuis le registre : 1 · sans
explication en base : 97, dont sans aucun scan : 42 · écarts sans explication :
−144 à +1 899 · ruptures de chaîne du journal : 45, la dernière le 26/09 · marchands
en points avec parrainage : 2 · crédits de parrainage en mode points : 1.

**Relevés du 26/09** — Railway : 18 variables posées (§4.1) plus 8 ajoutées par
Railway ; `NODE_ENV = production` ; `API_BASE_URL = https://app.winwin-card.com` ;
`SENTRY_DSN` non posée ; « Watch Paths » vide ; `185c640` a déclenché un déploiement.
Navigateur, cache `winwin-admin-v1`, entrée `/admin/` : en-tête `date` =
`Sat, 26 Sep 2026 22:20:42 GMT`. Supabase : nouvelles clés (`sb_publishable_…`,
`sb_secret_…`) et clés historiques (onglet « Legacy ») ; Data API : Max rows = 1000,
schémas exposés 2 sur 2, tables exposées 0 sur 14, fonctions exposées 0 sur 8,
exposition automatique des nouvelles tables désactivée, chemin de recherche
supplémentaire `public, extensions`, pool configuré automatiquement, option « Harden
Data API » disponible et non activée. GitHub (API) : dépôt public, Pages actif,
branche par défaut `claude/winwin-card-landing-ohS22`.

## Annexe E — Sources extérieures

| Source | Version, lieu | Ce qui y est lu |
|---|---|---|
| `@supabase/postgrest-js` | 2.107.0, sha512 `7ARs47/tyIjX…M6yWQ==` (= `package-lock.json`) | jamais de rejet (`dist/index.cjs:312-355`) ; relances des lectures (`:7-29`, `:115-120`, `:286-306`) ; délai optionnel (`:4837-4860`) |
| `@supabase/storage-js` | 2.107.0, sha512 `/X8OOVwKBn8a…zcMUw==` (= `package-lock.json`) | erreurs rendues en `{ error }` (`dist/index.cjs:74-77`, `:119`, `:308-320`, `:358-371`, `:468-486`) |
| `@supabase/supabase-js` | 2.107.0, sha512 `ChKzdlWVweMU…HS3ZA==` (= `package-lock.json`) | délai transmis tel quel, non fourni par le projet (`dist/index.cjs:1270-1276`) ; en-têtes de la clé (`:922-940`) |
| Discussion GitHub Supabase #45329, « Breaking Change: Tables not exposed to Data and GraphQL API automatically » | github.com/orgs/supabase/discussions/45329, lue le 26/09 | réglage d'exposition automatique, dates (28/04, 30/05, 30/10/2026), droit d'exécution de `PUBLIC` conservé sur les fonctions |
| Documentation Supabase « API keys », « Migrating to publishable and secret API keys », « Securing your API » | supabase.com/docs, **par extraits de moteur de recherche** (page bloquée par le proxy) | clé publishable = rôle `anon` ; clés historiques dépréciées d'ici fin 2026 ; les droits Postgres décident de l'accès par l'API |
| Documentation Google Wallet | citée par le rapport A §5.2 | 3 notifications par carte et par 24 h |
