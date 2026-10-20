# API WinWin v1 — contrat pour les caisses des commerçants

**Version** : brouillon 1 du 20/10/2026, **à valider par le pilotage** avant toute
implémentation. Rien n'est codé.
**Premier intégrateur** : Black Tulip (35 points de vente, Dubaï, caisse développée en
interne).
**Lecteurs** : (1) le technicien de la caisse, qui construit contre ce document ; (2) le
développeur WinWin qui l'implémente (partie II). Les choix encore ouverts sont listés en
partie III ; tant qu'ils ne sont pas tranchés, la valeur proposée ici fait foi.

Documents voisins : `01-api-caisses-cadrage.md` (cadrage, questions au technicien),
`README.md` (architecture de la zone `src/integration/`), passation §0.5 bis.

---

# Partie I — Le contrat (ce que le technicien lit)

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
  rattaché à la carte et sert à **récupérer la carte** si le client change de téléphone.

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
  demander un lien de récupération. **Rien d'autre** (aucune liste de clients, aucune donnée
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
| `carte` | **oui** | contenu du QR ou code court (§3). |
| `montant` | **oui** | **entier en fils** (1 AED = 100 fils), montant **payé** par le client (TTC, remises déduites), strictement positif. `185,00 AED` → `18500`. Jamais de virgule ni de chaîne. |
| `devise` | non | `"AED"` seulement. Absent = `AED`. Toute autre valeur : `400`. |
| `boutique` | oui si le commerçant a plusieurs boutiques | **code du point de vente** chez le commerçant, tel que transmis à WinWin à l'ouverture (liste des 35 codes). Inconnu ou fermé : voir §4.3. |
| `date_vente` | non | date et heure de la vente (ISO 8601 avec fuseau). Absente = l'heure de réception. Sert à l'historique ; la vente est créditée à réception. Plus de 7 jours dans le passé, ou dans le futur au-delà de 5 minutes : `422 date_vente_invalide`. |
| `telephone` | non | numéro du client tel qu'il est dans la fiche de la caisse, **tout format** (`050 123 4567`, `+971501234567`, `00971…`). Rattaché à la carte (§4.4). **Ne fait jamais échouer la vente.** |

Tout autre champ est ignoré (compatibilité future).

### 4.2 Ce que fait WinWin

1. Vérifie la clé, le corps, la boutique.
2. Trouve la carte (§3).
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

**Erreurs** — corps toujours `{ "error": "<code>" }`, parfois avec un champ `champ` :

| Statut | `error` | Signification | Que faire côté caisse |
|---|---|---|---|
| 400 | `corps_invalide` (+ `champ`) | champ manquant ou mal formé | corriger l'intégration ; **ne pas** renvoyer tel quel |
| 401 | `cle_invalide` | clé absente, fausse ou révoquée | alerter le support, ne pas renvoyer |
| 403 | `commercant_suspendu` | programme de fidélité suspendu | ne pas renvoyer |
| 403 | `boutique_fermee` | boutique désactivée chez WinWin | ne pas renvoyer ; prévenir le siège |
| 404 | `carte_inconnue` | carte inconnue chez ce commerçant | afficher « Carte non reconnue » ; vente encaissée sans fidélité |
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

- **En envoyant un numéro, le commerçant atteste que le client a accepté** qu'il serve à
  retrouver sa carte (clause du contrat commercial).

### 4.5 La récompense, pas à pas

Même règle qu'au comptoir WinWin :

- **Points** (seuil 500) : solde 480, vente de 50 points → solde 530, `seuil_atteint: true`
  (récompense acquise). Vente suivante de 50 points → `recompense_a_remettre: true`, le solde
  repart du surplus : 530 − 500 + 50 = **80**.
- **Tampons** (seuil 10) : 9 → 10, `seuil_atteint: true`. Vente suivante →
  `recompense_a_remettre: true`, le solde repart à **0** (la vente de la remise ne donne pas de
  tampon).

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
  stocké pour la récupération de carte, effacé avec la carte à la demande du client.
- Journaux WinWin : jamais la clé complète, jamais le numéro de téléphone.

## 10. Tester

- Une **clé de test** et un **commerçant de test** (« Black Tulip — test ») avec 3 boutiques
  de test et des cartes de test (identifiants et codes courts fournis), sur l'adresse de
  production. Mêmes règles, mêmes erreurs ; rien ne touche les vrais clients.
- Scénarios à dérouler avant la mise en service (liste de recette) : vente simple ; même vente
  renvoyée (`deja_enregistree`) ; carte par code court ; carte inconnue ; montant hors
  plafond ; vente à 0 point ; seuil atteint puis remise ; annulation puis renvoi de
  l'annulation ; annulation refusée après une autre vente ; numéro rattaché puis récupération ;
  coupure réseau simulée (renvoi).

## 11. Versions

- Ajouts compatibles (nouveau champ de réponse, nouvelle route, nouveau code d'erreur) :
  **sans changer `/v1`**. La caisse ignore les champs qu'elle ne connaît pas.
- Changement incompatible : nouvelle version (`/v2`), l'ancienne maintenue au moins 6 mois.

---

# Partie II — Implémentation côté WinWin (pour le développeur, à valider)

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
par les ~350 contrôles du filet, inchangés) et par `POST /ventes`. `crediter_scan` (la
transaction d'argent) n'est **pas modifiée**.

## 14. Base de données (une migration, exécutée avant le code)

| Objet | Contenu |
|---|---|
| `api_cles` (table) | `id`, `marchand_id`, `prefixe` (8 premiers caractères, pour le support), `empreinte` (sha256, unique), `environnement` (`live` / `test`), `cree_le`, `revoquee_le`, `derniere_utilisation`. RLS + droits `service_role`. |
| `marchands.fils_par_point` | entier > 0, défaut 100 (1 point par AED) |
| `marchands.plafond_vente_fils` | entier > 0, défaut 5 000 000 (50 000 AED) |
| `points_de_vente.code_externe` | code de la boutique chez le commerçant, unique par marchand |
| `scans.canal` | `comptoir` (défaut, tout l'existant) / `caisse` |
| `scans.reference_externe`, `scans.montant_fils`, `scans.vendu_le` | pour l'affichage, le support, et la détection « même référence, autre montant » |
| idempotence | `cle_idempotence = uuid_v5(espace WinWin fixe, marchand_id + ':' + reference)` : index unique t43 existant, rien à ajouter |
| téléphone | **migration 066** des briques (normalisation, unicité, `recuperations_carte`, fonctions), **ajustée** : rôle `api` accepté dans `recuperations_carte`, source `caisse` |
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

Chaque ligne des tableaux §4.3, §5, §6, §7 est un contrôle du filet ; plus : les renvois
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
| B15 Téléphone joint ? | oui | non | facultatif ; sans lui, pas de récupération v1 |
| B16 Export ? | oui | non | non nécessaire (rattachement au fil des ventes) |

---

# Partie III — Décisions restant à trancher (pilotage / Yass)

La valeur entre crochets est celle que ce brouillon propose ; elle fait foi tant que rien
d'autre n'est décidé.

**Argent et règles**
1. Conversion par défaut : [100 fils = 1 point, arrondi inférieur]. Vente qui donne 0 point :
   [rien crédité, réponse 200 `enregistree: false`].
2. Plafond par vente par défaut : [50 000 AED].
3. Programme à tampons : [1 tampon par vente, sans montant minimum].
4. Récompense : [même règle qu'au comptoir : acquise au seuil, remise automatiquement à la vente
   suivante, qui dit `recompense_a_remettre`].
5. Effets du comptoir sur une vente caisse : mise à jour de la carte [oui, toujours] ;
   parrainage [oui, comme au comptoir] ; demande d'avis Google 30 min après une remise [oui,
   comme au comptoir].

**Contrat**
6. Boutique : [obligatoire pour un commerçant à plusieurs boutiques ; code inconnu → 422].
   Autre choix : accepter et classer en « non attribué ».
7. Vente envoyée en retard : [acceptée jusqu'à 7 jours].
8. Annulation renvoyée : [200 `deja_annulee: true`] plutôt que 409.
9. Limites : [600 requêtes / min / clé] ; récupérations [30 / 15 min / boutique].
10. Révocation d'une clé : [effective en 60 s au plus] (cache de la clé).
11. Test : [commerçant de test sur la production] plutôt qu'un environnement séparé.
12. Liste blanche d'adresses IP par clé : [non en v1] (proposée si leur caisse appelle d'un
    serveur central à adresse fixe).
13. Langue du contrat remis au technicien : [anglais, traduit de ce document validé].

**Téléphone (f04)**
14. Consentement : [clause du contrat commercial : le commerçant atteste l'accord du client]
    — zone grise RGPD / PDPL, à Yass.
15. Changement de numéro : [jamais par l'API ; sur demande à WinWin (admin) en v1].
16. Téléphone comme identifiant de crédit (vente sans carte) : [non en v1 ; la carte est
    toujours présentée].
17. Récupération : [déclenchée en magasin par la caisse ; self-service par SMS plus tard (f11)].

**Implémentation**
18. Chemin de crédit partagé : extraire du scan la résolution de carte et les effets d'après
    vers `services/credit.js` [oui, comportement du comptoir inchangé, prouvé par le filet] —
    touche le fichier du scan.
19. Écriture du canal, de la référence et du montant en fils : [mise à jour de la ligne de
    journal dans la même transaction, sans toucher `crediter_scan`] ou nouveaux paramètres de
    `crediter_scan`.
20. Cas « pas d'appel à chaque vente » (B1 = non) : dépôt de fichier quotidien [hors v1].
