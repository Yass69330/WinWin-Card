# Audit WinWin — Segment 4 : les cartes dans le téléphone

> Quatrième segment de l'audit, après la photo de production (00a), la cartographie
> (00b), les notifications (01), le scan et le crédit (02), l'accès et les données (03).
> Question posée par le brief (§6) : **la carte telle qu'elle vit dans le téléphone**,
> sur Apple Wallet et Google Wallet — sa création, son téléchargement, sa mise à jour
> après un scan, son contenu, et la cohérence entre ce que montre la carte et ce que dit
> la base. Les notifications elles-mêmes ont été traitées au segment 1 : ce rapport n'en
> prend que l'angle de la carte.
> Même règle que les rapports précédents : **tout constat est rattaché à une preuve**
> (fichier:ligne, commit, requête, mesure, démonstration). Ce qui n'a pas pu être prouvé
> est marqué comme tel et n'est jamais comblé par une reconstitution. Le dépôt étant
> public, les constats qui touchent un accès disent **qui** et **à quelles conditions**,
> jamais **comment** (décision de pilotage du 26/09).

| | |
|---|---|
| **Date** | 2026-09-27 |
| **Commit audité** | `2d5840a` (branche `claude/keen-goldberg-MXslu`). Le code applicatif y est identique à `ca0579a`, en production depuis le 25/09 à 22:08 UTC (`git diff ca0579a 2d5840a -- winwincard/` est vide). |
| **Dernière migration du dépôt** | `047_avis_google` |
| **Périmètre** | génération des cartes Apple (`services/apple-pass.js`) et Google (`services/google-pass.js`) ; images du bandeau (`services/strip-generator.js`, `services/strip-cache.js`, `services/illustrations/`) ; service web Apple (`routes/apple-wallet.js`), téléchargement (`routes/passes.js`), route Google (`routes/google-wallet.js`) ; landing (`public/landing.html`, `routes/landing.js`) et aperçu admin (`public/admin/preview.html`). Sous l'angle carte seulement : l'inscription (`routes/clients.js`), les réglages de carte de l'admin (`routes/admin.js`, `public/admin/index.html`) et les huit endroits qui écrivent dans `passes`. |
| **Méthode** | lecture du code ; documentation extérieure lue à la source quand c'était possible (bibliothèque officielle de Google, dépôt de PostgREST) ; base de référence rejouée depuis le dépôt (PostgreSQL 16, 48 fichiers, 0 échec) pour tester chaque requête et démontrer un comportement (D-A) ; requêtes K1 à K4 en lecture seule (`docs/audit/04-requetes.sql`), exécutées par Yass le 27/09 ; mesures locales M1 (génération d'une carte Apple) et M2 (rendu du bandeau) ; Ponytail appliqué à la main |
| **Limites de méthode** | aucun accès direct à la production depuis le conteneur ; **aucune carte générée, envoyée ni mise à jour en production** ; les journaux Railway ne sont pas relevés (R1, NON VÉRIFIABLE d'office, décision de pilotage) ; les pages de documentation de Google, d'Apple et de PostgREST sont bloquées par le proxy du conteneur : Google et PostgREST ont été lus à la source, Apple et le reste par extraits de moteur de recherche, marqués HYPOTHÈSE forte ; les mesures locales viennent de la machine du conteneur, pas de celle de la production : ce sont des ordres de grandeur ; aucun test sur iPhone |

### Légende

| Marque | Sens |
|---|---|
| **PROUVÉ** | vérifiable par le fichier:ligne, le commit, la requête, la mesure ou la démonstration cités |
| **HYPOTHÈSE** | raisonnement cohérent, non vérifié — ce qui le confirmerait est indiqué |
| **NON VÉRIFIABLE** | la preuve n'existe pas ou n'est pas accessible — la raison est donnée |

La **gravité** (colonne « G ») suit l'échelle du brief (§4) : **1** argent des clients ·
**2** trafic machine (projection) · **3** scan au comptoir · **4** données et accès ·
**5** notifications · **6** carte dans le téléphone · **7** statistiques · **8** apparence.
« coût » : un comportement qui ne casse rien, mais fait travailler la plateforme pour rien.

---

## 1. En une page

**Ce que la carte affiche du solde est juste à chaque mise à jour.** La carte Apple relit
le solde en base à chaque téléchargement ; la carte Google reçoit le solde à chaque scan,
ajustement, annulation et crédit de parrainage ; les trois calculs du fond doré (carte
Apple, carte Google, bandeau) donnent le même résultat. **Aucun défaut de gravité 1 ou 2
n'a été trouvé dans ce segment.** Ce qui fait défaut, c'est tout ce qui entoure le solde :
la plateforme régénère beaucoup de cartes pour rien, fait attendre Google à des clients
iPhone, et laisse sur les cartes Google des informations figées à leur création.

| # | Constat | G | Statut |
|---|---|---|---|
| 1 | **Le cron réécrit la carte à l'identique, et l'iPhone la re-télécharge entière pour rien.** Sur les 7 derniers jours, **76 % des exécutions du cron ne changent rien à la carte** (65 % sur 62 jours) : **270 régénérations complètes inutiles** en 7 jours (≈ 39 par jour, ≈ 100 Ko chacune), sans aucune notification visible sur iOS. À 100 000 porteurs : ≈ 2 230 par jour à ratios constants, ≈ 4 200 si la moitié du parc devient inactive sous relance. | 6 (coût) | PROUVÉ (code, K1) / HYPOTHÈSE (projection) |
| 2 | **Chaque poussée fait revérifier toutes les cartes de l'appareil** : la cause C du rapport 01 est désormais **PROUVÉE** (documentation de PostgREST et code). Un scan sur une carte iPhone provoque **3,4 téléchargements ou vérifications** en moyenne (4 286 pour 1 251 scans sur 30 jours), jusqu'à 31 sur un même appareil. Corriger la liste sans corriger l'horodatage ferait **manquer** des mises à jour (démontré, D-A). | 6 | PROUVÉ |
| 3 | **L'inscription attend Google, même pour un client iPhone** : le lien Google arrive **1,4 s** après la carte en médiane (2,4 s au p90, **jusqu'à 22 s** mesurés), sans aucun délai maximal ; or 64 % des cartes finissent sur un iPhone. Le résultat de la création de l'objet Google n'est pas vérifié. | 6 | PROUVÉ (K2, code) |
| 4 | **La carte Google n'est tenue à jour que pour le solde, l'image, la couleur et le prénom.** Le dos (mode d'emploi, contact, lien de parrainage) et le module « CLIENT » restent ceux de la création ; l'image n'est jamais effacée quand plus aucune ne s'applique ; deux mises à jour rapprochées peuvent arriver dans le désordre (l'avant-dernier solde reste affiché jusqu'au scan suivant). | 6 · 8 | PROUVÉ (code) / NON VÉRIFIABLE (fréquence du désordre) |
| 5 | **Les messages s'empilent sur les cartes Google** : 10 au plus par carte (définition officielle), chacun affiché sans fin, et le code en ajoute un à chaque scan, relance, campagne, avis ou ajustement. Ce que fait Google au 11e n'est pas documenté. **Les mises à jour de carte, elles, ne notifient jamais** et ne consomment pas le quota de 3 notifications par 24 h : la question laissée par A §5.2 est tranchée. | 5 · 6 | PROUVÉ (définition, code) / NON VÉRIFIABLE (au-delà de 10) |
| 6 | **Un changement de design n'atteint une carte Apple qu'à sa prochaine réécriture** ; sur Google, le logo et le nom basculent d'un coup (classe), l'image et la couleur au scan suivant de chaque carte (objet). La bascule saisonnière « au fil des scans » existe donc déjà, **sur les deux plateformes** pour l'image et la couleur, contrairement à l'hypothèse du brief. Une bascule en masse à 100 000 porteurs : ≈ 81 000 cartes Apple régénérées (≈ 8 Go) et 100 000 mises à jour Google. | 8 (projection) | PROUVÉ (code) / HYPOTHÈSE (volumes) |
| 7 | **Les images du bandeau travaillent pour rien.** Chaque enregistrement de la fiche dans l'admin invalide toutes les images du marchand (jusqu'à **78 versions**) ; en mode barre de points, chaque solde nouveau déclenche un rendu (**106 valeurs** chez Dinapoli en 17 jours) ; un rendu **bloque tout le serveur 23 à 28 ms** (136 ms avec un fond personnalisé) ; la purge ne passe plus chez les marchands qui ne génèrent plus rien (**195 fichiers** d'anciennes versions). | 3 (latent) · coût | PROUVÉ (code, K3, K4, M2) |
| 8 | **Les deux chemins de génération Apple divergent** (installation refusée pour un marchand suspendu, mises à jour servies ; une couleur manque à l'installation) ; un prénom modifié au dashboard n'est pas poussé ; toute installation coûte **deux** générations complètes (bienvenue). | 6 · 8 | PROUVÉ (code) |
| 9 | **Le parrainage n'a pas été coupé** (précision de Yass, 27/09 : seule a été vérifiée l'absence de parrainage chez les vrais marchands en production en mode points) : **9 marchands** l'ont encore, dont 7 en tampons (419 cartes) ; leurs cartes Apple impriment le numéro de série dans le lien à chaque régénération. **Aucune réinscription spontanée d'appareil n'est observée** (0 sur 139) : une désinscription faite sans jeton fige la carte durablement. | 4 · 6 | PROUVÉ (K3, K1, code) |
| 10 | **Le service web Apple passe par le limiteur global** (300 requêtes par 15 min et par adresse). Une campagne chez le plus gros marchand provoque déjà ≈ 600 requêtes d'iPhone en quelques minutes : si elles arrivent par peu d'adresses (proxy de Railway, 02 §4.8), des mises à jour de cartes seraient refusées. | 6 | PROUVÉ (réglage) / HYPOTHÈSE (adresses) |
| 11 | **Deux rendus du bandeau** : l'aperçu de la landing est une imitation figée (8 pastilles, 3 pleines) qui ignore le seuil, le mode points, les thèmes et les couleurs personnalisées, pourtant fournis par le serveur. Les 15 marchands en points montrent des pastilles sur leur landing. | 8 | PROUVÉ (code) |
| 12 | **Une rotation de `JWT_SECRET` casserait les 1 104 cartes installées sur iPhone** (1 321 appareils) ; la rendre possible exige d'abord de séparer le secret des cartes de celui des sessions. | 4 · 6 | PROUVÉ (code) / HYPOTHÈSE (comportement de l'iPhone, extraits) |
| 13 | **Ponytail** : environ **−700 lignes** candidates, dont un aperçu admin en double (388 lignes) et une route Google sans appelant. Aucun garde-fou dans la liste. | — | liste de candidats |

**Ce que cela dit pour la roadmap.** Ce segment ne contient ni défaut d'argent ni défaut
de machine : sa priorité vient de ses **dépendances** et de ce qui **grossit avec le
stock**. Le travail inutile (constats 1, 2, 7) grossit avec le nombre d'inactifs et de
cartes par appareil ; il se traite avec le plafond de relance par épisode déjà retenu
(A §1). Trois préalables sont à placer avant d'autres chantiers : **séparer le secret des
cartes Apple** avant toute rotation de `JWT_SECRET` (verrouillage post-audit, 03) ;
**corriger ensemble la liste « mises à jour depuis » et son horodatage** (dette #11,
démontré ici) ; **ne plus attendre Google à l'inscription** avant l'e-commerce, où des
porteurs seront créés en masse. Enfin, une future API machine devra dire ce que la carte
affiche et notifie à chaque crédit (quota Google de 3 par 24 h, 10 messages par carte).

---

## 2. Méthode

- **Code** : lecture intégrale du périmètre au commit `2d5840a` ; relevé des lignes citées.
- **Documentation extérieure** : les pages de Google, d'Apple et de PostgREST sont
  bloquées par le proxy du conteneur. Deux sources primaires ont été lues autrement :
  - **Google Wallet** : la bibliothèque cliente officielle en Go, générée par Google à
    partir du descriptif de l'API (`googleapis/google-api-go-client`,
    `walletobjects/v1/walletobjects-gen.go`, branche principale au 27/09) : les définitions
    des champs y sont reproduites mot pour mot ;
  - **PostgREST** : la documentation et le journal des versions, dans le dépôt officiel
    (`PostgREST/postgrest`, `docs/references/api/resource_embedding.rst`, `CHANGELOG.md`) ;
  - le reste (Apple, refonte Google 2026) par **extraits de moteur de recherche**, marqués
    HYPOTHÈSE forte là où ils portent un constat.
- **Bibliothèque `@supabase/postgrest-js`** lue à la version figée (2.107.0) par
  `npm pack --ignore-scripts`, jamais installée ; empreinte identique au `package-lock.json`.
- **Base de référence** rejouée depuis le dépôt (méthode de 00a, annexe B), complétée des
  droits `service_role` des 7 tables (00a §5.1) et d'une maquette de `storage.objects` :
  - K1 à K4 testées à vide (0 erreur), puis sur un jeu fabriqué de 25 clients dont chaque
    résultat était calculé à la main avant exécution : **tous conformes** ;
  - durée vérifiée sur un volume synthétique de la taille de la production, puis dix fois
    plus : K1 environ 3 s, K2 à K4 moins de 1,5 s ;
  - démonstration **D-A** (le piège de la dette #11), annexe B.
- **Production** : K1 à K4 exécutées par Yass le 27/09 (résultats bruts : annexe A).
- **Mesures locales** (annexe B) : **M1**, copie fidèle de la signature et de l'assemblage
  d'une carte Apple (`apple-pass.js:180-292`, `:509-533`) avec des certificats jetables ;
  **M2**, le générateur de bandeau du dépôt, chargé tel quel, sur des marchands fictifs,
  avec les deux bibliothèques de rendu installées hors du dépôt (autorisation de pilotage).
- **Ponytail** : dépôt cloné en v4.10.0 (`e3ba2aa`), commande d'audit
  (`commands/ponytail-audit.toml`, `skills/ponytail-audit/SKILL.md`) lue et appliquée à la
  main ; rien d'installé ni d'exécuté (§7.4).

---

## 3. La carte, de bout en bout

### 3.1 La naissance : inscription et installation

**PROUVÉ (code, K1, K2).**

| # | Étape | Ce qui se passe | Preuve |
|---|---|---|---|
| 1 | Landing | lecture publique du marchand ; affichage d'un aperçu de carte en CSS (§4.10) | `merchants.js:176-186` ; `landing.html:413-432` |
| 2 | Inscription | lecture du marchand, écriture du client, écriture de la carte, puis **2 à 4 appels Google l'un après l'autre** (classe, objet), écriture du lien Google, **et seulement ensuite** la réponse avec les deux liens | `clients.js:23-95` ; `google-pass.js:367-409` |
| 3 | Redirection | iPhone hors navigateur intégré : ouverture directe de la carte Apple ; Android : Google Wallet ; sinon deux boutons. La carte est mémorisée dans le navigateur pour le passage suivant | `landing.html:592-595`, `:931`, `:945-1010` |
| 4 | Installation Apple | **1re génération complète** (`/api/passes/:serial/apple`) | `passes.js:8-68` |
| 5 | Enregistrement de l'appareil | l'iPhone s'inscrit pour les mises à jour (jeton de carte vérifié), le serveur répond 201 | `apple-wallet.js:26-56` |
| 6 | Bienvenue | après la réponse : réécriture de la carte (texte de bienvenue) et poussée → **2e génération complète** | `apple-wallet.js:58-60`, `:172-206` |

Mesures : l'inscription attend Google 1,4 s en médiane (K2, §4.3) ; 139 enregistrements
d'appareil depuis l'ouverture du registre (25/09 à 17:18, 00b C7), soit environ 2,2 jours
au moment du relevé (K1). Un objet Google est demandé pour **chaque** carte, qu'elle
finisse sur un iPhone ou non (00b §10 : un lien pour 1 691 cartes sur 1 691 le 26/09 ;
la création elle-même n'est pas vérifiée, §4.3).

### 3.2 La vie : qui réécrit la carte, qui prévient le téléphone

**PROUVÉ (code).** Toute écriture sur `passes` avance `updated_at` (déclencheur
`trg_passes_updated_at`, identique en production, 00a). C'est cette date, et elle seule,
que l'iPhone compare pour savoir si sa carte a changé (`apple-wallet.js:128-132`).

| Écrivain | Ce qu'il écrit | Poussée Apple | Google | Preuve |
|---|---|---|---|---|
| Scan | texte du scan | oui | mise à jour + message | `scan.js:169-173`, `:186-187` |
| Crédit de parrainage | texte, carte du parrain | oui | mise à jour + message | `scan.js:335-348` |
| Ajustement, annulation | texte « points ajustés » | oui | mise à jour + message | `clients.js:262-305` |
| Cron (relance, boost, anniversaire) | texte **constant** d'une fois sur l'autre | oui | message | `cron.js:63-65`, `:130-132`, `:234-259` |
| Campagne manuelle | texte, **toutes les cartes du marchand** | oui, 1 000 appareils au plus (00b L10) | message | `notifications.js:96-122` |
| Demande d'avis | texte | oui | message | `services/avis.js:133-160` |
| Bienvenue | texte | oui (un appareil) | — | `apple-wallet.js:184-186` |
| Lien Google | `google_pass_url` | non | — | `clients.js:83` (inscription) ; `google-wallet.js:32-36` (route sans appelant) |

**La chaîne Apple, après chaque poussée** (PROUVÉ, code ; documentation Apple par extraits) :
1. la poussée vise l'**appareil**, pas la carte : un jeton couvre toutes les cartes WinWin
   de l'appareil (01, cause B) ;
2. l'appareil demande la liste des cartes « mises à jour depuis » : le serveur renvoie
   **toutes** ses cartes (§4.2) ;
3. pour chacune, l'appareil télécharge la carte en donnant la date de sa dernière version :
   si `updated_at` n'a pas avancé, réponse 304 (une lecture en base) ; sinon, **génération
   complète** : 3 lectures l'une après l'autre, images, signature, ≈ 100 Ko
   (`apple-wallet.js:107-167`).

**La chaîne Google** : une mise à jour de l'objet (solde, prénom, image, couleur, code de
secours, lien d'avis ; `google-pass.js:412-494`) puis l'ajout d'un message qui sonne sur
Android (`google-pass.js:499-525`).

### 3.3 Ce que montre la carte, et d'où cela vient

**PROUVÉ (code), sauf mention.** « Réécriture » = une écriture sur `passes` suivie d'une
poussée et d'un téléchargement par l'appareil.

| Élément affiché | Carte Apple : source, rafraîchi quand | Carte Google : source, rafraîchi quand |
|---|---|---|
| **Solde** | `clients.stored_value`, **relu à chaque génération** ; « solde / seuil affiché » (`apple-pass.js:354-357`) ; à chaque réécriture | `loyaltyPoints.balance`, **valeur calculée au scan** et envoyée telle quelle (`scan.js:187`) ; sans dénominateur ; à chaque scan, ajustement, annulation, parrainage |
| **Fond doré** | `stored_value > 0 et ≥ seuil` (`apple-pass.js:300-302`) | même règle (`google-pass.js:417`, `:466-468`) ; bandeau : `≥ seuil` (`strip-generator.js:726`) — identiques pour un seuil ≥ 1 (02, S6 : aucun seuil nul) |
| **Prénom** | relu à chaque génération ; une modification au dashboard **ne déclenche aucune réécriture** (`clients.js:231`) | `accountName` au prochain scan ; le module « CLIENT » **jamais réécrit** (`google-pass.js:238-243`) |
| **Bandeau / image** | palier → image fixe → image générée → uni, à chaque génération (`apple-pass.js:454-491`) | objet : palier → image fixe → image générée, à chaque mise à jour, **jamais effacée** si rien ne s'applique (`google-pass.js:442-461`) ; classe : image Google → image générée à 0 → image fixe (`:68-86`), au seul enregistrement admin |
| **Couleur de fond** | à chaque génération | classe (enregistrement admin) **et** objet, réécrite à chaque mise à jour (`google-pass.js:466-468`) : l'objet l'emporte (HYPOTHÈSE forte : commentaire du code ; la définition officielle le dit pour l'image) |
| **Logo, nom du programme** | à chaque génération (logo téléchargé deux fois, `apple-pass.js:449-450`) | **classe seule** (`google-pass.js:152-197`), au seul enregistrement admin |
| **Dos de carte** : mode d'emploi, contact, parrainage, données personnelles | à chaque génération (`apple-pass.js:361-408`) | `textModulesData` **à la création seulement** (`google-pass.js:238-271`) ; jamais dans la mise à jour (`:422-481`) |
| **Lien d'avis** | présent si le marchand en a un, à chaque génération | posé à la création et à chaque mise à jour, **jamais retiré** (`google-pass.js:474-481`) |
| **Texte de notification** | `passes.notification_message` : le dernier écrivain gagne | messages **empilés**, 10 au plus, affichés sans fin (§4.5) |
| **QR et code de secours** | numéro de série, immuable | idem, réécrit à chaque mise à jour (`google-pass.js:436-440`) |

**Seuil affiché différent du seuil réel** (K3) : Nails By Ness (seuil 4, affiché 5) et LDC
Kitchen + Coffee (9 et 10, marchand inactif). Chez Nails By Ness, la carte Apple affiche
« 4 / 5 » **avec le fond doré** et le libellé de récompense, pendant que le bandeau dessine
4 pastilles et que la carte Google n'affiche que « 4 ». C'est un choix du marchand, pas un
défaut ; l'incohérence se voit sur une même carte (G8).

---

## 4. Santé : les constats

### 4.1 Les cartes régénérées pour rien (hérité de 02, mesuré)

**Le mécanisme — PROUVÉ (code).** L'iPhone ne sait pas ce qui a changé : il compare la
date `updated_at` de la carte à celle de la version qu'il possède, et le serveur renvoie la
carte entière dès que la date a avancé (`apple-wallet.js:128-132`, `:161`). Or le cron
réécrit un texte **identique d'une relance à l'autre** pour un client qui ne revient pas :
le modèle du marchand avec le prénom et le nom du marchand pour la relance
(`cron.js:63-65`), « plus que N » avec N inchangé tant que le solde ne bouge pas pour le
boost (`cron.js:130-132`). La carte régénérée est donc la même, octet pour octet, que celle
de l'iPhone. C'est exactement ce que les iPhone ont signalé le 27/09 (02, annexe A :
« pass was unchanged », « ignored the if-modified-since header »).

**Précision sur l'héritage de 02 (§5.2).** La réécriture du lien Google « à chaque appel »
existe (`google-wallet.js:32-36`), mais sur une route qui **n'a aucun appelant** (00b §6) :
elle n'explique pas les erreurs observées. La date donnée par l'iPhone, 18/09 08:00:41,
tombe dans le passage du cron. **PROUVÉ** (code) ; appel extérieur éventuel de la route :
NON VÉRIFIABLE (journaux non relevés).

**La mesure — PROUVÉ (K1).** Une exécution du cron est comptée « à l'identique » quand
l'écriture précédente sur la carte est une exécution du même workflow, sans scan,
annulation, campagne, crédit de parrainage, appareil enregistré ni envoi tracé au
registre entre les deux (définition complète : `04-requetes.sql`, K1).

| | 62 jours (rétention) | 7 derniers jours |
|---|---|---|
| exécutions du cron | 2 956 | 558 |
| dont réécriture à l'identique | **1 919 (65 %)** | **424 (76 %)** |
| dont sur une carte iPhone | 903 | 211 |
| poussées Apple provoquées (une par appareil) | 1 280 | **270** |
| cartes revérifiées par ces appareils | 2 894 | 642 |
| exécutions sur une carte iPhone, identiques ou non | 1 535 | 296 |

Lecture :
- **71 % des cartes iPhone réécrites par le cron sur 7 jours l'ont été pour rien**
  (211 sur 296) ;
- chaque poussée provoque une **génération complète** de la carte sur l'appareil qui la
  porte : **270 régénérations inutiles en 7 jours, ≈ 39 par jour**, plus 53 vérifications
  par jour des autres cartes des mêmes appareils ;
- aucune n'est vue : iOS n'affiche pas un texte identique (test du 26/09, passation
  §15 sexies) ; la plateforme paie la génération et le client ne voit rien.

**Les autres sources, mesurées** : campagnes au texte identique à la précédente : 1 sur 51
(le test du 26/09) ; réinscriptions d'appareil (bienvenue répétée) : 0 sur 139 ; route du
lien Google : aucun appelant. **Le cron est la seule source notable.** PROUVÉ (K1).

**Nécessité : aucune.** La carte est identique et la notification ne s'affiche pas. Le coût
est détaillé au §5, sa projection au §6.1.

### 4.2 Chaque poussée fait revérifier toutes les cartes de l'appareil (cause C de 01)

**PROUVÉ (documentation, code).** La liste des cartes « mises à jour depuis » filtre sur une
ressource embarquée (`apple-wallet.js:84-91`) :
- la bibliothèque, à la version figée, transmet ce filtre tel quel
  (`gt(column, value)` → `passes.updated_at=gt.<date>`,
  `@supabase/postgrest-js` 2.107.0, `dist/index.cjs:1507-1509`) ;
- la documentation de PostgREST est explicite : « *By default, Embedded Filters don't change
  the top-level resource rows at all* » ; « *In order to filter the top level rows you need
  to add `!inner` to the embedded resource* » (`resource_embedding.rst`, section
  *Top-level Filtering*). `!inner` a été introduit en version 9.0.0 (2021-11-25,
  `CHANGELOG.md`) précisément pour cela.

La liste renvoie donc **toutes les cartes de l'appareil**. La cause C du rapport 01, restée
HYPOTHÈSE forte, est **PROUVÉE**. La documentation Apple attend l'inverse : ne renvoyer que
les cartes mises à jour depuis l'étiquette fournie, dont le serveur définit le contenu
(extraits, HYPOTHÈSE forte).

**Ce que cela coûte — PROUVÉ (K1).** 1 321 appareils, 1 401 paires appareil × carte,
29 appareils portant plusieurs cartes, jusqu'à 31 sur un même appareil. Sur 30 jours,
1 251 scans sur une carte iPhone ont fait télécharger ou vérifier **4 286 cartes**, soit
**3,4 par scan** : si la carte scannée a le nombre moyen d'appareils (1,27, ci-dessous),
environ 1,3 génération complète (la carte scannée, sur chacun de ses appareils) et
2,2 vérifications d'autres cartes. Les appareils à nombreuses cartes pèsent lourd dans
cette moyenne.

**Une carte sur 1,27 appareil en moyenne** (1 401 paires pour 1 104 cartes iPhone).
**HYPOTHÈSE** : un iPhone et une Apple Watch (qui s'inscrit à part), ou des inscriptions
d'anciens appareils jamais retirées (passation, dette #12 b). Chaque mise à jour pousse
chacun de ces appareils.

**Le piège, s'il est corrigé seul — PROUVÉ (démonstration D-A, annexe B).** La dette #11
interdit de corriger ce filtre sans corriger l'horodatage. La base rejouée montre pourquoi :
une écriture de carte démarre à 17:59:40.512 et se valide à 17:59:42.519 ; une liste rend
entre-temps le curseur 17:59:41.523 à l'iPhone ; la date posée sur la carte est celle du
**début** de la transaction (17:59:40.511), donc antérieure au curseur : la demande suivante
de l'iPhone ne la liste **jamais**. Avec le curseur actuel, pris à l'horloge du serveur
Node (`apple-wallet.js:100`), s'ajoute l'écart entre les horloges. Aujourd'hui, le filtre
inerte masque les deux défauts ; une correction devra prendre une marge ou un compteur
toujours croissant.

### 4.3 L'inscription attend Google, même pour un client iPhone

**PROUVÉ (code).** L'inscription enchaîne, avant de répondre : lecture du marchand, écriture
du client, écriture de la carte, puis `generateGoogleWalletUrl` (lecture de la classe,
création éventuelle, lecture de l'objet, création, précédées d'une authentification
auprès de Google quand le jeton gardé 45 minutes a expiré, `google-pass.js:103-105`), puis
l'écriture du lien Google (`clients.js:79-86`, `google-pass.js:367-409`). Aucun appel à
Google n'a de délai maximal (00b F6). Le client iPhone ne reçoit son bouton Apple qu'après
tout cela.

**La mesure — PROUVÉ (K2).** Pour les 47 cartes jamais réécrites depuis leur inscription,
la base date elle-même l'écriture de la carte et celle du lien Google :

| | médiane | p90 | max |
|---|---|---|---|
| carte → lien Google (appels Google + un aller-retour avec la base) | **1 381 ms** | 2 441 ms | **22 004 ms** |
| client → carte (un aller-retour avec la base, étalon) | 500 ms | 551 ms | 572 ms |
| inscriptions des 30 derniers jours (34) : carte → lien Google | 1 280 ms | 1 924 ms | 10 741 ms |

Tranches : 8 entre 0,5 et 1 s, 33 entre 1 et 2 s, 2 entre 2 et 3 s, 1 entre 5 et 10 s,
**3 entre 10 et 30 s**.
- **Google seul coûte environ 0,9 s en médiane et 1,9 s au p90** (écart moins l'étalon ;
  HYPOTHÈSE sur la soustraction, les deux intervalles ne se recouvrant pas exactement).
- Les 3 cas au-delà de 10 s sont soit des appels Google lents, soit une réécriture non
  tracée de la carte (bienvenue d'un appareil retiré depuis, avant le registre) :
  **HYPOTHÈSE**, indiscernables.
- **L'étalon vaut 500 ms**, contre 197 ms pour un aller-retour mesuré sur de vrais scans
  (02, S7). La cause n'est pas établie (**HYPOTHÈSE** : connexion à rouvrir, les
  inscriptions étant espacées). Si chacun des quatre allers-retours avec la base coûte
  autant que l'étalon, l'inscription entière dure de l'ordre de 3 s avant la réponse,
  dont 0,9 s environ pour Google (HYPOTHÈSE, calcul).

**Pour qui ? — PROUVÉ (K1).** 1 104 cartes sur 1 728 (64 %) sont installées sur un iPhone ;
le temps passé à attendre Google ne leur sert à rien. L'objet Google est créé pour tous
(00b §10), et 63 % des envois Google visent déjà des cartes iPhone (A §5.1).

**Le résultat de la création n'est pas vérifié — PROUVÉ (code).** Ni la création de la
classe (`google-pass.js:378-381`) ni celle de l'objet (`:384-392`) ne lisent leur statut :
si Google refuse, le lien « ajouter à Google Wallet » est tout de même fabriqué et
enregistré, pour un objet qui n'existe pas. **HYPOTHÈSE** : l'ajout échoue alors côté
client. Le fait que 1 691 cartes sur 1 691 aient un lien (00b C3) ne prouve donc pas que
leurs objets existent. Une réponse de Google qui ne serait pas du JSON fait échouer
l'analyse (`google-pass.js:146-147`) : l'inscription se poursuit sans lien Google
(`clients.js:84-86`).

### 4.4 Ce que la carte Google ne remet jamais à jour

**PROUVÉ (code), sauf mention.**
- **Le dos de la carte est figé à la création.** Mode d'emploi (avec le seuil de
  l'époque), contact, lien de parrainage et module « CLIENT » sont posés par
  `buildLoyaltyObject` (`google-pass.js:238-271`) ; la mise à jour ne les envoie jamais
  (`:422-481`). La définition officielle affiche ensemble les modules de l'objet et ceux de
  la classe (10 au plus de chaque côté) : un changement de seuil, d'adresse ou de
  parrainage ne corrige pas les cartes existantes. Côté Apple, tout est régénéré à chaque
  réécriture.
- **L'image n'est jamais effacée.** La mise à jour ne pose une image que s'il y en a une à
  poser (`google-pass.js:445-461`). Quand plus aucune ne s'applique, l'objet garde la
  dernière. La définition officielle précise que l'image de l'objet prime sur celle de la
  classe. Cas en base (K3) :
  - Pizza Sabbioni, hors production, passé des tampons aux points sans image générée : ses
    cartes Google gardent l'image à tampons de l'époque, dont les fichiers n'ont jamais été
    purgés (K4 : 12 fichiers d'anciennes versions) ;
  - Spa Salon (2 paliers pour un seuil de 7) et Teatro (7 paliers, points) : les soldes
    sans palier gardent l'image précédente ; 1 carte chacun.
  **HYPOTHÈSE** sur l'affichage réel (Google peut mettre les images en cache).
- **Deux mises à jour rapprochées peuvent arriver dans le désordre.** La valeur envoyée est
  celle du scan (`scan.js:187`), la mise à jour part après la réponse, sans délai maximal
  ni ordre garanti ; elle peut attendre un rendu d'image (`google-pass.js:450-460`). Si la
  mise à jour d'un premier scan arrive après celle du second, la carte Google affiche
  l'avant-dernier solde jusqu'à la mise à jour suivante. Même effet que les cartes non
  rafraîchies de 00b (F3, F4) : **gravité 6**. Exposition : les scans rapprochés d'une
  même carte (02, S1 : 291 paires entre 2 et 10 s, surtout le bouton « ajouter un
  tampon »). Fréquence réelle : **NON VÉRIFIABLE** (le registre n'associe pas une mise à
  jour Google à son scan).
- **Des images remplacées à la même adresse.** Une image de palier ou l'image fixe
  redéposée garde exactement la même adresse (`admin.js:746-749`, `:851-854`). **HYPOTHÈSE**
  (extraits vagues) : Google, qui met les images en cache, peut garder l'ancienne. Les
  images générées, elles, changent d'adresse à chaque version.
- **Des images purgées alors que des objets y renvoient.** Une nouvelle version purge les
  anciennes au premier rendu (`strip-cache.js:81-124`, `:191`), alors que chaque objet
  garde l'adresse posée à son dernier scan. **HYPOTHÈSE** : sans effet si Google garde sa
  copie en cache.
- **Tous les marchands sont déclarés aux Émirats** (`countryCode: 'AE'`,
  `google-pass.js:164` ; 00b F9). G8.
- **La refonte de Google Wallet (2026)** : déployée depuis le 18/08/2026, image du bas de
  carte plus grande, cartes existantes « censées rester compatibles » (extraits :
  PassKit, Passcreator, 9to5google). **HYPOTHÈSE** sur le rendu des bandeaux WinWin au
  format 3:1 (1032 × 336). G8.

### 4.5 Les messages s'empilent sur les cartes Google ; les mises à jour ne notifient pas

**Les mises à jour ne notifient pas — PROUVÉ (définition officielle, code).** La définition
du champ `notifyPreference` de l'objet : « *This setting is ephemeral and needs to be set
with each PATCH or UPDATE request, otherwise a notification will not be triggered* » ; par
défaut, « *no notifications sent* ». Le code ne pose jamais ce champ
(`google-pass.js:422-487` ; aucune occurrence dans `src/`). **Une mise à jour de carte ne
déclenche donc aucune notification et ne consomme pas le quota de 3 par carte et par
24 h** : un scan en consomme une (l'ajout de message), pas deux. C'est la réponse à la
question que A §5.2 et la passation (§15 sexies) renvoyaient au segment 4.

**Les messages s'empilent — PROUVÉ (définition officielle, code).**
- Définition du champ `messages` : « *The maximum number of these fields is 10* ».
- Définition d'un message : il reste affiché « *indefinitely if `endTime` is not
  provided* ».
- Le code ajoute un message sans date de fin (`google-pass.js:505-516`) à chaque scan,
  ajustement, annulation, crédit de parrainage, relance, boost, anniversaire, avis, et à
  chaque campagne (sur toutes les cartes Google du marchand).

**Ordre de grandeur — HYPOTHÈSE (calcul).** Un client relancé tous les 8 jours atteint 10
messages en 80 jours ; un client fidèle, en 10 passages ; chaque campagne en ajoute un
partout. La plateforme a quatre mois : des cartes ont probablement déjà dépassé 10.

**Au-delà de 10 — NON VÉRIFIABLE.** La documentation accessible ne dit pas si Google refuse
le 11e message ou efface le plus ancien. S'il refuse, les notifications Android de ces
cartes ne partent plus, **en silence** côté client, mais le registre garde le refus.
**La requête de suivi K5** (facultative, `04-requetes.sql`) le trancherait sans rendre
aucun texte d'erreur (qui peut contenir l'identifiant de l'objet, `notif-registre.js:58-59`).

### 4.6 Les images du bandeau travaillent pour rien

**Chaque enregistrement de la fiche invalide toutes les images — PROUVÉ (code, K3).** Le
serveur avance `strip_config_version` dès qu'un champ visuel est **présent** dans la
requête, pas seulement quand il change (`admin.js:332-336`) ; or le formulaire de l'admin
envoie toujours les champs visuels (`admin/index.html:1442-1450`). Tout enregistrement
invalide donc toutes les images du marchand, et chaque dépôt de palier aussi
(`admin.js:770-796`). K3 : **78 versions** chez Magic Cleaning, 29 chez Shawerman, 26 chez
Pizz'Amore, 20 chez L'IWAN et NARA. Chaque version oblige à rendre de nouveau les images au
fil des scans.

**Un trou masqué — PROUVÉ (code).** En mode barre de points, la barre est dessinée avec le
seuil affiché (`strip-generator.js:778`), qui ne fait pas partie des champs visuels
(`admin.js:229-239`). Changer ce seul réglage laisserait des images fausses en cache ;
aujourd'hui, l'invalidation systématique le masque.

**Une image par solde en mode barre de points — PROUVÉ (code, K4).** La clé du cache
contient le solde exact (`strip-cache.js:42-48`, `valeurAffichee`,
`strip-generator.js:349-353`) ; le commentaire voisin (`strip-cache.js:34-37`, « une image
par palier de 5 %, 21 au plus ») est **périmé**. Presque chaque scan produit une valeur
nouvelle, donc un rendu : K4 compte **106 valeurs** rendues chez Dinapoli depuis le 10/09,
102 chez Pizz'Amore, 87 chez Boucherie République, 58 chez Wam N Fade. 12 marchands sont
en barre de points (K3).

**Un rendu bloque tout le serveur — PROUVÉ (code, M2).** Les trois variantes sont
rastérisées de façon synchrone (`strip-generator.js:808-819`, `:865-869`). Mesure M2 (plus
long blocage de la boucle d'événements pendant un rendu, médiane de 10) : **23 ms** (barre
de points ; le commentaire du code annonçait 24), 27 à 28 ms (tampons), **136 ms** avec un
fond personnalisé (Pro+). Pendant ce temps, aucune autre requête n'avance, scans compris.
Machine de mesure différente de la production : ordre de grandeur.

**La purge ne passe plus chez certains marchands — PROUVÉ (code, K4).** Les fichiers
d'anciennes versions ne sont supprimés qu'au premier rendu d'une nouvelle version, et une
seule fois par process (`strip-cache.js:79-88`, `:191`). K4 : **195 fichiers** d'anciennes
versions, le plus ancien du 19/06 ; 97 chez Magic Cleaning (41 versions, aucune image
courante : ses cartes utilisent des paliers), 28 chez MK Café et MK Barbershop, 12 chez
Pizza Sabbioni. Aucun de ces marchands n'a d'occasion de rendu : 0 scan sur 30 jours,
ou aucune image générée en usage (Magic Cleaning) (K3). Là où plusieurs versions coexistent
(versions présentes : 41 chez Magic Cleaning, 13 chez MK Café, 11 chez MK Barbershop), la purge
actuelle les aurait effacées au rendu de chaque version suivante : ces fichiers ont donc
été rendus sous l'ancienne purge, avant sa réécriture (`5aeb633`, 26/08), ou une purge a
échoué (K4 ne donne que la date du plus ancien fichier). **HYPOTHÈSE forte** : des restes
de l'ancienne purge, que la nouvelle ne revisite qu'au prochain rendu, qui ne vient pas.

**Un téléchargement entier pour tester une existence** (00b §6, confirmé). Chaque mise à
jour Google en tampons ou en barre télécharge l'image hero pour savoir si elle existe
(`strip-cache.js:214`). K4 : **13,4 Ko en moyenne** (66,8 au plus).

**Volumes (K4)** : 1 782 images générées (20 Mo), 75 images de palier (3,95 Mo), 202 autres
fichiers (7,24 Mo ; logos, icônes et fonds déposés, nature non détaillée par K4) ; aucune
image fixe déposée sous le nom que lui donne le code ; bucket sans plafond de taille
(03, Q1).

### 4.7 Apple : deux chemins de génération, une installation en deux temps, des changements qui attendent

**PROUVÉ (code).**
- **Deux chemins qui divergent.** L'installation (`passes.js:23-34`) et la mise à jour
  (`apple-wallet.js:135-145`) relisent chacune le client et le marchand, avec deux listes
  de colonnes recopiées :
  - l'installation refuse un marchand suspendu (`.eq('actif', true)`) ; la mise à jour
    continue de servir ses cartes ;
  - `couleur_texte_reward` manque à l'installation (`passes.js:30`) : une carte déjà dorée
    réinstallée prend la couleur de texte par défaut jusqu'à sa première mise à jour
    (cas rare, G8).
  Six listes de colonnes du marchand sont recopiées ainsi dans le code (§7.4).
- **Une installation coûte deux générations complètes** : le téléchargement, puis la
  bienvenue, qui réécrit la carte et la pousse juste après l'enregistrement
  (`apple-wallet.js:58-60`, `:184-186`). C'est ce qui affiche « Bienvenue » : nécessaire tel
  que le produit est conçu. K1 : 139 bienvenues en 2,2 jours.
- **Un changement de design attend la prochaine réécriture.** L'enregistrement de la fiche
  n'écrit rien dans `passes` et ne pousse aucun iPhone (`admin.js`, aucune occurrence) : la
  carte Apple d'un client change à son prochain scan, sa prochaine relance ou la prochaine
  campagne. Un client inactif sans relance garde l'ancien design indéfiniment. La
  précédence d'image est cohérente à chaque génération (passation §15).
- **Un prénom modifié n'est pas poussé** (`clients.js:229-233` : resynchronisation seulement
  si le solde change) ; il apparaît à la prochaine réécriture.

### 4.8 Les accès hérités de 03, vus de la carte

Décrits sans mode opératoire (décision de pilotage).

**Le parrainage n'a pas été coupé — PROUVÉ (K3, précision de pilotage du 27/09).** Les
rapports 00b (§1, §13), 02 (§4.4, §13) et 03 (§4.5) le disent coupé. Précision de Yass :
aucune coupure n'a été faite ; seule a été vérifiée l'absence de parrainage chez les vrais
marchands en production en mode points. K3 : **9 marchands** ont `referral_enabled` :

| Marchand | Mode | Cartes | Filleuls rattachés | Scans sur 30 j |
|---|---|---|---|---|
| Magic Cleaning | tampons | 157 | 1 | 138 |
| WinWin Card DEMO | tampons | 151 | 2 | 1 |
| Demo Winwin Card | tampons | 83 | 0 | 15 |
| Kasa Grill | tampons | 25 | 1 | 0 |
| Chef Kitchen, Kasa Grill Meyzieu, Nail'd It Dubai | tampons | 1 chacun | 0 | 0 |
| Pizza Sabbioni, Naan | points | 7 et 3 | 2 et 0 | 0 |

Pizza Sabbioni et Naan ne sont pas en production : l'exposition du défaut de gravité 1
(plafond du crédit en mode points, 00b constat 2) est **nulle en production**. En
tampons, Yass accepte l'incohérence rarissime (un parrain à carte pleine perd le tampon
crédité). **Côté carte** : les 419 cartes de ces 7 marchands en tampons (dont 234 chez les
deux comptes de démonstration) portent le lien de parrainage, et donc leur **numéro de
série** (03 constat 6), à chaque génération Apple (`apple-pass.js:393-397`), et leurs
objets Google le gardent depuis leur création. Le lien Google ignore `API_BASE_URL`
(`google-pass.js:259`, 00b F9).

**La désinscription sans jeton (03, constat 9) fige la carte durablement — PROUVÉ (K1) /
HYPOTHÈSE (comportement d'iOS).** Une inscription supprimée côté serveur n'est plus
poussée : la carte ne se met plus à jour, même quand le solde change. Le registre ne
montre **aucune réinscription spontanée** : 139 bienvenues, 139 paires distinctes, 0
répétition (K1). Rien n'indique qu'un iPhone se réinscrive de lui-même ; la documentation
accessible n'en dit rien. Gravité 6 ; exposition bornée par ce que 03 décrit.

**`JWT_SECRET`** : voir §6.4.

### 4.9 Le limiteur global compte aussi les iPhone qui viennent chercher leur carte

**PROUVÉ (code) / HYPOTHÈSE (adresses).** Le limiteur global (300 requêtes par 15 minutes
et par adresse, `index.js:42-47`) est monté avant le service web Apple (`index.js:102`) et
le téléchargement des cartes (`:105`). Or les adresses vues par le serveur sont, au moins
en partie, celles du proxy d'entrée de Railway (02 §4.8, HYPOTHÈSE forte ; sur les
quelques lignes du relevé du 27/09, les requêtes des iPhone viennent de deux adresses
seulement, 02 annexe A).

**Ordre de grandeur — HYPOTHÈSE (calcul).** Une campagne chez Dinapoli (220 cartes iPhone,
≈ 280 appareils à 1,27 appareil par carte) pousse tous ses appareils ; chacun demande la
liste, télécharge sa carte, et signale parfois une carte inchangée : ≈ 600 requêtes en
quelques minutes. Si elles arrivent par peu d'adresses, une partie est refusée (429) :
les cartes ne se mettent pas à jour à ce moment, et les scans passés par la même adresse
sont refusés aussi. Des refus réels : **NON VÉRIFIABLE** (journaux non relevés). Une
limite par adresse n'a pas de sens pour ce trafic (P8).

### 4.10 Deux rendus du bandeau : la carte et l'aperçu de la landing

**PROUVÉ (code).** L'aperçu de la landing n'est pas une image de la carte mais une
imitation en CSS :
- 8 pastilles, dont 3 pleines, **quel que soit le seuil** (`landing.html:423-432`) ;
- couleurs adaptées au fond avec le même seuil de contraste (0,18) que le générateur
  (`landing.html:796-843` ; `strip-generator.js`, `stampColors`), mais d'autres valeurs sur
  fond sombre : pastilles vides à 12 % et 35 % d'opacité, contre 7 % et 58 % ;
- il ignore le seuil, le mode points, les thèmes (logo, illustration, barre), les couleurs
  personnalisées des pastilles, le fond personnalisé, les images fixes et de palier. La
  route publique renvoie pourtant `max_value`, `type_programme` et `image_strip_url`
  (`merchants.js:179`). **Les 15 marchands en points montrent des pastilles** sur leur
  landing, alors que leur carte montre une barre ou rien.

La passation (§4, point 8) tenait ces pastilles pour décoratives. Tant qu'il y a deux
rendus, chaque évolution du bandeau doit être faite deux fois, ou l'aperçu dérive. L'admin,
lui, montre le vrai rendu (`admin.js:444-491`). G8.

---

## 5. Comportement : ce que coûte une carte

### 5.1 Le coût d'un geste

**PROUVÉ (code, mesures) ; volumes en HYPOTHÈSE quand indiqué.**

| Geste | Base | Extérieur | Calcul (M1, M2) | Octets |
|---|---|---|---|---|
| génération complète d'une carte Apple (réponse 200) | 3 lectures l'une après l'autre (≈ 0,6 s) | icône et logo (le logo **deux fois**), bandeau (mémoire ou stockage) | ≈ 12 ms, dont ≈ 5 ms bloquants (empreintes, zip) et ≈ 8 ms de signature dans un process à part | ≈ 100 Ko envoyés (102 907 octets relevés) |
| vérification sans changement (304) | 1 lecture | — | — | quelques centaines |
| liste « mises à jour depuis » | 1 lecture, toutes les cartes de l'appareil | — | — | — |
| mise à jour Google après un scan | — | téléchargement du hero pour tester son existence (13,4 Ko) ; mise à jour ; ajout de message | parfois un rendu (23 à 28 ms bloquants) | — |
| inscription | 1 lecture, 3 écritures | 2 à 4 appels Google, plus une authentification quand le jeton a expiré (≈ 0,9 s en médiane au total) | — | — |
| enregistrement d'un appareil | 2 écritures, puis bienvenue | 1 poussée | une génération de plus | ≈ 100 Ko |

### 5.2 Aujourd'hui, par jour

**PROUVÉ (K1) ; divisions en HYPOTHÈSE (moyennes).**

| Source | Générations complètes par jour | Autres requêtes du service web |
|---|---|---|
| scans sur carte iPhone (41,7 par jour) | ≈ 53 (1,27 appareil par carte) | ≈ 90 vérifications d'autres cartes |
| cron | ≈ 54, **dont ≈ 39 inutiles** | ≈ 53 vérifications (réécritures identiques seules ; les autres non mesurées) |
| bienvenues | ≈ 63 (installations) | — |

### 5.3 Nécessaire ?

| Comportement | Nécessaire ? |
|---|---|
| générer la carte scannée et la pousser | **oui** : c'est la mise à jour |
| régénérer une carte que le cron a réécrite à l'identique | **non** : identique, et iOS n'affiche rien (§4.1) |
| revérifier toutes les cartes de l'appareil | **non** : seule la carte modifiée devrait être listée (§4.2) |
| attendre Google à l'inscription d'un client iPhone | **non** pour lui ; oui pour un client Android, qui a besoin du lien (§4.3) |
| créer un objet Google pour chaque carte | **non** pour 64 % des cartes (iPhone) ; le signal fiable manque (pas de rappels de Google, 01 §5) |
| invalider toutes les images à chaque enregistrement de la fiche | **non** si aucun champ visuel n'a changé (§4.6) |
| une image par solde exact en barre de points | choix d'affichage ; un palier de 5 %, comme le prévoyait le commentaire, suffirait à la barre, le nombre exact restant dans le texte de la carte |
| télécharger le hero pour savoir s'il existe | **non** : un test d'existence ne demande pas le fichier |
| télécharger le logo deux fois | **non** |
| deux générations à l'installation | oui, tant que la bienvenue est voulue |

---

## 6. Projection

### 6.1 À 100 000 porteurs

**HYPOTHÈSE (calcul à ratios constants, K1 ; facteur 100 000 / 1 728 = 57,9).**

| Grandeur | Aujourd'hui | À 100 000 porteurs |
|---|---|---|
| cartes iPhone / paires appareil × carte | 1 104 / 1 401 | ≈ 63 900 / ≈ 81 100 |
| exécutions du cron par jour | ≈ 80 | ≈ 4 600, soit **≈ 1 h 30 par passage** à 1,2 s par carte (00b C6) |
| **régénérations inutiles par jour** | ≈ 39 | **≈ 2 230**, soit ≈ 230 Mo par jour, ≈ 7 Go par mois ; ≈ 12 000 requêtes à la base (lectures, listes, vérifications) ; ≈ 27 s de calcul |
| régénérations complètes par jour, toutes sources (hors installations) | ≈ 107 | ≈ 6 200, dont **36 % inutiles** |
| si la moitié du parc devient inactive sous relance (A §1) | — | **≈ 4 200 régénérations par jour, presque toutes inutiles** : 50 000 inactifs relancés tous les 8 jours (A §1), soit 6 250 relances par jour ; 53 % tombent sur une carte iPhone, à 1,28 appareil par carte (K1, 7 j) |
| scans sur carte iPhone par jour | ≈ 42 | ≈ 2 400, chacun faisant télécharger ou vérifier 3,4 cartes (plus si les appareils portent plus de cartes, §4.2) |

Ce qui compte n'est pas l'argent (quelques euros de bande passante par mois) mais **où** ce
travail tombe : dans le process qui sert les scans, pendant le passage du cron, et sur
le limiteur par adresse (§4.9).

### 6.2 Les machines (gravité 2) et l'e-commerce

**HYPOTHÈSE (projection).**
- **Chaque crédit envoyé par une borne ou une caisse suit le chemin du scan** : 1,27
  génération Apple, 2,2 vérifications, une mise à jour Google, **un message Google qui
  sonne sur Android**. En rafale, le quota de 3 notifications par carte et par 24 h est
  atteint dès le troisième crédit, et les 10 messages en quelques jours. Une API machine
  devra décider ce que la carte affiche et notifie à chaque crédit.
- **L'e-commerce crée des porteurs sans passage en caisse** : chaque création attend
  Google (§4.3), sans délai maximal. Une vague de créations empile des requêtes qui
  attendent toutes le service le plus lent ; le limiteur d'inscription (20 par heure et
  par adresse, 00b) refuserait une plateforme qui crée pour ses clients.
- Une vague de crédits réveille autant d'iPhone : c'est le cas du §4.9, à plus grande
  échelle.

### 6.3 Les cartes saisonnières (brief §3)

**PROUVÉ (code) pour le mécanisme ; HYPOTHÈSE (calcul) pour les volumes.** Le brief
supposait que, côté Google, le design vit dans la classe et que la bascule progressive ne
vaudrait que pour Apple. Le code dit autre chose :

| | Bascule « au fil des scans » (mode voulu par Yass) | Bascule « en masse » |
|---|---|---|
| **Apple** | **existe déjà de fait** : chaque carte prend le nouveau design à sa prochaine réécriture (§4.7). Un client inactif sans relance ne bascule jamais. | réécrire toutes les lignes `passes` et pousser tous les appareils : à 100 000 porteurs, **≈ 81 000 générations complètes**, ≈ 8 Go, ≈ 243 000 lectures, ≈ 16 min de calcul de signature ; à étaler (limiteur, process des scans) |
| **Google : image du bas et couleur** | **existe déjà de fait** : elles sont réécrites sur l'objet à chaque scan (`google-pass.js:442-468`) et priment sur la classe | une mise à jour par objet : **100 000 appels** (un objet par carte, §4.3) ; quotas de l'API inconnus (console Google) |
| **Google : logo, nom du programme** | impossible : ils ne vivent que dans la classe | **un appel par marchand** (enregistrement admin ou resynchronisation), immédiat pour toutes les cartes |
| **Google : dos de carte** | impossible : jamais réécrit (§4.4) | une mise à jour par objet, à ajouter au code |

Deux conditions pour l'une ou l'autre : que chaque image saisonnière ait une adresse
nouvelle (§4.4), et qu'une bascule ne ré-invalide pas toutes les images à chaque
enregistrement (§4.6).

### 6.4 La rotation de `JWT_SECRET` : ce qu'elle exigerait

Décrite, pas proposée comme correctif immédiat (consigne de pilotage).

**PROUVÉ (code).** Le jeton de chaque carte Apple est calculé à partir de `JWT_SECRET` et
du numéro de série (`apple-pass.js:24-30`), gravé dans la carte (`:326`) et vérifié à
l'enregistrement de l'appareil et au téléchargement (`apple-wallet.js:8-16`, `:30`, `:111`).
Changer le secret fait refuser toutes les cartes installées : elles gardent leur dernier
état et ne se mettent plus à jour. K1 : 1 104 cartes, 1 321 appareils.

**Ce qu'Apple impose — HYPOTHÈSE forte (extraits).** Ne pas changer le jeton dans une carte
mise à jour : rien ne garantit que chaque appareil reçoive la mise à jour, et ceux qui
gardent l'ancienne carte présentent l'ancien jeton. Un porteur ne peut pas retélécharger
sa carte lui-même : aucun lien de téléchargement ne figure sur la carte, la landing en
garde un seul dans le navigateur qui a servi à l'inscription (`landing.html:931`).

**Ce qu'une rotation exigerait, dans l'ordre :**
1. **séparer les deux usages** : un secret propre aux cartes, qui reprend la valeur
   actuelle, et un secret de sessions, que l'on peut alors changer sans toucher aux
   cartes ;
2. si le secret des cartes doit lui-même changer (fuite) : accepter les deux secrets
   pendant une longue période, faire porter le nouveau jeton par les cartes régénérées,
   mesurer quels appareils ont téléchargé depuis (aucune colonne ne le dit aujourd'hui), et
   accepter que les cartes jamais mises à jour cessent de l'être ;
3. une bascule forcée coûte une régénération de toutes les cartes (§6.3, en masse).

La valeur du jeton de carte est d'ailleurs limitée : la carte est déjà servie à qui connaît
son numéro de série par la route publique (03, constat 6).

### 6.5 Échéances et dépendances

Les dates relèvent du segment 6 ; ici, ce qui en dépend dans le périmètre. **PROUVÉ (code)
sauf mention.**

| Élément | Ce qui en dépend dans la carte | Si l'échéance passe |
|---|---|---|
| certificat Pass Type ID (juin 2027) et WWDR | **toute génération Apple**, installation comme mise à jour (`apple-pass.js:50-56`, `:260-292`) | plus d'installation ni de mise à jour valide (HYPOTHÈSE sur la réaction de l'iPhone à une signature expirée) |
| clé APNs | toutes les poussées (`apns.js`) | les cartes ne sont plus prévenues ; elles se mettent à jour à l'ouverture manuelle |
| compte de service Google | tous les appels et tous les liens « ajouter » (`google-pass.js:39-44`, `:394-408`) | plus de carte Google, et les inscriptions attendent un refus |
| domaine `app.winwin-card.com` | adresse du service web gravée dans chaque carte Apple (`apple-pass.js:325`) ; lien de parrainage Google en dur (`google-pass.js:259`) ; liens d'avis | plus aucune mise à jour Apple (00b §4.2) |
| dépôt public, branche de la vitrine | logo de secours de chaque classe Google (`google-pass.js:65`) | classes sans logo pour les marchands qui n'en ont pas |
| programme `openssl` de l'image | la signature (`apple-pass.js:290`) | plus de génération (00b §4.7) |

---

## 7. Questions transversales

### 7.1 Deux serveurs, et au redémarrage

**PROUVÉ (code).**

| État ou travail | Au redémarrage | Avec deux instances |
|---|---|---|
| cache mémoire des images (120 entrées) et verrou anti-rafale | vidés : relus au stockage | par instance : une même image rendue deux fois, sans conséquence |
| marqueur de purge par version (`strip-cache.js:79`) | vidé : la purge repasse au prochain rendu | par instance |
| jeton OAuth Google (45 min) | relu | un par instance |
| bienvenue, lancée après la réponse (`apple-wallet.js:58-60`) | perdue si l'arrêt tombe entre les deux : pas de bienvenue | — |
| resynchronisation de la classe Google après un enregistrement admin, sans attente (`admin.js:354`) | perdue : classe périmée (dette #4) | — |
| inscription coupée entre l'écriture du client et la réponse (2 à 3 s) | client et carte créés, la landing affiche une erreur ; un nouvel essai crée un **second** porteur | — |
| génération d'une carte en cours | la demande de l'iPhone échoue ; **HYPOTHÈSE** : il réessaie plus tard | sans état : n'importe quelle instance sert n'importe quel appareil |

**Une course entre deux instances** : une instance qui a lu le marchand avant un
enregistrement admin peut rendre une image de l'ancienne version juste après la purge de
l'autre ; ce fichier ne sera plus jamais purgé. Sans conséquence visible.

### 7.2 Le serveur sait faire, l'interface le demande-t-elle ?

**PROUVÉ (code).**

| Capacité serveur | Interface | État |
|---|---|---|
| resynchroniser la classe Google d'un marchand (`admin.js:676`) | aucune : console, procédure de la passation (§3.4) | dette #4, arbitrée |
| créer un objet Google à la demande (`google-wallet.js:7-41`) | aucune : la landing utilise le lien fabriqué à l'inscription | route sans appelant (§7.4 ; réemploi possible, P3) |
| renvoyer à la landing le seuil, le mode et l'image du marchand (`merchants.js:179`) | l'aperçu les ignore | §4.10 |
| effacer le seuil affiché d'un marchand | le formulaire n'envoie pas un champ vide (`admin/index.html:1450` : `parseInt(...) \|\| undefined`) | **impossible depuis l'admin** une fois posé ; G8 |
| recevoir les erreurs des iPhone (`apple-wallet.js:209-212`) | aucune : journaux Railway seulement, 7 jours | les « pass unchanged » ne se voient qu'en fouillant les journaux |
| savoir si une carte Google est installée | aucune : pas de rappels Google (01 §5) | inconnu |

### 7.3 Les changements de masse

**PROUVÉ (code) / HYPOTHÈSE (durées).**

| Changement | Ce qui se passe côté carte | Ce qui souffre |
|---|---|---|
| enregistrement de la fiche dans l'admin | toutes les images du marchand invalidées ; classe Google réécrite ; cartes Apple inchangées jusqu'à leur prochaine réécriture | des rendus bloquants au fil des scans suivants (23 à 28 ms chacun, §4.6) |
| campagne | toutes les cartes du marchand réécrites, tous ses appareils poussés (1 000 au plus) | le service web Apple et le limiteur (§4.9) ; ≈ 280 générations en quelques minutes chez Dinapoli |
| bascule saisonnière en masse | §6.3 | le process des scans, le limiteur, les quotas Google |
| rotation de `JWT_SECRET` | toutes les cartes Apple refusées | §6.4 |

### 7.4 Ponytail

**Méthode.** Commande d'audit de Ponytail (v4.10.0) : une ligne par candidat, étiquetée
`delete` (code mort, souplesse inutile), `stdlib`, `native`, `yagni` (abstraction à une
seule utilisation), `shrink` (même logique en moins de lignes), classée par taille de
coupe ; bilan en lignes. Ponytail exclut la justesse, la sécurité et la performance : elles
sont dans les constats. S'y ajoutent les règles du brief (§5) : un garde-fou n'est jamais
candidat sans protection équivalente, et une suppression ne se propose que **sur preuve**
d'usage nul. **Liste de candidats, pas feu vert** : chaque suppression serait un chantier
testé, décidé par Yass.

1. `delete:` **l'aperçu admin autonome** `public/admin/preview.html` (388 lignes, sa propre
   connexion) : aucun lien vers lui dans le dépôt ; l'admin principal montre déjà le vrai
   rendu (`admin/index.html:650`, `:1871`). **Condition** : Yass ne l'utilise pas.
2. `native:` **l'aperçu CSS de la landing** (≈ 70 lignes de CSS, 48 de script, 20 de HTML) :
   remplacé par l'image réelle du bandeau à 0, déjà générée pour la classe Google ; un
   seul rendu au lieu de deux (§4.10). ≈ −128 lignes.
3. `delete:` **le diagnostic Google de l'admin** (`admin.js:640-675`) et `getClassInfo`
   (`google-pass.js:353-364`) : aucun appelant (00b §6). ≈ −50 lignes. **Condition** :
   usage de Yass.
4. `delete:` **la route `/api/google-wallet/pass/:serial`** (`google-wallet.js`, 44 lignes,
   et son montage `index.js:56`, `:112`) : aucun appelant (00b §6). **Réserve** : c'est
   exactement le chemin « objet Google à la demande » de P3 ; à supprimer seulement si P3
   n'est pas retenue. Appel extérieur éventuel : NON VÉRIFIABLE (journaux).
5. `shrink:` **les deux chemins de génération Apple** (`passes.js:8-68`,
   `apple-wallet.js:107-167`) : une fonction commune ; ≈ −35 lignes et la fin des
   divergences du §4.7.
6. `shrink:` **trois précédences d'image et deux calculs de récompense et de couleur dans
   `google-pass.js`** (`:68-86`, `:216-316`, `:412-494`) : des fonctions communes ;
   ≈ −25 lignes, et la fin de l'incohérence de la passation (§15).
7. `stdlib:` **le calcul CRC32 écrit deux fois** (`apple-pass.js:137-147`, `:182-192`) :
   `zlib.crc32`, présent dans Node depuis 22.2 et 20.15 ; ≈ −20 lignes. **Condition** :
   borner la version de Node, aujourd'hui `>=22.0.0` (00a §7.5).
8. `delete:` **`selectStripImageUrl`** (`apple-pass.js:304-310`) : aucun appel ; la même
   logique est recopiée en `:454-463`. −8 lignes.
9. `shrink:` **six listes de colonnes du marchand recopiées** (`passes.js:30`,
   `apple-wallet.js:143`, `clients.js:25`, `clients.js:247`, `scan.js:60`, `scan.js:296`) :
   une constante ; peu de lignes, mais la fin d'une classe de divergence (§4.7).
10. `delete:` **la création du bucket avant chaque dépôt** (`strip-cache.js:136`,
    `admin.js:744`, `:849`) : le bucket existe. −3 lignes, trois appels de moins par rendu.
11. `shrink:` **le logo téléchargé deux fois** (`apple-pass.js:449-450`). −1 ligne, un
    téléchargement de moins par génération.

**Écartés** (usage prouvé ou garde-fou) : le thème illustration (Hilal Kebab, 58 cartes,
173 scans sur 30 jours, K3) ; la barre de points (12 marchands) ; l'assembleur zip maison
(aucun équivalent dans Node) ; le générateur de PNG uni (repli sans dépendance, voulu) ;
la route des journaux Apple (`/v1/log`, source des preuves du §4.1) ; `/debug/certs`
(dates des certificats, segment 6) ; la resynchronisation de toutes les classes (outil de
bascule en masse, §6.3) ; le cache mémoire et le verrou anti-rafale des images ; les
contrôles anti-SSRF du téléchargement d'images (garde-fou).

**net : environ −700 lignes (dont 388 pour l'aperçu admin), aucune dépendance npm.**

---

## 8. Seuils de rupture

Chaque seuil dans l'unité qui le provoque (brief §3).

| Ce qui casse ou coûte | Unité | Seuil | Aujourd'hui | Ce qui souffre en premier | Statut |
|---|---|---|---|---|---|
| régénérations inutiles | clients inactifs sous relance (stock) | pas de seuil dur : ≈ 0,48 régénération inutile par exécution du cron | ≈ 39 par jour | le service web Apple pendant le passage du cron | PROUVÉ (K1) / HYPOTHÈSE (projection) |
| revérifications | cartes WinWin par appareil | une requête par carte et par poussée | 29 appareils multi-cartes, 31 au plus | le service web Apple, le limiteur | PROUVÉ (K1) |
| limiteur global sur le service web Apple | requêtes d'iPhone par 15 min et par adresse | 300 | campagne Dinapoli ≈ 600 requêtes | mises à jour refusées, scans derrière la même adresse | HYPOTHÈSE (adresses) |
| inscription | appels Google par inscription | aucun délai maximal ; p90 2,4 s, max 22 s | 47 mesures | le client attend son bouton de carte | PROUVÉ (K2) |
| messages Google | événements par carte (scans, relances, campagnes) | 10 messages | probablement atteint pour des cartes anciennes | notifications Android (effet inconnu au-delà) | PROUVÉ (plafond) / NON VÉRIFIABLE (effet) |
| quota de notifications Google | notifications par carte et par 24 h | 3 (ajouts de message seulement) | — | les envois suivants, écrêtés | PROUVÉ (définition) |
| rendus d'images | soldes nouveaux (barre de points) et enregistrements admin | 23 à 28 ms bloquants par rendu (136 ms avec fond personnalisé) | ≈ 6 rendus par jour chez Dinapoli | tous les scans en cours | PROUVÉ (M2, K4) |
| bascule en masse | cartes installées | ≈ 81 000 générations Apple et 100 000 mises à jour Google à 100 000 porteurs | 1 401 paires | le process des scans, le limiteur, les quotas Google | HYPOTHÈSE (calcul) |
| rotation de `JWT_SECRET` | appareils Apple | tous | 1 321 | toutes les cartes Apple | PROUVÉ |
| stockage des images | valeurs × versions × marchands | borné par valeur (≈ 5 000 exactes par version et par marchand en barre de points) ; bucket sans plafond | 20 Mo générés, 195 fichiers anciens | l'espace de stockage | PROUVÉ (K4) |

**Ce qui casse en premier.** Rien ne casse franchement : la carte se dégrade en coût et en
fraîcheur. Le premier point dur est le **limiteur par adresse** devant le service web
Apple (§4.9), le jour où une campagne, une vague de crédits ou une bascule réveille
plusieurs centaines d'iPhone derrière peu d'adresses.

---

## 9. Propositions

Chaque proposition dit ce qu'elle retire, ce qu'elle protège, son coût et ses limites.
**Aucune n'est un correctif** : l'audit ne corrige rien, Yass décide.

**P1 — Ne pas réécrire ni pousser une carte Apple dont le texte ne change pas.** Le cron
(et la campagne) n'écrit dans `passes`, et ne pousse les iPhone, que si le nouveau texte
diffère de celui de la carte.
- *Retire* : rien de visible : iOS n'affiche déjà pas un texte identique.
- *Protège* : ≈ 71 % des régénérations provoquées par le cron (§4.1), et la charge du
  service web pendant son passage.
- *Coût* : une condition dans `notifyClient` (`cron.js:234-259`) et dans la campagne.
- *Limites* : n'arrête pas la relance sans fin, qui reste le vrai remède (plafond par
  épisode, A §1) ; ne change rien côté Google, où un message identique sonne encore
  (décision de produit, segment 1).

**P2 — Corriger ensemble la liste « mises à jour depuis » et son horodatage** (dette #11).
Filtrer vraiment les cartes (`!inner`) **et** rendre un curseur qui ne manque aucune
écriture : marge de sécurité, ou compteur toujours croissant posé par la base.
- *Retire* : rien.
- *Protège* : les 2,2 vérifications inutiles par scan (§4.2), et le limiteur.
- *Coût* : une route, peut-être une colonne.
- *Limites* : corrigé à moitié, il fait manquer des mises à jour (D-A) ; le gain
  grandit avec le nombre de cartes par appareil, faible aujourd'hui (1,06 en moyenne).

**P3 — Ne plus attendre Google à l'inscription, et ne créer l'objet Google qu'à la
demande.** L'inscription répond dès la carte écrite ; l'objet Google est créé quand le
client choisit Google (la route sans appelant fait exactement cela), et le résultat de la
création est lu.
- *Retire* : rien au client Android, si le lien est prêt quand il touche le bouton.
- *Protège* : ≈ 0,9 s (jusqu'à plus de 20 s) pour chaque client iPhone ; les objets et
  les appels Google inutiles (64 % des cartes) ; préalable de l'e-commerce.
- *Coût* : un chantier moyen (landing, inscription, route Google).
- *Limites* : les cartes existantes gardent leur objet ; l'installation effective sur
  Android reste inconnue sans rappels Google (01 §5).

**P4 — N'invalider les images que si un champ visuel a changé, et purger sans attendre un
rendu.** Comparer les valeurs avant d'avancer `strip_config_version` ; ajouter le seuil
affiché aux champs visuels ; purger les anciennes versions indépendamment ; tester
l'existence d'une image sans la télécharger.
- *Retire* : rien.
- *Protège* : des rendus bloquants (§4.6), la croissance du stockage, les adresses d'images
  purgées sous les objets Google.
- *Coût* : petit.
- *Limites* : la barre de points garde un rendu par solde tant que ce choix d'affichage
  tient ; le passer à des paliers de 5 % est une décision d'apparence.

**P5 — Tenir la carte Google à jour au-delà du solde.** À chaque mise à jour : réécrire le
dos de carte, effacer l'image quand plus aucune ne s'applique, borner les messages (date
de fin, ou nombre gardé).
- *Retire* : rien.
- *Protège* : la cohérence de la carte Google (§4.4), le plafond des 10 messages (§4.5).
- *Coût* : un chantier ; chaque comportement de l'API est à vérifier d'abord sur le
  marchand cobaye (effacement d'image, remplacement des modules).
- *Limites* : l'arbitrage de juillet (dette #4 : ne pas multiplier les appels à Google)
  pèse ici ; aucun appel supplémentaire n'est nécessaire, le PATCH existant peut porter
  ces champs.

**P6 — Un seul rendu du bandeau : l'image réelle dans la landing.** La route publique
renvoie l'adresse de l'image du bandeau à 0 (ou de l'image fixe), la landing l'affiche.
- *Retire* : l'animation CSS de l'aperçu, si Yass y tient.
- *Protège* : la synchronisation des deux rendus (§4.10) ; les marchands en points ne
  montrent plus de pastilles.
- *Coût* : petit.
- *Limites* : l'image doit exister ; elle l'est déjà pour la classe Google des marchands
  à image générée.

**P7 — Séparer le secret des cartes Apple de celui des sessions** (préalable du §6.4).
- *Retire* : rien.
- *Protège* : rend possible la rotation du secret des sessions (03, P3) sans casser les
  cartes installées.
- *Coût* : une variable d'environnement et deux lignes ; le secret des cartes reprend la
  valeur actuelle.
- *Limites* : ne renforce pas le secret des cartes lui-même ; si celui-ci a fui, il faut
  la procédure longue du §6.4.

**P8 — Une limite propre au service web Apple.** Sortir les routes `/v1/…` et le
téléchargement des cartes du limiteur global par adresse, et les limiter par appareil ou
par carte.
- *Retire* : rien.
- *Protège* : les mises à jour de cartes en rafale (campagne, vague de crédits, bascule),
  et les scans qui partagent l'adresse.
- *Coût* : petit.
- *Limites* : dépend de la vraie adresse des clients (proxy de Railway, 02 §4.8, segment 6).

---

## 10. Corrections et compléments aux rapports antérieurs

Ces rapports ne sont pas modifiés ; la correction est consignée ici.

| Rapport | Ce qu'il disait | Ce qui est établi | Statut |
|---|---|---|---|
| 01 §3 (cause C) ; passation §15 quater | le filtre « mises à jour depuis » serait inerte (HYPOTHÈSE forte) | inerte : documentation de PostgREST et code de la bibliothèque (§4.2) | PROUVÉ |
| A §5.2 ; passation §15 sexies | si les mises à jour d'objet notifient, un scan consomme deux unités du quota Google | les mises à jour ne notifient jamais : `notifyPreference` n'est pas posé, et la définition officielle exige de le poser à chaque requête (§4.5) ; un scan consomme une unité | PROUVÉ |
| 02 §5.2 | le lien Google réécrit à chaque appel de la route qui le génère fait régénérer des cartes | la route n'a aucun appelant (00b §6) ; la source mesurée est le cron (§4.1) | PROUVÉ |
| 00b §1 (constat 2), §13 ; 02 §4.4, §13 ; 03 §4.5 | parrainage coupé le 27/09 | aucune coupure ; vérification seulement, chez les vrais marchands en production en mode points (précision de Yass) ; 9 marchands l'ont, dont Pizza Sabbioni et Naan en points, hors production (§4.8) | PROUVÉ (K3) |
| 00b §12 (angle mort) | plafond de messages par objet Google non vérifié | 10 au plus (définition officielle) ; au-delà, NON VÉRIFIABLE (§4.5, K5) | PROUVÉ / NON VÉRIFIABLE |
| 00b §12 (angle mort) | durée du rendu synchrone des images non mesurée | 23 à 28 ms bloquants, 136 ms avec fond personnalisé (M2) | PROUVÉ (ordre de grandeur) |
| 00b §6 ; 02 §5.2 | téléchargement complet d'une image pour tester son existence | confirmé ; 13,4 Ko en moyenne par mise à jour Google (K4) | PROUVÉ |
| commentaire de `strip-cache.js:34-37` | une image par palier de 5 %, 21 au plus | une image par solde exact (§4.6) | PROUVÉ |

---

## 11. Ce que ce segment transmet

| Segment | À instruire |
|---|---|
| **Synthèse** | pas de gravité 1 ni 2 ici ; P1 avec le plafond de relance par épisode (A §1) ; **P7 avant toute rotation de `JWT_SECRET`** (verrouillage post-audit) ; **P2 : liste et horodatage ensemble, jamais séparément** ; **P3 avant l'e-commerce** ; la réponse à l'hypothèse des cartes saisonnières (§6.3) ; ce que devra afficher et notifier une carte à chaque crédit machine (§6.2) ; la correction du statut du parrainage (§10) |
| 1 — notifications | 76 % des exécutions du cron réécrivent un texte identique (K1) ; chacune ajoute aussi un message à la carte Google, dans la limite de 10 : **K5** trancherait l'effet ; les mises à jour d'objet ne consomment pas le quota Google ; aucun message n'a de date de fin |
| 2 — scan et crédit | chaque scan sur carte iPhone fait télécharger ou vérifier 3,4 cartes (K1) ; les rendus d'images bloquent le process des scans (23 à 28 ms, 136 ms avec fond personnalisé) ; deux mises à jour Google rapprochées peuvent arriver dans le désordre |
| 3 — accès et données | parrainage non coupé : 9 marchands, numéro de série sur leurs cartes (§4.8) ; aucune réinscription spontanée observée : la désinscription sans jeton fige la carte durablement ; la rotation de `JWT_SECRET` exige P7 d'abord |
| 5 — statistiques | aucune mesure possible des cartes installées sur Android (pas de rappels Google) : un lien Google pour chaque carte (1 691 sur 1 691 le 26/09, 00b C3), sans preuve que l'objet existe ni qu'il soit installé (§4.3) |
| 6 — infrastructure | calendrier : certificat Pass Type ID (juin 2027) et le reste du §6.5 ; limiteur et adresses du proxy devant le service web Apple (§4.9, P8) ; stockage : 195 fichiers d'anciennes versions, aucun plafond ; bande passante à 100 000 porteurs (≈ 7 Go par mois de cartes régénérées pour rien, plus les images lues au stockage) ; version basse de Node si `zlib.crc32` est retenu ; quotas de l'API Google (console) ; version de PostgREST déployée ; refonte Google Wallet 2026 (rendu du bandeau 3:1) |

---

## 12. Hypothèses et angles morts

| Point | Statut | Comment trancher |
|---|---|---|
| comportement de Google au-delà de 10 messages par carte | NON VÉRIFIABLE (documentation muette) | **K5** (suivi, facultative) |
| fréquence des mises à jour Google arrivées dans le désordre | NON VÉRIFIABLE | le registre n'associe pas une mise à jour à son scan |
| affichage d'une image hero périmée ou purgée sur Google | HYPOTHÈSE (cache d'images de Google) | observation d'une carte Google du marchand cobaye |
| priorité de la couleur de l'objet sur celle de la classe | HYPOTHÈSE forte (commentaire du code ; prouvé pour l'image par la définition officielle) | observation |
| cause de l'étalon de 500 ms à l'inscription (200 ms sur un scan) | HYPOTHÈSE (connexion à rouvrir) | journaux HTTP avec durées (segment 6) |
| 3 inscriptions entre 10 et 30 s : Google lent ou réécriture non tracée | HYPOTHÈSE | registre sur une plus longue durée |
| échec d'ajout côté client quand l'objet Google n'a pas été créé | HYPOTHÈSE | aucune trace : le statut n'est pas lu |
| réinscription spontanée d'un iPhone après suppression côté serveur | NON VÉRIFIABLE (documentation accessible muette ; 0 observée en 2,2 jours) | registre sur une plus longue durée |
| 1,27 appareil par carte : Apple Watch ou inscriptions périmées | HYPOTHÈSE | statuts 410 au registre (segment 1) |
| appels extérieurs à la route Google sans appelant | NON VÉRIFIABLE (journaux non relevés) | journaux Railway |
| refus 429 sur le service web Apple | NON VÉRIFIABLE (journaux non relevés) | journaux Railway ; adresses réelles (segment 6) |
| rendu des bandeaux 3:1 dans la refonte Google 2026 | HYPOTHÈSE (extraits) | observation sur un téléphone Android à jour |
| réaction de l'iPhone à une carte signée par un certificat expiré | HYPOTHÈSE | segment 6 |
| durées M1 et M2 en production | ordre de grandeur (autre machine ; polices non installées pour M2 : +7 ms au plus) | mesure sur Railway |
| fonds personnalisés (136 ms de rendu) en production | non relevé | une colonne de plus à K3 |
| projections à 100 000 porteurs | HYPOTHÈSE (ratios constants) | — |

---

## 13. Décisions de pilotage et décisions hors pilotage

Sur instruction de Yass, ce segment ne modifie pas `PASSATION_TECHNIQUE.md` : ce qui est
livré, les décisions et la dette découverte sont consignés ici.

**Livré** : ce rapport ; `docs/audit/04-requetes.sql` (K1 à K4, exécutées ; K5, suivi
facultatif non exécuté). Aucun code modifié, aucune migration, aucune carte générée ni
envoyée en production.
**Dette découverte** : §1, §4, §7.

**Décisions de pilotage**

| Date | Décision | Où elle joue |
|---|---|---|
| 27/09 | Plan validé ; périmètre compris : réglages de carte de l'admin et aperçu de la landing, sous l'angle carte | en-tête, §4.6, §4.10 |
| 27/09 | M2 accordé : `@resvg/resvg-js` 2.6.2 et `sharp` 0.33.5 installés hors du dépôt, sans modification de `package.json` ni du lockfile, rendus sur configurations fictives seulement, rien envoyé ; machine de mesure différente de la production | §4.6, annexe B |
| 27/09 | R1 (journaux Railway) NON VÉRIFIABLE d'office ; K1 sert de base au chiffrage | §4.1, §6.1, §12 |
| 27/09 | R2 (test sur un iPhone) refusé ; la documentation de PostgREST a tranché la cause C | §4.2 |
| 27/09 | K1 à K4 : comptages et métadonnées seulement, noms de marchands acceptés, aucune donnée client, aucun numéro de série, aucune adresse d'image ; testées ; moins de 100 lignes ; envoyées d'un coup | `04-requetes.sql` |
| 27/09 | Les constats d'accès sont décrits sans mode opératoire, comme en 03 | §4.8, §4.9 |
| 27/09 | Alerte de gravité 1 levée : **le parrainage n'a pas été coupé** ; Yass avait seulement vérifié que les vrais marchands en production en mode points ne l'ont pas ; Pizza Sabbioni et Naan ne sont pas en production ; l'incohérence rarissime en tampons (parrain à carte pleine) est acceptée | §4.8, §10 |
| 27/09 | Rapport écrit après les résultats de K1 à K4 ; commit et push sur feu vert, hors du passage de 08:00 UTC | — |

**Décisions hors pilotage** (prises par la session d'audit) :
- **installation de M2** : les deux bibliothèques autorisées ont été installées dans le
  répertoire de travail de la session (`npm install --no-save --ignore-scripts`), hors du
  dépôt ; les polices `@fontsource` du générateur, non couvertes par l'autorisation, n'ont
  **pas** été installées : le texte du bandeau n'est pas dessiné dans M2, et le surcoût des
  polices a été borné à part (+7 ms au plus, avec des polices système vingt fois plus
  lourdes) ;
- **M1** : la signature a été mesurée sur une copie fidèle des fonctions du dépôt, avec des
  certificats jetables générés dans le conteneur ; aucun module de l'application n'a été
  chargé ;
- la **documentation de Google** a été lue dans la bibliothèque officielle générée par
  Google (GitHub), celle de **PostgREST** dans son dépôt ; les autres sources par extraits
  de moteur de recherche, marqués HYPOTHÈSE forte ; une vérification de l'état du proxy du
  conteneur a été refusée par l'environnement et n'a pas été poursuivie ;
- **K1 et K3 ont été complétées avant envoi** (trois lignes d'activité, deux colonnes), pour
  éviter un second relevé ; **K5** a été ajoutée après lecture des résultats, facultative,
  testée comme les autres ;
- la démonstration **D-A** a été faite sur la base rejouée, jamais en production ;
- le crochet de fin de session du dépôt a demandé un commit et un push du fichier de
  requêtes : refusé, conformément à la consigne de pilotage (feu vert d'abord).

---

## Annexe A — Résultats bruts (production, 27/09)

**K1** — parc et cron (« — » : sans objet).

| Section | Rubrique | Total | inactive | near_reward | birthday |
|---|---|---|---|---|---|
| parc | cartes actives (clients non effacés) | 1 728 | — | — | — |
| parc | cartes présentes sur au moins un iPhone | 1 104 | — | — | — |
| parc | appareils iPhone | 1 321 | — | — | — |
| parc | paires appareil × carte | 1 401 | — | — | — |
| parc | appareils portant plusieurs cartes | 29 | — | — | — |
| parc | cartes au plus sur un même appareil | 31 | — | — | — |
| parc | scans des 30 derniers jours (annulés compris) | 1 686 | — | — | — |
| parc | dont scans sur une carte iPhone | 1 251 | — | — | — |
| parc | cartes revérifiées par les appareils de ces scans | 4 286 | — | — | — |
| parc | plus ancienne exécution du cron conservée | 2026-07-28 | — | — | — |
| cron, 62 j | exécutions | 2 956 | 2 837 | 118 | 1 |
| cron, 62 j | dont réécriture à l'identique | 1 919 | 1 874 | 45 | 0 |
| cron, 62 j | dont identiques sur une carte iPhone | 903 | 871 | 32 | 0 |
| cron, 62 j | poussées Apple provoquées par les identiques | 1 280 | 1 240 | 40 | 0 |
| cron, 62 j | cartes revérifiées par ces appareils | 2 894 | 2 650 | 244 | 0 |
| cron, 62 j | exécutions sur une carte iPhone | 1 535 | 1 442 | 92 | 1 |
| cron, 62 j | jours avec au moins une exécution | 62 | 62 | 33 | 1 |
| cron, 7 j | exécutions | 558 | 525 | 33 | 0 |
| cron, 7 j | dont réécriture à l'identique | 424 | 409 | 15 | 0 |
| cron, 7 j | dont identiques sur une carte iPhone | 211 | 202 | 9 | 0 |
| cron, 7 j | poussées Apple provoquées par les identiques | 270 | 259 | 11 | 0 |
| cron, 7 j | cartes revérifiées par ces appareils | 642 | 571 | 71 | 0 |
| cron, 7 j | exécutions sur une carte iPhone | 296 | 273 | 23 | 0 |
| cron, 7 j | jours avec au moins une exécution | 7 | 7 | 7 | 0 |
| campagnes | campagnes manuelles enregistrées | 51 | — | — | — |
| campagnes | dont texte identique à la précédente du même marchand | 1 | — | — | — |
| campagnes | appareils poussés par ces campagnes identiques | 1 | — | — | — |
| bienvenues | registre tenu depuis | 2026-09-25 | — | — | — |
| bienvenues | bienvenues Apple envoyées | 139 | — | — | — |
| bienvenues | paires carte × appareil distinctes | 139 | — | — | — |
| bienvenues | réinscriptions | 0 | — | — | — |

**K2** — attente de Google à l'inscription : 1 728 cartes au total, 47 retenues ; carte →
lien Google : médiane 1 381 ms, p90 2 441, max 22 004 ; client → carte : 500, 551, 572 ;
tranches : moins de 0,5 s : 0 · 0,5 à 1 s : 8 · 1 à 2 s : 33 · 2 à 3 s : 2 · 3 à 5 s : 0 ·
5 à 10 s : 1 · 10 à 30 s : 3 ; inscriptions des 30 derniers jours (34) : carte → lien
Google 1 280, 1 924, 10 741 ; client → carte 504, 549, 572.

**K3** — configuration des cartes, marchand par marchand (48 lignes). Colonnes : actif ·
forfait · programme · seuil · seuil affiché (s'il diffère) · bandeau · thème · paliers ·
image fixe · hero Google · fond de récompense · lien d'avis · parrainage · filleuls
rattachés · version des images · relance · boost · cartes · cartes iPhone · cartes créées
avant le 27/09 · cartes iPhone non réécrites depuis le 27/09 · cartes créées sur 30 j ·
scans sur 30 j. (o = oui, n = non.)

| Marchand | act. | forfait | prog. | seuil | aff. | bandeau | thème | pal. | fixe | heroG | fond | avis | parr. | fil. | vers. | rel. | boost | cartes | iPh. | av. 27/09 | iPh. anc. | 30 j | scans |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Dinapoli | o | pro_plus | points | 200 | — | points_bar | icon_metier | 0 | n | n | n | n | n | 0 | 4 | o | o | 283 | 220 | 267 | 205 | 283 | 285 |
| Boucherie République | o | pro_plus | points | 200 | — | points_bar | icon_metier | 0 | n | n | n | n | n | 0 | 6 | o | o | 231 | 138 | 231 | 137 | 231 | 256 |
| Pizz'Amore | o | pro_plus | points | 200 | — | points_bar | icon_metier | 0 | n | n | n | n | n | 0 | 26 | o | o | 224 | 121 | 218 | 102 | 223 | 339 |
| Magic Cleaning | o | pro_plus | stamps | 6 | — | — | icon_metier | 7 | n | n | o | n | o | 1 | 78 | o | o | 157 | 129 | 155 | 110 | 55 | 138 |
| WinWin Card DEMO | o | pro_plus | stamps | 10 | — | stamps | icon_metier | 0 | n | n | o | n | o | 2 | 19 | o | n | 151 | 49 | 151 | 48 | 2 | 1 |
| Wam N Fade | o | pro_plus | points | 2000 | — | points_bar | icon_metier | 0 | n | n | o | n | n | 0 | 11 | o | o | 115 | 91 | 115 | 83 | 30 | 113 |
| Demo Winwin Card | o | pro_plus | stamps | 10 | — | stamps | icon_metier | 0 | n | n | n | n | o | 0 | 9 | o | n | 83 | 37 | 83 | 32 | 29 | 15 |
| Nails By Ness | o | pro_plus | stamps | 4 | 5 | stamps | icon_metier | 0 | n | n | n | n | n | 0 | 11 | n | n | 72 | 52 | 72 | 52 | 72 | 138 |
| La Passerelle Indienne | o | pro_plus | stamps | 10 | — | stamps | icon_metier | 0 | n | n | o | n | n | 0 | 5 | n | n | 68 | 41 | 68 | 41 | 38 | 31 |
| Hilal Kebab | o | pro_plus | stamps | 11 | — | stamps | illustration | 0 | n | n | n | n | n | 0 | 10 | o | o | 58 | 38 | 54 | 31 | 58 | 173 |
| Asie Express | o | pro | points | 200 | — | points_bar | icon_metier | 0 | n | n | n | n | n | 0 | 4 | n | n | 53 | 36 | 51 | 33 | 53 | 42 |
| Bluemoon Boston | o | pro | stamps | 10 | — | — | icon_metier | 11 | n | n | o | n | n | 0 | 10 | n | n | 42 | 29 | 42 | 27 | 4 | 24 |
| L'IWAN | o | pro_plus | stamps | 5 | — | stamps | icon_metier | 0 | n | n | n | n | n | 0 | 20 | o | o | 31 | 20 | 27 | 16 | 31 | 41 |
| Kasa Grill | o | pro_plus | stamps | 10 | — | — | icon_metier | 10 | o | o | o | n | o | 1 | 2 | n | n | 25 | 1 | 25 | 1 | 0 | 0 |
| Crep' & Coffee | o | pro_plus | points | 100 | — | points_bar | icon_metier | 0 | n | n | n | n | n | 0 | 10 | n | n | 24 | 22 | 23 | 21 | 24 | 16 |
| Shop By Ness | o | pro_plus | points | 250 | — | points_bar | icon_metier | 0 | n | n | n | n | n | 0 | 4 | n | n | 19 | 18 | 19 | 18 | 19 | 18 |
| Bangkok Factory | o | pro_plus | points | 100 | — | points_bar | icon_metier | 0 | n | n | n | n | n | 0 | 5 | n | n | 15 | 10 | 15 | 10 | 15 | 7 |
| Maybach | o | pro_plus | stamps | 10 | — | stamps | icon_metier | 0 | n | n | n | n | n | 0 | 3 | n | n | 11 | 9 | 9 | 8 | 11 | 14 |
| NARA | o | pro_plus | stamps | 9 | — | stamps | icon_metier | 10 | n | n | n | n | n | 0 | 20 | o | o | 8 | 5 | 8 | 4 | 8 | 11 |
| Shawerman | o | pro_plus | stamps | 9 | — | stamps | icon_metier | 10 | n | n | n | n | n | 0 | 29 | o | o | 8 | 4 | 8 | 3 | 8 | 0 |
| Pizza Sabbioni | o | pro_plus | points | 500 | — | stamps | icon_metier | 0 | n | n | o | n | o | 2 | 5 | n | n | 7 | 4 | 7 | 4 | 0 | 0 |
| Central Coffee | o | pro_plus | stamps | 10 | — | stamps | icon_metier | 0 | n | n | n | n | n | 0 | 5 | n | n | 4 | 2 | 4 | 2 | 0 | 0 |
| Nina Salon | o | pro | stamps | 10 | — | stamps | icon_metier | 0 | n | n | n | n | n | 0 | 4 | n | n | 4 | 3 | 4 | 3 | 0 | 0 |
| Carbon Gaming | o | pro | stamps | 10 | — | stamps | icon_metier | 0 | n | n | n | n | n | 0 | 2 | n | n | 3 | 1 | 3 | 1 | 0 | 0 |
| Le Grand Buffet Indien | o | pro_plus | stamps | 10 | — | stamps | icon_metier | 0 | n | n | o | n | n | 0 | 15 | o | o | 3 | 3 | 3 | 3 | 3 | 2 |
| MK Barbershop | o | pro_plus | stamps | 9 | — | stamps | icon_metier | 0 | n | n | o | n | n | 0 | 12 | o | o | 3 | 2 | 3 | 2 | 0 | 0 |
| Naan | o | pro_plus | points | 100 | — | points_bar | icon_metier | 0 | n | n | n | n | o | 0 | 10 | n | n | 3 | 3 | 3 | 3 | 0 | 0 |
| Absolute Zero | o | pro | stamps | 6 | — | stamps | icon_metier | 0 | n | n | n | n | n | 0 | 5 | n | n | 2 | 2 | 2 | 2 | 0 | 0 |
| Cairo Gourmet | o | pro_plus | stamps | 10 | — | stamps | icon_metier | 3 | n | n | n | n | n | 0 | 5 | o | n | 2 | 2 | 2 | 2 | 0 | 0 |
| Isabella's Italian Street Kitchen | o | pro | stamps | 10 | — | stamps | icon_metier | 0 | n | n | n | n | n | 0 | 4 | n | n | 2 | 1 | 2 | 1 | 0 | 0 |
| LDC Kitchen + Coffee | **n** | pro | stamps | 9 | 10 | stamps | icon_metier | 0 | n | n | n | n | n | 0 | 16 | n | n | 2 | 2 | 2 | 2 | 0 | 4 |
| MK Café | o | pro_plus | stamps | 5 | — | stamps | icon_metier | 6 | n | n | o | n | n | 0 | 14 | o | o | 2 | 1 | 2 | 1 | 0 | 0 |
| Bella | o | pro | stamps | 10 | — | — | icon_metier | 0 | o | n | n | n | n | 0 | 1 | n | n | 1 | 1 | 1 | 1 | 0 | 0 |
| Chef Kitchen | o | pro | stamps | 10 | — | stamps | icon_metier | 0 | n | n | n | n | o | 0 | 3 | n | n | 1 | 0 | 1 | 0 | 0 | 0 |
| Démo France | o | pro_plus | points | 100 | — | points_bar | icon_metier | 0 | n | n | n | n | n | 0 | 6 | o | n | 1 | 0 | 1 | 0 | 1 | 0 |
| Hamza Salon | o | pro | stamps | 9 | — | stamps | icon_metier | 0 | n | n | n | o | n | 0 | 6 | n | n | 1 | 1 | 1 | 1 | 0 | 18 |
| Kasa Grill Meyzieu | o | pro | stamps | 10 | — | stamps | icon_metier | 0 | n | n | n | n | o | 0 | 5 | n | n | 1 | 1 | 1 | 1 | 0 | 0 |
| Kerwen flowers | o | pro | stamps | 6 | — | — | icon_metier | 7 | n | n | o | n | n | 0 | 8 | n | n | 1 | 1 | 1 | 1 | 0 | 0 |
| La Mezcaleria | o | pro | stamps | 10 | — | stamps | icon_metier | 0 | n | n | n | n | n | 0 | 8 | n | n | 1 | 1 | 1 | 1 | 0 | 0 |
| Naan Sweet | o | pro_plus | stamps | 10 | — | stamps | icon_metier | 0 | n | n | n | n | n | 0 | 6 | n | n | 1 | 0 | 1 | 0 | 0 | 0 |
| Nail'd It Dubai | o | pro_plus | stamps | 10 | — | stamps | icon_metier | 2 | n | n | n | n | o | 0 | 4 | o | n | 1 | 1 | 1 | 1 | 0 | 0 |
| Ray Test | o | pro_plus | points | 1000 | — | — | icon_metier | 0 | n | n | n | n | n | 0 | 2 | n | n | 1 | 0 | 1 | 0 | 0 | 0 |
| Spa Salon | o | pro | stamps | 7 | — | — | icon_metier | 2 | n | n | n | n | n | 0 | 5 | n | n | 1 | 1 | 1 | 1 | 0 | 0 |
| Teatro | o | pro | points | 2000 | — | — | icon_metier | 7 | n | n | n | n | n | 0 | 6 | n | n | 1 | 0 | 1 | 0 | 0 | 0 |
| Uncle Thai | o | pro_plus | points | 200 | — | points_bar | icon_metier | 0 | n | n | n | n | n | 0 | 6 | o | o | 1 | 1 | 1 | 1 | 1 | 0 |
| Franchise Test | o | pro_plus | stamps | 10 | — | — | icon_metier | 0 | n | n | n | n | n | 0 | 2 | n | n | 0 | 0 | 0 | 0 | 0 | 0 |
| Maison Maya | o | pro | points | 100 | — | points_bar | icon_metier | 0 | n | n | n | n | n | 0 | 3 | n | n | 0 | 0 | 0 | 0 | 0 | 0 |
| TAM-TAM | o | pro_plus | stamps | 10 | — | stamps | icon_metier | 0 | n | n | n | n | n | 0 | 7 | n | n | 0 | 0 | 0 | 0 | 0 | 0 |

**K4** — images dans le stockage (bucket `passes`).

| Section | Clé | Fichiers | Mo | Ko moyen | Ko max | Versions | Valeurs | Anciens | Plus ancien |
|---|---|---|---|---|---|---|---|---|---|
| par catégorie | autre fichier | 202 | 7,24 | 36,7 | 474,8 | | | | 2026-06-03 |
| par catégorie | image générée | 1 782 | 20,01 | 11,5 | 66,8 | | | | 2026-06-16 |
| par catégorie | image par palier (déposée) | 75 | 3,95 | 53,9 | 110,6 | | | | 2026-06-02 |
| générées : version ancienne | hero / strip2x / strip3x | 5 / 95 / 95 | 0,09 / 0,71 / 1,29 | 18,6 / 7,7 / 13,9 | 20,9 / 10,2 / 18,7 | | | | 2026-06-19 |
| générées : version courante | hero / strip2x / strip3x | 529 / 529 / 529 | 6,91 / 4,19 / 6,81 | 13,4 / 8,1 / 13,2 | 66,8 / 24,0 / 65,3 | | | | 2026-06-16 |

Par marchand (fichiers générés · Mo · versions présentes · valeurs rendues dans la version
courante · fichiers d'anciennes versions · plus ancien) : Dinapoli 318 · 3,17 · 1 · 106 ·
0 · 10/09 ; Pizz'Amore 306 · 2,97 · 1 · 102 · 0 · 10/09 ; Boucherie République 261 ·
2,58 · 1 · 87 · 0 · 10/09 ; Wam N Fade 174 · 1,78 · 1 · 58 · 0 · 21/09 ; **Magic Cleaning
97 · 1,02 · 41 · 0 · 97 · 15/07** ; Asie Express 87 · 0,82 · 1 · 29 · 0 · 14/09 ; Shop By
Ness 57 · 0,56 · 1 · 19 · 0 · 21/09 ; MK Barbershop 43 · 0,54 · 11 · 5 · 28 · 24/07 ;
Crep' & Coffee 42 · 0,40 · 1 · 14 · 0 · 11/09 ; Hilal Kebab 36 · 1,58 · 1 · 12 · 0 ·
17/09 ; MK Café 31 · 0,28 · 13 · 1 · 28 · 24/07 ; Bangkok Factory 30 · 0,27 · 1 · 10 · 0
· 08/09 ; Maybach 27 · 0,45 · 1 · 9 · 0 · 11/09 ; Naan 27 · 0,25 · 1 · 9 · 0 · 26/08 ;
Demo Winwin Card 21 · 0,34 · 1 · 7 · 0 · 06/07 ; L'IWAN 18 · 0,22 · 1 · 6 · 0 · 15/09 ; La
Mezcaleria 18 · 0,21 · 7 · 2 · 12 · 23/07 ; LDC Kitchen + Coffee 18 · 0,27 · 1 · 6 · 0 ·
23/09 ; WinWin Card DEMO 18 · 0,28 · 1 · 6 · 0 · 16/06 ; La Passerelle Indienne 15 · 0,22
· 1 · 5 · 0 · 18/08 ; Nails By Ness 15 · 0,19 · 1 · 5 · 0 · 23/09 ; Pizza Sabbioni 12 ·
0,17 · 1 · 0 · 12 · 19/06 ; Uncle Thai 12 · 0,12 · 1 · 4 · 0 · 15/09 ; Kasa Grill Meyzieu
11 · 0,17 · 2 · 3 · 2 · 06/07 ; Nina Salon 10 · 0,12 · 3 · 2 · 4 · 24/07 ; Carbon Gaming
9 · 0,14 · 1 · 3 · 0 · 03/07 ; Hamza Salon 9 · 0,12 · 1 · 3 · 0 · 26/09 ; Central Coffee
7 · 0,09 · 2 · 1 · 4 · 24/06 ; Isabella's Italian Street Kitchen 7 · 0,09 · 3 · 1 · 4 ·
15/07 ; Nail'd It Dubai 7 · 0,09 · 3 · 1 · 4 · 08/07 ; Absolute Zero 6 · 0,08 · 1 · 2 · 0
· 04/07 ; Cairo Gourmet 6 · 0,10 · 1 · 2 · 0 · 18/07 ; Chef Kitchen 6 · 0,10 · 1 · 2 · 0 ·
24/06 ; Démo France, Le Grand Buffet Indien, Maison Maya, Naan Sweet, NARA, Shawerman,
TAM-TAM : 3 fichiers chacun, 1 valeur, 0 ancien.

## Annexe B — Démonstration et mesures

**D-A — Une mise à jour jamais listée** (base rejouée, deux sessions). Session 1 : ouverture
d'une transaction à 17:59:40.512, écriture de la carte, attente de 2 s, validation à
17:59:42.519 ; `updated_at` posé : 17:59:40.511. Session 2, pendant ce temps : liste « mises
à jour depuis », curseur rendu 17:59:41.523. Après la validation, filtre
`updated_at > curseur` : **0 carte**. La mise à jour n'est jamais listée.

**M1 — Générer une carte Apple, hors réseau** (conteneur : 4 vCPU Intel Xeon 2,1 GHz,
Node 22.22.2, OpenSSL 3.0.13). Copie fidèle de `signManifest`, `createZip` et du manifeste
(`apple-pass.js:180-292`, `:509-533`), certificats RSA 2048 jetables, clé chiffrée par
phrase de passe comme en production ; neuf fichiers fictifs aux tailles d'une vraie
carte ; 40 générations.
- génération complète (empreintes, quatre écritures, `openssl`, lecture, effacement,
  zip de 105 Ko) : médiane **12,0 ms**, p90 14,8 ms ;
- dont calcul synchrone dans Node (empreintes, CRC du zip en JavaScript) : médiane 5,0 ms ;
- `openssl` seul : 40 signatures en 0,33 s, soit ≈ 8 ms de calcul chacune, dans un
  process séparé.

**M2 — Rendre un bandeau** (même machine ; `@resvg/resvg-js` 2.6.2 et `sharp` 0.33.5,
installés hors du dépôt ; générateur du dépôt chargé tel quel ; polices non installées).

| Marchand fictif | Rendu complet (3 images), médiane | Plus long blocage de la boucle, médiane | Poids des 3 images |
|---|---|---|---|
| tampons, `icon_metier`, seuil 10 | 47,5 ms (p90 62,2) | **28,3 ms** | 40 Ko |
| tampons, `icon_metier`, seuil 20 | 51,4 ms | — | 51 Ko |
| tampons, `logo_stamp` | 59,1 ms | **26,7 ms** | 31 Ko |
| tampons, `illustration` | 38,2 ms | — | 94 Ko |
| points, barre, seuil 500 | 43,1 ms | **23,0 ms** | 7 Ko |
| tampons, fond personnalisé (Pro+) | 149,8 ms | **136,3 ms** | 40 Ko |

Surcoût des polices, borné à part : trois rastérisations du même bandeau passent de 18,3 à
25,3 ms avec quatre polices système de 4,2 Mo au total (les polices réelles pèsent
environ vingt fois moins).

## Annexe C — Commandes reproductibles

```bash
# Le code audité est celui de la production
git diff --stat ca0579a 2d5840a -- winwincard/                       # vide

# Les écrivains de passes et les textes constants du cron
grep -rnE "from\('passes'\)" winwincard/backend/src
sed -n 60,70p winwincard/backend/src/workers/cron.js
sed -n 125,135p winwincard/backend/src/workers/cron.js

# Aucune demande de notification sur les mises à jour Google
grep -rn "notifyPreference" winwincard/backend/src                   # rien

# Le filtre embarqué tel que transmis (bibliothèque figée, sans installation)
npm pack @supabase/postgrest-js@2.107.0 --ignore-scripts
tar xzf supabase-postgrest-js-2.107.0.tgz && sed -n 1507,1510p package/dist/index.cjs

# Invalidation des images à chaque enregistrement
sed -n 229,239p winwincard/backend/src/routes/admin.js
sed -n 332,336p winwincard/backend/src/routes/admin.js

# Date de la réécriture de la purge
git log --format='%h %ad %s' --date=short -S"RÉÉCRITE" -- winwincard/backend/src/services/strip-cache.js
```

Base de référence : méthode de 00a (annexe B), plus les droits `service_role` des 7 tables
et une maquette de `storage.objects` ; requêtes : `docs/audit/04-requetes.sql`. Les scripts
de M1 et M2 ne sont pas versés au dépôt (travail de session) ; leur méthode est décrite en
annexe B.

## Annexe D — Sources extérieures

| Source | Version, lieu | Ce qui y est lu |
|---|---|---|
| Bibliothèque Go officielle de l'API Google Wallet | `googleapis/google-api-go-client`, `walletobjects/v1/walletobjects-gen.go`, branche principale au 27/09/2026 (générée depuis le descriptif de l'API) | `LoyaltyObject.notifyPreference` (éphémère, à poser à chaque requête ; aucune notification par défaut) ; `messages` (10 au plus) ; `Message.displayInterval` (affiché sans fin sans `endTime`) ; `heroImage` de l'objet prioritaire sur celui de la classe ; `textModulesData` de l'objet et de la classe affichés ensemble |
| Documentation PostgREST | dépôt `PostgREST/postgrest`, `docs/references/api/resource_embedding.rst` ; `CHANGELOG.md` | les filtres embarqués ne filtrent pas les lignes de premier niveau ; `!inner`, introduit en 9.0.0 (2021-11-25) |
| `@supabase/postgrest-js` | 2.107.0, empreinte sha512 = `package-lock.json` | `gt()` transmet `colonne=gt.valeur` (`dist/index.cjs:1507-1509`) |
| Documentation Apple Wallet (service web, jeton d'authentification) | developer.apple.com et forums, **par extraits de moteur de recherche** (pages bloquées) | liste « mises à jour depuis » limitée aux cartes changées ; ne pas changer le jeton d'une carte mise à jour ; poussée `background`, priorité 5, charge vide |
| Refonte Google Wallet 2026 | PassKit, Passcreator, 9to5google (10/09/2026), **par extraits** | déploiement depuis le 18/08/2026 ; image du bas plus grande ; cartes existantes censées rester compatibles |
| Ponytail | github.com/dietrichgebert/ponytail, v4.10.0 (`e3ba2aa`) | commande d'audit |
