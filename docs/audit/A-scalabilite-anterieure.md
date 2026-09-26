# Audit WinWin — Rapport A : scalabilité (antérieur au cadrage)

> **Statut : rapport transverse, écrit le 26/09 AVANT le brief d'audit.** Il n'est
> pas un segment. Ses constats relèvent de l'angle *comportement* et de l'angle
> *projection*, et sont **à répartir** dans les segments concernés — surtout le 1
> (notifications) et le 6 (infrastructure et exploitation). Conservé tel quel :
> les mesures qu'il contient ne sont pas refaisables à l'identique (le registre
> des envois n'existe que depuis le 25/09).
>
> Même règle que les segments : **tout constat est rattaché à une preuve**
> (fichier:ligne, requête, données). Ce qui n'a pas pu être prouvé est marqué
> comme tel et n'est jamais comblé par une reconstitution.

| | |
|---|---|
| **Date** | 2026-09-26 |
| **Commit audité** | `ca0579a` (production, `claude/keen-goldberg-MXslu`, déployé le 26/09) |
| **Dernière migration du dépôt** | `047_avis_google` |
| **Périmètre** | ce qui grossit avec le nombre de clients, de marchands et surtout **avec le temps** |
| **Méthode** | lecture du code **+ données de production** (requête 3 de `database/requetes/avis_et_ouverture_pro.sql`, exécutée le 25/09) |
| **Limite de méthode** | les données de terrain viennent d'**un seul appareil**, celui du fondateur (`b1fa63b0…`, 12 cartes actives sur 25 marchands). Les volumes qu'on en tire sont structurels ; les taux de conversion qu'on pourrait en tirer ne le sont pas — ce n'est pas un client. |

### Légende des statuts

| Marque | Sens |
|---|---|
| **PROUVÉ** | vérifiable en lisant le fichier:ligne cité, ou dans les données produites |
| **HYPOTHÈSE** | raisonnement cohérent, non vérifié en production — un test est fourni |
| **À VÉRIFIER** | demande une requête ou une observation qui n'a pas encore été faite |

---

## 1. En tête : la relance et le boost ne s'arrêtent jamais

**PROUVÉ — la mécanique.** `runInactiveWorkflow` (`cron.js:29-85`) ne connaît que
**deux** raisons de ne pas notifier un client :

1. il a scanné depuis `workflow_inactive_days` (`cron.js:52`) ;
2. il a déjà été relancé dans les `DEDUP_DAYS = 7` derniers jours (`cron.js:6`, `cron.js:54`).

Il n'existe **aucun compteur, aucune notion d'épisode, aucun arrêt après N
tentatives** : `grep -cE "max_relances|episode|stop_after|relance_count"` sur
`cron.js` rend **0**.

Conséquence directe : **un client qui ne revient jamais est relancé tous les
8 jours, à vie.** Huit et non sept parce que la fenêtre de dédup de 7 jours se
referme entre deux passages du cron, qui tourne une fois par nuit à 08:00 UTC.

**PROUVÉ — la même mécanique pour le boost.** `runNearRewardWorkflow`
(`cron.js:90-150`) cible les clients dont le solde est entre `max_value - seuil`
et `max_value`, avec la même dédup de 7 jours et aucune autre sortie. Un client
bloqué à 9/10 pour toujours reçoit donc, lui aussi, un push tous les 8 jours à vie.

**PROUVÉ — les deux ne se connaissent pas.** Ce sont deux passages indépendants,
avec deux clés de dédup distinctes (`workflow_type` vaut `'inactive'` ou
`'near_reward'`). Quand un marchand allume les deux, ils **alternent** et la
cadence perçue par le client passe à un push tous les 3 à 4 jours.

### Ce que montrent les données

Chronologie de l'appareil `b1fa63b0…`, 231 événements, 12 cartes portant au moins
un envoi automatique :

| Carte | Pushes automatiques | Dernier scan |
|---|---|---|
| Wam N Fade | **16** (8 relances + 8 boosts, alternés) | 18/07/2026 |
| Magic Cleaning | **12** (alternés) | 26/07/2026 |
| MK Café | **9** | **jamais** |
| WinWin Card DEMO (carte 1) | **8** | **jamais** |
| MK Barbershop | **8** | 05/08/2026 |
| WinWin Card DEMO (carte 2) | **7** | **jamais** |
| Shawerman | 4 | **jamais** |
| Uncle Thai, Pizz'Amore, L'IWAN ×2, Dinapoli | 2 chacune | — |
| **Total** | **74 pushes automatiques** | |

Le cas **Wam N Fade** résume tout : dernier scan le 18 juillet, **16 pushes
automatiques depuis**, soit un tous les 3,5 jours — indéfiniment, tant que la
carte reste installée et que les deux interrupteurs restent allumés.

Le cas **MK Café** est le plus pur : **jamais un seul scan**, 9 pushes
automatiques quand même.

**Et la plupart n'ont jamais été vues.** Le test du 26/09 a confirmé qu'iOS
n'affiche rien quand la valeur du champ ne change pas entre deux envois
(protocole et résultat en §15 sexies de la passation). Or la relance envoie un
texte identique d'une fois sur l'autre : dans une suite de relances consécutives
sans rien entre elles — six d'affilée chez MK Barbershop, six chez MK Café —
**seule la première s'est affichée**. La plateforme paie donc le coût complet
d'envois que personne ne reçoit. Cela ne diminue en rien le défaut du §1 : ça le
retourne. La boucle ne fatigue pas le client, elle consomme la plateforme dans le
vide.

### Pourquoi c'est le défaut de scalabilité principal

Le stock de clients inactifs **ne décroît jamais tout seul** : un client n'en
sort qu'en scannant. Il croît donc mécaniquement avec l'âge de la plateforme,
même à acquisition constante. C'est le seul défaut connu qui **s'aggrave sans
que rien ne change** — ni le code, ni le nombre de marchands, ni le trafic.

Ordre de grandeur, à interrupteurs constants : chaque client inactif coûte
**~45 pushes par an** (365 / 8), et **~91** si le marchand a aussi allumé le
boost. Multiplier par le nombre de clients inactifs sous un marchand qui a allumé
le workflow donne le volume annuel — un volume dont, par construction, la cible
a déjà ignoré toutes les occurrences précédentes.

**Aggravation du 26/09 :** l'ouverture des workflows au forfait Pro (commit
`ca0579a`) a élargi la portée de ce défaut à **15 marchands de plus**. Aucun n'a
d'interrupteur allumé aujourd'hui, donc rien n'est parti ; mais la surface de
déclenchement a triplé.

### Piste retenue en pilotage

**Plafond par épisode d'inactivité, réarmé au prochain scan.** Un client qui
s'éloigne reçoit au plus N relances, puis plus rien ; le compteur repart à zéro
dès qu'il scanne. La dédup actuelle de 7 jours reste, elle règle l'espacement ;
le plafond règle la **fin**, ce qui manque aujourd'hui.

Points à trancher au moment de spécifier : où vit le compteur (colonne sur
`clients`, ou comptage sur `workflow_executions` — cette table est purgée à
90 jours, ce qui réarmerait le plafond toute seule au bout de 90 jours) ;
si le plafond est global ou par workflow ; s'il est réglable par marchand.

---

## 2. Ce que coûte un client parti, à chaque passage

**PROUVÉ.** `notifyClient` (`cron.js:234-259`) exécute, **pour chaque client
notifié** :

| Opération | Nature |
|---|---|
| `passes.update` (notification_message) | écriture base |
| `device_tokens.select` | lecture base |
| `workflow_executions.insert` (dans l'appelant, `cron.js:67`) | écriture base |
| `sendPushUpdate` × nombre de jetons | appel réseau APNs |
| `addMessageToLoyaltyObject` | appel réseau Google |

Soit **3 opérations base + au moins 2 appels réseau par client et par passage**,
plus une ligne dans le registre des envois (groupée : un insert par marchand
depuis la migration 046).

Ces opérations sont payées **intégralement** pour un client parti depuis des
mois, et le seront encore dans un an. Elles écrivent aussi de la donnée :
`workflow_executions` grossit d'une ligne par notification (purgée à 90 jours),
et `notification_envois` d'une ligne par push et par plateforme (purgée à
90 jours également).

**PROUVÉ — et pour une carte supprimée, c'est payé pour rien** (chiffré au §5.1). Rien dans le
chemin ne vérifie que la carte est encore installée. Côté Apple, la
désinscription est fonctionnelle (le jeton disparaît de `device_tokens`), donc
la boucle Apple devient un no-op silencieux. Côté Google, `addMessage` est
appelé **inconditionnellement** dès que le service est configuré
(`cron.js:252-258`) : aucun test d'existence de l'objet, aucune condition sur la
plateforme du client.

---

## 3. La durée du cron grandit avec le stock d'inactifs

**PROUVÉ.** Tout est séquentiel, à trois niveaux emboîtés :

- les trois workflows s'enchaînent en série (`cron.js:19-21`) ;
- les marchands sont parcourus en série (`cron.js:47`, `108`, `188`) ;
- **les clients sont notifiés un par un, avec `await`** (`cron.js:66`, `133`, `216`).

Aucun parallélisme, aucun lot d'envoi. La durée du passage nocturne est donc
proportionnelle au **nombre total de clients notifiés**, c'est-à-dire au stock
d'inactifs — la grandeur qui, d'après le §1, ne fait que croître.

**HYPOTHÈSE — l'ordre de grandeur.** À deux appels réseau et trois requêtes par
client, un passage qui notifie 1 000 clients prend plusieurs minutes ; 10 000,
plusieurs dizaines de minutes. Non mesuré : le cron n'écrit ni heure de début, ni
heure de fin, ni compteur de durée. **Ce serait la première instrumentation à
poser** — trois `console.log` suffiraient à rendre la courbe visible avant
qu'elle ne pose problème.

**Conséquence en cas de redémarrage.** Un redéploiement Railway pendant le
passage interrompt la boucle. Les clients déjà notifiés ont leur ligne de dédup,
donc ils ne seront pas re-notifiés ; les suivants sautent leur tour et seront
repris la nuit d'après. Pas de doublon, mais un passage partiel **silencieux** :
rien ne le signale.

---

## 4. La déduplication se tronque au-delà de ~1 000 relances en 7 jours

**PROUVÉ — le mécanisme.** Les trois lectures du workflow sont faites sans
`range()` ni pagination (`grep -c "order(\|range(" cron.js` = **0**). PostgREST
tronque toute lecture à 1 000 lignes, **sans erreur ni avertissement** — c'est le
plafond déjà rencontré quatre fois dans ce dépôt (§12 et §16 de la passation).

La lecture dangereuse est celle des exécutions récentes (`cron.js:54`) : si plus
de 1 000 clients d'un **même marchand** ont été relancés dans les 7 derniers
jours, l'ensemble de dédup revient incomplet. Les clients absents de ces
1 000 lignes sont considérés comme jamais relancés et sont **re-notifiés dès la
nuit suivante** — puis la nuit d'après, et ainsi de suite. La cadence passe de
8 jours à **1 jour**, soit une amplification ×8, précisément au moment où le
volume est le plus élevé.

Les deux autres lectures se dégradent plus discrètement : `scans` tronquée
(`cron.js:52`) classe des clients **actifs** comme inactifs et les relance à
tort ; `clients` tronquée (`cron.js:53`) laisse la queue du fichier client ne
jamais recevoir de relance.

**RISQUE RÉEL MAIS LOIN.** Le seuil est par marchand et par fenêtre de 7 jours.
Le plus gros marchand compte aujourd'hui **~200 clients** (chiffre donné en
pilotage) — il faudrait qu'il en ait cinq fois plus, tous inactifs, pour
déclencher la bascule. À surveiller, pas à corriger en urgence ; mais à corriger
**avant** qu'un marchand ne franchisse le millier de clients, car le défaut est
silencieux et se manifesterait d'abord comme du spam, pas comme une erreur.

---

## 5. Les envois Google : un gaspillage mesuré, un plafond à vérifier

### 5.1 MESURÉ — la majorité des envois Google part vers des cartes qui ont une sonnette Apple

**Ce point n'est plus une question : il est mesuré.**

**Registre des envois, 24 h du 26/09 : 148 envois Google, dont 93 (63 %) vers
des cartes qui ont une sonnette Apple.** Près de deux envois Google sur trois
concernent une carte déjà joignable par APNs.

**PROUVÉ — la cause.** `cron.js:252-258` appelle `addMessageToLoyaltyObject` dès
que `isConfigured()` rend vrai, sans aucune condition sur le client ni sur
l'existence d'un objet Google. Un porteur iPhone qui n'a jamais ajouté sa carte à
Google Wallet n'a pas d'objet : l'appel est un aller-retour réseau pour rien, et
il est payé **par client et par passage**.

**PROUVÉ — le correctif existe déjà, sur une seule surface.** La campagne
manuelle fait exactement ce qu'il faut : elle ne pousse vers Google que les
passes dont `google_pass_url` n'est pas nul (`notifications.js:84-88`). Le cron,
lui, pousse vers tout le monde. Le patron est donc dans la maison, appliqué à une
surface sur cinq.

### Piste retenue en pilotage : sauter l'envoi Google quand une sonnette Apple existe

Coût annoncé : **zéro requête ajoutée**, les sonnettes étant déjà lues juste
avant l'envoi. C'est exact pour le cron (`cron.js:244`) et pour l'avis
(`avis.js`) : les deux lisent `device_tokens` puis appellent Google dans la même
fonction. Une réserve d'implémentation, pas de principe : `tokens` est
aujourd'hui déclaré **à l'intérieur** du `if (isApnsConfigured())`
(`cron.js:243-250`) — il faut le sortir de ce bloc pour que la décision Google
puisse le lire. Ce n'est pas vrai partout : dans `scan.js`, la lecture des jetons
et l'envoi Google vivent dans deux fonctions distinctes
(`notifierMiseAJourPass` / `mettreAJourGoogleWallet`), il faudrait les
rapprocher.

**Le risque à instruire avant de coder.** « A une sonnette Apple » n'est pas
l'inverse de « n'a pas de carte Google ». Un même client peut détenir la carte
sur un iPhone **et** dans Google Wallet — rien ne l'empêche. Dans ce cas, la
règle proposée **éteindrait une carte Google réellement installée**, sans bruit
et sans trace. Combien de cartes sont dans ce cas est **non mesuré** ; c'est la
première chose à chiffrer (requête A4).

**Refinement à comparer : utiliser le signal direct plutôt que le proxy.**
`passes.google_pass_url` dit si un objet Google a été créé pour cette carte —
c'est exactement la question posée, et c'est le signal que la campagne manuelle
utilise déjà. Dans le cron, il coûte lui aussi **zéro requête** : `notifyClient`
met déjà `passes` à jour en tête de fonction (`cron.js:237-240`), il suffit
d'ajouter un `.select('google_pass_url')` à cette écriture pour le récupérer dans
le même aller-retour. Avantage sur la sonnette Apple : aucun faux positif sur les
porteurs à deux plateformes. Limite connue : l'URL n'est renseignée que si le
lien Google a été généré (`clients.js:83`, `google-wallet.js:35`) — une carte
créée avant que Google ne soit configuré l'aurait à nul. À chiffrer aussi.

**Solution complète, hors de cette piste : les callbacks Google Wallet.** Google
sait notifier l'ajout et la suppression d'un objet. Les brancher donnerait un
état d'installation **fiable et tenu à jour**, au lieu d'un proxy déduit. C'est
déjà en parking côté pilotage (§15 quinquies de la passation). La piste
ci-dessus est un palliatif à coût nul ; les callbacks sont la réponse.

### 5.2 Le plafond Google de 3 notifications / 24 h existe-t-il ?

**NON VÉRIFIÉ.** Ce plafond ne repose que sur **un commentaire du dépôt**
(`google-pass.js:497`), jamais confirmé contre la documentation Google ni observé
en production. Six surfaces appellent `addMessageToLoyaltyObject` ; si le plafond
existe, les envois au-delà du troisième dans la fenêtre sont perdus **en
silence**, et le registre les enregistre en `200`.

Deux façons de trancher, sans code : lire la documentation Google Wallet sur
`messageType: TEXT_AND_NOTIFY`, ou provoquer quatre envois en moins de 24 h sur
une carte Android de test et regarder ce qui s'affiche.

**Lien avec le §1 :** si le plafond existe, la cadence d'un client sous deux
workflows actifs plus des campagnes manuelles le dépasse régulièrement — et ce
sont les envois **commerciaux** du marchand qui sont écrêtés par les envois
automatiques, pas l'inverse.

---

## 6. Ce qui n'entre pas dans ce segment

Écartés en pilotage, notés ici pour mémoire afin qu'on sache qu'ils ont été vus
et non oubliés : un budget global de notifications par client toutes surfaces
confondues, et la présence du parc de test dans la production.

---

## Annexe A — Requêtes de vérification

Toutes en lecture seule. Elles s'appuient sur `notification_envois`, qui
n'existe que **depuis le 25/09/2026** — rien d'antérieur n'y figure.

### A1 — Envois Google en échec, par statut (§5.1)

```sql
SELECT plateforme, statut, ok, count(*) AS envois,
       count(DISTINCT serial_number) AS cartes
FROM public.notification_envois
WHERE plateforme = 'google'
GROUP BY plateforme, statut, ok
ORDER BY envois DESC;
```

Un volume important de `404` confirmerait que le cron pousse vers des objets
Google inexistants.

### A2 — Les clients relancés en boucle (§1)

```sql
SELECT m.nom AS marchand, c.prenom,
       count(*)                          AS relances,
       min(we.executed_at)::date         AS premiere,
       max(we.executed_at)::date         AS derniere,
       (SELECT max(s.date_scan)::date FROM public.scans s
         WHERE s.client_id = c.id)       AS dernier_scan
FROM public.workflow_executions we
JOIN public.clients   c ON c.id = we.client_id
JOIN public.marchands m ON m.id = we.marchand_id
WHERE we.workflow_type = 'inactive'
GROUP BY m.nom, c.prenom, c.id
HAVING count(*) >= 3
ORDER BY relances DESC
LIMIT 100;
```

La colonne `dernier_scan` dit si une seule de ces relances a jamais ramené le
client. Rappel : `workflow_executions` est purgée à 90 jours, les compteurs sont
donc des planchers.

### A3 — Volume nocturne et taille des lots (§3, §4)

```sql
SELECT date_trunc('day', executed_at)::date AS nuit,
       workflow_type,
       count(*)                             AS notifications,
       count(DISTINCT marchand_id)          AS marchands,
       max(par_marchand)                    AS pire_marchand
FROM (
  SELECT executed_at, workflow_type, marchand_id,
         count(*) OVER (PARTITION BY date_trunc('day', executed_at), marchand_id, workflow_type) AS par_marchand
  FROM public.workflow_executions
) t
GROUP BY 1, 2
ORDER BY nuit DESC, workflow_type
LIMIT 60;
```

`pire_marchand` est la grandeur à surveiller pour le §4 : tant qu'elle reste très
en dessous de 1 000 sur 7 jours glissants, la dédup tient.

### A4 — Cartes à deux plateformes : le faux positif de la piste du §5.1

```sql
SELECT
  count(*)                                                   AS cartes,
  count(*) FILTER (WHERE dt.serial_number IS NOT NULL)       AS avec_sonnette_apple,
  count(*) FILTER (WHERE p.google_pass_url IS NOT NULL)      AS avec_objet_google,
  count(*) FILTER (WHERE dt.serial_number IS NOT NULL
                     AND p.google_pass_url IS NOT NULL)      AS LES_DEUX
FROM public.passes p
LEFT JOIN (SELECT DISTINCT serial_number FROM public.device_tokens) dt
       ON dt.serial_number = p.serial_number;
```

`LES_DEUX` est le nombre de cartes que la piste du §5.1 éteindrait à tort si elle
se fondait sur la sonnette Apple. Si ce nombre est nul ou négligeable, la piste
est sans danger ; sinon, passer par `google_pass_url`.

---

## Annexe B — Fichiers concernés

| Fichier | Rôle dans ce segment |
|---|---|
| `src/workers/cron.js` | les trois workflows, la boucle de notification, la purge |
| `src/services/notif-registre.js` | registre des envois (migration 046) — la seule mesure existante |
| `src/services/google-pass.js` | `addMessageToLoyaltyObject`, commentaire du plafond 3/24 h (`:497`) |
| `src/routes/notifications.js` | campagne manuelle — **seule surface qui filtre déjà sur `google_pass_url`** (`:84-88`) |
| `database/requetes/avis_et_ouverture_pro.sql` | requête 3 — la chronologie qui a produit les données du §1 |
