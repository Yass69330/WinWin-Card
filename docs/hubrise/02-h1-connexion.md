# H1 — Connexion d'un marchand à Hubrise : cadrage (06/11/2026, rien codé)

> **Statut** : cadrage seul. Zéro code avant le go de Yass, rien en prod.
>
> **Périmètre** : le flux « Connecter » lancé depuis l'admin WinWin, l'autorisation OAuth
> Hubrise, le stockage chiffré du jeton, puis l'abonnement aux ventes de la location.
> H1 ne dépend ni du compte dev ni du champ qui portera l'id de carte : le compte servira à
> tester, pas à concevoir.
>
> **Hors H1** : le crédit (H2), le choix du champ d'identité de la carte (après le JSON
> d'une commande de test).
>
> Les points Hubrise que je n'ai pas vérifiés sur pièce sont marqués **(à confirmer)** et
> repris au §7.

---

## 0. En une page

- **Qui clique.** L'admin WinWin ouvre la fiche du marchand, section « Hubrise », puis
  « Créer un lien de connexion ». Le lien s'ouvre sur place (installation en présence du
  marchand) ou s'envoie au marchand. **C'est le marchand qui se connecte à SON compte
  Hubrise** et choisit sa location. WinWin ne voit jamais ses identifiants Hubrise.
- **Comment on sait à qui est la connexion.** Le lien porte un **jeton signé** (marchand,
  usage unique, 30 min). Le marchand de la connexion vient **uniquement** de ce jeton,
  jamais d'un paramètre d'adresse. Un retour OAuth forgé ou rejoué ne peut rien rattacher à
  un autre marchand.
- **Le jeton Hubrise** est chiffré en AES-256-GCM avec une clé qui vit dans Railway, jamais
  dans Supabase. La base, ses sauvegardes et ses exports ne contiennent qu'un texte chiffré
  inutilisable. Aucune route ne le renvoie, aucun journal ne l'écrit.
- **Une location Hubrise = un seul marchand WinWin** (index unique sur les connexions
  actives). Les callbacks seront retrouvés par location → connexion → marchand. Un
  marchand ne peut recevoir que les ventes de ses locations.
- **« On sait recevoir ses ventes »** : à la connexion, on abonne la location aux
  événements de commande, puis un récepteur minimal vérifie la signature, note l'événement
  sans donnée personnelle et répond 200, **sans rien créditer** (H1b). Le crédit est H2.

---

## 1. Le parcours

```
Admin WinWin                     Serveur WinWin                         Hubrise
─────────────                    ──────────────                         ───────
Fiche marchand ▸ Hubrise
« Créer un lien de connexion » ─▶ POST /api/admin/marchands/:id/hubrise/lien
                                  (authAdmin) → URL /integrations/hubrise/connexion?l=<jeton signé>
ouvre le lien (ou l'envoie)    ─▶ GET /integrations/hubrise/connexion?l=…
                                  vérifie le jeton (signature, 30 min, usage unique)
                                  302 ─────────────────────────────────▶ écran d'autorisation
                                                                         (client_id, redirect_uri,
                                                                          scope, state)
                                                         le marchand se connecte, choisit
                                                         sa location, accepte
                                  GET /integrations/hubrise/retour ◀──── ?code=…&state=…
                                  1. state → marchand (jeton signé, nonce non consommé)
                                  2. POST token (code + client_id + secret) ─▶ access_token,
                                                                               account_id, location_id…
                                  3. location déjà prise par un AUTRE marchand → refus, rien écrit
                                  4. chiffrer le jeton, écrire hubrise_connexions
                                  5. abonner la location aux commandes (H1b) ─▶ callback enregistré
                                  6. page « Connecté : <nom de la location> »
Fiche marchand : « Connecté ·
location X · depuis le … »
```

- **Pourquoi un lien et pas un clic direct dans l'admin.** L'admin s'authentifie par un
  jeton `Bearer` gardé dans le navigateur. Une redirection vers Hubrise ne peut pas le
  porter. Le lien signé fait le pont et permet aussi de l'envoyer au marchand (décision D4 :
  lancé depuis l'admin).
- **Déconnecter** (fiche marchand) :
  - la connexion passe à `coupee_le` : tout callback de cette location est ignoré
    immédiatement ;
  - puis, au mieux, on retire l'abonnement chez Hubrise (et on révoque le jeton si Hubrise
    le permet, **à confirmer**) ;
  - le jeton chiffré est **effacé** (mis à `NULL`).
- **Coupure côté Hubrise** (le marchand retire l'app) : les callbacks cessent. Le prochain
  appel avec ce jeton répond 401, et la connexion passe à « coupée par Hubrise » (H1b ou
  H2).

---

## 2. Structure du module

Dans la zone existante `src/integration/` (`docs/api/README.md`), voisin de `api-v1/`,
monté par **une ligne** dans `src/integration/index.js`.

```
src/integration/hubrise/
  index.js        monte les routes ; en-tête de zone (comme api-v1/index.js)
  config.js       lit HUBRISE_CLIENT_ID / _SECRET / _JETON_CLE / _REDIRECT_URI ; absente →
                  routes Hubrise en 503 « non_configure », le reste de WinWin intact
  coffre.js       chiffrer / déchiffrer le jeton (AES-256-GCM, §4) ; seul fichier qui
                  manipule un jeton en clair
  lien.js         jeton signé du lien de connexion et du state OAuth (jsonwebtoken, déjà
                  en dépendance ; secret dédié, §4.3)
  oauth.js        GET /integrations/hubrise/connexion, GET /integrations/hubrise/retour
  api-hubrise.js  appels sortants : échange du code, abonnement (callback), désabonnement ;
                  délai court (5 s), aucun jeton ni corps dans les journaux
  connexions.js   lecture et écriture de hubrise_connexions (passe par coffre.js)
  admin.js        /api/admin/marchands/:id/hubrise (état), …/hubrise/lien, …/hubrise/couper
  callback.js     (H1b) POST /integrations/hubrise/callback : signature, connexion, journal, 200
public/admin/index.html   section « Hubrise » de la fiche marchand (état, lien, couper)
public/hubrise-retour.html (ou réponse HTML simple de oauth.js) : « Connecté » / « Échec : … »
```

**Frontière** : le module appelle Supabase et Hubrise. Le comptoir, la carte et le
dashboard ne l'appellent jamais. Une panne de Hubrise ou une clé absente ne touchent que
les routes Hubrise.

**Touches hors du module (H1b seulement)** : `src/index.js`, deux lignes.
- `express.json({ verify })` garde le corps brut **pour la seule route du callback**
  (I1 : HMAC sur le corps brut).
- Le limiteur global par adresse ignore `/integrations/hubrise/callback`, comme `/api/v1`.
  Les callbacks partent de quelques adresses Hubrise.

---

## 3. Base de données (une migration, exécutée avant le code)

**Numéro** : je propose **074** pour H1. H0, gelé sur `briques/h0-telephone-pays`, sera
renuméroté à sa reprise, comme f04 (066 → 067 → 068) : c'est la migration exécutée en
premier qui garde le numéro.

```sql
CREATE TABLE public.hubrise_connexions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  marchand_id           uuid        NOT NULL REFERENCES public.marchands(id) ON DELETE CASCADE,
  point_de_vente_id     uuid        REFERENCES public.points_de_vente(id) ON DELETE SET NULL,
  account_id            text        NOT NULL,      -- identifiants Hubrise (pas des secrets)
  location_id           text        NOT NULL,
  customer_list_id      text,
  nom_location          text,                      -- pour l'affichage admin
  scope                 text        NOT NULL,      -- scope accordé, tel que rendu par Hubrise
  jeton_chiffre         text,                      -- 'v1:<iv>:<tag>:<texte chiffré>' (base64) ; NULL une fois coupée
  callback_id           text,                      -- abonnement chez Hubrise (H1b)
  cree_le               timestamptz NOT NULL DEFAULT now(),
  coupee_le             timestamptz,
  coupee_par            text CHECK (coupee_par IN ('winwin', 'hubrise')),
  dernier_evenement_le  timestamptz,
  CHECK ((coupee_le IS NULL) = (coupee_par IS NULL)),
  CHECK (coupee_le IS NOT NULL OR jeton_chiffre IS NOT NULL)
);
-- Une location = un seul marchand, tant que la connexion est active.
CREATE UNIQUE INDEX hubrise_connexions_location_active
  ON public.hubrise_connexions (location_id) WHERE coupee_le IS NULL;
CREATE INDEX idx_hubrise_connexions_marchand ON public.hubrise_connexions (marchand_id);
ALTER TABLE public.hubrise_connexions ENABLE ROW LEVEL SECURITY;      -- aucune politique : service_role seul
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hubrise_connexions TO service_role;

-- Usage unique des liens de connexion (anti-rejeu du state).
CREATE TABLE public.hubrise_liens_utilises (
  nonce      uuid        PRIMARY KEY,
  marchand_id uuid       NOT NULL REFERENCES public.marchands(id) ON DELETE CASCADE,
  utilise_le timestamptz NOT NULL DEFAULT now()
);  -- RLS + droits service_role ; purge > 1 jour (le lien vit 30 min)

-- (H1b) Journal des callbacks, SANS donnée personnelle.
CREATE TABLE public.hubrise_evenements (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  connexion_id  uuid        REFERENCES public.hubrise_connexions(id) ON DELETE SET NULL,
  marchand_id   uuid        REFERENCES public.marchands(id) ON DELETE SET NULL,
  location_id   text,
  order_id      text,
  evenement     text,                      -- 'order.create', 'order.update'
  statut_commande text,
  decision      text NOT NULL,             -- H1 : 'recu' | 'connexion_inconnue' | 'connexion_coupee' | 'signature_invalide'
  recu_le       timestamptz NOT NULL DEFAULT now()
);  -- RLS + droits service_role ; purge à 90 jours ; H2 ajoutera ses décisions (credite, …)
```

- **Rien de personnel** dans ces tables : identifiants techniques Hubrise, dates, statuts.
  Effacement RGPD d'un client : rien à faire. Suppression d'un marchand : cascade.
- **Coupure** : la ligne reste (historique), jeton effacé. Reconnexion : nouvelle ligne.
- Les `CHECK` et l'index unique sont en base : même un appel direct ne peut pas rattacher
  une location à deux marchands actifs.

---

## 4. Le jeton : stockage et chiffrement

### 4.1 Pourquoi chiffrer et pas hacher

Le jeton Hubrise doit être **relu** : pour s'abonner aux commandes, se désabonner et, plus
tard, lire une commande si besoin. Une empreinte (comme les clés d'API WinWin,
`api-v1/cle.js`) ne se relit pas. Le jeton n'expire pas et ouvre les commandes et le
fichier client de la location : en clair dans une copie de la base, ce serait une fuite
durable.

### 4.2 Le schéma

- **AES-256-GCM** (module `crypto` natif de Node, aucune dépendance) :
  - IV aléatoire de 12 octets par chiffrement ;
  - étiquette d'authentification de 16 octets : un texte chiffré modifié est refusé au
    déchiffrement ;
  - **données associées = `marchand_id:location_id`**. Un texte chiffré recopié sur la ligne
    d'un autre marchand ne se déchiffre pas : le jeton est lié à sa connexion.
- **Clé** : `HUBRISE_JETON_CLE`, 32 octets en base64, **dans les variables Railway
  seulement** (générée par Yass : `openssl rand -base64 32`, copie gardée dans son
  gestionnaire de mots de passe). Jamais dans Supabase, jamais dans le dépôt, jamais dans
  le chat.
- **Format stocké** : `v1:<iv>:<tag>:<texte chiffré>`. Le `v1` permet une rotation plus
  tard : une clé `HUBRISE_JETON_CLE_V2`, rechiffrement au fil de l'eau. Rien n'est codé
  pour la rotation en H1.
- **En mémoire** : le jeton n'est déchiffré qu'au moment d'un appel sortant, dans
  `api-hubrise.js`, et n'est pas gardé.
- **Jamais** dans une réponse d'API, un journal, une erreur Sentry ou le registre. Le
  filet le vérifie (§6).

### 4.3 Le lien et le state

- Le lien de connexion et le `state` OAuth sont des jetons signés (`jsonwebtoken`) avec un
  **secret dédié**, `HUBRISE_LIEN_SECRET`, distinct de `JWT_SECRET`. Une fuite de l'un ne
  forge pas l'autre.
- Contenu : `marchand_id`, `nonce`, expiration à 30 min.
- **Usage unique** : le nonce est inscrit dans `hubrise_liens_utilises` au retour OAuth ;
  un second retour avec le même `state` est refusé.

### 4.4 Ce qui casse si…

- **La clé est perdue** : tous les jetons sont illisibles. Il faut reconnecter chaque
  marchand (nouveau lien). Aucune donnée client n'est perdue.
- **La clé fuit avec une copie de la base** : jetons exposés. On change la clé et on
  reconnecte. Les deux doivent fuir ensemble, d'où la séparation Railway / Supabase.
- **La clé change par erreur** : déchiffrement refusé (étiquette GCM). Les routes Hubrise
  répondent « connexion à refaire », rien d'autre n'est touché.

---

## 5. « Un marchand ne voit que ses données » : où c'est tenu

| Risque | Garde |
|---|---|
| Rattacher la location de quelqu'un à un autre marchand | Marchand pris **seulement** dans le `state` signé ; usage unique ; index unique location active |
| Rejouer un retour OAuth | Nonce consommé ; le `code` Hubrise est lui-même à usage unique (à confirmer) |
| Lire le jeton | Chiffré ; aucune route ne le renvoie ; données associées liées à la ligne |
| Recevoir les ventes d'un autre | (H1b, H2) callback signé par Hubrise ; location → connexion **active** → marchand ; une connexion coupée n'est plus lue |
| Accès direct à la base par une clé publique | RLS active sans politique : seul `service_role` (le serveur) lit ces tables |
| Le marchand dans son dashboard | Rien en H1 : l'état « Hubrise connecté » s'affichera plus tard, toujours sans jeton |

---

## 6. Tests prévus (filet `npm test`, sans réseau)

- **Faux serveur Hubrise** local : écran d'autorisation simulé (renvoie un `code`), échange
  du code, abonnement et désabonnement.
- Parcours complet : lien, autorisation, retour, puis connexion écrite, jeton chiffré
  (jamais égal au clair, déchiffrable avec la bonne clé et les bonnes données associées
  seulement) et abonnement enregistré.
- Refus :
  - lien expiré, mal signé ou déjà utilisé ;
  - `state` d'un autre marchand ;
  - location déjà active chez un autre marchand (rien écrit) ;
  - Hubrise en panne (rien écrit, message lisible) ;
  - configuration absente (503, le reste de WinWin répond).
- Couper : callbacks ignorés, jeton effacé.
- **Aucune fuite** : recherche du jeton en clair dans les réponses, les journaux du serveur
  et la base, après tout le parcours → 0.
- (H1b) callback bien signé → 200 et journal ; mauvaise signature → ignoré ; location
  inconnue ou coupée → ignoré ; corps modifié d'un octet → ignoré.
- Comptoir, API v1 et dashboard inchangés (filet entier), plus la contre-épreuve.
- Navigateur : section « Hubrise » de la fiche (état, lien, couper).

---

## 7. Ce qu'il manque côté Hubrise pour boucler

**À fournir par Yass (compte dev)** :
1. **Créer l'app (client OAuth)** dans le back-office Hubrise, avec :
   - le nom « WinWin », le logo et la description affichés au marchand (à confirmer : ce
     que l'écran d'autorisation montre) ;
   - l'**URL de retour** :
     `https://app.winwin-card.com/integrations/hubrise/retour`. Il faut confirmer si
     Hubrise exige qu'elle soit déclarée à l'avance et si elle doit correspondre exactement.
2. **`client_id` et `client_secret`** : les mettre **directement dans Railway**
   (`HUBRISE_CLIENT_ID`, `HUBRISE_CLIENT_SECRET`), jamais dans le chat ni le dépôt. Le
   `client_secret` sert aussi à vérifier les callbacks (I1).
3. **Une location de test** dans le compte dev, et un moyen d'y créer des commandes
   (caisse de test ou création manuelle).
4. **Générer** `HUBRISE_JETON_CLE` et `HUBRISE_LIEN_SECRET` (`openssl rand -base64 32`
   chacun) dans Railway, avec une copie dans le gestionnaire de mots de passe.

**À confirmer dans la doc Hubrise ou sur le compte** (je ne les ai pas vérifiés) :
- les adresses exactes : écran d'autorisation (a priori
  `manager.hubrise.com/oauth2/v1/authorize`), échange du code
  (`manager.hubrise.com/oauth2/v1/token`), API (`api.hubrise.com/v1`) ;
- la **syntaxe du scope** au niveau location (a priori
  `location[orders.read,customer_list.read]`), et ce que rend l'échange du code (`account_id`,
  `location_id`, `customer_list_id` ?) ;
- l'**abonnement aux commandes** : par connexion via l'API (`POST /callback` avec l'URL et
  les événements `order.create` / `order.update` ?), ou fixé dans la fiche de l'app ;
- la **révocation** : existe-t-il un appel pour révoquer un jeton ? Hubrise prévient-il
  quand le marchand retire l'app ?
- les limites d'appels, et si un même jeton peut couvrir plusieurs locations (un compte
  avec plusieurs magasins).

**Une question de minimisation pour le pilotage** : avec l'axe id-carte, `customer_list.read`
n'est peut-être plus nécessaire (si la référence de carte est dans la commande elle-même).
Mais un scope ajouté plus tard oblige chaque marchand à se reconnecter. *Reco : garder les
deux scopes demandés pour le premier marchand de test, et trancher à la lecture du JSON de
test, avant le premier vrai marchand.*

---

## 8. Découpe proposée

| # | Contenu | Migration | Touche la caisse ? |
|---|---|---|---|
| **H1a** | Table des connexions et des liens, `coffre.js`, lien signé, OAuth (aller, retour), section admin (état, lien, couper), faux serveur Hubrise au filet | 074 | non (aucune ligne hors du module, une ligne de montage) |
| **H1b** | Abonnement aux commandes à la connexion, récepteur minimal (signature, connexion, journal sans donnée personnelle, 200, **aucun crédit**), corps brut et sortie du limiteur dans `src/index.js` | même 074 (`hubrise_evenements`) | non (deux lignes dans `src/index.js`, prouvées sans effet au filet) |

- H1a peut se coder et se tester entièrement **sans** le compte dev (faux serveur). Le
  compte sert à la recette réelle.
- H1b donne la preuve « on reçoit ses ventes » de bout en bout avec le compte dev, sans
  argent en jeu.
- **t30 phase 2** (« Wait for CI ») n'est pas un prérequis de H1 (aucun crédit). Il le
  reste pour H2.

**Hypothèses et limites** :
- une seule instance Railway (comme le reste) ;
- clé de chiffrement unique sans rotation codée (format prêt pour) ;
- l'installation en présence du marchand ou l'envoi du lien est une procédure, pas un
  contrôle du code ;
- le lien vit 30 min : au-delà, on en crée un autre.

**Décisions demandées** :
1. Le lien de connexion, ouvert sur place ou envoyé au marchand, plutôt qu'un clic direct
   dans l'admin ?
2. La migration de H1 prend le n° 074, et H0 sera renuméroté à sa reprise ?
3. H1b (récepteur sans crédit) fait-il partie de H1 ?
4. Le scope (§7, dernier point) ?
