# Connecteur Hubrise — diagnostic et proposition (05/11/2026, rien codé)

> **Mise à jour du 05/11 (soir)** : H0 construit en local (migration 074, rien poussé) ;
> D1, D2, D6 tranchés et I1 levé par le pilotage : voir §8 et §9. Le reste du connecteur
> (H1 à H4) n'est pas codé ; les autres inconnus se lèvent avec le compte dev Hubrise,
> avant H2.
>
> **Statut d'origine** : diagnostic seul. Zéro code, zéro migration, rien poussé. Tout ce qui suit
> attend le feu vert de Yass. Les affirmations sur notre code citent le fichier ; celles sur
> Hubrise reprennent le modèle donné par le pilotage, et les points que je n'ai pas vérifiés
> moi-même sont listés au §9 (« inconnus »).
>
> **Périmètre** : France / UE. Dubaï reste sur l'API directe (Black Tulip, `docs/api/`).
> Lecture seule (`orders.read` + `customer_list.read`) ; l'écriture `loyalty_operations` est
> hors v1.

---

## 0. En une page

- **Où** : un module voisin de l'API v1, `src/integration/hubrise/`, monté par la même ligne
  que le reste de la zone (`src/integration/index.js`). Le comptoir, la carte et le dashboard
  ne l'appellent jamais. Une panne Hubrise ne touche jamais une caisse WinWin.
- **Preuve d'origine** : signature HMAC-SHA256 du corps brut, avec le secret de notre app
  Hubrise. Elle oblige à **garder le corps brut** : aujourd'hui `express.json` global le
  consomme avant la zone (`src/index.js:44`). Il faut une ligne de plus dans le parseur global.
  Ensuite, la `location` du callback doit correspondre à une connexion active chez nous.
- **Idempotence** : la clé t43 (`scans.cle_idempotence`, index unique `(marchand_id, clé)`,
  migration 051) = **UUID v5 de `hubrise:<location_id>:<order_id>`** dans un **espace neuf et
  figé**. Que Hubrise renvoie 6 fois, ou que `create` puis `update` arrivent, il y a un seul
  crédit, et c'est `crediter_scan` qui le garantit, sous verrou.
- **Carte** : seulement par le téléphone du `customer`, avec `trouver_carte_par_telephone`
  (migration 068). Pas de client, pas de téléphone ou pas de carte rattachée à ce numéro :
  **aucun crédit**, et l'événement est noté.
- **Crédit** : une fonction SQL neuve, `crediter_commande_hubrise`, qui appelle
  `crediter_scan` (non modifiée) et marque la ligne `canal = 'hubrise'`, comme
  `crediter_vente` le fait pour `'caisse'`. La conversion reprend `fils_par_point` et
  `plafond_vente_fils` (le centime remplace le fils).
- **Connexion** : flux OAuth « Connect » lancé depuis l'admin WinWin. Le jeton est **chiffré**
  en base (il faut pouvoir le relire, donc pas d'empreinte), avec une ligne par `location`.
  Le callback est enregistré à la connexion.

**Deux trous à combler AVANT le connecteur (trouvés dans le code)** :
1. **Le téléphone est normalisé « Émirats »** (`normaliser_telephone`, migration 068). Un
   « 06 12 34 56 78 » tapé sur une landing française donne `NULL`, donc impossible à
   retrouver. Un « 05 … » français devient même **+971 5…** (faux numéro, à cause de la règle
   `^05[0-9]{8}$`). Le mapping par téléphone est donc **inopérant en France** tant que la règle
   ne dépend pas du pays du marchand (§4.2).
2. **Double crédit comptoir + Hubrise** : si le caissier scanne aussi la carte WinWin pour la
   même vente, rien ne relie les deux (clés différentes). Il faut une règle produit (§4.5).

---

## 1. Où se branche le récepteur, et comment on le reconnaît

### 1.1 Ce qui existe (vérifié)

- `src/index.js:147` monte toute la zone par une seule ligne : `app.use(require('./integration'))`.
- `src/integration/index.js` répartit : `/api/v1` (API machine, clé du marchand),
  `/api/admin` (clés, codes caisse) et `/r` (récupération).
- `src/index.js:44` : `express.json({ limit: '2mb' })` **global, avant toute route**.
  Le corps brut est perdu quand la zone le reçoit.
- `src/index.js:61-72` : le limiteur global (300 requêtes par 15 min **par adresse**) ne
  laisse passer que `/v1/` et `/api/v1/`. Les callbacks Hubrise partent d'un petit nombre
  d'adresses Hubrise : un marchand actif, ou plusieurs, l'épuiseraient. **Il faut l'en
  sortir**, comme `/api/v1`.

### 1.2 Proposition de structure

```
src/integration/
  index.js                 + router.use(require('./hubrise'))           (1 ligne)
  hubrise/
    index.js               monte /integrations/hubrise/* ; en-tête de zone (comme api-v1/index.js)
    signature.js           HMAC-SHA256 du corps brut, comparaison à temps constant
    callback.js            POST /integrations/hubrise/callback : vérifier, décider, créditer, répondre
    commande.js            PUR (aucun accès réseau ni base) : commande Hubrise → { statut, montant_centimes,
                           telephone, vendu_le, decision } ; testable seul, cœur des cas limites
    connexions.js          lecture et écriture de hubrise_connexions ; chiffrement du jeton (AES-256-GCM)
    oauth.js               GET /integrations/hubrise/connexion (départ) et /retour (code → jeton)
    api-hubrise.js         appels sortants : échange du code, enregistrement du callback, test du jeton
    admin.js               /api/admin/hubrise/… : lister les connexions, couper, rattacher une boutique
  credit-vente.js          (extrait de api-v1/ventes.js, étapes 4 à 6 : conversion, crediter_*, carte,
                           avis), partagé par /api/v1/ventes et Hubrise ; ventes prouvées inchangées
```

Pourquoi `/integrations/hubrise/*` plutôt que `/api/v1/…` : ce n'est pas notre API, c'est
**leur** appel entrant, avec une autre authentification (signature, pas de clé Bearer). Le
garder hors du routeur `api-v1` évite que `authCle` (`api-v1/index.js:44`) ne s'y applique
par erreur.

### 1.3 Vérifier qu'un callback vient de Hubrise : trois couches

1. **Signature** : Hubrise signe chaque callback d'un HMAC-SHA256 du corps, calculé avec le
   `client_secret` de notre app (en-tête à confirmer, a priori `X-HubRise-Hmac-SHA256`,
   §9). On recalcule sur **les octets reçus**, jamais sur un JSON re-sérialisé, et on compare
   avec `crypto.timingSafeEqual`. Échec : **401**, compté par adresse, comme les échecs de
   clé (`api-v1/index.js:37`).
   - Garder le corps brut, à faire en un geste minimal dans `src/index.js:44` :
     `express.json({ limit: '2mb', verify: (req, _res, buf) => { if (req.originalUrl.startsWith('/integrations/hubrise/callback')) req.corpsBrut = buf; } })`.
     C'est une référence au tampon déjà lu, sans copie. Rien d'autre ne bouge.
2. **Connexion connue et active** : le `location_id` (et l'`account_id`) du callback doivent
   désigner une ligne active de `hubrise_connexions`. Sinon : **200 ignoré**, car répondre en
   erreur ferait insister Hubrise 6 fois pour rien. Une connexion coupée chez nous ne crédite
   plus, même si Hubrise continue d'envoyer.
3. **Défense en profondeur, optionnelle (non proposée en v1)** : relire la commande avec
   `GET /locations/:id/orders/:id` et le jeton avant de créditer. Coût : un appel sortant
   par commande et une dépendance de plus. La signature suffit si le secret reste secret.
   C'est noté comme levier, si un doute naît un jour.

### 1.4 Ce que répond le récepteur : la file d'attente gratuite

Hubrise renvoie un callback jusqu'à 6 fois (1 à 32 min) tant qu'il n'a pas de 2xx. On s'en
sert comme d'une file :

| Cas | Réponse | Hubrise renvoie ? |
|---|---|---|
| crédit fait, ou déjà fait (renvoi) | 200 | non |
| décision « rien à créditer » (invité, sans téléphone, sans carte, statut non retenu, 0 point, connexion coupée) | 200 | non |
| signature fausse | 401 | oui, puis abandon (c'est voulu) |
| base lente ou en panne, `crediter_*` en erreur | **503** | **oui** : la vente sera créditée au renvoi |
| corps illisible | 400 | oui, puis abandon (noté) |

Limite assumée : si la base reste en panne plus d'une heure environ (6 essais), la commande
n'est jamais créditée. Le journal `hubrise_evenements` (§6) ne la voit pas non plus, puisque
la base est en panne. Le seul rattrapage serait une relecture des commandes par l'API Hubrise.
C'est hors v1, et noté.

---

## 2. Idempotence (t31 / t43)

### 2.1 Ce qui existe (vérifié)

- `scans.cle_idempotence` (uuid) et l'index unique `scans_cle_idempotence_unique (marchand_id, cle_idempotence)`
  (migration 051).
- `crediter_scan` prend **le verrou de la carte, puis** lit la clé
  (`migration_051_credit_incassable.sql`, étapes 1 et 2). Deux callbacks simultanés pour la
  même commande sont donc **sérialisés**. Le second voit la ligne du premier et rend
  `deja_enregistre`. Même clé avec une autre carte, ou (en points) un autre montant :
  `cle_autre_scan`, rien n'est écrit. Scan annulé depuis : `scan_annule`, jamais recrédité.
- L'API v1 dérive déjà sa clé : `uuidv5("<marchand>:<référence>", ESPACE_VENTES)`
  (`api-v1/ventes.js:39`, `:110`), avec un espace figé « à ne jamais changer ».

### 2.2 Proposition

- **Clé = `uuidv5("hubrise:<location_id>:<order_id>", ESPACE_HUBRISE)`**, avec un **nouvel
  espace** UUID figé, écrit en constante et commenté « NE JAMAIS CHANGER », comme
  `ESPACE_VENTES`.
  - Un espace à part : aucune collision possible avec une référence Black Tulip, même si un
    marchand avait un jour les deux canaux.
  - `location_id` dans la clé : on ne suppose pas que l'identifiant de commande Hubrise est
    unique hors de sa location (§9, à confirmer). C'est sans coût si c'est le cas.
  - **La clé ne dépend que de la commande**, jamais de l'identifiant du callback ni du type
    d'événement. Ainsi `order.create` ×6, puis `order.update` ×n, créditent au plus une fois.
- `crediter_commande_hubrise` reprend le contrôle de `crediter_vente` : déjà enregistrée,
  mais pas en `canal = 'hubrise'` ou avec un autre `montant_fils` → `cle_autre_scan`.
- **Création puis mise à jour** :
  - commande « invitée » à la création, client attaché par une mise à jour : le premier
    événement qui remplit toutes les conditions crédite (une commande invitée n'a rien écrit,
    il n'y a donc pas de clé à heurter) ;
  - montant modifié après le crédit : `cle_autre_scan`, rien n'est écrit, l'événement est
    noté `montant_modifie`. **Limite v1** : pas d'ajustement automatique, correction à la
    main dans la fiche client.
  - commande annulée après crédit : voir le §4.4.

---

## 3. Mapping commande → carte par le téléphone

### 3.1 Ce qui existe (vérifié)

- `trouver_carte_par_telephone(marchand, brut)` (migration 068), appelée par
  `api-v1/telephone.js:15`, rend la carte non effacée rattachée à ce numéro **normalisé**,
  `numero_invalide` ou rien.
- Unicité : `clients_telephone_unique (marchand_id, telephone_normalise)`. Un numéro désigne
  au plus une carte par marchand : jamais de carte devinée.
- **Le numéro n'est collecté à l'inscription que sur la landing premium**
  (`public/landing.html:880-887` : le champ `field-telephone` n'apparaît que si
  `landing_premium_actif`). Sans landing premium, presque aucune carte n'a de numéro, et le
  connecteur ne crédite presque rien. **Le taux de réussite du connecteur est plafonné par la
  part de cartes qui ont un numéro.**

### 3.2 Règle proposée (invariant dur)

```
crédit ⇔ connexion active
        ∧ statut de commande retenu (§4.3)
        ∧ commande.customer présent
        ∧ customer.phone présent et normalisable (règle du PAYS du marchand, §4.2)
        ∧ trouver_carte_par_telephone → une carte non effacée
        ∧ points > 0 (ou programme tampons)
sinon : aucun crédit, 200, décision notée (sans le numéro)
```

- **Jamais de rattachement** de numéro par Hubrise : la commande n'apporte aucun identifiant
  de carte, il n'y a rien à quoi rattacher. Le sens est unique, numéro → carte existante.
- **Jamais de création de carte** : un client de la caisse sans carte WinWin n'est pas
  inscrit en silence (consentement, RGPD).
- **Minimisation** : du `customer`, on ne lit que `phone`. Le nom, l'e-mail, la date de
  naissance, les `loyalty_cards` et les `custom_fields` ne sont **ni lus, ni écrits, ni
  journalisés**. Le numéro n'apparaît jamais dans les journaux (même règle que
  `api-v1/telephone.js`).
- **« Carte installée »** : le code ne sait pas, de façon fiable, si une carte est dans un
  wallet. La fiche `clients` existe dès l'inscription. Apple n'est connu que par
  `device_tokens`, et Google seulement par « lien ouvert » (`passes.google_ouvert_le`), ce
  qui ne prouve pas l'installation (`services/canal-google.js:5-13`). **Proposition** : même
  règle que l'API v1, une carte = une fiche client non effacée chez ce marchand. Créditer
  une carte pas encore ajoutée au wallet ne coûte rien : le solde est juste quand le client
  l'ajoute. Exiger « installée » au sens Apple exclurait à tort les cartes Google. **À
  trancher** (§8, D1).

---

## 4. Le crédit

### 4.1 Chemin : la logique interne, pas l'endpoint `/ventes`

Ce qui existe : `POST /api/v1/ventes` (`api-v1/ventes.js`) fait, dans l'ordre :
1. lecture du corps ;
2. marchand et boutiques ;
3. carte ;
4. conversion ;
5. `crediter_vente` (RPC) ;
6. après la réponse : mise à jour de la carte (Apple, Google, déjà tracée dans
   `notification_envois` sous la source `scan`), puis avis Google après une remise.

**Proposition** : sortir les étapes 4 à 6 dans `src/integration/credit-vente.js` (même geste
que `identification.js` à l'étape 4), paramétré par la fonction SQL et le canal, puis :
- le prouver **sans effet sur `/ventes`** (le filet API v1 entier passe avant d'ajouter
  Hubrise) ;
- l'appeler depuis `hubrise/callback.js`.

On n'appelle pas `/ventes` en HTTP depuis nous-mêmes : ce serait une clé d'API de plus à
gérer, le limiteur par clé, un aller réseau, et une devise figée à `AED`
(`ventes.js:59`).

- **Pas de parrainage** (comme l'API, propre au comptoir) ; **avis Google après remise :
  oui** (comme l'API). À confirmer (§8, D5).
- **Envois** : aucune nouvelle surface d'envoi. La carte est mise à jour par
  `services/mise-a-jour-carte.js`, déjà tracée dans `notification_envois` (CLAUDE.md
  respecté). Tracer sous une source `hubrise` demanderait d'élargir
  `notification_envois_source_check` (migration 063). Ce n'est pas proposé : la source dit
  *pourquoi* on envoie (un crédit), le canal du scan dit *d'où* vient le crédit.

### 4.2 Prérequis : le téléphone selon le pays du marchand (bloquant pour la France)

Ce qui existe (`migration_068_telephone_carte.sql:46-59`) : `normaliser_telephone(brut)`
est `IMMUTABLE` et **à un seul argument**, avec les Émirats par défaut. La colonne générée
`clients.telephone_normalise` l'utilise.

| Saisi en France | Aujourd'hui | Attendu |
|---|---|---|
| `+33 6 12 34 56 78` | `+33612345678` ✔ | idem |
| `06 12 34 56 78` | **`NULL`** (ni 9 chiffres, ni « 05 ») | `+33612345678` |
| `0033 6 12 34 56 78` | `+33612345678` ✔ | idem |
| `05 56 12 34 56` (fixe Sud-Ouest) | **`+971556123456`** ✘ (faux numéro) | `+33556123456` |

Une colonne générée ne peut pas lire `marchands`. **Proposition** (migration dédiée, morceau
H0) :
- `marchands.pays` (`'AE'` par défaut, `'FR'`, liste fermée), réglé dans l'admin ;
- `clients.pays_telephone` (copié du marchand à l'inscription ; rempli pour l'existant) ;
- une fonction **au nom neuf**, `normaliser_telephone_pays(brut, pays)` : une seule signature
  par nom (piège §3.3 de la passation). L'ancienne fonction reste, elle appelle la nouvelle
  avec `'AE'`, ce qui ne change rien à Dubaï ;
- la colonne générée est redéfinie sur `(telephone, pays_telephone)`. Cela **réécrit
  `clients`** (5,6 s mesurées pour 100 000 lignes ; ≈ 3 000 lignes au 22/10, donc
  négligeable) : requête de taille avant, et garde-fou « doublons après normalisation »
  repris de la 068 ;
- `trouver_carte_par_telephone` et `attacher_telephone` normalisent le numéro reçu avec le
  pays du marchand.
- **Hypothèse** : le pays d'un client est celui du marchand. Un touriste qui donne un
  `+44…` reste reconnu (règle « + suivi de 8 à 15 chiffres »).

Sans H0, le connecteur ne trouve que les clients qui ont tapé leur numéro en `+33…`.

### 4.3 Quand créditer : le statut de la commande

Une commande Hubrise vit (`new`, `accepted`, `completed`, `cancelled`, `rejected`…). Créditer
à `new` créditerait une commande refusée ensuite. **Proposition** : ne créditer qu'aux
statuts d'une liste fermée, `completed` par défaut, réglable par connexion si une caisse
n'envoie jamais `completed`. **À confirmer avec de vraies commandes** de la caisse du premier
marchand (§9, I4). C'est l'inconnu le plus important pour la justesse.

### 4.4 Annulation après crédit

Une commande créditée puis passée à `cancelled` ou `rejected` est retrouvée par sa clé, comme
`POST /ventes/:reference/annulation` (`ventes.js:165-185`), puis passe par `annuler_scan`
(dernier mouvement seulement, garde-fous inchangés). Si ce n'est pas le dernier mouvement,
rien n'est fait et l'événement est noté `annulation_refusee`, à corriger à la main (même
limite que l'API v1, f05 tombée). **Proposé en morceau séparé (H4)**, après la mesure des
statuts réels.

### 4.5 Conversion, devise, canal

- **Conversion** : `floor(total_centimes / fils_par_point)`, plafond `plafond_vente_fils` ;
  tampons : 1 par commande. C'est la règle de `ventes.js:95-97`, reprise telle quelle. La
  colonne s'appelle « fils », mais l'unité est la **plus petite unité de la devise du
  marchand** (centime en France). Rien ne change en base. **L'admin saisit « en AED »**
  (passation §15 duodequadraginta) : il faut un libellé selon la devise du marchand
  (`marchands.devise`, dans la migration H0, ou déduite de `pays`).
- **Montant retenu** : `total` de la commande (chaîne de type `"23.50 EUR"`), **devise
  vérifiée** contre celle du marchand. Une autre devise donne `devise_inattendue`, sans
  crédit. **À confirmer** : faut-il exclure les frais de livraison, les remises ou la part
  payée en points de fidélité (§9, I5) ?
- **Date** : `vendu_le` = date de la commande, avec les mêmes bornes que l'API (7 jours de
  retard au plus, 5 min d'avance).
- **Canal** : `scans.canal = 'hubrise'`. Il faut élargir `scans_canal_check` (migration 066 :
  `('comptoir','caisse')`), posé `NOT VALID` puis validé : la validation lit toute la table
  `scans` sans bloquer les écritures. **Aucun lecteur de `canal`** dans le code ni dans le SQL
  aujourd'hui (vérifié par recherche) : l'ajout ne change aucune statistique.
  `reference_externe` = l'`order_id` Hubrise.
- **Boutique** : `point_de_vente_id` de la connexion (une location Hubrise = une boutique
  WinWin, rattachée dans l'admin), sinon `NULL` (vente non attribuée, comme l'API sans code
  caisse).

### 4.6 Double crédit comptoir + Hubrise (règle produit à poser)

Rien ne relie un scan au comptoir et la commande Hubrise de la même vente. Si le caissier
scanne la carte **et** que la caisse attache le client, le client est crédité **deux fois**.
Options :
- **(a)** chez un marchand connecté à Hubrise, le comptoir ne crédite plus : le scanner
  refuse, ou ne sert qu'à remettre la récompense. C'est sûr, mais cela touche le scan, zone
  dangereuse §5 ;
- **(b)** consigne au marchand, sans code : « soit on scanne, soit on attache le client en
  caisse ». C'est fragile ;
- **(c)** Hubrise ne crédite que les commandes **hors comptoir** (livraison, click and
  collect), selon le champ `service_type` (à confirmer).

**Recommandation** : (b) pour le premier marchand pilote, avec la mesure du journal (§6), puis
(a) ou (c) selon ce qu'on voit. **À trancher** (§8, D2).

---

## 5. Connexion marchand (OAuth Connect)

### 5.1 Le flux proposé

1. **Admin WinWin**, fiche marchand, section « Hubrise » : bouton « Connecter ». Lien vers
   `/integrations/hubrise/connexion?marchand=<id>`, réservé à l'admin.
2. Redirection vers l'écran d'autorisation Hubrise avec `client_id`, `redirect_uri`, `scope`
   et `state`.
   - Le **`state` est un jeton signé** (`jsonwebtoken`, déjà en dépendance) : il porte le
     `marchand_id` et un nonce, et vit 10 min. Cela évite une table d'états et empêche qu'un
     retour OAuth forgé rattache une location au mauvais marchand.
3. Le marchand choisit sa **location** chez Hubrise et accepte.
4. Retour sur `/integrations/hubrise/retour?code=…&state=…` : vérification du `state`, puis
   échange `code → access_token` (avec `account_id`, `location_id`, `customer_list_id`).
5. **Enregistrement du callback** auprès de Hubrise pour cette connexion : notre URL, et
   **les seuls événements `order.create` / `order.update`** (pas les événements client, par
   minimisation).
6. Écriture de `hubrise_connexions` (jeton chiffré), puis retour vers l'admin : « Connecté :
   location X ».

**Scope à demander** : `orders.read` + `customer_list.read`, au niveau **location** (syntaxe
exacte `location[orders.read,customer_list.read]` à confirmer, §9). On ne demande pas
`loyalty_operations` en v1 : un scope accordé est un risque même inutilisé.

**Plus tard** (hors v1) : le même bouton dans le dashboard marchand, et le départ depuis le
catalogue d'apps Hubrise (le marchand arrive chez nous sans session : il faut une page de
connexion).

### 5.2 Le jeton

- Il **n'expire pas** et donne accès aux commandes et au fichier client de la location. Il
  faut le relire (enregistrement du callback, relecture éventuelle), donc **une empreinte
  ne suffit pas** (contrairement aux clés d'API, `api-v1/cle.js`).
- **Chiffré en base** (AES-256-GCM, clé `HUBRISE_JETON_CLE` dans Railway, jamais dans
  Supabase). Une copie de la base (sauvegardes t23, export) ne donne donc pas de jeton
  utilisable. Le code n'a aujourd'hui **aucun chiffrement au repos** (recherche :
  `createCipheriv` absent), ce serait une première brique, petite et testée.
- **Révocation** : couper chez nous (`revoque_le`) fait ignorer les callbacks tout de suite.
  Le marchand peut aussi couper chez Hubrise : les callbacks cessent, et un appel avec le
  jeton répond 401, ce qui passe la connexion en « révoquée par Hubrise ».
- Secrets de l'app (`HUBRISE_CLIENT_ID`, `HUBRISE_CLIENT_SECRET`) : variables Railway, à
  poser par Yass.

---

## 6. Base de données (proposition, migrations à numéroter à partir de 074)

| Objet | Contenu | Morceau |
|---|---|---|
| `marchands.pays`, `marchands.devise`, `clients.pays_telephone`, `normaliser_telephone_pays`, colonne générée redéfinie, fonctions téléphone ajustées | §4.2 | H0 |
| `hubrise_connexions` | `id`, `marchand_id`, `point_de_vente_id` (nul possible), `account_id`, `location_id` (unique parmi les actives), `customer_list_id`, `jeton_chiffre`, `scope`, `statuts_credites` (défaut `{completed}`), `callback_enregistre_le`, `cree_le`, `revoque_le`, `revoque_par`, `dernier_evenement_le` ; RLS active, droits à `service_role` | H1 |
| `hubrise_evenements` | journal **sans donnée personnelle** : `connexion_id`, `marchand_id`, `order_id`, `type`, `statut_commande`, `decision` (liste fermée : `credite`, `deja_credite`, `invite`, `sans_telephone`, `telephone_illisible`, `sans_carte`, `statut_non_retenu`, `zero_point`, `devise_inattendue`, `hors_plafond`, `montant_modifie`, `annulee`, `annulation_refusee`, `connexion_coupee`), `scan_id`, `recu_le` ; purge à 90 jours | H1 |
| `scans_canal_check` élargi à `'hubrise'` | §4.5 | H2 |
| `crediter_commande_hubrise(...)` | `crediter_scan` (inchangée), puis marquage `canal`, `reference_externe`, `montant_fils`, `vendu_le` ; contrôle `cle_autre_scan` (comme `crediter_vente`) | H2 |

Le journal `hubrise_evenements` sert trois choses :
- le **support** (« pourquoi mon client n'a pas eu ses points ? ») ;
- la **mesure du taux de réussite** (part `credite` ; part `sans_carte` = clients à
  convertir) ;
- la **preuve des statuts réels** de la caisse (I4).

Il ne garde jamais le numéro ni le nom. Effacement RGPD : rien à faire (aucune donnée
personnelle) ; `scan_id` suit la règle des scans (anonymes).

---

## 7. Découpe en morceaux (chacun : migration exécutée avant, filet, contre-épreuve, feu vert)

| # | Morceau | Migration | Touche la caisse ? |
|---|---|---|---|
| **H0** (construit en local, 05/11) | Téléphone selon le pays du marchand (`pays` en admin). Libellé de devise **reporté** en H1/H2 | oui (réécrit `clients`) | oui, ≈ 20 µs par scan déjà payés (colonne générée) ; à prouver au filet |
| **H1** | Connexion : app Hubrise déclarée (Yass), OAuth, `state` signé, jeton chiffré, enregistrement du callback, section admin | oui (`hubrise_connexions`, `hubrise_evenements`) | non |
| **H2** | Récepteur : corps brut, signature, sortie du limiteur global, `commande.js` pur, décision et journal ; extraction `credit-vente.js` (ventes prouvées inchangées) ; `crediter_commande_hubrise`, canal | oui (canal, fonction) | non (ligne `express.json` : prouvée sans effet) |
| **H3** | Pilote chez un marchand : connexion réelle, 1 à 2 semaines de journal, décision D2 (double crédit) et I4 (statuts) sur données | non | non |
| **H4** | Annulation après crédit (`cancelled` / `rejected`) | non | non |
| plus tard | dashboard « Connecter Hubrise » ; départ depuis le catalogue Hubrise ; relecture des commandes manquées ; écriture `loyalty_operations` (la caisse affiche le solde) | | |

**Ordre** : H0 peut partir seul, car il corrige aussi le cas « 05 » faux pour tout marchand
français, Hubrise ou non. H1 et H2 peuvent se coder en parallèle, mais **H2 ne part pas en
production sans H1** (pas de connexion, aucun callback ne passe le contrôle 2).

**Tests prévus (filet `npm test`)** :
- `commande.js`, cas par cas : invité ; sans téléphone ; « 06… » / « +33… » / « 05… » en FR
  et en AE ; statut ; devise ; 0 point ; plafond ;
- callback signé, mal signé, corps modifié d'un octet ;
- renvoi 6 fois, puis `create` + `update` simultanés : **un seul scan** ;
- `update` avec un autre montant (`montant_modifie`, rien d'écrit) ;
- connexion coupée ;
- base en panne (503) ;
- le comptoir et `/api/v1/ventes` inchangés ;
- OAuth contre un faux serveur Hubrise local (`state` faux, expiré, ou d'un autre marchand) ;
- chiffrement aller-retour, et refus avec une autre clé.

---

## 8. Décisions

**Tranchées par le pilotage (05/11)** :
- **D1 — validé** : une carte = une fiche client non effacée chez ce marchand (comme l'API v1).
- **D2 — tranché autrement que proposé** : **un seul canal par marchand**, appliqué à
  l'installation. Un marchand Hubrise n'a pas d'accès scanner caissier. **Aucun drapeau de
  blocage à coder** : c'est une règle d'installation, pas un garde-fou du code.
  - Limite : rien n'empêche techniquement de recréer un accès scanner chez un marchand
    Hubrise (admin). La règle tient par la procédure d'installation.
- **D6 — validé** : créditer au statut `completed` seulement.

**Encore ouvertes (reco par défaut, qui fait foi sans autre décision)** :
- **D3** — Faire H0 avant Hubrise. *Reco : oui.* De fait, H0 est construit (migration 074,
  local) : sans lui, le connecteur ne retrouve en France que les numéros tapés en « +33 ».
- **D4** — Connexion lancée depuis l'**admin WinWin** seulement en v1. *Reco : oui.* On
  installe nous-mêmes chaque marchand, ce qui va avec D2 (canal choisi à l'installation).
  Le bouton du dashboard et le départ depuis le catalogue Hubrise viennent plus tard.
- **D5** — Après une remise venue de Hubrise : avis Google **oui** (même chemin que l'API et
  le comptoir) ; parrainage **non** (propre au comptoir, comme l'API). *Reco : oui / non.*
- **D7** — Landing premium obligatoire pour un marchand Hubrise ? *Reco : oui.* C'est la
  seule surface qui demande le numéro, et le numéro est la seule clé du connecteur. Le
  bloc B de `database/requetes/h0_telephone_pays.sql` en donne le plafond par marchand.

## 9. Inconnus à confirmer (Hubrise, doc ou compte de test)

- **I1 — levé (pilotage, 05/11)** : Hubrise signe ses callbacks avec l'en-tête
  `X-HubRise-Hmac-SHA256`. C'est un HMAC-SHA256 du **corps brut**, calculé avec notre
  `client_secret` et écrit en hexadécimal. En cas de différence, on ignore le callback.
  - **Corps brut avant le parsing JSON : confirmé dans notre code.** `express.json` global
    (`src/index.js:44`) lit et analyse le corps avant toute route. Le récepteur doit donc
    récupérer les octets reçus par l'option `verify` de ce même parseur (§1.3). Il ne faut
    jamais recalculer la signature sur un `JSON.stringify(req.body)`, qui ne rend pas les
    mêmes octets (espaces, ordre, échappements).
  - Comparaison : `crypto.timingSafeEqual` sur les deux valeurs hexadécimales de même
    longueur ; une longueur différente vaut un refus.
  - « Ignorer » : réponse **200** sans rien faire (Hubrise ne renvoie pas), plutôt qu'un
    401, à trancher en H2. Le §1.4 proposait 401. Avec 200, un faux appel ne déclenche pas
    6 renvois ; avec 401, un vrai callback mal vérifié (un bug chez nous) serait renvoyé et
    visible. *Reco : 401* (vrai bug chez nous = renvois visibles dans le journal).
- **I2 à I9** : à lever avec le **compte dev Hubrise** (en cours côté Yass), **avant H2** :
  - **I2** — corps du callback ;
  - **I3** — unicité de l'`order_id` ;
  - **I4** — statuts réels ;
  - **I5** — contenu du `total` ;
  - **I6** — format du téléphone ;
  - **I7** — syntaxe du scope ;
  - **I8** — enregistrement du callback ;
  - **I9** — compte de test et catalogue.
- **I10** — Contrat de sous-traitance et conditions marchand (hors code).

**Requêtes en lecture seule (Supabase)** : elles sont toutes dans
`winwincard/backend/database/requetes/h0_telephone_pays.sql`.
- Bloc A : aperçu de la 074, à passer avant.
- Bloc B : couverture du téléphone chez les marchands français.
- Bloc C : écarts, à passer après la 074.

Le filet les exécute à chaque passage.

## 10. Hypothèses (ce qui ferait casser) et limites

- **Une seule instance Railway** (comme le reste) : sinon les compteurs d'échecs par adresse
  ne sont plus partagés. L'idempotence, elle, est en base et tient.
- **Le secret de l'app ne fuit pas** : sinon on peut forger des callbacks. Leur portée reste
  bornée (une commande ne crédite qu'une carte existante, à un numéro existant), et la
  relecture (§1.3, couche 3) devient alors nécessaire.
- **Base en panne plus d'une heure environ** : commandes perdues, sans rattrapage en v1.
- **Le pays du client est celui du marchand** (H0) : un numéro national étranger sans « + »
  n'est pas reconnu.
- **Montant modifié après crédit** : pas d'ajustement automatique (v1).
- **Le taux de crédit dépend de la caisse** (client attaché ou non) **et de nous** (numéro
  connu) : sur la ligne `sans_carte`, Hubrise ne fait qu'exposer un manque d'inscription.
