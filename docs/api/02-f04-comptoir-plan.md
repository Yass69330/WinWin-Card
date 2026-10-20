# f04 côté comptoir — plan de code (20/10/2026)

> **RECADRÉ le 20/10 (pilotage) : ce plan n'est pas livré tel quel.** Black Tulip n'utilise
> aucune interface WinWin : l'attache du numéro et la récupération passeront par **l'API**
> (chantier API, `01-api-caisses-cadrage.md` §D). Les écrans de la caisse WinWin (§6) sont
> **remisés**. Le socle (migration 066, page client, confirmation avant attache, patron
> d'attribut) est codé et testé, gardé sur la branche `briques/f04-telephone` ; voir la
> passation, « f04 : codé puis recadré ».

Périmètre (pilotage, 20/10) : stockage du numéro de téléphone sur la carte, attache par le
caissier après un scan, récupération de la carte au comptoir par le numéro. **Hors lot**
(attend le technicien) : attache par l'API de vente et contrat `POST /ventes`.

Exigences du pilotage : (1) un patron d'attribut client **répétable**, sans machinerie
générique pour des champs qui n'existent pas ; (2) une zone « intégration » **délimitée et
documentée** pour qu'un développeur humain la reprenne sans deviner.

---

## 1. Diagnostic (code, 20/10)

- **La caisse** (`public/scanner/index.html`, PWA) : après un scan, l'écran `screen-result`
  affiche prénom et solde, puis « Scan suivant » / « Saisie manuelle ». Pas de minuterie qui
  referme l'écran. La page est servie réseau d'abord par son service worker : une mise à jour
  arrive sans changer de version.
- **La réponse du scan ne contient pas le numéro de série résolu.** Le caissier peut avoir
  scanné un code de secours (6 caractères) ou un identifiant Google ; le serveur le résout
  (`client.pass_serial_number`) mais ne le renvoie pas. Pour attacher un numéro à **cette**
  carte sans refaire la résolution, il faut ce numéro de série.
- **Droits** : `authScanner` laisse passer le jeton boutique (`scanner`, avec
  `point_de_vente_id`) et le jeton marchand. Les nouvelles routes comptoir l'utilisent telles
  quelles.
- **Données** : `clients.telephone` (texte libre, 11 numéros, 0 doublon en chiffres bruts, le
  19/10), rempli par l'inscription premium avec une ligne `consentements`. Effacement RGPD :
  `rgpd_effacement` met `telephone` à `null` et supprime les consentements.
- **Nouvelles tables** : la base ne donne aucun droit par défaut à `service_role` (audit 00b
  §8) ; chaque migration le fait elle-même (modèle 063 : RLS activée + `GRANT … TO
  service_role`).
- **QR** : la bibliothèque `qrcode` est déjà une dépendance (QR de la landing, dashboard).

---

## 2. La zone « intégration » (exigence 2)

Tout ce qui relie WinWin à **l'extérieur du comptoir classique** (identité du client, caisse
du commerçant, borne plus tard) vit dans un seul dossier, monté par **une seule ligne** dans
`src/index.js`. Le scan, la carte et le dashboard n'en dépendent pas.

```
src/integration/
  index.js            monte les routeurs de la zone (un seul app.use dans src/index.js)
  comptoir.js         /api/comptoir/*   gestes du caissier (authScanner) : attacher un
                                        numéro, chercher une carte, créer un QR de récupération
  recuperation.js     /r/:jeton          page publique du QR (sert public/recuperation.html)
                      /api/recuperation/:jeton   ce que la page lit (liens de la carte)
  (plus tard)
  api-ventes/         /api/v1/*          API machine des caisses (clé par marchand) — lot API
public/recuperation.html                page du client qui scanne le QR (Apple / Google)
database/migration_066_telephone_carte.sql
tests/scenarios.js                     section « f04 comptoir »
tests/navigateur/comptoir_telephone.js écrans de la caisse
docs/api/README.md                     architecture de la zone (ce qui suit, en court)
```

**Conventions** (celles du dépôt, écrites une fois dans `docs/api/README.md`) :
- noms en français, comme le reste du code ; routes au pluriel des choses (`cartes`,
  `recuperation`) ; préfixes : `/api/comptoir` (caissier), `/api/v1` (machines, plus tard),
  `/r` (lien public court) ;
- **toute règle d'argent ou d'identité vit dans une fonction SQL** appelée en un seul aller
  (`attacher_telephone`, `creer_recuperation`), comme `crediter_scan` et `annuler_scan` : la
  vérification et l'écriture sont atomiques, la route reste mince ;
- réponses d'erreur : `{ "error": "code_en_snake_case" }`, le texte affiché est choisi par
  l'écran (FR / EN) ;
- **rien dans la zone n'ajoute une requête au scan** (règle n°1) ; une nouvelle surface
  d'envoi (APNs, Google) écrit dans `notification_envois` (CLAUDE.md) — ce lot n'en ajoute
  aucune ;
- chaque route a ses tests au filet avant le push ; chaque migration crée ses droits.

---

## 3. Le patron d'attribut client (exigence 1)

Le téléphone est le premier ; le patron est écrit dans le README, **seul le téléphone est
codé**. Pour un attribut qui sert d'**identité** (retrouver une carte) :

| Où | Quoi | Téléphone (ce lot) |
|---|---|---|
| `clients.<attr>` | la valeur telle que saisie | `telephone` (existe) |
| `clients.<attr>_normalise` | colonne **générée** par une fonction SQL pure : une seule règle de format, impossible à oublier dans une route | `telephone_normalise = normaliser_telephone(telephone)` |
| index unique partiel | une valeur = une carte par marchand (clients non effacés) | `(marchand_id, telephone_normalise)` |
| `clients.<attr>_source`, `<attr>_lie_le` | d'où vient la valeur, quand | `inscription`, `comptoir`, `caisse`, `import` |
| `consentements` | une ligne par attache, `type` = l'attribut, **`source`** (nouvelle colonne) | `type = 'telephone'` |
| fonction SQL `attacher_<attr>` | contrôle + écriture + consentement, atomiques | `attacher_telephone` |
| `rgpd_effacement` | la valeur brute à `null` (la normalisée suit seule) | déjà fait pour `telephone` |

Un attribut **sans** rôle d'identité (anniversaire, produit favori) n'a que la première et
la quatrième lignes, plus le consentement. Ajouter l'e-mail plus tard = une migration sur ce
modèle, une fonction `attacher_email`, une route : aucune réécriture.

---

## 4. Migration 066 (exécutée dans Supabase avant le push)

1. `normaliser_telephone(brut text) → text`, `IMMUTABLE`, règles simples, **Émirats par
   défaut** : on retire espaces, tirets, points, parenthèses ; `00` devant devient `+` ;
   `05XXXXXXXX` (10 chiffres) → `+9715XXXXXXXX` ; `5XXXXXXXX` (9 chiffres) → `+9715…` ;
   `971…` (12 chiffres) → `+971…` ; un `+` suivi de 8 à 15 chiffres est gardé tel quel
   (numéro étranger) ; tout le reste → `null` (numéro inutilisable pour la récupération, la
   valeur brute reste).
2. **Garde-fou** : si deux clients d'un même marchand ont le même numéro **une fois
   normalisé**, la migration s'arrête sans rien changer (message avec le seul nombre). Le
   contrôle du 19/10 comparait les chiffres bruts (`0501…` et `971501…` n'étaient pas vus
   comme égaux) : celui-ci est le bon.
3. `clients` : `telephone_normalise` (générée, stockée), `telephone_source` (liste fermée),
   `telephone_lie_le`. Les numéros existants : `source = 'inscription'`, `lie_le =
   created_at`.
4. Index unique partiel `(marchand_id, telephone_normalise)`, clients non effacés.
5. `consentements.source` (texte, `null` pour l'existant = inscription).
6. Table `recuperations_carte` : `marchand_id`, `client_id`, `point_de_vente_id`, `role`
   (boutique ou marchand), `jeton_hash` (**jamais le jeton en clair**), `cree_le`,
   `expire_le` (+10 min), `ouvert_le`, `ouvertures`. RLS activée, droits `service_role`.
7. Fonctions `attacher_telephone`, `trouver_carte_par_telephone`, `creer_recuperation`, droits
   d'exécution `service_role`. `rgpd_effacement` : supprime aussi les récupérations du client.

**Coût** : la colonne générée réécrit la table `clients` (verrou le temps de la réécriture :
les scans attendent). Pour quelques milliers de lignes, moins d'une seconde (HYPOTHÈSE, à
mesurer au filet sur 50 000 porteurs ; requête de taille à lancer avant). Aucun index ajouté
au chemin du scan.

**Hypothèse** : changer plus tard la règle de format demande une migration qui recalcule la
colonne (une fonction `IMMUTABLE` redéfinie ne recalcule pas les valeurs stockées). Écrit dans
la migration.

---

## 5. Routes

| Route | Qui | Effet |
|---|---|---|
| `POST /api/comptoir/cartes/:serial/telephone` `{ telephone }` | caissier | `attacher_telephone` : ok / `numero_invalide` / `carte_introuvable` / `deja_un_numero` (fin masquée « …34 12 ») / `numero_pris` (prénom de l'autre carte) ; consentement `source = comptoir` |
| `POST /api/comptoir/recherche` `{ telephone }` | caissier | prénom, solde, seuil de la carte de ce marchand, ou 404 ; **limité** (30 recherches / 15 min par boutique) contre le défilement de numéros |
| `POST /api/comptoir/recuperations` `{ client_id }` | caissier | jeton aléatoire (128 bits), haché en base, valable 10 min, tracé (boutique, rôle) ; rend le QR (image) et l'heure de fin |
| `GET /r/:jeton` | public | la page `recuperation.html` |
| `GET /api/recuperation/:jeton` | public | prénom, nom du commerce, liens Apple et Google de **la même carte** ; compte les ouvertures ; 410 si expiré, 404 si inconnu |

**Seul changement à la caisse existante** : la réponse de `POST /api/scan` gagne un champ
`serial_number` (le numéro de série résolu, déjà en main : **zéro requête**, champ ajouté,
rien d'enlevé). C'est le seul fichier du scan touché ; à valider explicitement.

**Choix** : un numéro déjà attaché ne se remplace pas depuis le comptoir (sinon n'importe quel
caissier pourrait détourner l'ancre de récupération d'un client). Changement de numéro :
plus tard, depuis la fiche client du dashboard. Inscription sur la landing avec un numéro
déjà lié à une autre carte : **l'inscription réussit**, la nouvelle carte n'a pas de numéro
(l'ancienne garde le sien) ; c'est justement le cas « nouveau téléphone », qui se règle au
comptoir.

---

## 6. Les deux écrans de la caisse

**Écran 1 — « + numéro » après un scan réussi.** Un bouton discret sous le résultat, à côté
de « Scan suivant ». Au tap : une fenêtre, un champ téléphone (clavier numérique, exemple
« 05X XXX XXXX »), « Attacher ». Une requête, à ce moment seulement. Messages : « Numéro
attaché », « Cette carte a déjà un numéro (…34 12) », « Ce numéro est déjà lié à la carte de
Sarah », « Numéro invalide ». Puis retour au résultat ; « Scan suivant » toujours là. Le
bouton s'affiche à chaque scan réussi : savoir si la carte a déjà un numéro demanderait une
lecture de plus au scan (refusé, règle n°1) ; le serveur le dit au tap.

**Écran 2 — « Retrouver une carte ».** Un bouton sur l'écran du scanner, à côté de « Saisie
manuelle ».
1. Le caissier tape le numéro dicté → « Chercher ».
2. « Sarah · 140 / 500 points » → « C'est bien elle / lui » ou « Annuler ». Rien d'autre
   n'est montré (ni numéro complet, ni historique).
3. Le QR plein écran, compte à rebours 10:00, « Scannez avec l'appareil photo du nouveau
   téléphone ». « Terminé » referme.
4. Le client scanne → page « Ajouter à Apple Wallet / Google Wallet » (iPhone : Apple en
   premier) → **la même carte**, même solde, mêmes mises à jour. L'ancienne, sur l'ancien
   téléphone, reste valable.

Textes FR / EN dans le dictionnaire de la caisse. L'onglet Scanner du **dashboard** n'est pas
dans ce lot (il sera découpé avec t42) : la récupération se fait depuis la caisse PWA.

---

## 7. Filet et contre-épreuve

- Format : une table de cas (`05…`, `+971…`, `00971…`, `971…`, `5…`, espaces et tirets,
  étranger `+33…`, trop court, lettres).
- Migration : garde-fou (deux numéros égaux une fois normalisés → refus, rien changé) ;
  numéros existants marqués `inscription`.
- Attache : ok ; même numéro deux fois → rien de changé ; autre carte → `numero_pris` ;
  carte d'un autre marchand → introuvable ; consentement `comptoir` écrit ; **le scan fait
  toujours le même nombre de requêtes**, sa réponse ne change que d'un champ.
- Inscription landing avec un numéro déjà lié → 201, carte sans numéro.
- Recherche : trouvée, absente, numéro d'un autre marchand invisible, limite → 429.
- Récupération : jeton tracé (boutique, rôle), jamais stocké en clair ; liens de la même
  carte ; expiré → 410 ; ouvertures comptées ; effacement RGPD → numéro et récupérations
  partis.
- Navigateur : « + numéro » après scan ; « Retrouver » jusqu'au QR ; page du client.
- Contre-épreuve sur le commit de prod (les nouveaux tests échouent, les anciens passent) ;
  suite complète ; un push ; validation à l'œil de Yass.

---

## 8. Hypothèses et limites

- **Format** : règles simples, Émirats par défaut ; un numéro étranger saisi sans `+` peut ne
  pas se retrouver. `libphonenumber` écartée (poids, une dépendance de plus) ; à revoir si
  des numéros réels tombent à `null`.
- **Sans code SMS**, la vérification est humaine (prénom + solde, devant le caissier, tracée).
  Code SMS / e-mail : amélioration notée, pas un barrage.
- Un numéro partagé (famille) : une seule carte porte le numéro.
- Le QR n'est pas à usage unique (un aperçu de lien ou un double tap l'ouvriraient deux
  fois) : il expire en 10 minutes, chaque ouverture est comptée.
- Le lien de la carte affiché au client contient son numéro de série, comme aujourd'hui sur
  la landing : c'est sa carte.
