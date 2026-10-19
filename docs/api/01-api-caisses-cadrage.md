# API caisses — cadrage (19/10/2026, rien codé)

Premier client visé : **Black Tulip**, 35 points de vente (fleuristes, Dubaï), caisse développée
en interne. Ce document est un **brouillon de contrat** côté WinWin, à valider par le pilotage
puis à confronter aux réponses de leur technicien (partie B). Aucun code tant que les deux ne sont
pas validés.

Sources : le code de production (`src/routes/scan.js`, `crediter_scan` migration 051,
`annuler_scan` migration 052, clé d'idempotence t43), l'audit (`docs/audit/02-scan-credit.md`
§4.3 « le modèle à suivre pour une API machine », `99-synthese.md` §B « Les machines »).
Les fiches de cartes t33 et f02 à f05 ne sont pas dans le dépôt : elles sont reprises ici
d'après leur intitulé (message du pilotage du 19/10).

---

## A. Brouillon du contrat d'API

### A.1 Principe

Une vente encaissée par leur caisse, avec la carte WinWin du client scannée sur leur lecteur,
devient **un crédit** sur cette carte, par **le même chemin que le scan au comptoir** :
`crediter_scan` (report, remise, seuil, verrou de carte), puis mise à jour de la carte (Apple,
Google) et registre des envois. Rien n'est réécrit : la caisse est un « scanner de plus », qui
parle par une route à lui.

### A.2 Authentification : une clé propre au marchand

- **Jamais le jeton marchand** (règle du Socle). Une **clé d'API** par marchand, créée en
  admin, montrée **une seule fois**, stockée **hachée** en base (comme un mot de passe),
  révocable, avec sa date de dernière utilisation.
- En-tête : `Authorization: Bearer wwk_live_…`.
- Portée de la clé : **créditer et annuler les ventes de ce marchand, rien d'autre** (pas de
  lecture des clients, pas de campagnes, pas de statistiques).
- Limiteur **par clé** (pas par adresse : leur serveur central enverrait tout depuis une
  seule adresse, et le limiteur global de 300 / 15 min couperait les ventes). Seuil à fixer
  sur leur volume (question B4).
- **Nécessite une migration** (table des clés). Aucun code avant validation.

### A.3 Routes

**1. Créditer une vente**

`POST /api/v1/ventes`

```json
{
  "reference": "BT-DXB-014-000123",     // n° de commande / ticket, UNIQUE chez eux
  "boutique": "DXB-014",                // leur code de magasin (35 codes, rapprochés des boutiques WinWin)
  "carte": "6f1c…-…",                   // contenu du QR WinWin lu par leur lecteur (ou code de secours 6 car.)
  "montant": 25000,                     // en plus petite unité (fils) : 250,00 AED
  "devise": "AED",
  "date_vente": "2026-10-19T08:12:30Z"  // facultatif, pour la trace
}
```

Réponses :

| Cas | Code | Corps |
|---|---|---|
| crédité | 200 | `{ "ok": true, "points_credites": 25, "solde": 140, "seuil": 500, "recompense": false, "deja_enregistre": false }` |
| même vente renvoyée | 200 | même corps, `"deja_enregistre": true` (rien recrédité) |
| carte inconnue pour ce marchand | 404 | `{ "error": "carte_inconnue" }` |
| boutique inconnue / coupée | 422 / 403 | `{ "error": "boutique_inconnue" }` / `{ "error": "boutique_coupee" }` |
| même référence, autre carte ou autre montant | 409 | `{ "error": "reference_deja_utilisee" }` |
| corps invalide | 400 | `{ "error": "…" }` |
| clé absente, fausse, révoquée | 401 | `{ "error": "cle_invalide" }` |
| trop de requêtes | 429 | `Retry-After` |
| base indisponible | 503 | `Retry-After` — **renvoyer la même requête** : jamais de double crédit |

Pas de prénom, pas de téléphone, pas d'e-mail dans la réponse (données minimales).

**2. Annuler une vente (remboursement)**

`POST /api/v1/ventes/{reference}/annulation`

Réponses : 200 `{ "ok": true, "solde": 115 }` ; 404 vente inconnue ; 409 `deja_annulee` ;
409 `pas_la_derniere` (voir A.5, point dur).

**3. (facultatif, si demandé — question B6) Lire le solde d'une carte**

`GET /api/v1/cartes/{carte}` → `{ "solde": 140, "seuil": 500, "recompense": false }`.
À n'ouvrir que si leur caisse doit afficher le solde **avant** la vente.

### A.4 Idempotence : une vente renvoyée ne crédite qu'une fois

- On **réutilise la clé d'idempotence en place** (t43, `scans.cle_idempotence`, index unique
  par marchand) : la clé est **dérivée de la référence** (UUID v5 de `marchand + référence`).
  La même vente renvoyée, même mille fois, tombe sur la même clé : `crediter_scan` rend le
  premier résultat, marqué `deja_enregistre`.
- Une même référence avec une autre carte ou un autre montant : refusée (409), rien d'écrit.
- C'est aussi ce qui permet **l'annulation par référence** : la clé dérivée retrouve le scan
  sans rien stocker de plus. Pour l'afficher dans le dashboard (« vente BT-…-123 ») et pour le
  support, une colonne `reference_externe` serait utile (**migration**, à décider).

### A.5 Points durs — décisions du pilotage (19/10)

1. **Conversion montant → points : ACTÉ.** Règle **propre au marchand**, réglée en admin
   (par exemple 1 point par AED, arrondi vers le bas) ; la caisse n'envoie que le montant.
   Plus un **plafond par vente très élevé**, simple garde-fou contre une saisie absurde (un
   montant en fils pris pour des AED, un zéro de trop) : au-delà, 422 `montant_hors_plafond`,
   rien d'écrit. **Migration** (réglage par marchand). Hypothèse : le plafond est fixé assez
   haut pour qu'aucune vente réelle ne le touche (valeur à caler sur leurs tickets, B7, B11).
2. **Remboursement tardif : ACTÉ, pas de remboursement tardif.** On garde l'annulation du
   **dernier mouvement** (`annuler_scan`, garde-fous inchangés). Une vente remboursée après un
   autre passage est refusée (`pas_la_derniere`) ; le commerçant corrige au besoin par un
   ajustement depuis la fiche client, comme aujourd'hui. **f05 tombe.** Limite : leur caisse
   doit traiter ce refus sans boucler (question B9).
3. **Récompense atteinte en caisse (99 §B1).** Un humain est présent à la caisse : la réponse
   dit `recompense: true`, et leur caisse affiche « récompense à remettre ». Reste à définir
   ce que fait leur caissier (remise immédiate ou au prochain passage), comme au comptoir.
4. **Solde jamais négatif : ACTÉ.** Contrainte en base (`CHECK stored_value >= 0`,
   **migration**), posée **avant** d'ouvrir le second écrivain. Préalable : une requête qui
   prouve qu'aucun solde n'est négatif aujourd'hui (sinon la contrainte ne se pose pas).
5. **Canal du crédit : ACTÉ.** Colonne `canal` sur les scans (`comptoir` / `caisse`),
   `comptoir` par défaut pour tout l'existant, posée **avec** l'API (**migration**).

### A.6 Briques couvertes

| Brique | Couverte ? | Comment |
|---|---|---|
| **f02** logique de crédit partagée | **oui** | la route appelle `crediter_scan`, comme le scan |
| **f03** idempotence serveur | **oui** | clé t43 dérivée de la référence |
| **f04** liaison compte client ↔ carte | **revient** (besoin « identité compte », 19/10) | voir **D** : numéro de téléphone attaché à la carte par le caissier, sert à la récupération |
| **f05** annulation par n° de commande | **tombe** (décision 19/10) | annulation par référence du **dernier mouvement** seulement |

### A.7 Ce qui ne change pas

La caisse WinWin, le scan au comptoir, l'onglet Scanner, les cartes : rien. La route API est
un nouvel appelant de `crediter_scan`, à côté du scan.

---

## B. Questions pour leur technicien (fermées)

1. **Envoi à chaque vente.** Votre caisse peut-elle appeler une adresse HTTPS (webhook /
   requête POST JSON) **à chaque vente encaissée** ? Oui / non.
2. **D'où part l'appel.** L'appel part-il **de chaque caisse** (35 points de vente) ou **d'un
   serveur central** ? Chaque caisse / serveur central.
3. **Synchrone ou après coup.** Le caissier doit-il voir la réponse (points crédités,
   récompense) **pendant** la vente, ou l'envoi peut-il partir **après** (file, quelques
   secondes ou minutes plus tard) ? Pendant / après.
4. **Identification du client.** Votre lecteur peut-il **scanner le QR code** de la carte
   WinWin (Apple / Google Wallet) et transmettre son contenu tel quel dans l'appel ? Oui / non.
   Sinon, le caissier peut-il **taper un code de 6 caractères** ? Oui / non.
5. **Référence unique.** Chaque vente a-t-elle un **numéro unique** (ticket, commande), stable
   en cas de renvoi ? Oui / non. Format (exemple) ?
6. **Code magasin.** Chaque vente porte-t-elle un **code de point de vente** stable ? Oui / non.
   Liste des 35 codes ?
7. **Montant.** Le montant envoyé est-il **TTC**, en **AED**, en **fils** (centimes) ? Remises
   déduites ? Oui / non pour chacun.
8. **Fidélité.** Points (proportionnels au montant) ou tampons (un par passage) ? Si points :
   combien de points par AED, et seuil de récompense ?
9. **Remboursements.** Votre caisse envoie-t-elle un événement **à chaque remboursement /
   annulation** de vente, avec la même référence ? Oui / non. Délai typique entre vente et
   remboursement ? Si WinWin refuse l'annulation (la vente n'est plus le dernier passage du
   client), votre caisse **s'arrête-t-elle** sans renvoyer en boucle ? Oui / non.
10. **Retour d'information.** Avez-vous besoin que WinWin **réponde avec le solde et la
    récompense** pour l'afficher en caisse ? Oui / non. Ou d'une **lecture du solde avant la
    vente** ? Oui / non.
11. **Volume.** Combien de ventes par jour (tous magasins) ? Pic par minute (Saint-Valentin,
    fête des mères) ?
12. **Renvois.** En cas d'erreur réseau ou de réponse 503, votre caisse **renvoie-t-elle la
    même requête** automatiquement ? Oui / non. Combien de fois, avec quel délai ?
13. **Environnement de test.** Pouvez-vous appeler un **environnement de test** WinWin avant
    la production ? Oui / non.
14. **Sécurité.** Pouvez-vous stocker une **clé secrète** côté serveur (jamais dans
    l'application du caissier) et l'envoyer en en-tête `Authorization` ? Oui / non.
15. **Téléphone du client (D).** Quand le caissier scanne la carte WinWin, la fiche client de
    votre caisse est-elle **déjà connue** (numéro de téléphone) ? Oui / non. Pouvez-vous
    **joindre ce numéro** à l'appel de vente ? Oui / non. Format stocké (exemple) ?
16. **Export (D).** Pouvez-vous exporter vos clients en fichier (numéro de téléphone, et
    numéro de carte WinWin s'il est connu) ? Oui / non.

---

## C. Lot 1 — prérequis : plan de code (diagnostic du 19/10, rien codé)

Trois correctifs indépendants, aucun ne touche la caisse (scan, scanner, `crediter_scan`).
Un push chacun, ou t17 a et b ensemble (même risque, admin et Apple).

### C.1 t17 a — désinscription Apple : contrôle du jeton

- **Constat (code).** `src/routes/apple-wallet.js`, `DELETE /v1/devices/:deviceId/registrations/:passTypeId/:serialNumber` :
  efface la ligne `device_tokens` sans vérifier le jeton. L'inscription (`POST`, même chemin)
  le vérifie (`verifyAppleToken`). Qui connaît l'identifiant d'appareil et le numéro de série
  coupe les mises à jour de la carte.
- **Correctif.** Une ligne, la même qu'à l'inscription :
  `if (!verifyAppleToken(req, serialNumber)) return res.status(401).send();` avant l'effacement.
- **Filet.** Désinscription avec le bon jeton → 200 et ligne effacée ; sans en-tête, ou jeton
  d'une autre carte → 401 et ligne **toujours là**.
- **Hypothèse (ce qui le ferait casser).** Apple envoie l'en-tête `Authorization: ApplePass …`
  à la désinscription (documentation Apple : oui, comme à l'inscription). Si un iPhone ne
  l'envoyait pas, sa désinscription serait refusée : la ligne resterait, et on continuerait à
  pousser vers un appareil qui n'a plus la carte (un envoi perdu, rien de cassé côté client ;
  c'est la dette « jetons morts » déjà connue). Après le push : surveiller dans Railway les
  `DELETE /v1/devices` en 401 pendant quelques jours.
- **Limite.** Ne nettoie pas les jetons morts (dette 410, inchangée).

### C.2 t17 b — quota manuel de notifications borné (admin)

- **Constat (code).** `src/routes/admin.js`, `PATCH /api/admin/marchands/:id` : le champ
  `notification_quota_override` passe tel quel. Texte → erreur 500 de la base ; négatif →
  quota négatif (le marchand ne peut plus rien envoyer, sans message clair) ; énorme → aucune
  limite d'envoi. L'écran admin borne déjà la saisie (0 à 9 999, vide = forfait), le serveur non.
- **Correctif.** Vide ou `null` → `null` (quota du forfait) ; sinon **entier de 0 à 1 000**,
  sinon 400 `Quota notifs : entier de 0 à 1000`. Route admin seule, rien côté marchand.
  L'écran admin passe à `max="1000"` (même borne des deux côtés).
- **Filet.** `null` accepté ; 0 accepté (0 = aucune notification) ; 1 000 accepté ; −1, 1 001,
  2,5 et « abc » → 400 et valeur en base inchangée.
- **Hypothèse.** 1 000 notifications par mois suffit à tout marchand (Pro+ = 20). À relever
  si un jour un forfait le demande. **Préalable SQL** : vérifier qu'aucun marchand n'a déjà
  une valeur hors bornes (sinon on le voit avant, on ne casse rien : la borne ne s'applique
  qu'à l'écriture).

### C.3 t23 — copie chiffrée des sauvegardes hors du compte Supabase (P4)

**Constat (audit 06 §6, dépôt).** Sauvegardes Supabase quotidiennes, 7 jours, dans le même
compte que la base, effacées avec le projet ; aucune copie ailleurs, aucun script d'export.
L'identité qui commande Supabase et Railway est le compte GitHub de Yass (audit 03, 06 §5.5).

**Proposition.**
- **Quoi** : chaque nuit, un export complet de la base (`pg_dump`, schéma `public`, droits
  compris), **chiffré** (AES-256, phrase secrète), envoyé dans un stockage **d'un autre
  fournisseur, avec un compte à part** (pas de connexion par GitHub).
- **Où ça tourne** : une tâche planifiée GitHub Actions, **hors du serveur de l'API** (00b
  §4.4). Rien dans Railway, rien dans le code du serveur. GitHub n'exécute les tâches planifiées
  que depuis la branche par défaut du dépôt, aujourd'hui la branche du site
  (`claude/winwin-card-landing-ohS22`) : le fichier de tâche y vit, il ne contient aucun secret.
- **Où ça va** : un compartiment Backblaze B2, région **UE (Amsterdam)**, avec **verrou
  d'objets** (Object Lock) **30 jours** : pendant 30 jours, une copie ne peut être effacée par
  personne, même avec le compte. Clé d'accès **en écriture seule** (ne peut ni lire ni
  effacer). Copies gardées 90 jours, puis effacées automatiquement. Volume : quelques Mo par
  jour, quelques centimes par mois (gratuit sous 10 Go).
- **Accès à la base** : un rôle Postgres dédié **en lecture seule** (`sauvegarde`), créé par
  une requête que Yass exécute dans Supabase avec un mot de passe qu'il choisit (jamais dans le
  dépôt). Connexion par le « Session pooler » (IPv4 ; la connexion directe Supabase est IPv6,
  que GitHub n'a pas).
- **Contrôle à chaque nuit** : la tâche **restaure la copie dans une base jetable** sur la
  machine GitHub et vérifie que les tables centrales (`clients`, `scans`, `passes`,
  `marchands`) ne sont pas vides. Une sauvegarde jamais relue n'est pas une sauvegarde. Le
  journal de la tâche n'affiche que « ok » ou l'erreur, **jamais de données ni de chiffres**
  (le dépôt est public : ses journaux aussi).
- **Alerte** : un échec envoie un e-mail à Yass (comportement GitHub par défaut).
- **Gestes de Yass** (guidés pas à pas le jour venu) : créer le compte Backblaze (e-mail, 2FA),
  le compartiment verrouillé et la clé en écriture seule ; générer une phrase secrète longue
  dans son gestionnaire de mots de passe **et sur papier** ; exécuter la requête du rôle
  `sauvegarde` ; coller 4 secrets dans GitHub (adresse de la base, phrase secrète, deux
  identifiants Backblaze). Puis un essai lancé à la main.
- **Restauration** (procédure écrite dans la passation au moment du code) : télécharger une
  copie, déchiffrer avec la phrase secrète, `pg_restore` dans un projet Supabase neuf.

**Hypothèses (ce qui le ferait casser).**
- Le rôle `postgres` de Supabase peut créer un rôle qui lit sans être bloqué par les règles de
  sécurité par ligne (`BYPASSRLS`, nécessaire à `pg_dump` sur les tables qui en ont) : **à
  vérifier par une requête** avant le code. Sinon, repli : l'adresse du rôle `postgres`
  (droits complets) comme secret, moins propre.
- `pg_dump` 17 (même version majeure que la base, 17.6) s'installe sur la machine GitHub.
- GitHub peut retarder une tâche planifiée de quelques dizaines de minutes, et la suspend
  après 60 jours sans activité sur le dépôt (le dépôt est actif tous les jours).
- Aucune restriction réseau n'est activée sur la base Supabase (sinon, ouvrir l'accès).

**Limites (écrites comme telles).**
- **Ne réduit pas la journée perdue** (P5, Point in Time, ≈ 100 $ / mois : reporté, décision
  sur le volume réel).
- Ne contient pas les fichiers du stockage Supabase (logos, images : elles se régénèrent ou
  restent en place, audit 06 §6.3), ni les réglages Railway, Supabase, Google.
- La phrase secrète est dans GitHub : qui prend le compte GitHub peut lire les copies futures
  — mais il a déjà la base. Ce qu'il ne peut pas : **effacer les copies** (verrou 30 jours,
  clé sans droit d'effacement, compte Backblaze séparé). C'est le risque que P4 couvre.
- **Données personnelles** hors de Supabase (prénoms, téléphones, e-mails) : chiffrées, dans
  l'UE ; à mentionner dans la politique de confidentialité (zone RGPD / PDPL, hors périmètre
  technique).
- Si le dépôt devient privé : 2 000 minutes gratuites par mois, la tâche en prend environ 3
  par nuit (≈ 90 par mois).

---

## D. Addendum f04 — identité du client : numéro de téléphone attaché à la carte (zéro code)

### D.1 Le besoin (pilotage, 19/10)

La caisse des décisionnaires stocke déjà les numéros de téléphone de leurs clients. On veut
(a) rattacher les numéros existants aux cartes (rattrapage manuel acceptable) ; (b) que **le
caissier** attache un numéro à une carte, numéro qui sert à **récupérer la carte** si le
client change d'appareil. Zéro friction : **le client ne tape jamais son numéro**.

### D.2 Aujourd'hui : comment une carte se récupère après un changement d'appareil (code)

- **Aucun parcours de récupération.** La seule mémoire est le navigateur du client : la page
  d'inscription garde la carte dans le stockage local (`landing.html`, écran « Tu as déjà ta
  carte ») et repropose les mêmes liens. Autre téléphone, autre navigateur, stockage effacé :
  rien. Le client se réinscrit → **nouvelle carte à 0**, l'ancienne garde ses points, orpheline.
- Le numéro de série de la carte **est** la clé : `/api/passes/{serial}/apple` (et `/google`)
  rend la même carte, même solde, sur n'importe quel appareil. Le problème n'est que de
  **retrouver le numéro de série**.
- Ce que les portefeuilles font seuls (documentation Apple / Google, **non vérifié chez
  nous**) : un nouvel iPhone restauré avec le **même identifiant Apple** retrouve ses cartes
  (et s'inscrit de nouveau pour les mises à jour) ; Google Wallet suit le **compte Google**. La
  perte réelle : **changement de plateforme** (iPhone ↔ Android), nouveau compte, carte
  supprimée, téléphone sans sauvegarde.
- Ce que la base a déjà : `clients.telephone` et `clients.email` (texte libre, sans format,
  sans unicité), remplis **seulement** par la page d'inscription « premium » (Pro / Pro+ avec
  l'option), avec preuve de consentement (`consentements`). La fiche client du dashboard les
  affiche aux forfaits qui y ont droit. Aucune recherche par numéro nulle part.

### D.3 Où stocker le numéro

- **Garder `clients.telephone`** (ce que le client a saisi, affiché tel quel) et ajouter :
  - `telephone_normalise` : format international (`+9715…`), calculé par le serveur (un
    numéro local `05…` devient `+9715…`, pays par défaut : Émirats) ;
  - **index unique** `(marchand_id, telephone_normalise)` sur les clients non effacés : **un
    numéro = une carte par marchand** (pour un réseau, le marchand est le groupe : une carte
    valable dans les 35 boutiques) ;
  - `telephone_source` (`inscription`, `comptoir`, `caisse`, `import`) et `telephone_lie_le`.
- **Migration**, exécutée avant le code. L'e-mail : même modèle plus tard si besoin ; le
  téléphone d'abord (c'est ce que leur caisse a).
- Consentement : une ligne `consentements` (type `telephone`) à chaque rattachement, avec sa
  source ; au comptoir, c'est le caissier qui atteste l'accord oral du client. **Zone grise
  RGPD / PDPL assumée par Yass**, notée.
- Droit d'affichage : le numéro reste masqué dans le dashboard aux forfaits sans droit aux
  coordonnées (règle actuelle) ; **il sert quand même à la récupération**. Décision du
  pilotage : la récupération est-elle ouverte à tous les forfaits ?

### D.4 Attacher le numéro — trois chemins, du plus automatique au plus manuel

1. **Par l'API de vente (zéro geste)** : si leur caisse connaît le client (fiche avec
   numéro) au moment où la carte est scannée, elle joint `telephone` à l'appel de vente. Le
   serveur l'attache **si la carte n'a pas encore de numéro** ; sinon il ne touche à rien (un
   numéro attaché ne se remplace pas par l'API). Question B15. **Le rattrapage (a) se fait
   alors tout seul, au fil des passages.** Hors du chemin chaud : l'attache est écrite après
   la réponse de vente, elle ne la ralentit pas.
2. **Au comptoir WinWin (scanner)** : sur l'écran de résultat du scan, un bouton discret
   « + numéro » (n'apparaît que si la carte n'en a pas). Le caissier tape le numéro dicté par
   le client. **Rien ne s'ajoute au scan lui-même** : le bouton est facultatif, une requête à
   part, seulement au tap (règle n°1 : la caisse ne ralentit pas).
3. **Rattrapage manuel (import)** : un fichier `numéro de carte ; téléphone` chargé en admin.
   **Limite importante** : leur caisse et nos cartes n'ont **aucune clé commune** aujourd'hui.
   Un fichier de numéros seuls ne dit pas à quelle carte chacun appartient ; l'import ne vaut
   que pour des paires déjà connues (B16). Pour les cartes déjà inscrites en « premium », le
   numéro est déjà en base : on le normalise (requête de rattrapage, pas de saisie).

**Conflit** : numéro déjà attaché à une **autre** carte du même marchand → refus, message
« ce numéro est déjà lié à la carte de {prénom} ». Pas de fusion automatique de cartes
(fusion = chantier à part, si le besoin se confirme).

### D.5 Récupérer la carte (flux proposé)

Au comptoir, client sur son nouveau téléphone, sans rien taper :
1. le caissier ouvre « Retrouver une carte » (scanner ou dashboard) et tape le numéro dicté ;
2. le serveur cherche la carte **de ce marchand** pour ce numéro : prénom et solde affichés,
   le caissier vérifie avec le client (« Sarah, 140 points ? ») ;
3. l'écran affiche un **QR code de réinstallation** ; le client le scanne avec l'appareil photo
   → page « Ajouter à Apple Wallet / Google Wallet » → **la même carte** (même numéro de
   série, même solde, mêmes mises à jour) ;
4. le lien du QR est **à usage limité** (valable 10 minutes, jeton dérivé, pas le numéro de série
   en clair), écrit dans un journal (qui, quand, quelle boutique).

Sur l'ancien téléphone, l'ancienne carte reste valable (même numéro de série) : deux appareils
sur une même carte, comme aujourd'hui pour un client qui a l'iPhone et l'Apple Watch.

**Amélioration notée, pas un barrage** : récupération **à distance** (sans comptoir) avec code
SMS ou e-mail. Le client taperait alors son numéro lui-même, et un SMS a un coût et un
fournisseur à choisir. Zone grise assumée ; à faire seulement si le comptoir ne suffit pas.

### D.6 Hypothèses et limites

- Un numéro identifie une personne : faux pour un téléphone partagé (famille). Un numéro =
  une carte par marchand ; le second membre de la famille garde une carte sans numéro.
- La récupération au comptoir s'appuie sur le caissier (prénom + solde affichés) : sans code
  SMS, quelqu'un qui connaît le numéro d'un autre pourrait, **devant un caissier**, récupérer sa
  carte. Risque faible (présence physique, journal), assumé.
- Normalisation des numéros : règles simples (Émirats par défaut) ; un numéro étranger mal
  saisi peut ne pas être retrouvé. Bibliothèque de référence (`libphonenumber`) à évaluer au
  moment du code (nouvelle dépendance).
- Volume du rattrapage automatique : dépend de B15 (leur caisse connaît-elle le client au
  moment du scan ?).

### D.7 Découpage proposé (quand le pilotage le décidera)

1. Migration (colonnes, index unique, rattrapage des numéros « premium » déjà en base) ;
2. recherche par numéro + QR de réinstallation (dashboard d'abord, puis scanner) ;
3. bouton « + numéro » au comptoir ;
4. `telephone` dans l'appel de vente de l'API (avec le lot API).

Préalable SQL (à faire tourner avant la migration) : combien de clients ont déjà un
téléphone, combien de doublons par marchand une fois normalisés.
