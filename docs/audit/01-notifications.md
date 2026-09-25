# Audit WinWin — Segment 01 : notifications

> Premier segment d'un audit global de la plateforme.
> Chaque segment suit la même règle : **tout constat est rattaché à une preuve**
> (fichier:ligne, requête, commit). Ce qui n'a pas pu être prouvé est marqué comme
> tel et n'est jamais comblé par une reconstitution.

| | |
|---|---|
| **Date** | 2026-09-25 |
| **Commit audité** | `8f611b6` (production, branche `claude/keen-goldberg-MXslu`, déployé le 2026-09-24) |
| **Dernière migration du dépôt** | `045_token_version` |
| **Périmètre** | tout ce qui envoie un push Apple ou met à jour un objet Google Wallet |
| **Méthode** | lecture du code uniquement |
| **Limite de méthode** | **aucune requête SQL n'a été exécutée** — pas de variable `SUPABASE_*` ni de `.env` dans l'environnement d'audit. Les requêtes de l'annexe A restent à exécuter. |

### Légende des statuts

| Marque | Sens |
|---|---|
| **PROUVÉ** | vérifiable en lisant le fichier:ligne cité |
| **HYPOTHÈSE** | raisonnement cohérent, non vérifié en production — un test est fourni |
| **NON VÉRIFIÉ** | demande un accès base ou une observation en production |

---

## 1. Déclencheur

Un porteur détenant des cartes chez plusieurs marchands a reçu **la relance « client
inactif » de 5 marchands différents au même instant**. Le soupçon plus large : les
notifications automatiques partent mal, sans qu'on sache lesquelles fonctionnent.

---

## 2. Inventaire des surfaces d'envoi

**PROUVÉ.** Sept surfaces émettent un push Apple ou une mise à jour Google.

| Surface | Fichier | Déclencheur | Horaire | Déduplication | Trace en base |
|---|---|---|---|---|---|
| Workflow `inactive` | `cron.js:21` | cron global | **08:00 UTC** | `workflow_executions`, 7 j | `workflow_executions` seulement |
| Workflow `near_reward` | `cron.js:77` | cron global | 08:00 UTC | idem, 7 j | idem |
| Workflow `birthday` | `cron.js:142` | cron global | 08:00 UTC | 1 ×/an | idem |
| Purge des exécutions | `cron.js:231` | cron global | 08:00 UTC | — | — |
| Envoi manuel marchand | `notifications.js:45` | action dashboard | à la demande | quota mensuel | **`notification_logs`** |
| Push après scan | `scan.js:230` | scan en caisse | temps réel | aucune | aucune |
| Welcome push | `apple-wallet.js:58` | enregistrement du pass | temps réel | aucune | aucune |

**Un seul job planifié**, `cron.schedule('0 8 * * *')` (`cron.js:9`), confirmé au
démarrage par `index.js:148`. Les 48 marchands sont traités dans la même boucle, au
même passage. **Aucun fuseau horaire marchand n'existe en base** — tout est en UTC.

---

## 3. Pourquoi les relances arrivent groupées

Trois causes se composent. La troisième est un défaut.

### Cause A — un seul cron, une seule heure — **PROUVÉ**

`cron.js:9` : `cron.schedule('0 8 * * *')`. Aucun étalement entre marchands.

### Cause B — le push vise un appareil, pas une carte — **PROUVÉ**

`apns.js:98` envoie sur `/3/device/${pushToken}` avec l'en-tête
`apns-topic: pass.com.winwincard.loyalty`. Le push silencieux **ne nomme aucun
numéro de série** : il signale à iOS qu'« un pass de ce type a changé ».

Tous les marchands de la plateforme partagent le même Pass Type ID. Sur un appareil
donné, **un seul jeton push couvre donc l'ensemble des cartes WinWin** de son
porteur.

### Cause C — l'endpoint « passes mis à jour depuis » ne filtre pas — **HYPOTHÈSE**

`apple-wallet.js:80-104` :

```js
const query = supabase.from('device_tokens')
  .select('serial_number, passes(updated_at)')
  .eq('device_id', deviceId);
if (passesUpdatedSince) query.gt('passes.updated_at', passesUpdatedSince);
```

Le filtre porte sur une **ressource embarquée** (`passes`). En PostgREST, filtrer un
embed sans `!inner` ne supprime pas la ligne parente : il vide l'embed. La ligne
`device_tokens` reste donc dans le résultat, et `data.map(d => d.serial_number)`
(`apple-wallet.js:99`) renvoie **tous les numéros de série de l'appareil**, quelle
que soit leur date de modification.

> **Statut : hypothèse forte, non vérifiée en production.**
> Test décisif, sans authentification requise (cette route n'appelle pas
> `verifyAppleToken`, ce qui est conforme à la spécification Apple) :
>
> ```bash
> curl -s "https://<prod>/v1/devices/<device_id>/registrations/pass.com.winwincard.loyalty?passesUpdatedSince=2030-01-01T00:00:00Z"
> ```
>
> Avec une date future, la réponse attendue est **`204 No Content`**.
> Si des numéros de série sont renvoyés, la cause C est confirmée.

### Enchaînement complet

1. Le cron traite le marchand 1 → écrit `passes.notification_message` (`cron.js:211`).
2. Push silencieux sur le jeton du porteur (`cron.js:219`).
3. iOS demande la liste des cartes modifiées → **reçoit les 5 numéros de série**.
4. iOS re-télécharge **les 5 cartes**.
5. Le champ `notification_txt` porte `changeMessage: '%@'`
   (`apple-pass.js:356-360`) : iOS affiche **une notification par carte dont ce
   champ a changé**.
6. Le cron poursuit avec les marchands 2 à 5 — l'opération se répète.

---

## 4. Ce qui part réellement

### Troncature à 1 000 lignes — **PROUVÉ**

`grep -c "order(\|range("` sur `src/workers/cron.js` renvoie **0**. Aucune requête
du cron n'a d'`ORDER BY` ni de pagination. PostgREST tronque toute lecture à
**1 000 lignes** sans erreur ni avertissement.

| Ligne | Requête | Conséquence si tronquée |
|---|---|---|
| `cron.js:44` | scans du marchand sur la fenêtre d'inactivité | **des clients actifs sont classés inactifs et relancés à tort** |
| `cron.js:45` | clients du marchand | des clients ne sont jamais examinés |
| `cron.js:46` | exécutions récentes (déduplication) | **la déduplication saute → re-notification** |
| `cron.js:101` | clients proches du seuil | sous-envoi silencieux |

`cron.js:44` est le cas le plus dommageable : il produit une relance **fausse**,
visible par le client final.

### Workflow anniversaire — **PROUVÉ inopérant**

`cron.js:174` exige `date_anniversaire IS NOT NULL`. Or le champ correspondant de la
page d'inscription est **masqué en V1** : `landing.html:513-517`, classe `field-v2`,
commentaire `<!-- Date anniversaire — V2 (masqué en V1) -->`.

Aucune date de naissance n'étant collectée, ce workflow ne peut rien envoyer.
Confirmation attendue : requête A4 de l'annexe, résultat **0**.

### Traçabilité des envois — **PROUVÉ absente**

Le cron **n'écrit rien** dans `notification_logs` (aucune occurrence dans
`cron.js`, hors commentaire). Les envois automatiques ne laissent que des
`console.log` dans Railway, éphémères.

Les réponses APNs sont pourtant lues et journalisées (`apns.js:120` et `:127`
relèvent `:status` et `reason`), mais `cron.js:219` fait
`sendPushUpdate(...).catch(e => console.error(...))` : **l'échec meurt dans les logs**.

Conséquence directe : il est impossible de répondre en base à « combien de relances
sont parties hier, pour quel marchand, avec quel taux d'échec ».

### Écritures silencieuses — **PROUVÉ**

Les trois `insert` de déduplication (`cron.js:58`, `:120`, `:196`) ne lisent pas
`error`. Rappel : **supabase-js ne rejette jamais** — une erreur non lue est
invisible. C'est exactement le mode d'échec qui avait laissé `workflow_executions`
vide jusqu'à la migration 028.

`notifications.js:137` fait `.then().catch(...)` sur un insert Supabase : **du code
mort**. Un échec d'écriture de `notification_logs` est silencieux.

> Les trois autres `.catch()` sur Supabase du dépôt (`strip-cache.js:136`,
> `admin.js:701`, `admin.js:806`) portent sur `supabase.storage`, **qui rejette
> bien** : ceux-là sont légitimes.

---

## 5. Requêtes gaspillées

### Jetons morts jamais purgés — **PROUVÉ**

Aucune occurrence de `410`, `Unregistered` ni `BadDeviceToken` dans `src/`. Apple
répond `410 Unregistered` quand un porteur a supprimé sa carte ; le code ne le
distingue d'aucune autre erreur.

Conséquences : le jeton est re-poussé à chaque cron, chaque scan et chaque envoi
manuel, indéfiniment ; et il gonfle le dénominateur `total_apple` de
`notification_logs`, ce qui rend **le taux d'envoi affiché au marchand
ininterprétable**.

### Google Wallet — **PROUVÉ sans signal**

Aucune occurrence de `callback`, `webhook`, `SAVE` ni `DEL_OBJECT` dans
`google-pass.js` ou `google-wallet.js`. On ne sait ni si un objet a été enregistré,
ni s'il a été supprimé, et on continue de le mettre à jour.

---

## 6. Synthèse par workflow

| Workflow | État | Preuve | Risque principal |
|---|---|---|---|
| `inactive` | partiellement fonctionnel | part, mais `cron.js:44-46` tronquables | relance à tort de clients actifs |
| `near_reward` | partiellement fonctionnel | `cron.js:101` tronquable | sous-envoi silencieux |
| `birthday` | **inopérant** | `landing.html:513` champ masqué | aucun envoi possible |
| Purge | **inconnu** | `cron.js:233` lit `count`, pas `error` | croissance non bornée de la table |
| Envoi manuel | fonctionnel et mesuré | `notification_logs` écrit | dénominateur gonflé par les jetons morts |
| Push au scan | fonctionnel | `scan.js:230` | aucune trace |
| Welcome push | **inconnu** | `apple-wallet.js:58`, sans suivi | — |

---

## 7. Ce qui n'est pas mesurable aujourd'hui

Aucune de ces questions n'a de réponse en base, faute de trace :

- combien de relances sont parties, quel jour, pour quel marchand ;
- quel taux d'échec APNs, et pour quelle raison ;
- combien de jetons sont morts (pas de traitement du 410, pas de colonne
  « dernière activité ») ;
- l'état réel des objets Google Wallet ;
- **si un envoi n'a pas eu lieu à cause de la déduplication ou d'une requête
  tronquée** — les deux cas sont indiscernables dans les logs.

Hors de portée par conception : le nombre de notifications **réellement affichées**
sur l'écran du porteur. Apple n'expose aucun retour sur ce maillon.

---

## 8. Hypothèses et angles morts

| Point | Statut | Comment trancher |
|---|---|---|
| Filtre embarqué inerte (cause C) | **HYPOTHÈSE** | `curl` du §3 — `204` attendu |
| Un jeton partagé par toutes les cartes d'un appareil | **HYPOTHÈSE** | requête A2 |
| Migration 028 réellement appliquée | **NON VÉRIFIÉ** | requête A1 — sinon tout historique antérieur est sans valeur |
| Volumes réels par marchand | **NON VÉRIFIÉ** | requête A3 |
| `passes.updated_at` bien mis à jour au cron | **NON VÉRIFIÉ** | le trigger `trg_passes_updated_at` (`schema.sql:166`) devrait s'en charger, non observé |
| Durée de rétention des logs Railway | **NON VÉRIFIÉ** | console Railway |

---

## 9. Options envisageables, avec leurs limites

Aucune n'est recommandée à ce stade : ce document est un constat, pas un plan.

| Option | Traite | Limite |
|---|---|---|
| Corriger le filtre embarqué (`!inner`) | cause C | **ne résout pas** l'arrivée groupée : les 5 marchands poussent dans le même passage |
| Étaler le cron (par marchand ou par fuseau) | cause A | ne supprime pas la rafale si plusieurs marchands tombent dans le même créneau ; **aucun fuseau marchand n'existe en base** |
| Grouper les pushes par jeton | volume de requêtes | la notification iOS reste par carte : réduit le coût, pas le ressenti |
| Traiter le 410 + horodatage d'activité | jetons morts | prérequis à toute mesure ; ne change rien au ressenti client |
| Tracer les envois de workflow en base | non-mesurabilité | purement instrumental ; coût d'écriture par envoi |

---

## Annexe A — Requêtes de vérification

À exécuter dans Supabase. Aucune n'écrit.

**A1 — Migration 028 appliquée ? (prérequis à toute lecture d'historique)**

```sql
SELECT table_name, grantee,
       string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND grantee IN ('service_role', 'authenticated')
   AND table_name IN ('workflow_executions', 'device_tokens', 'notification_logs')
 GROUP BY 1, 2 ORDER BY 1, 2;
```

**A2 — Jetons partagés entre plusieurs cartes / plusieurs marchands**

```sql
SELECT count(*) FILTER (WHERE n_serials   > 1) AS jetons_multi_cartes,
       count(*) FILTER (WHERE n_marchands > 1) AS jetons_multi_marchands,
       max(n_serials)                          AS max_cartes_par_jeton
  FROM (SELECT push_token,
               count(DISTINCT serial_number) AS n_serials,
               count(DISTINCT marchand_id)   AS n_marchands
          FROM device_tokens GROUP BY push_token) t;
```

**A3 — Marchands exposés à la troncature à 1 000 lignes**

```sql
SELECT m.nom,
  (SELECT count(*) FROM scans s
    WHERE s.marchand_id = m.id
      AND s.date_scan > now()
          - (coalesce(m.workflow_inactive_days, 30) || ' days')::interval) AS scans_fenetre,
  (SELECT count(*) FROM clients c
    WHERE c.marchand_id = m.id AND c.deleted_at IS NULL)                   AS clients
  FROM marchands m
 WHERE m.forfait = 'pro_plus' AND m.actif
 ORDER BY 2 DESC;
```

Toute valeur ≥ 1 000 signale un marchand dont les relances sont faussées.

**A4 — Le workflow anniversaire peut-il envoyer quoi que ce soit ?**

```sql
SELECT count(*) AS clients_avec_date_naissance
  FROM clients WHERE date_anniversaire IS NOT NULL;
```

**A5 — Activité réelle des workflows sur 30 jours**

```sql
SELECT date_trunc('day', executed_at)::date AS jour,
       workflow_type, m.nom, count(*) AS n
  FROM workflow_executions we
  JOIN marchands m ON m.id = we.marchand_id
 WHERE executed_at > now() - interval '30 days'
 GROUP BY 1, 2, 3 ORDER BY 1 DESC, 4 DESC;

SELECT extract(hour from executed_at AT TIME ZONE 'UTC') AS heure_utc, count(*)
  FROM workflow_executions
 WHERE executed_at > now() - interval '30 days'
 GROUP BY 1 ORDER BY 1;
```

**A6 — Jetons probablement morts**

```sql
SELECT count(*) FILTER (WHERE created_at < now() - interval '90 days') AS jetons_90j,
       count(*) FILTER (WHERE created_at < now() - interval '30 days') AS jetons_30j,
       count(*)                                                        AS total
  FROM device_tokens;
```

> `device_tokens` ne possède **aucune colonne d'activité** : `created_at` est la
> seule approximation disponible. C'est en soi un angle mort.

---

## Annexe B — Fichiers concernés

| Fichier | Rôle dans ce segment |
|---|---|
| `src/workers/cron.js` | les trois workflows, l'envoi, la purge |
| `src/services/apns.js` | transport APNs, lecture des statuts |
| `src/routes/apple-wallet.js` | enregistrement des appareils, endpoint « mis à jour depuis » |
| `src/services/apple-pass.js` | champ `notification_txt` et son `changeMessage` |
| `src/routes/notifications.js` | envoi manuel, `notification_logs` |
| `src/routes/scan.js` | push après scan |
| `public/landing.html` | champ date de naissance, masqué en V1 |
| `database/migration_010_*.sql`, `migration_028_*.sql` | `workflow_executions` et son GRANT |
