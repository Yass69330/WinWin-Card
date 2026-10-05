# Campagne de charge, temps 2 : procédure de création (étape 15)

**Rien n'est créé avant le feu vert de pilotage.** Cette procédure crée un
environnement de TEST complet, séparé de la production : un projet Supabase et
un projet Railway neufs.

Trois règles valent pour toute la procédure :

- **Jamais la production.** On ne duplique rien de la production : ni projet,
  ni service, ni variable. Les secrets de production ne sont jamais recopiés
  ici.
- **Les secrets ne sortent jamais de Railway ou de Supabase.** Ne m'envoie
  jamais de mot de passe, de clé ou de chaîne de connexion. Ce document ne
  donne que les NOMS des variables. Seules les valeurs non secrètes (ports,
  adresses internes, chemins) y sont écrites.
- **En cas de doute, on s'arrête** et tu m'envoies la ligne du journal qui
  pose question.

## Ce que tu vas créer

| Où | Quoi | Pourquoi |
|---|---|---|
| Supabase | projet `winwin-campagne-15`, Paris (eu-west-3), Micro | la base de test, même région et même taille que la production |
| Railway | projet `winwin-campagne-15`, Amsterdam (EU West) | les machines de test, même région que la production |
| ↳ service `pilote` | prépare la base et joue les essais, puis s'arrête | c'est lui qu'on pilote, une variable à la fois |
| ↳ service `serveur` | le VRAI serveur WinWin, branché sur l'imitateur | ce qu'on mesure |
| ↳ service `imitateur` | faux Apple, faux Google, faux iPhones | aucun vrai téléphone, aucune vraie clé |

Les trois services Railway utilisent le même dépôt, la branche
`campagne/etape15` et le même Dockerfile de campagne. La variable
`CAMPAGNE_PROGRAMME` choisit le programme que chacun lance. Le champ « Custom
Start Command » reste VIDE partout, comme en production.

**Coût.** Supabase Micro coûte environ 0,0134 $ de l'heure, soit environ
10 $ par mois (tarif public, à vérifier sur l'écran de création). Pour 3 à 5
jours, cela fait quelques dollars. Railway facture à l'usage : la
consommation se lit dans « Usage » du projet. **À la fin de la campagne, on
supprime les deux projets** (voir la dernière section).

---

## Geste 1 — La base de test (Supabase)

1. Supabase → **New project**.
   - Organisation : la même que la production.
   - Name : `winwin-campagne-15`.
   - **Region : West EU (Paris), eu-west-3.**
   - **Compute : Micro.**
   - Database password : un mot de passe neuf, **lettres et chiffres
     seulement** (un symbole casserait la chaîne de connexion). Garde-le dans
     ton gestionnaire de mots de passe.
   - « Enable Data API » : **coché**. Le serveur passe par elle.
   - « Automatically expose new tables » : **NON coché**, comme en production
     (relevé du 26/09). Coché, chaque table reçoit d'office tous les droits pour
     `anon` et `authenticated`, et la requête d'écarts du geste 3 rend « ÉCART »
     (42 droits en trop, constaté le 05/10, passation §15 vicies C).
   - « Enable automatic RLS », si l'option est proposée : **NON coché**. La
     migration 048 pose elle-même cette protection. On vérifie justement qu'elle
     le peut sur un projet neuf : c'est une hypothèse écrite dans la 048.
2. Une fois le projet prêt : Settings → Data API (ou « API ») → **Max rows :
   vérifie que la valeur est 1000**, comme en production.
3. Repère ces trois valeurs, sans me les envoyer. Tu les colleras dans Railway
   au geste 2.
   - **Project URL** : elle ira dans `SUPABASE_URL`.
   - **Clé secrète** : Supabase → API Keys → crée une clé secrète dédiée,
     nommée `serveur_campagne` (même geste que pour la production le 29/09,
     passation §15 septies). Elle commence par `sb_secret_`. Elle ira dans
     `SUPABASE_SERVICE_KEY`. La production utilise ce même format de clé : la
     mesure reste comparable. N'utilise pas l'onglet « Legacy API keys ».
   - **Chaîne « Session pooler »** : bouton **Connect** → « Session pooler »
     (port 5432, pas le « Transaction pooler » 6543). Remplace
     `[YOUR-PASSWORD]` par ton mot de passe. Elle ira dans
     `CAMPAGNE_DATABASE_URL`. Le pooler est nécessaire : la connexion directe
     de Supabase passe en IPv6, ce que Railway ne garantit pas en sortie.
     *(HYPOTHÈSE.)*

## Geste 2 — Le projet Railway de test, sans rien déployer

1. Railway → **New Project → Empty Project**. Nomme-le `winwin-campagne-15`.
   **Ne duplique jamais le projet ni un service de production** : cela
   recopierait les vraies clés.
2. Dans ce projet, crée **trois services vides** (« Create → Empty Service »)
   et nomme-les exactement `serveur`, `imitateur` et `pilote`. Ces noms
   servent d'adresses internes, par exemple `serveur.railway.internal`.
3. Pour **chacun des trois**, dans Settings :
   - **Region : EU West (Amsterdam).**
   - Custom Start Command : **VIDE**.
   - Ne connecte PAS encore le dépôt.
4. Sur `serveur` seulement : Settings → Deploy → **Healthcheck Path
   `/health/db`**, comme en production ; puis Settings → Networking →
   **Generate Domain**, port
   **8080**. Note l'adresse obtenue (`https://….up.railway.app`) : c'est
   l'**adresse publique du serveur de test**. Ce n'est pas un secret. Si
   Railway ne propose le domaine qu'après un premier déploiement, fais-le au
   geste 4 : le serveur refusera d'abord de démarrer (`API_BASE_URL` absent),
   puis démarrera dès que tu auras reporté l'adresse dans `API_BASE_URL` et
   `CIBLE_PUBLIQUE`.
5. Remplis les variables. Pour chaque service, c'est la liste complète :
   n'ajoute rien d'autre.

**`serveur`**

| Variable | Valeur |
|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `tests/charge/Dockerfile` |
| `PORT` | `8080` |
| `NODE_OPTIONS` | `--require /app/tests/charge/campagne.js` |
| `SUPABASE_URL` | Project URL du Supabase de **TEST** |
| `SUPABASE_SERVICE_KEY` | clé secrète `sb_secret_…` du Supabase de **TEST** |
| `JWT_SECRET` | une valeur **neuve**, longue (au moins 48 caractères), au hasard ; **jamais celle de la production** |
| `ADMIN_PASSWORD` | une valeur **neuve**, au hasard ; jamais celle de la production |
| `API_BASE_URL` | l'adresse publique du serveur de test (étape 4) |
| `CAMPAGNE_APNS` | `http://imitateur.railway.internal:9001` |
| `CAMPAGNE_GOOGLE` | `http://imitateur.railway.internal:9002` |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `30` (comme la production) |

**Aucune** variable `APPLE_…`, `GOOGLE_SERVICE_ACCOUNT_JSON` ni `SENTRY_DSN`.
Le serveur de test refuse de démarrer s'il en trouve une : c'est un garde-fou
voulu.

**`pilote`**

| Variable | Valeur |
|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `tests/charge/Dockerfile` |
| `CAMPAGNE_PROGRAMME` | `tests/charge/pilote.js` |
| `CAMPAGNE_ETAPE` | `temoin` |
| `CAMPAGNE_DATABASE_URL` | chaîne « Session pooler » du Supabase de **TEST** |
| `JWT_SECRET` | `${{serveur.JWT_SECRET}}` (référence : la même valeur que le serveur, sans la recopier) |
| `CIBLE` | `http://serveur.railway.internal:8080` |
| `CIBLE_PUBLIQUE` | l'adresse publique du serveur de test (étape 4) |
| `IMITATEUR` | `http://imitateur.railway.internal:9002` |

Dans Settings → Deploy du pilote : **Restart Policy : Never**. Le pilote fait
une étape puis s'arrête ; il ne doit pas recommencer tout seul. Pas de domaine
public, pas de healthcheck.

**`imitateur`**

| Variable | Valeur |
|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `tests/charge/Dockerfile` |
| `CAMPAGNE_PROGRAMME` | `tests/charge/imitateur.js` |
| `IMITATEUR_SERVEUR` | `http://serveur.railway.internal:8080` |
| `IMITATEUR_PORT_APNS` | `9001` |
| `IMITATEUR_PORT_WEB` | `9002` |
| `JWT_SECRET` | `${{serveur.JWT_SECRET}}` |

Pas de domaine public : l'imitateur n'est joignable que depuis le projet.

*HYPOTHÈSES Railway, vérifiées au premier déploiement :*

- `RAILWAY_DOCKERFILE_PATH` choisit le Dockerfile de campagne ;
- le fichier `Dockerfile.dockerignore` placé à côté est bien pris en compte ;
- la référence `${{serveur.JWT_SECRET}}` recopie la valeur ;
- les adresses `*.railway.internal` répondent.

Si l'une d'elles est fausse, l'échec est bruyant (voir les gestes 3 et 4) :
on s'arrête et tu m'envoies le message.

## Geste 3 — Préparer la base de test (pilote, `CAMPAGNE_ETAPE=temoin`)

Sur `pilote` : Settings → Source → **Connect Repo** →
`Yass69330/WinWin-Card`, **branche `campagne/etape15`**, **Root Directory
`winwincard/backend`**. Railway construit puis lance le pilote.

Dans le journal de construction, le Dockerfile utilisé doit être
`tests/charge/Dockerfile`. Dans le journal du pilote, tu dois lire :

```
[pilote] étape « temoin »
[preparer] base NEUVE (aucune table dans public), mode temoin
[preparer] dépôt rejoué : 53 fichiers (jusqu'à migration_053_parrainage_jamais_de_baisse.sql) en … s
[preparer] témoin en place
[preparer] écarts : 0|VERDICT|IDENTIQUE au dépôt (hors plateforme)|0 écart(s) · … plateforme|…
[preparer] VERDICT : base de test IDENTIQUE au dépôt
[pilote] FIN de l'étape « temoin » : sortie 0 (réussie)
```

Ce qui peut arriver d'autre :

- **`rejeu interrompu à migration_048…`** : la 048 ne peut pas poser sa
  protection sur un projet neuf. C'est l'hypothèse qu'on vérifie. Envoie-moi
  la ligne et ne relance rien.
- **`VERDICT : ÉCART`** (étape en échec, sortie 1) : la base de test n'est
  pas identique au dépôt, donc la mesure ne vaudrait pas pour la production.
  Envoie-moi le journal du pilote et ne lance pas la suite.
- **`REFUS : … ce n'est PAS une base de campagne`** : la chaîne de connexion
  vise une autre base que celle du projet de test. Rien n'a été écrit. Vérifie
  `CAMPAGNE_DATABASE_URL`.
- **`Cannot find module '/app/tests/charge/pilote.js'`** : Railway n'a pas
  pris le `Dockerfile.dockerignore` de la campagne. Envoie-moi le message.

## Geste 4 — Démarrer le serveur et l'imitateur

Sur `serveur`, puis sur `imitateur` : **Connect Repo**, avec la même branche
et le même Root Directory qu'au geste 3.

- Dans le journal du serveur, tu dois lire `[campagne] actif : témoin présent,
  clés factices, sorties permises …`, puis `WinWin Card API démarré sur le
  port 8080`.
- Le déploiement du serveur doit être vert (contrôle de santé `/health/db`).
- Dans le journal de l'imitateur, tu dois lire `[imitateur] prêt apns=9001
  web=9002 iphones=oui`.
- Si le serveur affiche **`REFUS`** au démarrage, c'est un garde-fou. Le plus
  souvent : le geste 3 n'est pas fait, ou une variable interdite est présente.
  Envoie-moi la ligne.

## Geste 5 — LE TEST D'ADRESSE (premier essai mesuré)

Ce test répond à une question : un client peut-il tromper le limiteur en
annonçant une fausse adresse ?

1. Sur `pilote` : `CAMPAGNE_ETAPE` = **`adresse`**, puis **Deploy**.
2. Dans le journal du pilote, une ligne commence par **`adresse :`**. Elle
   donne l'une de ces trois conclusions :
   - **`CONTOURNABLE`** : le limiteur croit l'adresse annoncée par le client.
     N'importe qui peut le contourner. C'est noté pour l'étape 17, rien n'est
     corrigé maintenant.
   - **`ADRESSE PARTAGÉE`** : le limiteur voit une adresse interne de
     Railway. Tous les clients du monde tombent dans un seul compteur.
   - **`adresse réelle du client`** : le limiteur voit la bonne adresse et ne
     se laisse pas tromper par cet en-tête.
3. Le pilote écrit aussi une ligne **`à ouvrir dans un navigateur`** suivie
   d'une adresse. Ouvre-la deux fois : sur ton ordinateur en wifi, puis sur
   ton téléphone en 4G. La page affiche `ip_retenue`. Compare cette valeur à
   ton adresse IP (cherche « quelle est mon adresse IP »).
4. **Envoie-moi** :
   - la ligne `adresse : …` du pilote. Elle ne contient aucun secret : on y
     lit l'adresse de documentation 192.0.2.77 et celle de Railway ;
   - pour chaque navigateur, **« ip_retenue = mon adresse : oui ou non »**.
     Pas l'adresse elle-même.
5. Remets `CAMPAGNE_ETAPE` = **`attente`**, puis **Deploy**.

Pourquoi revenir à `attente` : un push sur la branche de campagne redéploie
le pilote. Avec `attente`, il ne rejoue rien.

*La clé contenue dans l'adresse du navigateur n'ouvre que les sondes du
serveur de TEST. Elle est dérivée du `JWT_SECRET` de test, pas de celui de la
production.*

## La suite, après le test d'adresse

La suite est détaillée à ton retour, une fois le résultat du test d'adresse
connu. Le principe reste le même : une valeur de `CAMPAGNE_ETAPE`, puis
**Deploy**, puis tu lis le journal du pilote.

- `donnees` charge les données factices. Le palier se choisit avec
  `CHARGE_PLAFOND` sur le pilote (5000, puis 20000, puis 50000). La base est
  vidée à chaque fois, et le témoin est remis.
- Une liste de scénarios, par exemple `scan,rush` ou `campagne` : le pilote
  les joue contre le serveur de test, par le réseau privé. Les réglages se
  font avec `CHARGE_RYTHME`, `CHARGE_DUREE_S`, `CHARGE_CIBLE_CAMPAGNE`,
  `CHARGE_CAMPAGNE_S` et `CHARGE_CRON_S`.

**Créneau à éviter** : le serveur de test lance son cron quotidien à 08:00
UTC, comme la production (midi à Dubaï). Au palier 50 000, ce cron dure
environ 50 minutes. Aucun essai entre 08:00 et 09:00 UTC, sauf l'essai du cron
lui-même.

## À la fin de la campagne

1. Railway : projet `winwin-campagne-15` → Settings → **Delete Project**.
2. Supabase : projet `winwin-campagne-15` → Settings → General → **Delete
   project**.
3. Vérifie que la production n'a pas bougé : `/health/db` est vert, et la
   requête d'écarts rend « IDENTIQUE ».
