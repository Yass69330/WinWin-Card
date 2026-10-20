# API WinWin v1 — contrat pour les caisses des commerçants

**Version** : 1.0 du 20/10/2026, **validée par le pilotage** (décisions verrouillées le 20/10,
partie III). Rien n'est codé ; l'implémentation démarre sur validation explicite.
**Premier intégrateur** : Black Tulip (35 points de vente, Dubaï, caisse développée en
interne).
**Lecteurs** : (1) le technicien de la caisse, qui construit contre ce document ; (2) le
développeur WinWin qui l'implémente (partie II). Les décisions sont consignées en partie III.

Documents voisins : `01-api-caisses-cadrage.md` (cadrage, questions au technicien),
`README.md` (architecture de la zone `src/integration/`), passation §0.5 bis.

---

# Partie I — Le contrat (ce que le technicien lit)

## 0. Invariant : WinWin est additif, jamais bloquant

**L'API WinWin ne peut bloquer aucune vente.** C'est la règle qui prime sur tout le reste du
document :

- **Client sans carte** : la vente est encaissée normalement ; la caisse n'appelle pas WinWin
  (ou reçoit `404`, sans conséquence sur la vente).
- **WinWin en panne, lent ou injoignable** : la vente est encaissée quand même ; l'appel est mis
  en file et renvoyé plus tard (§8).
- **Aucune réponse de WinWin**, quelle qu'elle soit (erreur, refus, délai dépassé), ne doit
  empêcher, retarder au-delà du délai d'attente, ni annuler l'encaissement. La caisse
  **clôture la vente d'abord** (ou en parallèle) ; la fidélité suit.
- WinWin ne renvoie jamais d'instruction du type « refuser la vente ». Ses refus portent
  **uniquement** sur le crédit de fidélité.

Côté WinWin, l'API est sortie du limiteur global (un serveur central de caisse ne doit jamais
être freiné par le trafic d'une autre adresse) et répond par des erreurs explicites, jamais par
une attente sans fin (délai côté serveur : 5 s, puis `503`).

## 1. Principe

À **chaque vente encaissée**, la caisse appelle WinWin avec : la référence unique de la vente,
la carte de fidélité du client, le montant. WinWin convertit le montant en points selon la
règle du commerçant, crédite la carte **exactement comme au comptoir** (même calcul, même
journal, même mise à jour de la carte dans Apple Wallet / Google Wallet) et répond avec le
nouveau solde et l'état de la récompense.

- Une vente **renvoyée** (coupure réseau, nouvel essai) n'est **jamais créditée deux fois** :
  la référence de vente est la clé.
- Une vente peut être **annulée** tant qu'elle est le **dernier mouvement** de la carte.
- **Aucune donnée personnelle** n'est renvoyée par WinWin (ni prénom, ni téléphone, ni e-mail).
- La caisse peut, en option, **joindre le numéro de téléphone** du client à la vente : il est
  rattaché à la carte et sert à **récupérer la carte** si le client change de téléphone, et
  ensuite à **créditer par le numéro** quand le client n'a pas sa carte sous la main (§3.1).
- Les points déjà cumulés par la caisse sous le numéro du client peuvent être **reversés une
  seule fois** sur sa carte WinWin (§6 bis).

## 2. Accès

| | |
|---|---|
| Adresse de production | `https://app.winwin-card.com/api/v1` |
| Transport | HTTPS seulement (TLS 1.2+). Tout appel en HTTP est refusé. |
| Format | JSON, `Content-Type: application/json`, UTF-8 |
| Authentification | `Authorization: Bearer <clé>` |
| Version | dans l'adresse (`/v1`). Voir §11. |

### 2.1 La clé d'API

- **Une clé par commerçant**, remise par WinWin (format `wwk_live_` + 40 caractères). Elle
  n'est affichée **qu'une fois** à sa création ; WinWin n'en garde qu'une empreinte et ne peut
  pas la retrouver : en cas de perte, une nouvelle clé est créée et l'ancienne révoquée.
- **Droits de la clé** : créditer une vente, annuler une vente, lire le solde d'une carte,
  reverser les points d'avant (migration, une fois par carte), demander un lien de
  récupération. **Rien d'autre** (aucune liste de clients, aucune donnée
  personnelle, aucun réglage).
- **Où la garder** : sur un serveur ou dans la configuration protégée des caisses, **jamais**
  affichée à l'écran ni dans un code accessible au caissier.
- **D'où appeler** : la même clé fonctionne depuis **chaque caisse** ou depuis **un serveur
  central** ; le magasin est désigné par le champ `boutique` de chaque appel (§4.1).
- **Révocation** : sur demande à WinWin, effective en **60 secondes au plus**. Une clé
  révoquée reçoit `401 cle_invalide`.
- **Clé de test** (`wwk_test_…`) : rattachée à un **commerçant de test** distinct (mêmes
  règles, cartes de test fournies par WinWin). Rien de ce qui est fait avec elle ne touche les
  vrais clients. Voir §10.

### 2.2 Limites

- **600 requêtes par minute et par clé** (toutes routes confondues). Au-delà : `429` avec
  l'en-tête `Retry-After` (secondes). Les limites ne sont jamais partagées entre commerçants.
- Temps de réponse visé : sous 1 seconde. **Délai d'attente conseillé côté caisse : 10 s.**

## 3. Identifier la carte du client

Chaque carte WinWin (Apple Wallet ou Google Wallet) porte :

1. un **QR code**, dont le contenu est l'identifiant complet de la carte, un UUID de 36
   caractères, par exemple `3f6d2a1e-8b4c-4f0a-9d2e-7c1b5a9e0f12` ;
2. un **code court** de **6 caractères** imprimé sous le QR et au dos de la carte, par exemple
   `9E0F12` : ce sont les 6 derniers caractères de l'identifiant (chiffres et lettres A à F).

Le champ `carte` de chaque appel accepte **l'un ou l'autre**, tel quel :

| La caisse… | Elle envoie dans `carte` |
|---|---|
| lit le QR avec son lecteur | le contenu brut du QR (36 caractères) |
| ne lit pas les QR, ou le lecteur échoue | le code court tapé par le caissier (6 caractères, majuscules ou minuscules) |

- Espaces autour ignorés ; casse ignorée.

### 3.1 Sans la carte : par le numéro de téléphone

Si le client n'a pas sa carte sous la main, la caisse peut l'identifier par son **numéro de
téléphone** (champ `telephone`, sans `carte`) :

- **Crédit uniquement si ce numéro est rattaché à une carte WinWin** du commerçant (rattaché
  par une vente précédente, §4.4, ou à l'inscription). La carte est créditée comme si elle
  avait été scannée.
- **Jamais de crédit sans carte** : numéro inconnu → `404 carte_inconnue`, avec
  `lien_installation`, l'adresse où le client obtient sa carte (à afficher ou envoyer : « Votre
  carte de fidélité est ici »). Une fois la carte installée et le numéro rattaché, les ventes
  suivantes sont créditées et les points d'avant peuvent être reversés (§6 bis).
- Si `carte` **et** `telephone` sont fournis, c'est la **carte** qui désigne le compte ; le
  numéro est seulement rattaché (§4.4).
- **Code court en collision** (deux cartes du même commerçant finissent par les mêmes 6
  caractères, très rare) : `409 carte_ambigue`, rien n'est crédité ; le caissier **scanne le
  QR** (seul moyen sûr). WinWin ne renvoie jamais la liste des cartes en collision.
- Une carte d'un autre commerçant, effacée ou inconnue : `404 carte_inconnue`.

## 4. Créditer une vente

`POST /api/v1/ventes`

### 4.1 Corps de la requête

```json
{
  "reference": "BT-DXB-014-20261021-000123",
  "carte": "3f6d2a1e-8b4c-4f0a-9d2e-7c1b5a9e0f12",
  "montant": 18500,
  "devise": "AED",
  "boutique": "DXB-014",
  "date_vente": "2026-10-21T14:32:05+04:00",
  "telephone": "+971 50 123 4567"
}
```

| Champ | Obligatoire | Règle |
|---|---|---|
| `reference` | **oui** | identifiant **unique et stable** de la vente chez le commerçant (ticket, commande). 1 à 64 caractères parmi `A-Z a-z 0-9 . _ - : /`. La même vente renvoyée porte **toujours** la même référence. |
| `carte` | **oui, sauf** si `telephone` identifie le client (§3.1) | contenu du QR ou code court (§3). |
| `montant` | **oui** | **entier en fils** (1 AED = 100 fils), montant **payé** par le client (TTC, remises déduites), strictement positif. `185,00 AED` → `18500`. Jamais de virgule ni de chaîne. |
| `devise` | non | `"AED"` seulement. Absent = `AED`. Toute autre valeur : `400`. |
| `boutique` | oui si le commerçant a plusieurs boutiques | **code du point de vente** chez le commerçant, tel que transmis à WinWin à l'ouverture (liste des 35 codes). Inconnu ou fermé : voir §4.3. |
| `date_vente` | non | date et heure de la vente (ISO 8601 avec fuseau). Absente = l'heure de réception. Sert à l'historique ; la vente est créditée à réception. Plus de 7 jours dans le passé, ou dans le futur au-delà de 5 minutes : `422 date_vente_invalide`. |
| `telephone` | non (oui si `carte` est absent) | numéro du client tel qu'il est dans la fiche de la caisse, **tout format** (`050 123 4567`, `+971501234567`, `00971…`). Avec `carte` : rattaché à la carte (§4.4), **ne fait jamais échouer le crédit**. Sans `carte` : identifie le client (§3.1). |

Tout autre champ est ignoré (compatibilité future).

### 4.2 Ce que fait WinWin

1. Vérifie la clé, le corps, la boutique.
2. Trouve la carte (§3), ou, sans `carte`, la carte rattachée au numéro (§3.1).
3. **Convertit le montant** selon la règle du commerçant :
   - programme **à points** : `points = arrondi_inférieur(montant ÷ fils_par_point)`, réglé par
     commerçant (par défaut **100 fils = 1 point**, soit 1 point par AED) ;
   - programme **à tampons** : **1 tampon par vente**, quel que soit le montant ;
   - montant au-delà du **plafond par vente** du commerçant (garde-fou contre une saisie
     absurde, par défaut 50 000 AED) : `422 montant_hors_plafond`, **rien n'est crédité** ;
   - vente qui donne **0 point** (montant sous le seuil d'un point) : rien n'est crédité,
     réponse `200` avec `points_credites: 0` et `enregistree: false`.
4. **Crédite la carte** par le même mécanisme que le comptoir WinWin, en une seule
   transaction : solde, journal, message de la carte. Récompense : voir §4.5.
5. Si `telephone` est fourni : le rattache à la carte (§4.4), après le crédit.
6. Répond. La mise à jour de la carte dans le téléphone du client part **après** la réponse
   (quelques secondes).

### 4.3 Réponses

**Crédité** — `200`

```json
{
  "ok": true,
  "reference": "BT-DXB-014-20261021-000123",
  "enregistree": true,
  "deja_enregistree": false,
  "programme": "points",
  "points_credites": 185,
  "solde": 640,
  "seuil": 500,
  "seuil_atteint": true,
  "recompense_a_remettre": false,
  "telephone": "rattache"
}
```

| Champ | Sens |
|---|---|
| `enregistree` | `true` si la vente a crédité la carte ; `false` si elle valait 0 point. |
| `deja_enregistree` | `true` si cette référence avait **déjà** été créditée : c'est la réponse de la première fois, **rien n'a été recrédité**. Le traiter comme un succès. |
| `programme` | `"points"` ou `"tampons"`. |
| `points_credites` | points (ou tampons) ajoutés par cette vente. |
| `solde` | solde de la carte après la vente. |
| `seuil` | solde qui donne droit à la récompense. |
| `seuil_atteint` | le solde vient d'atteindre le seuil : la récompense est **acquise**, elle sera remise **au prochain passage**. Afficher : « Récompense acquise — à remettre au prochain passage ». |
| `recompense_a_remettre` | **cette vente** est celle de la remise : le caissier **remet la récompense maintenant**. Afficher : « Remettre la récompense au client ». |
| `telephone` | issue du rattachement (§4.4), `null` si aucun numéro n'a été envoyé. |

**Erreurs** — corps toujours `{ "error": "<code>" }`, parfois avec un champ `champ`. **Aucune
ne concerne l'encaissement** (§0) : dans tous les cas, la vente est déjà encaissée ; seule la
fidélité est en jeu.

| Statut | `error` | Signification | Que faire côté caisse |
|---|---|---|---|
| 400 | `corps_invalide` (+ `champ`) | champ manquant ou mal formé | corriger l'intégration ; **ne pas** renvoyer tel quel |
| 401 | `cle_invalide` | clé absente, fausse ou révoquée | alerter le support, ne pas renvoyer |
| 403 | `commercant_suspendu` | programme de fidélité suspendu | ne pas renvoyer |
| 403 | `boutique_fermee` | boutique désactivée chez WinWin | ne pas renvoyer ; prévenir le siège |
| 404 | `carte_inconnue` (+ `lien_installation`) | carte inconnue chez ce commerçant, ou numéro rattaché à aucune carte | vente encaissée sans fidélité ; proposer au client le `lien_installation` |
| 409 | `carte_ambigue` | code court en collision | **scanner le QR** puis renvoyer |
| 409 | `reference_deja_utilisee` | même référence déjà enregistrée avec **une autre carte ou un autre montant** | ne pas renvoyer ; vérifier l'unicité des références |
| 409 | `vente_annulee` | cette référence a été créditée puis annulée : elle ne sera jamais recréditée | ne pas renvoyer ; créer une nouvelle vente avec une nouvelle référence si besoin |
| 422 | `boutique_inconnue` | code boutique absent de la liste du commerçant | ne pas renvoyer ; prévenir WinWin |
| 422 | `montant_hors_plafond` | montant au-delà du plafond par vente | vérifier l'unité (fils, pas AED ×100 deux fois) |
| 422 | `date_vente_invalide` | trop ancienne (> 7 jours) ou dans le futur | ne pas renvoyer |
| 429 | `trop_de_requetes` | limite de la clé atteinte | **renvoyer la même requête** après `Retry-After` |
| 503 | `service_indisponible` | WinWin momentanément indisponible | **renvoyer la même requête** après `Retry-After` |
| — | (pas de réponse, délai dépassé, coupure) | issue inconnue | **renvoyer la même requête** : jamais de double crédit |

### 4.4 Le numéro de téléphone (facultatif)

But : retrouver la carte du client s'il change de téléphone (§7). Le client ne saisit jamais
son numéro : il vient de la fiche client de la caisse.

- WinWin normalise le numéro (format international ; un numéro local sans indicatif est lu
  comme un numéro des **Émirats**) et applique la règle **un numéro = une carte par
  commerçant**.
- Valeurs possibles du champ `telephone` de la réponse :

| Valeur | Sens |
|---|---|
| `"rattache"` | numéro rattaché à la carte (elle n'en avait pas) |
| `"deja_rattache"` | la carte avait déjà ce numéro : rien changé |
| `"ignore_autre_numero"` | la carte a **déjà un autre** numéro : il n'est **jamais remplacé** par l'API (changement de numéro : auprès de WinWin) |
| `"ignore_numero_pris"` | ce numéro est déjà rattaché à **une autre carte** du commerçant : rien changé |
| `"ignore_invalide"` | numéro illisible : rien changé |
| `"non_traite"` | rattachement momentanément impossible (la vente, elle, est créditée) ; renvoyer le numéro à la prochaine vente suffit |

- **Cadre légal** : le commerçant est **responsable du traitement** des données de ses clients ;
  WinWin agit comme **sous-traitant**. La base légale du rattachement est couverte par le
  **contrat de sous-traitance** entre le commerçant et WinWin (j04), pas par un mécanisme dans
  le produit. WinWin n'envoie aucun SMS ni message au numéro.

### 4.5 La récompense, pas à pas

Même règle qu'au comptoir WinWin :

- **Points** (seuil 500) : solde 480, vente de 50 points → solde 530, `seuil_atteint: true`
  (récompense acquise). Vente suivante de 50 points → `recompense_a_remettre: true`, le solde
  repart du surplus : 530 − 500 + 50 = **80**.
- **Tampons** (seuil 10) : 9 → 10, `seuil_atteint: true`. Vente suivante →
  `recompense_a_remettre: true`, le solde repart à **0** (la vente de la remise ne donne pas de
  tampon).

### 4.6 Ce qui suit une vente

Comme au comptoir : la carte du client est mise à jour dans son téléphone ; après la vente qui
remet une récompense, la demande d'avis Google du commerçant part 30 minutes plus tard (si le
commerçant l'a activée). **Différence** : une vente reçue par l'API **ne déclenche pas** le
crédit de parrainage (il reste propre au comptoir WinWin).

## 5. Annuler une vente

`POST /api/v1/ventes/{reference}/annulation` — corps vide `{}`.

Annule le crédit d'une vente **tant qu'elle est le dernier mouvement de la carte** (aucune
vente, aucun passage au comptoir ni ajustement depuis). Il n'y a **pas** d'annulation partielle
ni de remboursement tardif : une vente remboursée après un autre passage du client reste
créditée ; le commerçant corrige au besoin depuis son espace WinWin.

| Statut | Corps | Sens |
|---|---|---|
| 200 | `{ "ok": true, "reference": "…", "solde": 455, "deja_annulee": false }` | annulée, solde remis à sa valeur d'avant la vente |
| 200 | `{ "ok": true, "reference": "…", "solde": 455, "deja_annulee": true }` | **déjà annulée** (renvoi) : rien changé, traiter comme un succès |
| 404 | `{ "error": "vente_inconnue" }` | aucune vente créditée sous cette référence (dont une vente à 0 point) |
| 409 | `{ "error": "pas_le_dernier_mouvement" }` | la carte a bougé depuis : non annulable par l'API |
| 409 | `{ "error": "solde_modifie" }` | le solde ne correspond plus à la vente : non annulable par l'API |
| 401, 429, 503 | comme §4.3 | |

Une référence annulée ne pourra **jamais** être recréditée (`409 vente_annulee`).

## 6. Lire le solde d'une carte (facultatif)

`GET /api/v1/cartes/{carte}` — `{carte}` = contenu du QR ou code court.

`200` : `{ "programme": "points", "solde": 455, "seuil": 500, "seuil_atteint": false }`.
Erreurs : `404 carte_inconnue`, `409 carte_ambigue`, 401, 429, 503.
À n'utiliser que pour afficher le solde **avant** la vente ; la réponse d'une vente donne déjà
le solde après.

## 6 bis. Reverser les points d'avant (migration, une fois par carte)

La caisse cumule déjà des points sous le numéro de téléphone de ses clients. Quand un client
installe sa carte WinWin, ces points peuvent y être **reversés une seule fois**.

`POST /api/v1/migrations`

```json
{ "carte": "3f6d2a1e-8b4c-4f0a-9d2e-7c1b5a9e0f12", "points": 320, "boutique": "DXB-014" }
```

| Champ | Obligatoire | Règle |
|---|---|---|
| `carte` | oui, sauf si `telephone` | contenu du QR ou code court (§3) |
| `telephone` | non | identifie le client si `carte` est absent (numéro rattaché, §3.1) |
| `points` | **oui** | entier **en points** (ou en tampons), déjà converti par le commerçant, de 1 à 100 000. **WinWin n'applique aucun taux** : la conversion des anciens points est une décision du commerçant. |
| `boutique` | non | code du point de vente où la migration est faite |

- **Une seule fois par carte** : la migration est enregistrée sous une clé propre à la carte.
  Renvoi avec le même nombre de points → `200` avec `deja_migree: true`, rien recrédité.
  Nouvel appel avec un autre nombre → `409 migration_deja_faite`, rien changé.
- **Même chemin que le crédit d'une vente**, marqué `origine = migration` : la carte est mise à
  jour dans le téléphone ; **pas** de demande d'avis, **pas** de parrainage ; la ligne ne compte
  **pas** comme un passage dans les statistiques et les relances du commerçant.
- **Carte qui a déjà atteint son seuil** (récompense en attente) : `409 recompense_en_attente`,
  rien changé ; la migration se fait après la remise.
- **Programme à tampons** : `points` (= tampons) au plus égal au seuil, sinon
  `422 points_hors_bornes` (au-delà du seuil, l'excédent serait perdu à la remise suivante).
- Réponse `200` : `{ "ok": true, "points_credites": 320, "solde": 320, "seuil": 500,
  "seuil_atteint": false, "deja_migree": false }`.
- Corriger une migration erronée : auprès de WinWin (ajustement depuis l'espace commerçant).
- Moment conseillé : dès que la réponse d'une vente indique `"telephone": "rattache"` (le
  client vient d'installer sa carte et son numéro y est lié).

## 7. Récupérer une carte (client qui a changé de téléphone)

Le client est **en magasin**, sur son nouveau téléphone, et sa fiche dans la caisse porte son
numéro (rattaché par une vente précédente, §4.4).

`POST /api/v1/recuperations`

```json
{ "telephone": "+971 50 123 4567", "boutique": "DXB-014" }
```

`201` :

```json
{
  "url": "https://app.winwin-card.com/r/4c1d…e9",
  "expire_le": "2026-10-21T10:42:05Z",
  "qrcode_png": "data:image/png;base64,iVBORw0KGgo…",
  "solde": 455
}
```

- La caisse **affiche le QR** (écran client, ticket) **ou envoie le lien** au client (SMS ou
  WhatsApp par ses propres moyens). Le client l'ouvre avec son nouveau téléphone et touche
  « Ajouter à Apple Wallet / Google Wallet » : il retrouve **la même carte, avec le même
  solde** ; l'ancienne reste valable sur l'ancien téléphone.
- Le lien est valable **10 minutes**. Chaque demande est tracée (boutique, heure).
- Vérification : le caissier s'assure que la personne est bien le client de la fiche (la
  caisse connaît son nom ; WinWin ne le renvoie pas).
- Erreurs : `404 telephone_inconnu` (aucune carte avec ce numéro chez le commerçant),
  `400 corps_invalide`, 401, 429 (**30 demandes par 15 minutes et par boutique**), 503.

## 8. Renvois et fiabilité : la règle d'or

**Toute requête sans réponse claire se renvoie à l'identique.** C'est sûr : la référence de
vente empêche tout double crédit, et une annulation déjà faite répond `deja_annulee`.

Conseillé : 3 essais à 2 s, 10 s et 60 s ; ensuite, garder la vente en file et la renvoyer
plus tard, **dans les 7 jours** (`date_vente` renseignée). Ne jamais changer la référence d'une
vente pour la renvoyer.

## 9. Sécurité et données

- HTTPS seul ; la clé ne transite que dans l'en-tête `Authorization`.
- WinWin ne renvoie aucune donnée personnelle ; le seul champ personnel reçu est `telephone`,
  stocké pour la récupération de carte et le crédit par numéro, effacé avec la carte à la
  demande du client. WinWin traite ce numéro en sous-traitant du commerçant (§4.4).
- Journaux WinWin : jamais la clé complète, jamais le numéro de téléphone.

## 10. Tester

- Une **clé de test** et un **commerçant de test** (« Black Tulip — test ») avec 3 boutiques
  de test et des cartes de test (identifiants et codes courts fournis), sur l'adresse de
  production. Mêmes règles, mêmes erreurs ; rien ne touche les vrais clients.
- Scénarios à dérouler avant la mise en service (liste de recette) : vente simple ; même vente
  renvoyée (`deja_enregistree`) ; carte par code court ; carte inconnue ; montant hors
  plafond ; vente à 0 point ; seuil atteint puis remise ; annulation puis renvoi de
  l'annulation ; annulation refusée après une autre vente ; numéro rattaché puis récupération ;
  vente par numéro (carte rattachée, puis numéro inconnu → lien d'installation) ; migration
  des points puis renvoi de la migration ; coupure réseau simulée (renvoi) ; **WinWin coupé :
  la vente est encaissée et l'appel part plus tard**.

## 11. Versions

- Ajouts compatibles (nouveau champ de réponse, nouvelle route, nouveau code d'erreur) :
  **sans changer `/v1`**. La caisse ignore les champs qu'elle ne connaît pas.
- Changement incompatible : nouvelle version (`/v2`), l'ancienne maintenue au moins 6 mois.

---

# Partie II — Implémentation côté WinWin (pour le développeur)

## 12. Où vit le code

Zone `src/integration/` (architecture et conventions : `README.md`) :

```
src/integration/
  index.js               monte la zone (une ligne dans src/index.js)
  api-v1/
    index.js             routeur /api/v1 : clé, limiteur par clé, erreurs JSON
    cle.js               vérification de la clé (empreinte, cache 60 s, révocation)
    ventes.js            POST /ventes, POST /ventes/:reference/annulation
    cartes.js            GET /cartes/:carte
    migrations.js        POST /migrations
    recuperations.js     POST /recuperations
  recuperation.js        /r/:jeton, /api/recuperation/:jeton (repris des briques)
services/credit.js       le crédit partagé par le comptoir et l'API (voir §13)
public/recuperation.html (repris des briques)
```

Le comptoir (`src/routes/scan.js`) et l'API passent **par la même fonction de crédit**.

## 13. Le chemin de crédit partagé

Aujourd'hui, la résolution de la carte, `crediter_scan` et les effets d'après (mise à jour
Apple / Google, parrainage, demande d'avis 30 min après une remise) vivent dans la route du
scan. Proposition : **extraire** la résolution de carte et les effets d'après dans
`services/credit.js`, appelés par la route du scan **sans changer son comportement** (prouvé
par les ~350 contrôles du filet, inchangés), par `POST /ventes` et par `POST /migrations`.
`crediter_scan` (la transaction d'argent) n'est **pas modifiée**. Le module reçoit des options
explicites : canal (`comptoir` / `caisse`), origine (`passage` / `migration`), parrainage
(comptoir seulement), demande d'avis (pas pour une migration).

## 14. Base de données (une migration, exécutée avant le code)

| Objet | Contenu |
|---|---|
| `api_cles` (table) | `id`, `marchand_id`, `prefixe` (8 premiers caractères, pour le support), `empreinte` (sha256, unique), `environnement` (`live` / `test`), `cree_le`, `revoquee_le`, `derniere_utilisation`. RLS + droits `service_role`. |
| `marchands.fils_par_point` | entier > 0, défaut 100 (1 point par AED) |
| `marchands.plafond_vente_fils` | entier > 0, défaut 5 000 000 (50 000 AED) |
| `points_de_vente.code_externe` | code de la boutique chez le commerçant, unique par marchand |
| `scans.canal` | `comptoir` (défaut, tout l'existant) / `caisse` |
| `scans.origine` | `passage` (défaut, tout l'existant) / `migration` ; une ligne `migration` est **exclue** des comptages de passages (statistiques `apercu_stats`, segments, relances d'inactivité) |
| migration une fois par carte | `cle_idempotence = uuid_v5(espace WinWin, marchand_id + ':migration:' + client_id)` : l'index unique t43 garantit l'unicité, sans table de plus |
| `scans.reference_externe`, `scans.montant_fils`, `scans.vendu_le` | pour l'affichage, le support, et la détection « même référence, autre montant » |
| idempotence | `cle_idempotence = uuid_v5(espace WinWin fixe, marchand_id + ':' + reference)` : index unique t43 existant, rien à ajouter |
| téléphone | **migration 066** des briques (normalisation, unicité, `recuperations_carte`, fonctions), **ajustée** : rôle `api` accepté dans `recuperations_carte` ; rattachement source `caisse` **sans** ligne `consentements` (base légale : contrat de sous-traitance) ; recherche de carte par numéro pour le crédit (§3.1) |
| solde jamais négatif | **déjà en production** : `clients_stored_value_non_negatif` (migration 051, `CHECK (stored_value >= 0)`, posée validée ; relevée en production le 19/10) |

`crediter_scan` reçoit le canal, la référence et le montant en fils : soit par de nouveaux
paramètres facultatifs (défauts = comportement d'aujourd'hui), soit par une mise à jour de la
ligne de journal juste après, dans la même transaction. Choix d'implémentation à trancher en
revue (le second ne touche pas la fonction d'argent).

## 15. Ce qui ne change pas

Le comptoir (scan, caisse WinWin, dashboard), les cartes, les notifications : inchangés. Les
écrans « + Numéro » / « Retrouver une carte » de la caisse WinWin restent **remisés**
(`briques/f04-telephone`). L'admin gagne : création / révocation des clés, réglage
`fils_par_point` et `plafond_vente_fils`, codes externes des boutiques.

## 16. Tests (avant tout push)

Chaque ligne des tableaux §4.3, §5, §6, §6 bis, §7 est un contrôle du filet ; plus : l'invariant
§0 (aucune réponse ne dépasse le délai serveur ; base coupée → 503 rapide) ; les lignes de
migration absentes des statistiques et des segments ; aucune demande de parrainage sur une
vente API ; les renvois
simultanés (deux mêmes ventes en parallèle → un seul crédit), la révocation, le limiteur par
clé, l'absence de toute donnée personnelle dans chaque réponse, le comptoir inchangé (filet
existant), la contre-épreuve sur le code en production.

## 17. Couverture des inconnues (posture : on ne dépend pas du technicien)

| Inconnue (question B) | Cas A | Cas B | Couvert par |
|---|---|---|---|
| B1 Appel à chaque vente ? | oui | non (pas d'appel sortant) | A : ce contrat. B : un dépôt de fichier quotidien des ventes (même champs) est possible plus tard, **hors v1**. |
| B2 Chaque caisse ou serveur central ? | caisses | central | une clé par commerçant, valable des deux ; `boutique` dans chaque appel ; limite par clé |
| B3 Synchrone ou après coup ? | pendant la vente | en file, plus tard | réponse immédiate ; `date_vente` + 7 jours de délai ; renvois sûrs |
| B4 Lecture du QR ? | oui | non | `carte` = QR **ou** code court |
| B5 Référence unique ? | oui | non | **exigée** : sans référence stable, pas d'intégration (la protection contre le double crédit en dépend) |
| B6 Code magasin ? | oui | non | A : `boutique` mappé. B : ventes non attribuées (mono-site ou statistiques sans boutique) |
| B7 Montant TTC, fils ? | oui | AED décimaux | **imposé en fils entiers** ; la conversion est faite côté caisse |
| B8 Points ou tampons ? | points | tampons | les deux (§4.2) |
| B9 Remboursements ? | envoyés | non | annulation du dernier mouvement ; refus clair sinon, sans boucle |
| B10 Affichage du solde ? | oui | non | réponse de vente + lecture facultative |
| B11 Volume, pics ? | — | — | 600 / min / clé, réglable |
| B12 Renvois automatiques ? | oui | non | idempotence ; recommandations §8 |
| B13 Test ? | oui | non | commerçant de test sur la production |
| B14 Clé secrète ? | serveur | dans la caisse | la clé reste dans la configuration protégée ; révocation rapide |
| B15 Téléphone joint ? | oui | non | facultatif ; sans lui, ni récupération ni crédit par numéro ni migration par numéro (la migration reste possible avec la carte) |
| B16 Export ? | oui | non | non nécessaire (rattachement au fil des ventes) |

---

# Partie III — Décisions

## Verrouillées par le pilotage (20/10)

- **Invariant** : WinWin est additif, jamais bloquant (§0).
- **Montant** : en fils entiers, imposé.
- **Parrainage** : **non** pour l'API (gardé au comptoir WinWin).
- **Avis Google** : **oui**, comme au comptoir, aligné sur l'offre commerciale.
- **Téléphone, cadre légal** : pas de mécanisme de consentement dans le produit. Modèle
  sous-traitant : le commerçant est responsable du traitement, WinWin sous-traitant ; base
  légale par le contrat de sous-traitance (j04). Aucun garde-fou codé sur le numéro (WinWin
  n'envoie aucun SMS) ; à revoir avec f11.
- **Crédit par téléphone (#16)** : **oui** quand le numéro est rattaché à une carte ; **jamais
  de crédit sans carte** (lien d'installation à la place).
- **Migration des points existants** : un crédit unique par carte, idempotent, marqué
  `origine = migration`, par le chemin de crédit existant ; **le taux de conversion n'est pas
  codé** (décision métier différée, avec les décisionnaires) : l'API reçoit des points déjà
  convertis.
- **Valeurs par défaut acceptées** : 100 fils = 1 point (arrondi inférieur), vente à 0 point
  non enregistrée ; plafond 50 000 AED par vente ; 1 tampon par vente ; récompense comme au
  comptoir ; mise à jour de la carte toujours ; boutique obligatoire pour un réseau (code
  inconnu refusé) ; ventes en retard jusqu'à 7 jours ; annulation renvoyée = succès
  `deja_annulee` ; 600 requêtes / min / clé, 30 récupérations / 15 min / boutique ; révocation
  en 60 s ; commerçant de test sur la production ; pas de liste blanche d'adresses en v1 ;
  contrat remis au technicien en anglais ; changement de numéro jamais par l'API ;
  récupération en magasin, self-service plus tard (f11) ; crédit partagé extrait du scan
  (comportement prouvé inchangé) ; canal / origine / référence écrits dans la même transaction
  sans toucher `crediter_scan` ; dépôt de fichier quotidien hors v1.

## Restant à trancher (proposition entre crochets, elle fait foi sans autre décision)

1. **« Carte installée »** pour le crédit par téléphone : [une carte WinWin existante et non
   effacée, dont le numéro est rattaché]. Exiger la preuve d'installation dans le portefeuille
   n'est fiable que côté Apple (appareil enregistré) ; côté Google, WinWin ne voit que le clic
   et une vérification ponctuelle.
2. **Migration sur une carte au seuil** : [refus `409 recompense_en_attente`, à refaire après la
   remise]. En tampons : [au plus le seuil, sinon refus] — sinon l'excédent serait perdu à la
   remise (règle actuelle des tampons, sans report).
3. **Migration, plafond** : [1 à 100 000 points, comme le pavé du comptoir].
4. **Migration, correction** : [par un ajustement depuis l'espace commerçant ; pas d'annulation
   par l'API].
5. **Migration, moment** : [à l'initiative de la caisse, conseillé dès `telephone: rattache`] ;
   WinWin ne déclenche rien seul.
6. **Lien d'installation** renvoyé avec `404 carte_inconnue` : [la page d'inscription du
   commerçant (`/l/<slug>`), sans pré-remplissage du numéro].
