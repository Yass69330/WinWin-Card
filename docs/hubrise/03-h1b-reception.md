# H1b — Réception des ventes Hubrise, sans crédit : cadrage (08/11/2026, rien codé)

> **Statut au 08/11** :
> - décisions D1 à D4 prises (D1 : 401 ; D2 : journaux seulement, pas de migration ;
>   D3 : `callback_id` suffit ; D4 : valeurs techniques et `total`) ;
> - **H1b codé en local** : filet 615/615, contre-épreuve conforme ;
> - rien n'est poussé ;
> - détail et mise en production : passation §15 tredecies septuagies.
>
> **Point de départ** : H1a est en production (`faa1a4a`). hamza-salon est connecté à la
> location de test `1bp94-0` (jeton chiffré). Cette connexion **reste active** : elle sert à
> H1b. Le « Couper » réel et le rejeu du lien se testeront plus tard, sur une connexion
> dédiée.
>
> **Objectifs** :
> 1. recevoir les ventes d'une location connectée (abonnement, vérification, journal) **sans
>    rien créditer** ;
> 2. **voir une vraie commande de test** et identifier **quel champ porte la référence de
>    carte**, prérequis de H2, sans journaliser de donnée personnelle.
>
> CI t30 non requis : H1b ne crédite pas.
>
> Points Hubrise non vérifiés sur pièce : marqués **(à confirmer)**, voir §7.

---

## 1. Abonnement aux commandes

Adresses données par le pilotage (06/11) : `POST`, `GET` et `DELETE` sur
`https://api.hubrise.com/v1/callback`, avec l'en-tête `X-Access-Token`. Il n'y a qu'**un
callback par connexion** : un nouveau `POST` remplace l'ancien.

- **À la connexion** (retour OAuth, `oauth.js`) : une fois la connexion enregistrée, on
  envoie `POST /callback` avec le corps suivant :

  ```json
  { "url": "https://app.winwin-card.com/integrations/hubrise/callback", "events": { "order": ["create", "update"] } }
  ```

  - On note `callback_id` (colonne déjà présente en 075) et la date d'abonnement.
  - **Si l'abonnement échoue, la connexion est gardée** et la page dit « Connecté ;
    abonnement aux ventes à refaire ». La fiche admin le montre, avec un bouton.
- **Bouton admin « Abonner aux ventes »** :
  `POST /api/admin/hubrise/connexions/:id/abonner`. Il est **indispensable dès le premier
  jour** : la connexion de hamza-salon date d'avant H1b et n'a pas d'abonnement. Il est
  idempotent, puisque `POST` remplace. La fiche affiche « Abonné le … » ou « Pas
  d'abonnement aux ventes ».
- **Au « Couper »** (`admin.js`) : la connexion est d'abord coupée chez nous (jeton effacé,
  inchangé par rapport à H1a). Puis, avec le jeton déchiffré une dernière fois, on appelle
  `DELETE /callback` **puis** la révocation. Les deux sont « au mieux » : un échec ne
  rouvre pas la connexion.
- **401 de Hubrise sur un de ces appels** : le jeton est mort (le marchand a retiré l'app,
  sans webhook côté Hubrise). La connexion passe à `coupee_par = 'hubrise'`, jeton effacé,
  et la fiche affiche « coupée par Hubrise, à reconnecter ».

## 2. Le récepteur `POST /integrations/hubrise/callback`

Dans l'ordre :

1. **Corps brut** : on garde les octets reçus (§3). **Signature** : on calcule le
   HMAC-SHA256 du corps brut avec `HUBRISE_CLIENT_SECRET`, en hexadécimal, puis on le
   compare à `X-HubRise-Hmac-SHA256` avec `crypto.timingSafeEqual` (une longueur différente
   vaut un refus).
   - **En cas de différence, on ignore** (décision I1) : rien n'est lu ni écrit, à part une
     ligne de journal `signature_invalide` sans le corps.
   - Code de réponse : je propose **401**, à trancher (§8, D1). Il rend un vrai bug chez
     nous visible dans les journaux (Hubrise renvoie la requête). Un 200 silencieux
     masquerait un secret mal posé.
2. **Lecture** de `location_id`, de l'identifiant de commande, du type d'événement et du
   statut **(à confirmer : emplacement exact dans le corps du callback)**. Si le corps est
   illisible : 400.
3. **Connexion** : la location doit désigner une connexion **active**. Inconnue ou coupée :
   **200** et journal `connexion_inconnue` / `connexion_coupee` (Hubrise ne renvoie pas).
4. **Journal** dans `hubrise_evenements`, table déjà créée en 075 : connexion, marchand,
   location, `order_id`, événement, statut, `decision = 'recu'`, plus
   `connexions.dernier_evenement_le`. **Aucune donnée personnelle** : ni nom, ni téléphone,
   ni e-mail, ni adresse, ni corps de commande.
5. **Réponse 200**. **Aucun crédit**, aucun appel à `crediter_*`, aucune carte touchée.
6. **Base en panne** : **503**. Hubrise renvoie jusqu'à 6 fois, de 1 à 32 minutes.

**Garde-fous** :
- taille du corps bornée à 2 Mo, comme le reste ;
- le récepteur ne lit **jamais** le jeton (aucun appel sortant) ;
- une requête non signée ne touche pas la base.

## 3. Les deux lignes de `src/index.js`

1. **Corps brut** (`src/index.js:44`) : le parseur JSON global garde une référence aux
   octets lus, **pour cette seule route**. Rien n'est copié, et rien ne change pour les
   autres routes.

   ```js
   app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => {
     if (req.originalUrl.startsWith('/integrations/hubrise/callback')) req.corpsBrut = buf; } }));
   ```

   **Filet de sécurité dans le module** : si Hubrise envoyait un autre `Content-Type` que
   JSON, le parseur global laisserait le corps intact. Le récepteur le lit alors lui-même
   avec `express.raw` sur sa route. La signature est toujours vérifiée sur les octets
   reçus, jamais sur un `JSON.stringify`.
2. **Limiteur global** (`src/index.js:70`) : on ajoute
   `|| req.path === '/integrations/hubrise/callback'` à `skip`. Les callbacks partent de
   quelques adresses Hubrise : sans cette ligne, quelques marchands actifs épuiseraient le
   compteur par adresse (300 par 15 min). Le récepteur a son propre limiteur, généreux,
   par location.

Le filet prouve que ces deux lignes ne changent rien pour les autres routes : il rejoue tout
le filet existant.

## 4. Voir la structure d'une vraie commande sans journaliser de donnée personnelle

**But** : savoir à quel endroit de la commande Hubrise arrive la référence de carte que le
caissier a saisie, par exemple `customer.loyalty_cards[].ref`, un `custom_field`, une note
ou un code promo. Les candidats sont à vérifier sur pièce : on n'en suppose aucun.

**Méthode proposée : un « relevé de structure » pour la seule location de test**, sans
aucune valeur écrite.

- **Interrupteur** : la variable Railway `HUBRISE_DIAGNOSTIC_LOCATIONS=1bp94-0`.
  - Vide ou absente : aucun relevé.
  - Seules les locations listées sont relevées. Aucun autre marchand n'est concerné, même
    par erreur de configuration.
  - Le relevé s'éteint en retirant la variable.
- **Contenu du relevé**, calculé en mémoire à partir du corps déjà vérifié :
  - la **liste des chemins** du JSON, tableaux réduits à `[]`, par exemple
    `new_state.customer.loyalty_cards[].ref` ;
  - pour chaque chemin : le **type** (texte, nombre, booléen, nul), la **longueur** d'un
    texte, et **un seul indicateur** : `forme_carte`, vrai si la valeur **a la forme d'un
    identifiant de carte WinWin** (numéro de série de 36 caractères, ou code court de
    6 caractères hexadécimaux).
  - **Jamais la valeur elle-même.** Un nom, un téléphone ou un e-mail apparaissent comme
    « texte, 12 caractères », rien de plus.
  - **Exception utile et non personnelle** : les valeurs de quelques champs techniques en
    liste fermée (`event_type`, `resource_type`, `status`, `service_type`, `currency`).
    Elles servent à D6 (créditer au statut `completed`) et à I5 (devise et montant).
- **Où on le lit** : je propose une colonne `structure jsonb` dans `hubrise_evenements`,
  remplie **seulement** pour une location de diagnostic. Yass la lit en SQL, avec une
  requête fournie. Cela demande une **petite migration 076** (une colonne). Alternative
  sans migration : une ligne `[hubrise] structure …` dans les journaux Railway, moins
  pratique à relire et coupée si elle est longue. Voir §8, D2.
- **Le test** :
  1. Yass passe une commande sur la location `1bp94-0` (back-office ou caisse de test). Il y
     saisit, dans le champ que la caisse propose pour la fidélité, **le code court d'une
     carte de test** (par exemple celle de Tuma), puis il la fait passer en `completed`.
  2. On lit le relevé : le chemin marqué `forme_carte = true` est **le champ carte**. Les
     statuts reçus (`create`, puis les `update`) donnent le cycle réel (I4).
- **Après H2** : on retire la variable, on purge les lignes de diagnostic, et la colonne
  reste vide.

Pourquoi c'est sûr :
- aucune valeur de donnée personnelle n'est écrite, ni en base ni dans les journaux ;
- le relevé est borné à une location nommée, et coupé par défaut ;
- la détection de forme est une simple vérification de motif, en mémoire.

## 5. Base de données

- **Rien à créer pour le cœur de H1b** : `hubrise_evenements`, `callback_id` et
  `dernier_evenement_le` existent depuis la 075.
- **À ajouter : une colonne `hubrise_connexions.abonne_le`** (date d'abonnement, pour la
  fiche admin). Elle va dans la même migration que la colonne `structure` :
  - **076** si D2 = colonne ;
  - sinon `abonne_le` seule (076), ou on se contente de `callback_id` non nul, ce qui
    évite toute migration. **Reco : `callback_id` suffit**, pas de colonne de date.
- La purge à 90 jours du journal est notée pour plus tard. Le cron purge déjà le registre.

## 6. Tests prévus (filet, contre le faux Hubrise de H1a, étendu)

- **Abonnement** :
  - à la connexion : bon corps, bon `X-Access-Token` ;
  - échec d'abonnement : connexion gardée, fiche « à refaire » ;
  - bouton « Abonner », idempotent ;
  - 401 : connexion coupée par Hubrise.
- **Couper** : `DELETE /callback`, puis révocation, avec le même jeton.
- **Récepteur** :
  - bien signé : 200, ligne `recu`, `dernier_evenement_le` posé, **aucun scan ni solde
    changé** ;
  - signature fausse, absente, ou corps modifié d'un octet : refusé, rien écrit en base
    (sauf la ligne de journal) ;
  - location inconnue ou coupée : 200 et journal ;
  - corps illisible : 400 ; base en panne : 503 ;
  - autre `Content-Type` : signature vérifiée sur les octets bruts.
- **Diagnostic** :
  - location hors liste : aucun relevé ;
  - location listée : chemins, types et longueurs, et `forme_carte` vrai sur le champ qui
    porte un code court ;
  - **aucune valeur** d'un faux nom, téléphone ou e-mail dans la base ni dans le journal
    (recherche du texte exact) ;
  - champs techniques en liste fermée bien relevés.
- **Les deux lignes de `index.js`** : le filet existant entier (600) reste vert, et le
  limiteur global ne compte plus la route du callback.
- Contre-épreuve sur la production avant le push.

## 7. À confirmer avec le compte dev (je ne l'ai pas vérifié)

- La **forme exacte du corps du callback** : emplacement de `location_id`, de l'identifiant
  de commande, du type d'événement, du statut et de la commande elle-même. Le relevé du §4
  y répond dès la première commande. Le récepteur lira ces champs de façon tolérante (§2,
  étape 2) et notera `structure_inattendue` sinon.
- **Hubrise envoie-t-il un appel de test** à la création du callback ? Si oui, il sera reçu
  comme un événement ordinaire.
- Le **`Content-Type`** réel des callbacks : géré dans les deux cas.
- L'**appel exact de l'abonnement** (corps, réponse avec un identifiant) : donné par le
  pilotage, à vérifier à la recette.

## 8. Décisions demandées

- **D1** — Signature invalide : on ignore et on répond **401** (reco), ou 200 silencieux ?
- **D2** — Relevé de structure : **colonne `structure` en base, migration 076** (reco), ou
  journaux Railway seulement, sans migration ?
- **D3** — Date d'abonnement : `callback_id` non nul suffit (reco, pas de colonne), ou
  colonne `abonne_le` ?
- **D4** — Champs techniques relevés en clair : `event_type`, `resource_type`, `status`,
  `service_type`, `currency` (reco). Faut-il en ajouter (le montant `total` pour I5, qui
  n'est pas une donnée personnelle) ?

## 9. Hypothèses et limites

- **Une seule instance** Railway, comme le reste : le limiteur du récepteur est en mémoire.
- **La signature repose sur le secret de l'app.** S'il fuit, des callbacks peuvent être
  forgés, mais H1b ne crédite rien : le pire est une ligne de journal fausse. Le sujet
  devient critique en H2.
- **Base en panne plus d'une heure** (6 renvois de Hubrise) : événement perdu. C'est sans
  enjeu en H1b, et le sujet sera traité en H2 (rattrapage).
- **Le relevé dépend de la saisie réelle à la caisse** : si la caisse de test ne propose
  aucun champ fidélité, le test le montrera, et la question deviendra produit (où le
  caissier saisit-il la carte ?).
