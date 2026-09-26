# Audit WinWin — Étape préalable 00a : la photo de production

> Première étape de l'audit global (brief §6). Question posée : **le schéma de la
> base de production correspond-il au dépôt ?** Et : où tournent le serveur
> (Railway) et la base (Supabase), avec quel coût en latence, en France et à Dubaï.
> Même règle que les segments : **tout constat est rattaché à une preuve**
> (requête, fichier:ligne, commit). Ce qui n'a pas pu être prouvé est marqué comme
> tel et n'est jamais comblé par une reconstitution.

| | |
|---|---|
| **Date** | 2026-09-26 |
| **Commit audité** | `97a5524` (branche `claude/keen-goldberg-MXslu`) |
| **Dernière migration du dépôt** | `047_avis_google` (+ `rgpd_effacement.sql`, hors numérotation) |
| **Périmètre** | schéma `public` de la production : tables, colonnes, contraintes, index, triggers, policies, fonctions (signature et code), droits ; réglages et objets de la plateforme Supabase qui touchent l'application ; régions Railway et Supabase, réglages Railway, version de Node ; latence d'un scan |
| **Méthode** | base de **référence** reconstruite dans le conteneur d'audit à partir du dépôt (PostgreSQL 16.13) ; requêtes **P1 à P8** en lecture seule (`docs/audit/00a-requetes.sql`) exécutées par Yass dans l'éditeur SQL Supabase le 26/09 (production : PostgreSQL 17.6), puis comparées mécaniquement à la référence ; historique git complet (241 commits) pour l'origine des écarts ; relevés de Yass dans les tableaux de bord Railway et Supabase ; mesure de latence de Yass depuis Dubaï (médianes de 15 essais) |
| **Limite de méthode** | aucun accès direct à la base ni au réseau de production depuis le conteneur (connexion à `app.winwin-card.com` refusée par le proxy) : tout ce qui vient de la production est un résultat collé ou relevé par Yass. La latence a été mesurée depuis Dubaï seulement : le chiffre France est une estimation |

### Légende des statuts

| Marque | Sens |
|---|---|
| **PROUVÉ** | vérifiable par la requête, le fichier:ligne ou le commit cité |
| **HYPOTHÈSE** | raisonnement cohérent, non vérifié — ce qui le confirmerait est indiqué |
| **NON VÉRIFIABLE** | la preuve n'existe pas ou n'est pas accessible — la raison est donnée |

---

## 1. En une page

**La photo tient.** Le dépôt dit la vérité sur la structure de la base et sur la
logique de ses fonctions. Les segments suivants peuvent lire `database/` comme
l'état réel de la production, **aux cinq exceptions près** listées ci-dessous
(1 à 5). S'y ajoutent deux constats sur le serveur (6 et 7).

| | Constat | Statut |
|---|---|---|
| ✅ | **Les 14 tables sont identiques** au dépôt : 161 colonnes, 58 contraintes, 49 index, 3 triggers, 8 policies. Aucune table, colonne, séquence, vue ni type en plus ou en moins. | PROUVÉ |
| ✅ | **Le code des 7 fonctions du dépôt est identique** en production, dont les deux qui écrivent le solde (`increment_stored_value`, `annuler_scan`). Une seule `increment_stored_value`, à 4 arguments : le piège des surcharges de juillet n'est pas revenu. | PROUVÉ |
| ⚠️ 1 | **Le dépôt ne contient pas les droits qui font marcher le serveur** sur 7 tables centrales (`marchands`, `clients`, `passes`, `scans`, `device_tokens`, `consentements`, `workflows`). En production ils existent ; dans une base rejouée depuis le dépôt, ils n'existent pas. | PROUVÉ |
| ⚠️ 2 | **Le texte de 4 fonctions diffère** du dépôt : commentaires retirés ou différents, lignes regroupées. Le code est le même. `increment_stored_value` tourne avec le texte de la migration **022**, neutralisée dans le dépôt depuis le 11/07. Les trois autres textes n'ont **jamais existé dans git**. | PROUVÉ |
| ⚠️ 3 | **Un déclencheur hors dépôt** (`ensure_rls` → fonction `rls_auto_enable`) active d'office la protection RLS sur toute nouvelle table. La RLS est active sur **4 tables de plus** que ce que dit le dépôt. Sans effet pour le serveur. | PROUVÉ (origine NON VÉRIFIABLE) |
| ⚠️ 4 | **Le rôle `anon` peut exécuter les 8 fonctions**, dont `effacer_client`, qui s'exécute avec les droits de son propriétaire. C'est le réglage par défaut de PostgreSQL, identique dans la base rejouée. L'exposition réelle dépend de la clé `anon` de Supabase, qu'aucune page ne contient. **Transmis au segment 3.** | PROUVÉ (droit) / HYPOTHÈSE (exposition) |
| ⚠️ 5 | **Les requêtes du serveur sont probablement coupées à 8 secondes** (réglage du rôle `authenticator`). Une lecture qui grossit avec le stock (statistiques réseau, admin) échouera net au-delà, au lieu de ralentir. **Transmis aux segments 5 et 6.** | HYPOTHÈSE |
| ⚠️ 6 | **Le serveur tourne en Californie, la base à Paris.** Chaque requête à Supabase coûte environ 213 ms vue du serveur (mesuré depuis Dubaï). Un scan en enchaîne 4 : **environ 1,1 s par scan à Dubaï et 1 s en France**, dont environ 0,85 s d'allers-retours entre la Californie et Paris. Relève de la gravité 3 (scan au comptoir). | PROUVÉ (régions, mesure) / HYPOTHÈSE (total par scan, France) |
| ⚠️ 7 | **La production tourne sous Node 24 ; le dépôt et le Socle disent Node 22.** La contrainte du dépôt (`>=22`) laisse une reconstruction changer de version majeure sans aucun commit. C'est déjà arrivé une fois : la signature des cartes Apple avait cassé (28/05). | PROUVÉ |

**Aucun de ces écarts ne met en danger l'argent des clients aujourd'hui.**
- L'écart 1 comptera le jour où il faudra **reconstruire la base à partir du
  dépôt** : restauration après incident, base jetable du filet de tests (brief
  §8), second projet Supabase pour la structure UAE. Ce jour-là, le serveur ne
  pourrait pas lire la table `marchands` (§5.1).
- L'écart 6 se paie déjà, **à chaque scan**, en France comme à Dubaï (§7.3).

---

## 2. Méthode

### 2.1 Une base de référence construite à partir du dépôt

Dans le conteneur d'audit, sur PostgreSQL 16.13 :

1. un prélude reproduit le strict nécessaire de Supabase : rôles `anon`,
   `authenticated` et `service_role` (ce dernier `BYPASSRLS`), schéma
   `extensions` contenant `uuid-ossp` et `pgcrypto` ;
2. rejeu, dans l'ordre, de `schema.sql`, des migrations `002` à `047`, puis de
   `rgpd_effacement.sql` (qui crée `effacer_client`, appelée par
   `clients.js:163`).

**Les 48 fichiers passent sans une erreur.** Commandes exactes : annexe B.

### 2.2 Des empreintes plutôt que des listings

L'éditeur SQL de Supabase coupe l'affichage vers 100 lignes, sans prévenir
(passation §3.10). Un listing complet du schéma y est donc illisible. Chaque
objet est plutôt réduit à une **empreinte** : les 10 premiers caractères du md5
d'une description normalisée. Les mêmes requêtes tournent sur la référence et sur
la production. **Deux empreintes égales = objet identique.** Seuls les objets
divergents ont ensuite fait l'objet d'une requête de détail (P7, P8).

Normalisation appliquée des deux côtés :
- les préfixes `public.` et `extensions.` sont retirés (sur Supabase,
  `uuid-ossp` vit dans le schéma `extensions`) ;
- les colonnes sont triées par **nom**, pas par position physique : une colonne
  ajoutée à la main dans un autre ordre n'est pas un écart ;
- pour le code des fonctions : une empreinte brute (au caractère près) et une
  empreinte qui ignore les espaces et retours à la ligne.

**Robustesse vérifiée** : la production tourne en PostgreSQL 17.6, la référence
en 16.13. Les 70 empreintes de tables (5 par table) sont identiques des deux
côtés : la différence de version ne fausse pas la comparaison.

### 2.3 Les requêtes

`docs/audit/00a-requetes.sql`, toutes en lecture seule :

| Requête | Photographie | Lignes |
|---|---|---|
| P1 | version, extensions, schémas, nombre d'objets, séquences, types (enum et domaines avec leurs valeurs) | 10 |
| P2 | une ligne par table : RLS + empreintes colonnes, contraintes, index, triggers, policies | 14 |
| P3 | une ligne par fonction : signature, retour, langage, `SECURITY DEFINER`, empreintes du code | 8 |
| P4 | droits effectifs de `anon`, `authenticated`, `service_role` sur chaque table et séquence | 16 |
| P5 | droit d'exécution sur chaque fonction + privilèges par défaut | 14 |
| P6 | réglages des rôles, buckets Storage, réglages serveur | 11 |
| P7 | code des 4 fonctions divergentes, comparé ligne à ligne au dépôt | 48 |
| P8 | déclencheurs d'événements + définition de `rls_auto_enable` | 38 |

P7 a été validée avant envoi par un **contrôle positif** : sur une copie de la
référence où un seul mot de `increment_stored_value` était changé
(`false` → `true`), elle fait ressortir exactement cette ligne.

---

## 3. Les tables — identiques

**PROUVÉ (P1, P2).** Mêmes 14 tables des deux côtés, aucune vue, aucun type
personnalisé, mêmes deux séquences (`avis_clics_id_seq`,
`notification_envois_id_seq`). Pour chaque table, les cinq empreintes sont égales.

| Table | Colonnes | Contraintes | Index | Triggers | Policies | RLS dépôt | RLS prod |
|---|---|---|---|---|---|---|---|
| `avis_clics` | 5 | 3 | 2 | 0 | 0 | oui | oui |
| `clients` | 12 | 5 | 5 | 1 | 3 | oui | oui |
| `consentements` | 6 | 3 | 1 | 0 | 0 | oui | oui |
| `device_tokens` | 8 | 5 | 5 | 0 | 1 | oui | oui |
| `diagnostics_camera` | 5 | 2 | 2 | 0 | 0 | **non** | **oui** |
| `marchands` | 62 | 16 | 3 | 1 | 1 | oui | oui |
| `notification_envois` | 11 | 4 | 6 | 0 | 0 | oui | oui |
| `notification_logs` | 8 | 2 | 2 | 0 | 0 | oui | oui |
| `passes` | 9 | 4 | 5 | 1 | 2 | oui | oui |
| `points_de_vente` | 8 | 2 | 5 | 0 | 0 | **non** | **oui** |
| `referral_credits` | 6 | 4 | 4 | 0 | 0 | **non** | **oui** |
| `scans` | 10 | 4 | 6 | 0 | 1 | oui | oui |
| `workflow_executions` | 5 | 2 | 2 | 0 | 0 | **non** | **oui** |
| `workflows` | 6 | 2 | 1 | 0 | 0 | oui | oui |
| **Total** | **161** | **58** | **49** | **3** | **8** | | |

« Identique » couvre, pour chaque colonne, le nom, le type, la nullabilité, la
valeur par défaut, l'identité et le calcul ; pour chaque contrainte, son nom et sa
définition complète (clés, `ON DELETE`, `CHECK`) ; pour chaque index, sa
définition complète (unicité, colonnes, condition des index partiels). Cela
inclut les points déjà fragiles par le passé : les `CHECK` rattrapés par la 025,
ceux de `strip_mode` et `strip_theme` (040, 043), `token_version` (045), le
registre (046), les avis (047).

**Seul écart : la protection RLS**, active en production sur 4 tables où le dépôt
ne l'active pas. Origine et effet au §6.2.

---

## 4. Les fonctions — même code, textes différents

### 4.1 Vue d'ensemble

**PROUVÉ (P3, P7, historique git).**

| Fonction | Signature (identique) | Texte | Code | Texte présent en production |
|---|---|---|---|---|
| `admin_marchands_stats` | `() → jsonb` | identique au caractère près | identique | migration 044 |
| `group_stats` | `(uuid) → jsonb` | identique au caractère près | identique | migration 039 |
| `set_updated_at` | `() → trigger` | identique au caractère près | identique | `schema.sql` |
| `increment_stored_value` | `(uuid, integer, integer, text) → TABLE(avant, apres, is_reset)` | commentaires différents | **identique** | **migration 022 telle que committée en `b7692dc`** |
| `annuler_scan` | `(uuid, uuid) → jsonb` | sans commentaires, un `RETURN` sur une ligne | **identique** | **jamais présent dans git** |
| `credit_referral` | `(uuid, integer) → TABLE(avant, apres)` | 2 commentaires en moins | **identique** | **jamais présent dans git** |
| `effacer_client` | `(uuid, uuid) → void`, `SECURITY DEFINER` | sans commentaires, 4 clauses `WHERE` sur une ligne | **identique** | **jamais présent dans git** |
| `rls_auto_enable` | `() → event_trigger`, `SECURITY DEFINER` | **absente du dépôt** | — | voir §6.1 |

Langage, volatilité, `SECURITY DEFINER` et réglages (`proconfig`) sont
identiques pour les 7 fonctions du dépôt.

### 4.2 Pourquoi « même code » est prouvé, et pas seulement probable

P7 compare les lignes comme deux ensembles : elle voit ce qui existe d'un seul
côté, pas un changement d'**ordre**. En PL/pgSQL, deux lignes échangées peuvent
changer la logique. La preuve d'ordre vient donc d'ailleurs.

- **Pour `annuler_scan`, `credit_referral` et `effacer_client`** : l'empreinte
  « sans espaces » de la production (P3, `h_corps`) est **égale** à l'empreinte du
  texte du dépôt **privé de ses commentaires et de ses espaces**, calculée dans le
  conteneur :

  | Fonction | Production, `h_corps` (P3) | Dépôt, sans commentaires ni espaces |
  |---|---|---|
  | `annuler_scan` | `3b108bb459` | `3b108bb459` |
  | `credit_referral` | `3a1baf914f` | `3a1baf914f` |
  | `effacer_client` | `e0cc0950ba` | `e0cc0950ba` |

  Autrement dit, une fois les espaces retirés, le texte de production est
  exactement le code du dépôt, **dans le même ordre, caractère pour caractère**.
  Il ne contient aucun commentaire.

- **Pour `increment_stored_value`** : les deux empreintes de production (P3 :
  `df8fca9795` et, au caractère près, `46dd4ea1ea`) sont **égales** à celles du
  corps de `migration_022_points_report.sql` dans le commit `b7692dc`
  (2026-07-11, « report du surplus (option B) — EN ATTENTE, NE PAS POUSSER »).
  Les 6 lignes de commentaire propres à la production en P7 sont celles de ce
  fichier. Enfin, le code sans commentaires de la 022 et celui de la 023 ont la
  même empreinte (`d4b664ce21`). Le code en production est donc celui de la 023,
  la référence désignée par la passation (§3.3).

**Limites de cette preuve.** Les espaces à l'intérieur des chaînes de caractères
ne sont pas comparés : ils n'apparaissent que dans trois messages d'erreur
(`'client introuvable: %'`, `'Parrain introuvable : %'`,
`'Client introuvable ou déjà effacé'`). Aucune ligne de code ne contient `--`
hors commentaire (vérifié), donc retirer les commentaires n'a rien retiré d'autre.
Les empreintes font 40 bits : une égalité par hasard est exclue en pratique.

### 4.3 Ce que ces écarts de texte veulent dire

- **`increment_stored_value`** : la passation (§3.3) désigne la 023 comme source
  de vérité et dit que les deux surcharges ont été supprimées « par DROP manuel ».
  La photo le confirme et précise : **le `CREATE` de la 023 n'a jamais été rejoué
  en production après la 022.** Aucune conséquence sur le comportement. Une
  conséquence documentaire : le texte exact en production n'existe plus que dans
  l'historique git, le fichier 022 étant réduit à des commentaires depuis
  `4db5d47`. **PROUVÉ.**
- **Les trois autres** : leur texte ne figure dans **aucune version d'aucun
  fichier `.sql`** des 241 commits du dépôt (recherche sur l'historique complet,
  toutes branches), et leurs lignes propres n'apparaissent dans aucun fichier du
  dépôt, quel qu'il soit. Ils ont été exécutés à partir d'une copie sans commentaires,
  sans trace dans git. C'est la règle de la passation §3.7 (b) enfreinte dans la
  lettre, pas dans le fond. **PROUVÉ** (absence dans git) ; **NON VÉRIFIABLE**
  quant à la provenance (la base ne garde pas d'historique de ses DDL).
  **HYPOTHÈSE** : une copie donnée dans le fil de pilotage.

### 4.4 Correspondance des lignes « dépôt seulement » de P7

Pour relecture, voici la traduction des empreintes rendues par P7 en
`3_depot_seulement` (texte de la référence) :

| Fonction | Lignes du dépôt absentes en production |
|---|---|
| `annuler_scan` | 6 commentaires (`-- Charger le scan cible…`, `-- Verrou par carte…`, `-- Doit être le scan actif le plus récent…`, `-- Intégrité : le solde courant…`, `-- quelque chose a bougé entre-temps…`, `-- Inversion : restaurer le solde…`) + le `RETURN jsonb_build_object(` écrit sur 6 lignes, que la production écrit sur une seule (mêmes clés, mêmes valeurs, même ordre) |
| `credit_referral` | 2 commentaires (`-- Verrouillage du client…`, `-- Cap à max_value…`) |
| `effacer_client` | 8 commentaires (dont la numérotation des étapes 1 à 5) + les clauses `where … / and marchand_id = p_marchand_id;` écrites sur deux lignes, que la production écrit sur une |
| `increment_stored_value` | 4 commentaires propres à la 023, remplacés en production par les 6 de la 022 |

Les compteurs de P7 se réconcilient : `annuler_scan` 44 − 12 + 1 = 33 ;
`credit_referral` 22 − 2 = 20 ; `increment_stored_value` 34 − 4 + 6 = 36 ;
`effacer_client` 37 − 15 + 4 − 1 = 25. Le « − 1 » est la ligne
`where id = p_client_id` de l'`UPDATE` final : la production l'a fusionnée avec la
suivante, mais la même ligne existe aussi dans le contrôle d'appartenance en tête
de fonction, donc P7 ne la signale pas. La preuve d'ordre du §4.2 couvre ce cas.

---

## 5. Les droits

### 5.1 Le dépôt ne suffit pas à reconstruire une base qui marche

**PROUVÉ (P4 référence vs P4 production).**

| Tables | `service_role` dans la base rejouée | `service_role` en production |
|---|---|---|
| `marchands`, `clients`, `passes`, `scans`, `device_tokens`, `consentements`, `workflows` | **aucun droit** | lecture + écriture (`rawd`) |
| `avis_clics`, `notification_envois`, `notification_logs`, `points_de_vente`, `referral_credits`, `workflow_executions` | lecture + écriture | lecture + écriture |
| `diagnostics_camera` | lecture, insertion, suppression (`rad`) | idem |
| les 2 séquences | `rU` | `rU` |

Tous les droits que le dépôt **déclare** existent en production : la 028, la 030,
les GRANT des migrations 006, 032, 042, 046 et 047, et les droits d'exécution
des migrations 036, 038, 039 et 044 sont bien passés. Mais les
7 tables créées par `schema.sql` n'ont reçu leurs droits `service_role` par
**aucun fichier**. La production les a ; leur origine est **NON VÉRIFIABLE**
(aucun historique des GRANT en base).

**Pourquoi c'est bloquant et pas cosmétique — PROUVÉ (P5).** Les privilèges par
défaut de la production pour les tables que crée le rôle `postgres` ne donnent à
`service_role` que `Dxtm` (vider, référencer, déclencher, maintenir) : **ni
lecture ni écriture**. Une table neuve est donc inutilisable par le serveur tant
qu'un `GRANT` explicite n'est pas passé. C'est le mécanisme des incidents corrigés
par la 028 (déduplication des workflows muette) et la 030 (parrain jamais
crédité). Que le réglage ait été le même à l'époque n'est pas vérifiable ; la
leçon de la passation (§8) vaut en tout cas aujourd'hui, preuve à l'appui.

**Conséquence — HYPOTHÈSE forte.** Rejoué tel quel sur un projet Supabase dont les
privilèges par défaut sont ceux de la production, le dépôt produirait une base où
le serveur **ne peut lire ni `marchands` ni `clients`** : connexion marchand,
landing, scan, cartes, tout tomberait. *Test qui trancherait* : rejouer le dépôt
sur un projet Supabase neuf, puis appeler `GET /api/merchants/<slug>/public`.

Cela concerne tout futur rejeu : restauration après incident, base jetable du
filet de tests (brief §8), second projet Supabase pour la structure UAE (brief
§3). Gravité à établir au segment 6.

### 5.2 Les rôles de l'API publique : `anon` et `authenticated`

**PROUVÉ (P4).** Aucun des deux n'a de droit de **lecture ni d'écriture** sur
aucune table, à une exception prévue par le dépôt : `authenticated` peut lire et
écrire `notification_logs` (migration 006, lignes 18-19). Tous deux ont `Dxt`
(vider, référencer, déclencher) sur les 14 tables, hérité des privilèges par
défaut, qui ajoutent aussi `m` (maintenir, PostgreSQL 17) : P4 ne le teste pas.

**HYPOTHÈSE, pour le segment 3** : l'API REST de Supabase (PostgREST) n'expose
que la lecture, l'insertion, la modification, la suppression et l'appel de
fonctions. Le droit de vider une table ne serait donc pas atteignable par l'API.
Aucune autre porte n'est ouverte côté base : `pg_graphql` n'est pas installé
(P1).

### 5.3 Le droit d'exécuter les fonctions

**PROUVÉ (P5).** `anon`, `authenticated` et `service_role` peuvent exécuter les
**8 fonctions**. C'est le comportement par défaut de PostgreSQL (droit
d'exécution accordé à tous), et la base rejouée rend exactement la même chose :
**ce n'est pas un écart avec le dépôt**, c'est un réglage que le dépôt ne
restreint pas.

Ce qu'un appel par `anon` produirait réellement :

| Fonction | Mode d'exécution | Appel par `anon` |
|---|---|---|
| `increment_stored_value`, `annuler_scan`, `credit_referral`, `group_stats`, `admin_marchands_stats` | droits de l'appelant | **échoue** : `anon` n'a pas le droit de lire `clients` ni `scans` (P4) |
| `rls_auto_enable`, `set_updated_at` | — | **impossible** : une fonction de déclencheur ne s'appelle pas directement (erreur « trigger functions can only be called as triggers », obtenue sur la référence en appelant `set_updated_at()` et une fonction `event_trigger` de test) |
| **`effacer_client`** | **droits du propriétaire** (`SECURITY DEFINER`) | **s'exécute**, sans passer par les droits de `anon` ni par la RLS |

`effacer_client` supprime les jetons d'appareil, la carte et les consentements du
client, puis efface ses données et change son numéro de série
(`rgpd_effacement.sql:29-54`) : **la carte du client est détruite**. Son solde
reste en base, mais n'est plus rattaché à aucune carte utilisable.

**Ce qui borne l'exposition — HYPOTHÈSE, à instruire au segment 3.** Il faut à la
fois :
1. **la clé `anon` du projet Supabase.** Elle n'apparaît dans aucune page servie
   par l'application (aucune occurrence de clé Supabase dans `public/` ; le
   serveur n'utilise que la clé `service_role`, `supabase.js:8-14`). Qui la
   détient et où elle a circulé reste à établir ;
2. **l'identifiant du marchand**, qui est public (`GET /api/merchants/:slug/public`
   le renvoie, `merchants.js:179`) ;
3. **l'identifiant du client visé**, renvoyé au client à son inscription
   (`clients.js:88-89`) et au marchand par les routes du dashboard ; l'inventaire
   complet des endroits où il circule revient au segment 3.

Gravité potentielle : 1 (argent, carte détruite) sous réserve des trois
conditions. Piste évidente pour le segment 3 : retirer le droit d'exécution aux
rôles `anon` et `authenticated`, le serveur n'utilisant que `service_role`.

---

## 6. Ce qui vit en base hors du dépôt

### 6.1 Le déclencheur `ensure_rls` et la fonction `rls_auto_enable`

**PROUVÉ (P8).** Un déclencheur d'événement `ensure_rls`, propriété du rôle
`postgres`, se déclenche à chaque `CREATE TABLE`, `CREATE TABLE AS` et
`SELECT INTO`. Il appelle `public.rls_auto_enable()`, qui active la RLS sur toute
table créée dans le schéma `public` (lignes 13-18 de sa définition). Un échec est
seulement journalisé (lignes 20-22) : il ne peut pas faire échouer une migration.
La fonction est `SECURITY DEFINER` avec `search_path = pg_catalog`, ce qui est
correct.

Les six autres déclencheurs d'événements sont ceux de la plateforme Supabase
(propriétaire `supabase_admin`) : rechargement du cache de l'API après un
changement de schéma (`pgrst_ddl_watch`, `pgrst_drop_watch`) et droits posés à
l'installation d'extensions.

**Origine — NON VÉRIFIABLE** : ni le dépôt ni la base ne gardent trace de sa
création. Son propriétaire (`postgres`, et non `supabase_admin`) indique qu'elle a
été créée depuis une session du projet (éditeur SQL ou option du tableau de bord),
pas par la plateforme elle-même. **HYPOTHÈSE** : option Supabase « activer la RLS
sur les nouvelles tables », à confirmer par Yass.

### 6.2 La RLS sur 4 tables de plus

**PROUVÉ (P2)** : `diagnostics_camera`, `points_de_vente`, `referral_credits` et
`workflow_executions` ont la RLS active en production, pas dans le dépôt.

**Sans effet pour le serveur — PROUVÉ** : il passe par `service_role`, qui ignore
la RLS. Preuve indirecte en production : `notification_envois` a la RLS active et
**aucune** policy, et reçoit bien ses lignes (recette du registre, passation
§15 quinquies).

**Origine — NON VÉRIFIABLE.** `ensure_rls` n'agit qu'à la création d'une table.
Les 4 tables ont été créées entre juin et septembre (commits d'ajout : 010 le
03/06, 014 le 07/06, 032 le 14/08, 042 le 11/09). Pour toute table plus ancienne
que le déclencheur, la RLS a été activée à la main. Rien ne permet de dater le
déclencheur.

Effet sur l'avenir : toute nouvelle table sera protégée d'office et invisible
pour `anon` et `authenticated` tant qu'aucune policy n'est écrite. C'est un défaut
sûr. Pour que le dépôt dise la vérité, `ensure_rls` et ces 4 activations devront
y être consignés ; le segment 6 le proposera.

### 6.3 Extensions et schémas

**PROUVÉ (P1).**
- Extensions : `pgcrypto`, `uuid-ossp` (déclarées par `schema.sql`),
  `pg_stat_statements` et `supabase_vault` (plateforme).
- **`pg_cron`, `pg_net` et `pg_graphql` ne sont pas installés.** Aucune tâche
  planifiée ne tourne dans la base : **toutes les tâches automatiques vivent dans
  le process Node** (`cron.js`). C'est la confirmation, côté base, du lien partagé
  signalé par le brief (§6, segment 0).
- `pg_stat_statements` est installé : le segment 6 pourra **mesurer les requêtes
  les plus coûteuses de la production sans toucher au code**.
- Schémas : `auth`, `extensions`, `graphql`, `graphql_public`, `pgbouncer`,
  `public`, `realtime`, `storage`, `vault`, tous standards. L'application n'utilise
  que `public` et Storage : aucun `.schema(`, aucun `realtime`, aucun
  `supabase.auth` dans `src/` ni `public/` (vérifié).

### 6.4 Stockage de fichiers

**PROUVÉ (P6 + code).** Un seul bucket, `passes`, **public**, **sans limite de
taille**. C'est le seul que le code utilise (`strip-cache.js:10` ;
`admin.js:744-872`). Public veut dire que tout fichier est lisible par qui connaît
son adresse : c'est voulu (Apple et Google vont chercher les images). Non
photographiés : les règles d'accès en écriture (`storage.objects`) et le volume
stocké (§9).

### 6.5 Réglages du serveur de base

**PROUVÉ (P6).**

| Réglage | Valeur | Lecture |
|---|---|---|
| `TimeZone` | UTC | cohérent avec le code (cron à 08:00 UTC, anniversaire en UTC) |
| `max_connections` | 60 | petite instance |
| `shared_buffers` | 224 Mo (28 672 × 8 ko) | petite instance |
| `statement_timeout` global | 120 s | — |
| `statement_timeout` / `lock_timeout` du rôle `authenticator` | **8 s / 8 s** | voir ci-dessous |
| `statement_timeout` de `anon` / `authenticated` | 3 s / 8 s | — |
| `service_role` | aucun réglage propre | — |
| `authenticator` : bibliothèques préchargées | `supautils`, **`safeupdate`** | `safeupdate` refuse tout `UPDATE`/`DELETE` sans `WHERE` passé par l'API : un garde-fou existant |
| `idle_in_transaction_session_timeout` | 0 (aucun) | — |

**Le plafond de 8 secondes — HYPOTHÈSE.** Le serveur passe par l'API REST, qui se
connecte en `authenticator` puis prend le rôle `service_role`. Ce dernier n'ayant
aucun réglage propre, ce sont les 8 s d'`authenticator` qui s'appliqueraient :
toute requête du serveur plus longue serait **coupée net**, et toute attente de
verrou (le `FOR UPDATE` du scan) au-delà de 8 s échouerait. Aujourd'hui, sans
effet visible. À la cible, c'est un **seuil de rupture dur** pour ce qui grossit
avec le stock (`group_stats`, `admin_marchands_stats`, exports) : l'écran ne
ralentit pas, il tombe en erreur. *Ce qui le confirmerait* : la documentation de
la version de PostgREST déployée, ou une mesure au segment 6.

**Taille de l'instance — NON VÉRIFIABLE en SQL.** 60 connexions et 224 Mo de
mémoire partagée indiquent une petite instance. À lire au tableau de bord
(Settings → Compute and Disk) pour le segment 6.

---

## 7. Serveur, régions et latence

### 7.1 Relevés

**PROUVÉ.** Relevés faits par Yass le 26/09 dans les tableaux de bord Railway et
Supabase. Les captures sont jointes au fil de pilotage et ne sont pas versées au
dépôt.

| Élément | Valeur | Où c'est réglé |
|---|---|---|
| Région Supabase | **eu-west-3 (Paris)** | tableau de bord Supabase |
| Région Railway | **US West (Californie)** | tableau de bord Railway seulement : `railway.toml` ne fixe ni région ni nombre d'instances |
| Instances Railway | **1** replica | idem |
| Limites par instance | 8 vCPU, 8 Go | idem (des plafonds, pas une consommation) |
| Serverless (mise en veille) | désactivé | tableau de bord |
| Redémarrage | sur échec, 3 essais au plus | `railway.toml:8-9`, identique |
| Healthcheck | `/health`, délai 30 s | `railway.toml:6-7`, identique |
| Teardown | désactivé | tableau de bord ; effet à instruire au segment 6 |
| Cron Railway | aucun | — |
| Version de Node en production | **v24.10.0** | réponse de `/health` (`index.js:124`, `process.version`) ; voir §7.5 |

Trois conséquences immédiates :

- **Une seule instance : PROUVÉ.** L'hypothèse dont dépendent le cache marchand
  (passation §15 ter), les minuteurs de l'avis Google (§15 sexies) et le cron
  tient aujourd'hui. Elle n'est pourtant écrite nulle part dans le dépôt : passer
  à deux instances se fait d'un clic, sans commit ni relecture.
- **Aucune tâche planifiée hors du process Node : PROUVÉ.** Il n'y a ni cron
  Railway ni `pg_cron` en base (§6.3). Le seul planificateur est
  `cron.schedule('0 8 * * *')` (`cron.js:17`).
- **« Serverless désactivé » est un réglage porteur : HYPOTHÈSE.** Un service mis
  en veille n'exécuterait ni le cron de 08:00 UTC ni les minuteurs de l'avis, qui
  vivent en mémoire. Rien dans le dépôt ne protège ce réglage.

### 7.2 Constat : le serveur est en Californie, la base à Paris

**PROUVÉ (relevés du §7.1).** Chaque requête du serveur vers Supabase fait
l'aller-retour entre la Californie et Paris.

**Mesure de Yass, le 26/09, depuis Dubaï, sous Chrome, médiane de 15 essais :**

| Appel | Ce qu'il fait côté serveur | Médiane |
|---|---|---|
| `GET /health` | ne touche pas la base (`index.js:123-125`) | **291 ms** |
| `GET /api/merchants/dinapoli/public` | **une** requête Supabase, rien d'autre (`merchants.js:176-186`) | **504 ms** |
| **Écart** | **une requête Supabase vue du serveur** : aller-retour Californie ↔ Paris, passerelle Supabase et exécution | **≈ 213 ms** |

**La requête a bien touché la base : PROUVÉ.** Yass a vérifié le code HTTP en
console : `200` (marchand trouvé). Le conteneur d'audit n'a pas accès à
`app.winwin-card.com` (connexion refusée par le proxy) et n'a pas pu le vérifier
lui-même. Le code confirme d'ailleurs que la mesure vaudrait même sans 200 : la
requête Supabase est la **première instruction** de la route
(`merchants.js:177-181`) : elle part avant toute décision. Les trois réponses
possibles de la route la paient donc toutes :
- 200 : marchand trouvé ;
- 404 : requête exécutée, aucune ligne ;
- 403 : marchand trouvé, mais inactif.

Aucune authentification ne précède cette route. Le seul cas où la base ne serait
pas touchée est un refus du limiteur global (429, `index.js:42-47`). Mais ce
limiteur est placé avant les deux routes : il refuserait aussi `/health`, et les
deux appels répondraient aussi vite l'un que l'autre, ce qui contredit un écart
de 213 ms.

### 7.3 L'impact chiffré sur un scan

**Temps d'un scan vu de la caisse ≈ aller-retour caisse ↔ Railway + N × 213 ms**,
où N est le nombre de requêtes Supabase faites l'une après l'autre avant la
réponse.

**N = 4, et 5 quand le cache marchand a expiré : PROUVÉ (code).**

| # | Étape | Preuve |
|---|---|---|
| (0) | état du marchand (suspension, révocation), seulement quand le cache de 60 s a expiré | `auth.js:18` |
| 1 | statut de la boutique (jeton boutique) **ou** test du réseau (jeton marchand) | `scan.js:28` / `scan.js:43` |
| 2 | résolution du client (numéro de série ou code de secours) | `scan.js:65` / `scan.js:73` |
| 3 | incrément du solde (`increment_stored_value`) | `scan.js:121` |
| 4 | mise à jour de la carte et journal du scan, en parallèle | `scan.js:169` |

Rien d'autre n'est attendu avant la réponse (`res.json`, `scan.js:201`). Le push
Apple, la mise à jour Google et le parrainage partent après.

**Chiffrage : HYPOTHÈSE.** C'est un calcul fait à partir de la mesure, pas le
chronométrage d'un vrai scan.

| | Dubaï | France |
|---|---|---|
| Aller-retour caisse ↔ Railway | 291 ms (mesuré) | ≈ 150 à 200 ms (**estimation**) |
| 4 requêtes Supabase l'une après l'autre | 4 × 213 = **852 ms** | **852 ms** |
| **Scan, cache marchand valide** | **≈ 1,14 s** | **≈ 1,00 à 1,05 s** |
| Scan, cache marchand expiré (5 requêtes) | ≈ 1,36 s | ≈ 1,22 à 1,27 s |
| Part des allers-retours Railway ↔ Supabase | ≈ 75 % | ≈ 81 à 85 % |

**Le chiffre France est une HYPOTHÈSE.** Le trajet France ↔ Californie est plus
court que Dubaï ↔ Californie : environ 9 000 km contre 13 000 à vol d'oiseau.
L'estimation retient l'ordre de grandeur habituel d'un aller-retour entre l'Europe
de l'Ouest et la côte ouest américaine, plus le coût d'entrée chez Railway visible
dans la mesure de Dubaï. *Ce qui la confirmerait* : le même protocole en console,
lancé depuis la France (`/health` suffit).

**Ce que disent ces chiffres :**
- **Le temps d'un scan dépend surtout de la distance entre le serveur et la base,
  pas du calcul.** Toute requête ajoutée à la chaîne du scan coûte environ 0,2 s
  de plus, en France comme à Dubaï.
- Le cache marchand de 60 s évite environ 213 ms à chaque scan qui le trouve
  valide : ce n'est pas un raffinement.
- À Dubaï, où le scan manuel reste le cœur du produit (brief §3), la caisse attend
  environ 1,1 s par scan, dont environ 0,85 s passées à faire l'aller-retour entre
  la Californie et Paris.
- **À classer en gravité 3** (scan au comptoir) dans la synthèse. Le constat ne
  propose rien : l'audit ne corrige pas.

**Limites de ce chiffrage :**
- Les 213 ms ont été mesurées en rafale, avec une connexion du serveur vers
  Supabase déjà ouverte. Un scan isolé après une pause peut en plus payer la
  réouverture de cette connexion : un ou deux allers-retours supplémentaires.
  **HYPOTHÈSE, non mesurée** ; cela dépend de la durée de maintien des connexions
  dans Node.
- Même réserve côté caisse : le premier scan après une pause peut rouvrir la
  connexion entre le téléphone et Railway.
- La répartition des 213 ms entre réseau et exécution n'est pas mesurée.
  `pg_stat_statements` (§6.3) donnera la part d'exécution au segment 6.
- La mesure vient d'un ordinateur à Dubaï, pas d'un téléphone de caisse sur réseau
  mobile.
- Aucun autre emplacement du serveur n'est chiffré ici. Déplacer le serveur
  changerait aussi sa distance aux services d'Apple et de Google : c'est à peser
  au segment 6.

### 7.4 Au-delà du scan : le cron de 08:00 UTC

Toutes les routes paient environ 213 ms par requête Supabase faite l'une après
l'autre. Le cron est le cas le plus net d'un coût qui grossit avec le stock de
clients.

**Il ne tourne pas la nuit — PROUVÉ (`cron.js:17`, `cron.schedule('0 8 * * *')`).**
Il démarre à 08:00 UTC : **12 h à Dubaï** (UTC+4 toute l'année) et **10 h à
Paris** en heure d'été (9 h en heure d'hiver). À Dubaï, il tourne donc en plein
rush de midi. Le commentaire de `cron.js:16` le qualifie de « nightly », à tort.

**HYPOTHÈSE (calcul).** Chaque client notifié coûte 3 requêtes Supabase l'une
après l'autre :
- la mise à jour de la carte (`cron.js:237`) ;
- la lecture des jetons (`cron.js:244`) ;
- l'écriture de la déduplication (`cron.js:67` / `134` / `217`).

Soit environ 0,64 s par client en allers-retours avec la base, avant même les
appels à Apple et à Google. Le cron traite tout l'un après l'autre (rapport A
§3). Un passage qui notifie 1 000 clients dure donc au moins environ 11 min ; un
passage qui en notifie 10 000, au moins environ 1 h 45. Cela chiffre l'ordre de
grandeur que le rapport A (§3) laissait en hypothèse.

**Croisement signalé aux segments 1 et 2, sans conclusion.** Le passage du cron
et le rush de midi à Dubaï partagent la même fenêtre, le même process Node et la
même base. Ce que ce voisinage produit sur le scan n'est ni mesuré ni établi ici.

### 7.5 La version de Node

**PROUVÉ (relevé et dépôt).** La production tourne sous Node **v24.10.0**. Le
dépôt déclare `22` dans `.nvmrc` et `"node": ">=22.0.0"` dans `package.json`
(lignes 34-36), les deux depuis `75e1a39` (28/05). Le document « Socle » du
pilotage, hors dépôt, indique Node 22. **La version qui tourne n'est pas celle
qui est documentée.**

**Ce n'est pas seulement un écart de documentation : PROUVÉ (historique).** La
contrainte `>=22.0.0` n'a pas de limite haute : une reconstruction peut changer
de version majeure de Node sans le moindre commit. Le dépôt a déjà connu ce type
de rupture. Le commit `e8320ef` du 28/05, « pin Node.js 20 LTS to fix
passkit-generator PKCS7 signing on Node 22+ », répondait à une signature des
cartes Apple cassée par une version majeure plus récente. Aucun test automatisé
ne détecterait une récidive (brief §9).

**Mécanisme : HYPOTHÈSE.** Nixpacks, l'outil de construction déclaré
(`railway.toml:2`), lirait `engines.node` avant `.nvmrc` et prendrait la version
majeure la plus haute autorisée. *À confirmer* dans les journaux de construction
de Railway. La suite relève du segment 6.

---

## 8. Ce que la photo change pour la suite

| Segment | Ce qu'il hérite de 00a |
|---|---|
| Tous | le dépôt peut être lu comme l'état réel des tables et de la logique des fonctions. Les écarts de texte des fonctions sont connus et expliqués (§4) : ne pas les redécouvrir. |
| 1 — notifications | au moins 0,64 s d'allers-retours avec la base par client notifié dans le cron, soit au moins 11 min pour 1 000 clients (§7.4) ; le cron tourne à 08:00 UTC, soit 12 h à Dubaï, en plein rush de midi : croisement signalé, sans conclusion (§7.4) |
| 2 — scan et crédit | le code de `increment_stored_value` et `annuler_scan` en production est celui du dépôt (§4.2) ; 4 à 5 requêtes Supabase l'une après l'autre par scan, environ 213 ms chacune : toute requête ajoutée à la chaîne du scan coûte environ 0,2 s (§7.3) ; chronométrer un vrai scan pour confirmer le calcul ; le cron de 08:00 UTC tombe pendant le rush de midi à Dubaï : croisement signalé, sans conclusion (§7.4) ; verrou et requête bornés à 8 s (§6.5, hypothèse) |
| 3 — accès et données | droit d'exécution de `anon` sur `effacer_client` (§5.3) ; `authenticated` en lecture/écriture sur `notification_logs` (§5.2) ; `Dxtm` hérités sur toutes les tables ; où circule la clé `anon` ; les inscriptions Supabase Auth sont-elles ouvertes (elles fourniraient un jeton `authenticated`) |
| 5 — statistiques | plafond de 8 s sur `group_stats` et `admin_marchands_stats` à la cible (§6.5) |
| 6 — infrastructure | droits manquants au dépôt, reconstruction impossible en l'état (§5.1) ; `ensure_rls` et RLS des 4 tables à consigner (§6.1, §6.2) ; taille de l'instance ; `pg_stat_statements` pour mesurer (dont la part exécution des 213 ms) ; bucket sans limite ; la prod est en PostgreSQL 17.6, la base jetable du conteneur en 16 ; région et nombre d'instances réglés hors dépôt, « Serverless désactivé » porteur, effet de « Teardown » (§7.1) ; version de Node sans limite haute (§7.5) ; emplacement du serveur, à peser avec la distance à Apple et Google (§7.3) |
| Synthèse | la base jetable du filet de tests, rejouée depuis le dépôt, devra recevoir les `GRANT` des 7 tables (ou tourner sous un rôle qui ignore les droits), sinon les tests échoueront pour une mauvaise raison ; l'écart 6 (géographie) est à classer en gravité 3 |

---

## 9. Hypothèses et angles morts

| Point | Statut | Comment trancher |
|---|---|---|
| Origine des droits `service_role` sur les 7 tables centrales | NON VÉRIFIABLE | aucun historique des GRANT en base |
| Origine de `ensure_rls` et de la RLS sur 4 tables | NON VÉRIFIABLE / HYPOTHÈSE | souvenir de Yass, ou option du tableau de bord |
| Provenance des textes de 3 fonctions jamais présents dans git | NON VÉRIFIABLE | aucun historique des DDL en base |
| Plafond de 8 s appliqué aux requêtes du serveur | HYPOTHÈSE | documentation PostgREST de la version déployée, ou mesure (segment 6) |
| Rejeu du dépôt sur un projet neuf = serveur aveugle | HYPOTHÈSE forte | rejeu sur un projet Supabase neuf (segment 6) |
| Exposition réelle de `effacer_client` | HYPOTHÈSE | segment 3 |
| Droit `m` (maintenir, PG 17) effectif sur les tables | non mesuré | P4 ne teste pas ce privilège, présent dans les privilèges par défaut |
| Propriétaires des tables, commentaires, paramètres de stockage des tables, appartenance à la publication `supabase_realtime` | **non photographiés** | hors besoin de cette étape ; l'application n'utilise pas Realtime |
| Règles d'accès de `storage.objects`, volume du bucket | **non photographiés** | segment 6 |
| Espaces à l'intérieur des chaînes des fonctions | non comparés | 3 messages d'erreur seulement (§4.2) |
| Empreintes tronquées à 10 caractères (40 bits) | limite acceptée | collision fortuite exclue en pratique |
| Code HTTP de `/api/merchants/dinapoli/public` pendant la mesure | PROUVÉ : `200`, vérifié en console par Yass | — |
| Aller-retour caisse ↔ Railway depuis la France | HYPOTHÈSE (≈ 150 à 200 ms) | même protocole en console depuis la France |
| Temps total d'un scan | HYPOTHÈSE (calcul) | chronométrer un vrai scan (segment 2) |
| Coût de réouverture des connexions après une pause | HYPOTHÈSE, non mesuré | mesure d'un scan isolé après plusieurs minutes d'inactivité |
| Pourquoi Node 24 plutôt que 22 | HYPOTHÈSE | journaux de construction Railway |
| « Serverless désactivé » porteur | HYPOTHÈSE | documentation Railway sur la mise en veille |
| Effet de « Teardown désactivé » | non instruit | segment 6 |

---

## Annexe A — Résultats bruts

### P1 — contexte

| Rubrique | Référence (dépôt) | Production |
|---|---|---|
| version | 16.13 | **17.6** |
| extensions | pgcrypto 1.3, plpgsql 1.0, uuid-ossp 1.1 | + **pg_stat_statements 1.11**, **supabase_vault 0.3.1** |
| schémas | extensions, public | auth, extensions, graphql, graphql_public, pgbouncer, public, realtime, storage, vault |
| tables `public` | 14 | 14 |
| vues | 0 | 0 |
| séquences | avis_clics_id_seq, notification_envois_id_seq | idem |
| types | (aucun) | (aucun) |
| fonctions | 7 | **8** (+ `rls_auto_enable`) |
| triggers | 3 | 3 |
| policies | 8 | 8 |

### P2 — empreintes des tables (identiques des deux côtés, sauf `rls`)

| Table | h_col | h_cons | h_idx | h_trg | h_pol |
|---|---|---|---|---|---|
| avis_clics | 15e41f26a9 | fa2939e75d | afba50eedb | d41d8cd98f | d41d8cd98f |
| clients | 3a7d704fac | e5703d37ae | 718580fca1 | cd81ee2ec6 | 92c8f318d5 |
| consentements | 6522d2d2b5 | 47372e7a27 | 2c19580a47 | d41d8cd98f | d41d8cd98f |
| device_tokens | e30b39da5b | cfe0042077 | 562cf11d3a | d41d8cd98f | ef98a53312 |
| diagnostics_camera | 81c6e53263 | ca71463871 | 495fdbec43 | d41d8cd98f | d41d8cd98f |
| marchands | ec310c2d79 | c44777a8e3 | b96831cf15 | d8c0ed18e6 | ba2c64374a |
| notification_envois | 6172a47dca | e2628ff5df | eca7c370e4 | d41d8cd98f | d41d8cd98f |
| notification_logs | ac25dbfa84 | 407348e994 | fd86b47603 | d41d8cd98f | d41d8cd98f |
| passes | 2fa65e1dc6 | 0dde65652c | fe86087221 | 7ccca379fe | f5ac52b87d |
| points_de_vente | cd0720260d | 7c093a7de5 | 7d4735111c | d41d8cd98f | d41d8cd98f |
| referral_credits | 9d35856bf2 | 8b229706ca | 1c32aca53e | d41d8cd98f | d41d8cd98f |
| scans | 9020bbaef1 | eae213ba36 | f644bcf823 | d41d8cd98f | 78bfcdeee5 |
| workflow_executions | 593dc5810c | 78fff07096 | aaacb2ced5 | d41d8cd98f | d41d8cd98f |
| workflows | 51f418dd71 | 89d292be10 | 26b595d7e8 | d41d8cd98f | d41d8cd98f |

(`d41d8cd98f` = empreinte d'une liste vide.)

### P3 — empreintes du code des fonctions

| Fonction | Référence `h_corps` / brut | Production `h_corps` / brut |
|---|---|---|
| admin_marchands_stats | ca8a05d052 / 51fe8d569e | ca8a05d052 / 51fe8d569e |
| annuler_scan | c7f2450a13 / c280450010 | **3b108bb459 / 469d946a3c** |
| credit_referral | a55f276f88 / 78c386db94 | **3a1baf914f / 1beb5f33c1** |
| effacer_client | b273e95065 / 123464ff22 | **e0cc0950ba / a115d4c0ef** |
| group_stats | 46c933a208 / 28e35b2e44 | 46c933a208 / 28e35b2e44 |
| increment_stored_value | ee31147989 / 46e91e087c | **df8fca9795 / 46dd4ea1ea** |
| rls_auto_enable | — | 2965a64617 / 99be20677b |
| set_updated_at | d258fba5fe / 9b1889f562 | d258fba5fe / 9b1889f562 |

### P4 — droits sur les tables et séquences

| Objet | anon (réf / prod) | authenticated (réf / prod) | service_role (réf / prod) |
|---|---|---|---|
| 2 séquences | — / — | — / — | rU / rU |
| avis_clics, notification_envois, points_de_vente, referral_credits, workflow_executions | — / Dxt | — / Dxt | rawd / rawdDxt |
| notification_logs | — / Dxt | rawd / rawdDxt | rawd / rawdDxt |
| diagnostics_camera | — / Dxt | — / Dxt | rad / radDxt |
| clients, consentements, device_tokens, marchands, passes, scans, workflows | — / Dxt | — / Dxt | **— / rawdDxt** |

### P5 — privilèges par défaut (production)

| Créateur → objets | Droits accordés d'office |
|---|---|
| postgres → tables | postgres `arwdDxtm` ; anon, authenticated, service_role **`Dxtm`** |
| postgres → séquences | postgres `rwU` |
| postgres → fonctions | postgres `X` |
| supabase_admin → tables | postgres, anon, authenticated, service_role `arwdDxtm` |
| supabase_admin → séquences | postgres, anon, authenticated, service_role `rwU` |
| supabase_admin → fonctions | postgres, anon, authenticated, service_role `X` |

Droit d'exécution : `true` pour les trois rôles sur les 8 fonctions, en
référence (7) comme en production (8).

### P6

Reproduit aux §6.4 (bucket) et §6.5 (réglages).

### P7 — lignes présentes seulement en production (texte intégral)

| Fonction | Ligne | Texte |
|---|---|---|
| annuler_scan | 38 | `RETURN jsonb_build_object('ok', true, 'client_id', v_scan.client_id, 'serial', v_serial, 'stored_value', v_scan.stored_value_avant);` |
| effacer_client | 13, 16, 19 | `where client_id = p_client_id and marchand_id = p_marchand_id;` |
| effacer_client | 29 | `where id = p_client_id and marchand_id = p_marchand_id;` |
| increment_stored_value | 19-21 | `-- scan (le scan gagnant précédent l'a laissé volontairement au-dessus,` / `-- cf. commentaire de tête). Tampons : reset strict à 0, inchangé.` / `-- Points : report du surplus, jamais 0.` |
| increment_stored_value | 29-31 | `-- Scan gagnant : franchit ou atteint le seuil pile sur ce scan. Jamais` / `-- de reset ici, quel que soit le mode — le solde reste au-dessus du` / `-- seuil jusqu'au scan suivant (fond doré Apple).` |

Les lignes « dépôt seulement » sont traduites au §4.4.

### P8 — la définition de `rls_auto_enable` relevée en production

Ce texte n'existe pas dans le dépôt : il est versé ici pour que le segment 6
puisse le consigner. L'indentation peut différer de quelques espaces : c'est le
rendu de l'éditeur Supabase.

Déclencheur : `ensure_rls`, sur `ddl_command_end`, actif, propriétaire
`postgres`, pour `CREATE TABLE`, `CREATE TABLE AS` et `SELECT INTO`.

```sql
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
```

Les six autres déclencheurs, propriété de `supabase_admin` :
`issue_graphql_placeholder`, `pgrst_ddl_watch`, `pgrst_drop_watch`,
`issue_pg_cron_access`, `issue_pg_net_access`, `issue_pg_graphql_access`.

---

## Annexe B — Reconstruire la base de référence

Dans un conteneur disposant de PostgreSQL 16 (équivalent des commandes utilisées
le 26/09) :

```bash
pg_ctlcluster 16 main start
su postgres -c "createdb ref"
su postgres -c "psql -q -v ON_ERROR_STOP=1 -d ref" <<'EOF'
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA extensions;
CREATE EXTENSION "uuid-ossp" SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;
ALTER DATABASE ref SET search_path = "$user", public, extensions;
EOF
cd winwincard/backend/database
for f in schema.sql $(ls migration_*.sql | sort) rgpd_effacement.sql; do
  su postgres -c "psql -q -v ON_ERROR_STOP=1 -d ref" < "$f" || echo "ECHEC $f"
done
```

Puis exécuter P1 à P5, P7 et P8 de `docs/audit/00a-requetes.sql` sur `ref`. P6
exige le schéma `storage` de Supabase. Sur la référence, P7 ne rend que ses 4
lignes de synthèse et P8 ne rend rien.

Les rôles `anon`, `authenticated` et `service_role` sont des rôles de toute
l'instance : sur un serveur où ils existent déjà, retirer les trois `CREATE ROLE`.
