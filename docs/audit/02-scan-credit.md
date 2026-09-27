# Audit WinWin — Segment 2 : scan et crédit

> Deuxième segment de l'audit, après la photo de production (00a), la cartographie
> (00b) et les notifications (01). Question posée par le brief (§6) : **du scanner
> jusqu'à l'écriture du solde, annulation comprise**, que vaut la chaîne aujourd'hui,
> que fait-elle d'elle-même et à quel coût, et que deviendra-t-elle quand des machines
> (bornes, caisses, e-commerce) enverront des crédits sans humain pour vérifier et
> **renverront d'elles-mêmes une demande restée sans réponse**.
> Même règle que les rapports précédents : **tout constat est rattaché à une preuve**
> (fichier:ligne, commit, requête, relevé, démonstration). Ce qui n'a pas pu être
> prouvé est marqué comme tel et n'est jamais comblé par une reconstitution. Le dépôt
> étant public, le rapport décrit des constats et leurs preuves, **jamais un mode
> opératoire** (décision de pilotage du 26/09).

| | |
|---|---|
| **Date** | 2026-09-27 |
| **Commit audité** | `eb2067b` (branche `claude/keen-goldberg-MXslu`). Le code applicatif y est identique à `ca0579a`, en production depuis le 25/09 à 22:08 UTC (`git diff ca0579a eb2067b -- winwincard/` est vide). |
| **Dernière migration du dépôt** | `047_avis_google` |
| **Périmètre** | `routes/scan.js` (scan, historique, annulation), `routes/scanner-auth.js`, `utils/backup-code.js`, le passage par `middleware/auth.js` et `services/marchand-cache.js` ; les fonctions `increment_stored_value`, `annuler_scan`, `credit_referral` ; les tables `scans`, `clients`, `referral_credits` ; le scanner (`public/scanner/`) et l'onglet scanner du dashboard. Ajouts validés en pilotage : l'ajustement du solde (`routes/clients.js`), le coût du travail déclenché après la réponse, l'outil de diagnostic caméra (Ponytail seulement). |
| **Méthode** | lecture du code et de l'historique git complet (243 commits) ; code des bibliothèques lu à la version figée par `package-lock.json`, sans installation ; base de référence rejouée depuis le dépôt (PostgreSQL 16, 48 fichiers, 0 échec) pour **démontrer** des comportements (D1 à D4, D6) et **tester** chaque requête ; requêtes S1 à S7 en lecture seule (`docs/audit/02-requetes.sql`), exécutées par Yass le 27/09 ; relevé des journaux Railway par Yass le 27/09 ; Ponytail appliqué à la main |
| **Limites de méthode** | aucun accès à la production depuis le conteneur ; le code applicatif n'a pas été exécuté (seul un serveur Node de dix lignes, sans rapport avec l'application, a servi à observer l'arrêt d'un process) ; les documentations Railway et Supabase sont bloquées par le proxy du conteneur : elles sont citées par extraits de moteur de recherche et marquées comme telles ; les journaux HTTP de Railway (durées, codes) ne sont pas filtrables depuis la page utilisée ; les réglages Overlap et Draining du service n'ont pas été relevés |

### Légende

| Marque | Sens |
|---|---|
| **PROUVÉ** | vérifiable par le fichier:ligne, le commit, la requête, le relevé ou la démonstration cités |
| **HYPOTHÈSE** | raisonnement cohérent, non vérifié — ce qui le confirmerait est indiqué |
| **NON VÉRIFIABLE** | la preuve n'existe pas ou n'est pas accessible — la raison est donnée |

La **gravité** (colonne « G ») suit l'échelle du brief (§4) : **1** argent des clients ·
**2** trafic machine (projection) · **3** scan au comptoir · **4** données et accès ·
**5** notifications · **6** carte dans le téléphone · **7** statistiques · **8** apparence.

Les numéros **H1 à H4** renvoient aux requêtes de suivi facultatives de
`02-requetes.sql` (S1b, S1c, S5b, S7b), qui trancheraient une hypothèse.

---

## 1. En une page

**Quand tout va bien, la chaîne du scan est juste.** Le crédit se fait sous un verrou
par carte, avec un code identique au dépôt (00a §4) ; le journal est cohérent depuis
que le registre des envois existe (S2 : aucune rupture inexpliquée depuis le 25/09).
**Elle ne sait pas se défendre quand quelque chose casse au milieu** : une réponse
perdue, un redéploiement, une caisse qui renvoie. Or c'est le comportement normal
d'une machine.

| # | Constat | G | Statut |
|---|---|---|---|
| 1 | **Le crédit et sa ligne de journal sont deux écritures séparées, et la ligne n'a jamais été vérifiée**, depuis la première version du scan (23/05). Trois causes laissent un solde crédité sans ligne : l'erreur non lue (00b), **le process coupé entre les deux** (aucun arrêt propre : l'effet est démontré sur Node, le délai laissé par Railway reste une hypothèse) et **la réponse du crédit perdue en route**, que le serveur traite comme « rien crédité ». Aucune occurrence depuis le 25/09. | 1 | PROUVÉ (mécanisme) / NON VÉRIFIABLE (avant le 25/09) |
| 2 | **Aucune protection serveur contre le double crédit**, et quand la chaîne s'est arrêtée avant la ligne, **le doublon ne se voit pas** : deux crédits, une seule ligne dans l'historique de la caisse (D2a). Le garde-fou humain, relire l'historique, ne le voit donc pas. **15 marchands actifs sont en mode points**, dont 3 comptes de test : la condition posée pour traiter l'idempotence (« avant plusieurs marchands en points », dette #9), que la passation dit déjà atteinte, est largement dépassée. | 1 · 2 | PROUVÉ |
| 3 | En production : **1 paire de scans à moins de 2 s** (Magic Cleaning, 02/08, remise juste après le seuil), **21 paires en points de même montant à moins de 10 minutes**, 290 paires en tampons entre 2 et 10 s. Chacune peut être un doublon ou un geste voulu : la base ne les distingue pas. | 1 | PROUVÉ (données) / HYPOTHÈSE (doublons, H1 et H2) |
| 4 | **Après une erreur réseau, la caisse repropose la même carte**, et un tap de plus crédite à nouveau, sans que personne sache si le premier crédit est passé. Un refus du limiteur de débit s'affiche lui aussi en « erreur réseau ». | 1 · 3 | PROUVÉ (code) |
| 5 | **Deux scans du même client qui se chevauchent peuvent s'écrire dans le désordre** dans le journal ; **aucun des deux ne peut plus être annulé** (D1). Aucun cas en production (S1, S2). | 1 · 2 | PROUVÉ (mécanisme) ; aucun cas observé |
| 6 | **Une machine qui passe après le seuil déclenche la remise, sans personne pour remettre la récompense.** 45 clients ont aujourd'hui une récompense en attente (S6). Un renvoi au seuil avance aussi la remise (D2b, D2c). | 1 · 2 | PROUVÉ (code, données) / HYPOTHÈSE (usage des bornes) |
| 7 | **Parrainage en mode points** : le crédit plafonne le parrain au seuil. Personne n'est exposé (vérifié par Yass) ; le seul crédit jamais versé, chez le marchand de test, a été intégral (S3). **À corriger avant toute activation chez un marchand en points.** Ce crédit verrouille aussi la ligne du marchand (D3). | 1 | PROUVÉ |
| 8 | **L'ajustement du dashboard écrit une valeur absolue, sans verrou ni ligne de journal** : un scan passé entre l'ouverture de la fiche et la validation est effacé, et le scan précédent ne peut plus être annulé (D2d). Des ajustements tombent à une ou deux minutes d'un scan (S2 : 3 cas). | 1 | PROUVÉ (mécanisme) / NON VÉRIFIABLE (écrasement réel) |
| 9 | **Une requête à la base coûte 0,2 s sur de vrais scans** (S7, médiane 197 ms) ; après dix minutes sans scan, **les écritures qui suivent le crédit arrivent environ 0,26 s plus tard** (tantôt la carte, tantôt le journal), et la caisse les attend. Un scan coûte d'environ 1,1 s à 1,8 s à Dubaï, de l'envoi à la réponse. | 3 | PROUVÉ (mesures) / HYPOTHÈSE (total) |
| 10 | **Au comptoir, une panne se lit « carte introuvable » ou « boutique coupée »**, après jusqu'à 7 s de relances ; aucune requête n'a de délai maximal fixé par l'application ; un jeton expiré ou **révoqué** laisse la caisse sur un message brut. | 3 | PROUVÉ |
| 11 | **Les limiteurs de débit ne voient pas l'adresse des clients mais celle du proxy de Railway** : UptimeRobot, les iPhone qui mettent leurs cartes à jour et un scanner Windows apparaissent sous des adresses `152.233.x.x`. | 3 · 4 | PROUVÉ (journaux) / HYPOTHÈSE forte (origine) |
| 12 | **Une campagne réécrit toutes les cartes du marchand en une instruction** ; un scan du même marchand attend : 3,4 à 4,1 s à 100 000 cartes sur la base rejouée (D4). | 3 | PROUVÉ (mécanisme) / HYPOTHÈSE (durée en production) |
| 13 | **Chaque scan déclenche un travail inutile** : en tampons, le téléchargement complet d'une image pour vérifier qu'elle existe ; et la régénération de cartes inchangées quand l'iPhone revérifie toutes ses cartes (erreurs d'Apple relevées le 27/09). | 6 · 3 | PROUVÉ |
| 14 | **Intégrité** : aucun solde négatif, aucun solde de tampons au-dessus du seuil ; 4 lignes de journal ne suivent plus les règles actuelles. Rien en base n'interdit un solde négatif ni un seuil nul. | 1 | PROUVÉ / HYPOTHÈSE (cause des 4 lignes) |
| 15 | **Ponytail** : environ **−1 050 lignes** possibles, dont l'outil de diagnostic caméra (−630 lignes, −1,3 Mo) et la machine d'état du scan, écrite deux fois (scanner et dashboard). Aucun garde-fou dans la liste. | — | liste de candidats |

**Ce que cela dit pour la roadmap.** Les constats 1, 2 et 5 ont une seule cause : le
crédit, sa ligne et la carte ne forment pas un tout, et rien n'identifie une demande
pour la reconnaître quand elle revient. **C'est le préalable de toute intégration
machine** (brief §3, gravité 2). Le filet de tests argent et scan (brief §8) doit
passer avant ; le §10 en donne les scénarios candidats.

---

## 2. Méthode

- **Code** : lecture intégrale du périmètre ; relevé des lignes citées au commit
  `eb2067b`. **Historique** : `git fetch --unshallow` (243 commits), pour dater
  l'apparition des garde-fous et l'âge des défauts.
- **Bibliothèques**, lues à la version figée par `package-lock.json`, téléchargées par
  `npm pack --ignore-scripts`, jamais installées ; empreintes sha512 identiques à
  celles du fichier de verrouillage : `@supabase/postgrest-js` 2.107.0 (relances),
  `express-rate-limit` 7.5.1 (réponse d'un refus, clé), `morgan` 1.11.0 (adresse
  journalisée), `helmet` 7.2.0 (en-tête Referrer-Policy). Le `fetch` de Node repose sur
  `undici`, embarqué dans Node : lu en 7.16.0 et 6.24.1 (celle du Node 22 du
  conteneur), mêmes valeurs par défaut ; la version embarquée par le Node 24.10 de
  production n'est pas vérifiée (annexe D).
- **Base de référence** rejouée depuis le dépôt (méthode de 00a, annexe B), puis :
  - S1 à S7 testées à vide et sur un jeu de 48 scans fabriqués dont chaque résultat
    était connu d'avance (en-tête de `02-requetes.sql`) ;
  - **démonstrations D1 à D4 et D6** avec les fonctions du dépôt, identiques à la
    production (00a §4) : annexe B.
- **Production** : S1 à S7 exécutées par Yass le 27/09 (résultats bruts : annexe A).
  C8 non exécutée : Yass a vérifié directement qu'aucun marchand actif en mode points
  n'a le parrainage (§4.4).
- **Journaux Railway**, relevés par Yass le 27/09 : recherche texte dans les journaux
  de l'application (format `combined` de `morgan`), 7 jours disponibles.
- **Ponytail** : dépôt cloné en v4.10.0 (`e3ba2aa`), commande d'audit
  (`commands/ponytail-audit.toml`, `skills/ponytail-audit/SKILL.md`) lue et appliquée à
  la main ; rien d'installé ni d'exécuté (§7.4).
- **Arrêt d'un process Node** : observé sur un serveur de dix lignes sans gestionnaire
  de `SIGTERM`, comme `index.js`, avec le Node 22 du conteneur (§7.1).

---

## 3. La chaîne du scan, pas à pas

### 3.1 Les étapes

**PROUVÉ (code).** Une requête `POST /api/scan` (`scan.js:15`) fait, dans l'ordre :

| # | Étape | Écrit quelque chose ? | Erreur lue ? | Si elle échoue | Preuve |
|---|---|---|---|---|---|
| 0 | état du marchand (suspendu, révoqué), seulement si le cache de 60 s a expiré | non | oui | la caisse continue (décision de pilotage, passation §15 ter) | `auth.js:96`, `marchand-cache.js:53-57`, `:90-96` |
| 1 | statut de la boutique (jeton boutique) ou test du réseau (jeton marchand) | non | **non** | « accès coupé » (403), ou jeton marchand accepté sur un réseau | `scan.js:28-37`, `:43-52` |
| 2 | client, par numéro de série ou par code de secours | non | **non** | « carte introuvable » (404) | `scan.js:64-93` |
| 3 | **crédit** : `increment_stored_value`, sous verrou de la carte | **le solde** | oui | 500, que le crédit ait eu lieu ou non (§3.2, ligne c) | `scan.js:121-128` ; `migration_023:69-99` |
| 4a | message et date de la carte | la carte | **non** | carte iPhone non rafraîchie (00b, F3) | `scan.js:170-173` |
| 4b | **ligne de journal** | **le journal** | **non** | **solde crédité sans ligne** | `scan.js:174-182` |
| 5 | réponse à la caisse | — | — | — | `scan.js:201-217` |
| 6 | après la réponse : poussées Apple et Google, parrainage, demande d'avis | registre, carte du parrain | en partie | carte non rafraîchie, crédit de parrain perdu | `scan.js:186-199`, `:229-235` |

Les étapes 4a et 4b partent **ensemble**, et la réponse **attend les deux**
(`Promise.all`, `scan.js:169`). Avant la réponse, il y a donc 4 échanges avec la base
l'un après l'autre (1, 2, 3, 4), 5 quand le cache du marchand a expiré : c'est le
décompte de 00a (§7.3), confirmé.

Le crédit est une transaction à lui seul : **il est validé avant que la ligne de
journal ne parte**. Rien ne relie les deux écritures. C'est l'origine commune des
constats 1, 2 et 5.

### 3.2 Le tableau des coupures

**PROUVÉ (code, démonstrations D1 et D2).** Ce que devient chaque chose quand la
chaîne s'arrête à un endroit donné, puis quand la caisse (ou une machine) refait le
scan.

| Où la chaîne s'arrête | Solde | Journal | Écran de la caisse | Après un second essai | L'annulation répare ? |
|---|---|---|---|---|---|
| a. Avant le crédit (panne, refus, limiteur, délai) | inchangé | rien | une erreur | un crédit, une ligne : **juste** | rien à réparer |
| b. Le crédit échoue pour de bon | inchangé | rien | erreur 500 | juste | — |
| c. **Le crédit est validé, sa réponse se perd entre la base et le serveur** | +1 | rien | erreur 500 | **+2, une seule ligne** | **non** : la caisse ne voit qu'une ligne pour sa visite (D2a) |
| d. **Le process est coupé entre le crédit et la ligne** (redéploiement, plantage) | +1 | rien | erreur réseau | **+2, une seule ligne** | **non**, même raison (D2a) |
| e. La ligne de journal échoue (erreur non lue) | +1 | rien | **succès** | pas de second essai | **non** : il n'y a pas de ligne à annuler (00b, constat 1) |
| f. Tout est écrit, la réponse se perd vers la caisse (réseau du commerce, patience de la caisse) | +1 | 1 ligne | erreur réseau | +2, deux lignes | **oui**, si quelqu'un voit le doublon et annule |
| g. Le second essai part avant la fin du premier (délai de la machine plus court que le scan) | +1 puis +1 | deux lignes, **parfois dans le désordre** | … | +2 | **non** si les lignes sont dans le désordre (D1) |
| h. Doublon juste au seuil (lignes c, d, f ou g) | seuil, puis remise | — | « seuil franchi », puis « remettez la récompense » | **la récompense est remise tout de suite** | seulement si le doublon est vu (D2b, D2c) |

Pour une caissière, les lignes c, d et g ne se voient pas. **Pour une machine, aucune
ne se voit** : elle renvoie par construction et ne lit pas l'historique.

La ligne c mérite d'être dite simplement : quand la réponse du crédit se perd,
`postgrest-js` rend une erreur sans rejeter (00b, F2), et `scan.js:128` répond 500
**comme si rien n'avait été crédité**. Les écritures ne sont jamais relancées par la
bibliothèque (§4.7) : ce n'est donc pas elle qui double, c'est le second essai de la
caisse.

### 3.3 Ce que la production mesure (S7)

**PROUVÉ (S7).** La base horodate elle-même trois écritures de chaque scan : le solde
(déclencheur de `clients`), la carte (déclencheur de `passes`) et la ligne de journal
(valeur par défaut de `scans.date_scan`). Pour le dernier scan de 620 clients, du 11/07
au 27/09, sans réécriture depuis :

| Inactivité de la plateforme avant le scan | Scans | Solde → journal, médiane | Solde → carte, médiane | Journal − carte, scan par scan : médiane | p90 |
|---|---|---|---|---|---|
| ensemble | 620 | **197 ms** | 215 ms | −7 ms | +276 ms |
| moins de 5 s | 37 | 175 ms | 172 ms | +1 ms | +299 ms |
| de 5 s à 1 min | 134 | 184 ms | 186 ms | −4 ms | +48 ms |
| de 1 à 10 min | 263 | 199 ms | 219 ms | −11 ms | +58 ms |
| **10 min et plus** | 186 | 216 ms | **478 ms** | −9 ms | **+300 ms** |

Ce que cela établit :

- **Un aller-retour complet entre le serveur et la base coûte environ 0,2 s sur de
  vrais scans** (médiane 197 ms). Le chiffre de 00a (213 ms, mesuré depuis Dubaï par
  différence) est confirmé. **PROUVÉ.**
- **Après dix minutes sans scan** (30 % des scans mesurés), les écritures qui suivent
  le crédit arrivent plus tard, alors qu'elles sont envoyées ensemble : la carte, en
  médiane, 478 ms après le crédit au lieu de 172 à 219 ms (**+0,26 s**) ; le journal,
  au moins 0,3 s après la carte dans 10 % des scans, au lieu de 0,05 à 0,06 s entre 5 s
  et 10 min d'inactivité. Scan par scan, le surcoût tombe tantôt sur la carte, tantôt
  sur le journal, parfois sur les deux : la médiane de l'écart journal − carte reste
  proche de zéro (−9 ms). La caisse attend les deux écritures : elle le paie dans tous
  les cas, environ 0,25 s de plus en médiane. **PROUVÉ** (mesures).
  **HYPOTHÈSE** pour la cause : une connexion à rouvrir sur le trajet entre le serveur et
  la base après une longue inactivité. Côté serveur, une connexion ne sert qu'une
  requête à la fois (`undici`, `pipelining` = 1) et une connexion inutilisée est
  refermée après 4 s par défaut (davantage si le serveur de Supabase l'indique ;
  annexe D). Mais une seule connexion à rouvrir côté serveur ferait payer toujours la
  même écriture, la seconde envoyée (le journal) ; la mesure montre l'inverse en
  médiane : le surcoût se joue sans doute aussi plus loin sur le trajet.
- **Une queue longue, à part** : pour au moins 10 % des scans, la carte est réécrite
  plus de 3 s après le crédit (solde → carte, p90 : 3 368 ms). La ligne du journal,
  elle, part en moins de 0,6 s dans 90 % des cas (p90 : 504 ms). Un retard réseau toucherait
  l'une ou l'autre au hasard. **HYPOTHÈSE (H4)** : c'est une autre écriture de la carte,
  la poussée de bienvenue envoyée à l'installation (`apple-wallet.js:58`, `:183-185`),
  qui tombe juste après le premier scan d'un client installé au comptoir. S7b la
  tranche. Si elle est fausse, 10 % des scans attendraient plus de 3 s.

**Le temps d'un scan à Dubaï — HYPOTHÈSE (calcul à partir de mesures).**

| | Connexions ouvertes | Après dix minutes sans scan |
|---|---|---|
| Caisse ↔ Railway | 0,29 s (00a, mesuré) | 0,29 s |
| 4 échanges avec la base, l'un après l'autre (5 si le cache a expiré) | 4 × 0,2 = 0,8 s (1 s) | 0,8 s (1 s) |
| Surcoût des écritures qui suivent le crédit | — | +0,26 s (mesuré, S7) |
| Surcoût probable du premier échange (même cause supposée) | — | environ +0,26 s (**non mesuré**) |
| **Total** | **environ 1,1 à 1,3 s** | **environ 1,6 à 1,8 s** |

Aujourd'hui, avec 54 scans par jour, le second cas n'est pas rare : c'est un scan sur
trois. Ce coût tient à la distance entre le serveur (Californie) et la base (Paris),
constat de 00a ; ce segment en précise le montant réel.

---

## 4. Santé : les constats

### 4.1 Le crédit et sa ligne de journal (00b, constat 1, approfondi)

**PROUVÉ (git).** La ligne de journal n'a **jamais** été vérifiée : dans la première
version du scan (`67f0794`, 23/05), elle est écrite sans lecture de son erreur ; le
passage au crédit atomique et à l'envoi en parallèle (`d0a43a6`, 04/06) n'y a rien
changé. Le défaut a l'âge de la plateforme.

**PROUVÉ (code).** Trois causes laissent un solde crédité sans ligne (§3.2, lignes c,
d, e) :

- **la ligne échoue** et l'erreur n'est pas lue (`scan.js:174-182`) : la caisse voit un
  succès ;
- **le process est coupé entre le crédit et la ligne** : aucun arrêt propre n'est
  prévu (`index.js` ne gère pas `SIGTERM` ; §7.1) ; chaque push sur la branche de
  production redéploie (00b §4.7) ;
- **la réponse du crédit se perd** entre la base et le serveur : `scan.js:128` répond
  500 alors que le solde a bougé.

**Aujourd'hui — PROUVÉ (C7, S2).** Depuis le début du registre (25/09 17:18), **aucun**
scan crédité sans ligne (C7) et **aucune** rupture de chaîne sans explication (S2).

**Avant le 25/09 — NON VÉRIFIABLE.** S2 détaille les 45 ruptures de chaîne du journal
comptées par C7 :

| Explication trouvée en base | Ruptures | Lecture |
|---|---|---|
| premier scan parti d'un solde non nul | 20 | solde posé avant le premier scan (reprise d'une carte papier, cadeau) |
| sans explication en base | 24 | profil d'ajustements manuels (voir ci-dessous) |
| ajustement tracé au registre | 1 | Hamza Salon, 26/09 |

- **Wam N Fade porte 22 des 45 ruptures**, presque toutes de la même forme : un client
  à 1 point passe à 140 (+139, huit fois), d'autres à 200 ou à 1 900. C'est le profil
  d'ajustements faits depuis le dashboard, pas de lignes perdues. **HYPOTHÈSE forte.**
- **Trois ruptures valent exactement un scan** et restent compatibles avec une ligne
  perdue : Magic Cleaning le 25/07 (+1), Asie Express le 15/09 (+24 points), NARA le
  18/09 (+1). Avant le registre, un ajustement et une ligne perdue sont
  indiscernables : **NON VÉRIFIABLE**.
- **Trois ruptures montrent un ajustement fait une à deux minutes après un scan, jusqu'au
  seuil** : Bluemoon Boston (22/07, 1 → 10), WinWin Card DEMO (01/08, 1 → 10), LDC
  Kitchen + Coffee (05/08, 2 → 9). Ce voisinage entre scan et ajustement compte pour le
  §4.6.

**Ce qu'un solde crédité sans ligne fausse** (00b) : l'annulation (§4.5),
l'historique de la caisse, les statistiques qui comptent les scans, et la relance
d'inactivité. S'y ajoute un effet nouveau : **le doublon qui suit devient invisible**
(§4.2).

### 4.2 Le double crédit

**Ce qui protège aujourd'hui — PROUVÉ (code, git).** Rien côté serveur : aucune
colonne de référence, aucune contrainte d'unicité, aucune détection de renvoi
(passation §16 ; `scans` n'a que sa clé primaire, `schema.sql:107-114`). Tout est dans
les écrans :

| Garde-fou | Scanner (PWA) | Onglet scanner du dashboard |
|---|---|---|
| un seul envoi à la fois (`processing`) | depuis toujours | depuis toujours |
| confirmation avant écriture, en tampons | **26/07** (`25cd3cf`) | **23/08** (`cddf79e`) |
| verrou de la carte qui vient d'être traitée | **23/08** (`cddf79e`) | **23/08** (`cddf79e`) |

Avant ces dates, la caméra pouvait réécrire la même carte au retour de « scan
suivant » : la passation le décrit pour le scanner (§2 [11], « +1 involontaire »).
L'onglet du dashboard est resté ainsi un mois de plus : jusqu'au 23/08, il créditait
dès que le QR était détecté (`cddf79e^:…/dashboard/index.html`, `proceedToScanDashboard`
appelle directement l'écriture en tampons).

**La caisse repropose la carte après une erreur — PROUVÉ (code).** Sur le scanner,
quand l'appel échoue (réseau, réponse illisible), le drapeau `processing` retombe
aussitôt, la caméra tourne encore et la carte n'est pas verrouillée
(`scanner/index.html:1092-1096`) : la même carte est redétectée, la confirmation (ou le
pavé des points) se rouvre, et un tap crédite à nouveau. L'onglet du dashboard fait de
même au bout de 3 s (`dashboard/index.html:1615-1618`). **Aucune des deux interfaces ne
sait si le premier crédit est passé**, et aucune n'invite à vérifier l'historique.

**Le doublon invisible — PROUVÉ (D2a).** Quand la chaîne s'est arrêtée entre le crédit
et la ligne (§3.2, lignes c et d), le second essai crédite une deuxième fois et écrit
**une seule ligne** : l'historique montre une visite, le solde en compte deux. Le
garde-fou que la passation invoque pour reporter l'idempotence (« le caissier montre
l'historique au client », dette #9) ne voit pas ce cas.

**Ce que montre la production — PROUVÉ (S1) / HYPOTHÈSE (interprétation).** Paires de
scans consécutifs d'un même client :

| Écart | Paires | Dont points | Dont points de même montant | Dont remise juste après le seuil |
|---|---|---|---|---|
| moins de 2 s | **1** | 0 | 0 | **1** |
| 2 à 10 s | 291 | 1 | 0 | 6 |
| 10 à 60 s | 185 | 74 | **15** | 22 |
| 1 à 10 min | 74 | 42 | **6** | 9 |
| 10 min et plus | 371 | 291 | 28 | 9 |

- **La paire à moins de 2 s** (Magic Cleaning, 02/08, mode tampons) : un client atteint
  le seuil, et la remise suit en moins de 2 secondes. Deux scans voulus aussi rapprochés
  depuis un même écran sont très improbables : il faut attendre la réponse, relancer la
  caméra et, sur le scanner, confirmer. **HYPOTHÈSE** : un doublon (deux appareils, un
  renvoi après une erreur, ou la relecture automatique de la carte par l'onglet du
  dashboard, qui n'avait alors ni confirmation ni verrou), qui a fait remettre la
  récompense un passage trop tôt.
- **Les 21 paires en points de même montant à moins de 10 minutes** sont des doubles
  crédits possibles, en valeur monétaire : c'est exactement ce que produit la carte
  reproposée après une erreur (le pavé se rouvre, la caissière retape le même
  montant). Deux achats identiques dans la minute sont aussi possibles.
  **HYPOTHÈSE (H1)** ; S1b les liste pour les confronter aux tickets de caisse.
- **Les 290 paires en tampons entre 2 et 10 s** sont compatibles avec le bouton
  « ajouter un tampon », fait pour poser plusieurs tampons en une visite. Une partie
  précède les garde-fous de juillet et d'août. **HYPOTHÈSE (H2)** ; S1c les répartit
  avant et après ces dates.

**Pourquoi c'est de l'argent — PROUVÉ (S5).** **15 marchands actifs sont en mode
points** (Asie Express, Bangkok Factory, Boucherie République, Crep' & Coffee, Démo
France, Dinapoli, Maison Maya, Naan, Pizz'Amore, Pizza Sabbioni, Ray Test, Shop By Ness,
Teatro, Uncle Thai, Wam N Fade), dont le plus gros (Dinapoli, 267 clients) et le plus
actif (Pizz'Amore, 322 scans sur 30 jours), d'après 00b (C1). Trois sont des comptes de
test ou de démonstration (Pizza Sabbioni d'après la passation, §4 point 7 ; Démo France et Ray
Test d'après leur nom). La passation (§1) n'en comptait qu'un. En points, un crédit vaut
un montant d'achat : médiane de 37, 95 % à 200 ou moins, maximum **2 000** en un seul scan sur
90 jours (1 105 scans). Le serveur accepte jusqu'à 100 000 par scan (`scan.js:110`) ;
aucune interface ne demande de confirmer un montant élevé.

### 4.3 Le journal écrit dans le désordre (constat nouveau)

**PROUVÉ (code).** La ligne de journal prend son heure au moment où elle est écrite
(`scans.date_scan` vaut `now()` par défaut, `schema.sql:113`), c'est-à-dire **après** le
crédit, dans une autre transaction. Si deux scans du même client se chevauchent (deux
appareils, un second essai parti avant la fin du premier), les deux crédits se
sérialisent correctement sous le verrou, mais **les deux lignes peuvent arriver dans
l'ordre inverse**.

**PROUVÉ (D1).** Solde 4 ; crédit A (4 → 5) puis crédit B (5 → 6) ; la ligne de B arrive
0,3 s avant celle de A. L'annulation du scan le plus récent par date (A) est refusée
(`solde_incoherent` : le solde vaut 6, la ligne dit 5) ; celle de B aussi
(`pas_le_dernier`). **Le doublon est inannulable** ; seul un ajustement manuel du solde
le corrige, et il ne laisse pas de ligne (§4.6).

**Aujourd'hui — PROUVÉ (S1, S2).** Aucune paire inversée par chevauchement en production :
S1 n'en trouve aucune à moins d'une minute, et S2, qui écarte les scans annulés, aucune
non plus. Les trois paires que S1 classe « inversées » sont espacées de plus d'une
minute : **HYPOTHÈSE**, des annulations ou des ajustements intercalés, que la règle de
S1 (annulés compris) prend pour une inversion. **Projection** : le risque suit le nombre
de demandes qui se chevauchent, c'est-à-dire les renvois de machines (§6).

### 4.4 Le crédit de parrainage (00b, constat 2)

**Mode points — PROUVÉ (S3, vérification de Yass).** `credit_referral` plafonne le
solde du parrain au seuil (`migration_015:33`) : un parrain au-dessus du seuil y perd son
surplus (démontré par 00b). **Personne n'est exposé aujourd'hui** : Yass a vérifié
qu'aucun marchand actif en mode points n'a le parrainage allumé. Le seul crédit jamais
versé (Pizza Sabbioni, marchand de test, 27/07, bonus 1, parrain à 0) a été intégral
(S3). **Constat, en une ligne : à corriger avant toute activation du parrainage chez un
marchand en points.**

**Mode tampons — PROUVÉ (code).** Le parrainage crédite toujours 1 tampon (règle
produit) : la seule perte est celle d'un parrain à 10/10 en attente de remise, dont le
tampon est absorbé par le plafond alors que la notification l'annonce
(`scan.js:333`). **G1, exposition nulle tant que le parrainage reste coupé.**

**Le crédit verrouille aussi la ligne du marchand — PROUVÉ (D3).** Le verrou de
`credit_referral` porte sur une jointure (`migration_015:21-26`) : il verrouille le
client **et** la ligne du marchand (`pgrowlocks` : « For Update » sur `marchands`).
Pendant ce temps, toute écriture qui référence ce marchand attend : la ligne de journal
d'un autre scan du même marchand a attendu 2,5 s dans la démonstration, une inscription
aussi ; un crédit, une carte ou un scan d'un autre marchand n'ont pas attendu. En
production, le crédit dure le temps d'un appel (quelques millisecondes) : **effet
négligeable aujourd'hui (G3, latent)**, à ne pas reproduire dans une future fonction.

**Le crédit n'écrit aucune ligne de journal — PROUVÉ (code).** La chaîne du parrain se
rompt par construction (S2 range ces ruptures sous « crédit de parrainage »), et son
dernier scan ne peut plus être annulé (même mécanisme que D2d).

### 4.5 L'annulation du dernier scan

**Ce qu'elle protège — PROUVÉ (code).** `annuler_scan` refuse sans rien modifier dans
trois cas (`migration_038:44-73`) : scan introuvable ou déjà annulé ; puis, sous le
verrou de la carte, scan qui n'est pas le plus récent du client, ou solde différent de
l'« après » du scan. Elle **répare exactement un cas** : le dernier scan, quand rien n'a
bougé depuis (§3.2, ligne f).

**Ce qu'elle ne peut pas réparer — PROUVÉ (D1, D2a, D2d).** Un crédit sans ligne (lignes
c, d, e) ; un doublon écrit dans le désordre (ligne g) ; un scan suivi d'un ajustement ou
d'un crédit de parrainage.

**Elle est sûre face aux renvois — PROUVÉ (code, D6).** Une annulation renvoyée vise le
même scan. Renvoyée après coup, elle est refusée (« déjà annulé ») ; partie en même
temps que la première, elle attend le verrou de la carte, puis voit le scan annulé et
est refusée (« pas le dernier », `migration_038:60-67`). Rien ne bouge deux fois.
C'est l'inverse du scan, et c'est le modèle à suivre pour une API machine.

**Elle est utilisée — PROUVÉ (S5).** 11 annulations, dont 10 sur les 30 derniers jours,
chez 7 marchands ; délai médian entre le scan et son annulation : **53 s** (maximum :
environ 46 h). C'est un outil de rattrapage immédiat, pas un gadget : Ponytail ne la
retient pas.

**Défauts de bord — PROUVÉ (code).**

- **Portée de l'historique et portée de l'annulation diffèrent.** Avec un jeton de
  boutique, l'historique ne montre que les scans de la boutique (`scan.js:366-368`),
  et le bouton « Annuler » apparaît sur le plus récent de chaque client dans cette
  liste (`scanner/index.html:1331-1346`) ; mais l'annulation exige que ce soit le plus
  récent du client **sur tout le réseau** (`migration_038:60-67`). Après un passage dans
  une autre boutique, le bouton mène à « annulation impossible ». Sans danger.
- **La demande d'avis part même si la remise est annulée** : le minuteur est armé au scan
  de remise (`scan.js:229-235`) et ne revérifie rien à T+30 min (`services/avis.js:86-114`,
  `:121`). G5, une seule enseigne concernée aujourd'hui (Hamza Salon, 00b C3).
- **L'annulation n'existe que dans le scanner** : aucune dans l'onglet scanner du
  dashboard (§7.2).
- **Trace au registre** : S5 compte 0 lot « annulation » depuis le 25/09. **HYPOTHÈSE
  (H3)** : aucune annulation depuis ; sinon, la relance de la carte après annulation
  n'écrit pas au registre. S5b tranche.

### 4.6 L'ajustement du solde depuis le dashboard

**PROUVÉ (code).** `PATCH /api/clients/:id` écrit une **valeur absolue**, sans verrou ni
relecture (`clients.js:208-226`), à partir de la valeur affichée à l'ouverture de la
fiche (`dashboard/index.html:2057`). Il n'écrit **aucune ligne de journal** ; sa seule
trace est le registre des envois, depuis le 25/09.

- **Un scan passé entre l'ouverture de la fiche et la validation est effacé.** Le
  voisinage existe : S2 montre trois ajustements jusqu'au seuil faits une à deux minutes
  après un scan (§4.1). Qu'un scan ait déjà été effacé ainsi : **NON VÉRIFIABLE** (aucune
  trace avant le registre).
- **Après un ajustement, le dernier scan ne peut plus être annulé** (D2d :
  `solde_incoherent`).
- **La caisse mono-site peut ajuster** : elle porte un jeton marchand complet (brief §9),
  accepté par cette route. Un solde peut donc être posé à n'importe quelle valeur entre
  0 et 1 000 000 (`clients.js:209-211`) depuis une caisse, sans ligne de journal. →
  segment 3.

### 4.7 Au comptoir : ce que voit la caissière

**Une panne se lit comme une absence, après des relances — PROUVÉ (code,
bibliothèque).** Les lectures des étapes 1 et 2 ne lisent pas leur erreur (00b, F3) :
une panne donne « accès coupé » ou « carte introuvable ». Avant cela, `postgrest-js`
relance toute lecture 3 fois après une erreur réseau ou une réponse 503/520, en
attendant 1 s, 2 s puis 4 s (`dist/index.cjs:7`, `:15`, `:21`, `:25-29`, `:286-307`,
relances actives par défaut, `:148`, `:159`). Chaque lecture peut donc ajouter **jusqu'à
7 s** avant l'erreur. Les écritures (`POST`, dont le crédit, `:5067-5083`) ne sont
jamais relancées.

**Aucun délai maximal fixé par l'application — PROUVÉ (code, bibliothèque).** Ni les
écrans (`fetch` sans délai : `scanner/index.html:1064`, `dashboard/index.html:1601`), ni
le serveur vers la base (00b, F6). Restent les bornes par défaut du `fetch` de Node :
10 s pour ouvrir une connexion, **300 s** pour recevoir une réponse (`undici` 7.16.0,
`core/connect.js:53`, `dispatcher/client.js:229-230` ; mêmes valeurs en 6.24.1,
annexe D). Une caisse peut rester sur « Traitement… » bien plus longtemps que la
patience d'une caissière ou d'une machine.

**Jeton expiré ou révoqué — PROUVÉ (code).** Le scanner ne traite que deux refus
(`access_disabled`, `use_boutique_login`, `scanner/index.html:1077-1085`). Un jeton
expiré (401), un marchand suspendu ou un jeton **révoqué** (403 `session_revoked`, la
révocation de la migration 045) s'affichent en message brut, et la caisse reste sur
l'écran de scan : il faut se déconnecter à la main. C'est la dette #1, élargie par la
révocation : révoquer un marchand bloque toutes ses caisses de cette façon.

**Un refus du limiteur s'affiche en « erreur réseau » — PROUVÉ (bibliothèque, code).**
Le limiteur global (`index.js:42-47`) répond par le texte par défaut
(`express-rate-limit`, `dist/index.cjs:633`, `:661-668`), pas en JSON ; le scanner
échoue en lisant la réponse et affiche une erreur réseau, puis repropose la carte
(§4.2). La caissière recommence, et le limiteur refuse encore.

**Le code de secours — PROUVÉ (S5, code).** Aucune collision aujourd'hui (S5 : 0).
Pour une saisie donnée, la probabilité de tomber sur un autre client vaut à peu près
(nombre de clients du marchand) ÷ 16,8 millions : 0,002 % à 267 clients, 0,06 % à 10 000,
0,6 % à 100 000 (e-commerce). En cas de collision, le serveur renvoie les prénoms **et les
numéros de série complets** des candidats (`scan.js:78-85`), qui sont des clés au porteur
(00b §4.2) → segment 3. Pour une machine, un 409 est une impasse (§6.3).

### 4.8 Les limiteurs de débit comptent par adresse du proxy de Railway

**PROUVÉ (journaux, bibliothèques).** L'adresse que journalise `morgan` est `req.ip`
(`morgan` 1.11.0, `index.js:327`, `:519-521`), exactement la clé de tous les limiteurs
(`express-rate-limit`, `dist/index.cjs:655-659`). Or, dans le relevé du 27/09, des
clients sans rapport entre eux partagent la même plage : un scanner sous Windows
(`152.233.13.165`), le service de mise à jour des cartes des iPhone (`passd`,
`152.233.13.166`, `152.233.12.245`), et **UptimeRobot**, un service de surveillance
externe (`152.233.47.65`). **Les limiteurs ne comptent donc pas par client**, au moins
pour une partie du trafic.

**Origine — HYPOTHÈSE forte (sources publiques).** Deux projets tiers publics décrivent
le même phénomène sur Railway : des adresses `152.233.x.x` journalisées à la place des
clients, identifiées comme celles du proxy d'entrée de Railway ; et, avec `trust proxy =
1`, une adresse de routage interne qui varie d'une requête à l'autre, parce que le trajet
compte deux proxys (annexe D). Le réglage du dépôt est `trust proxy = 1`
(`index.js:25`), avec l'intention écrite « requis pour rate limiting par IP réelle ».
Les adresses `79.127.178.81` et `.82`, vues sur un scanner iPhone, appartiennent à un
fournisseur d'hébergement et de CDN (Datacamp Limited, par extraits) : **HYPOTHÈSE** d'un
relais ou d'un VPN du téléphone, pas de l'adresse du commerce.

**Effets — HYPOTHÈSE.** Deux effets opposés, selon la manière dont Railway répartit ses
adresses :
- une limite par adresse **inopérante** contre un même client, dont les requêtes se
  répartissent sur plusieurs adresses : c'est la protection contre la force brute du
  login caisse (20 essais par heure, `rateLimiters.js:33-39`) qui en pâtit → segment 3 ;
- une limite **partagée** entre des clients sans rapport qui passent par la même
  adresse : au-delà de 300 requêtes par quart d'heure sur une adresse, des scans et des
  mises à jour de cartes seraient refusés. Aujourd'hui, le pire quart d'heure compte
  14 scans sur toute la plateforme (S4) ; aucun refus n'a été vu dans les 13 lignes
  relevées, et le relevé complet des codes sur 7 jours n'a pas été fait : **NON
  VÉRIFIABLE**.

Pour les machines, une limite par adresse IP n'a de toute façon pas de sens : elles
devront être limitées par clé (§6.3).

### 4.9 Intégrité des soldes et du journal (S6)

**PROUVÉ (S6).**

| Contrôle | Résultat | Attendu |
|---|---|---|
| soldes négatifs | 0 | 0 |
| tampons : solde au-dessus du seuil | 0 | 0 |
| tampons : solde au seuil (récompense à remettre) | 22 | quelques-uns |
| points : solde au seuil ou au-dessus (récompense à remettre) | 23 (plus haut : 2 004) | quelques-uns |
| points : solde à deux fois le seuil ou plus | 1 | 0 |
| marchands au seuil nul ou négatif | 0 | 0 |
| lignes de journal à solde négatif | 0 | 0 |
| scans hors remise dont l'écart ne vaut pas le montant crédité | 1 | 0 |
| tampons : scans hors remise dont le pas n'est pas +1 | 3 | 0 |
| remises qui ne suivent pas la règle du report | 0 | 0 |
| lignes antérieures aux colonnes de mesure | 403 | historique |

- Le calcul du solde est sain : les lignes de journal suivent les règles
  d'`increment_stored_value`, à 4 exceptions près. **HYPOTHÈSE** : ces 4 lignes datent
  d'un seuil ou d'un mode changé depuis (Pizza Sabbioni est passé des tampons aux points,
  passation §4 point 7), puisque le contrôle lit le seuil actuel. Une liste nominative
  trancherait.
- **45 clients ont une récompense en attente** de remise au prochain passage. C'est
  l'exposition du §6.4.
- 1 client en points a deux récompenses d'avance (un achat plus grand que le seuil) :
  elles tombent un passage après l'autre, cas accepté en V1 (dette #6).
- **Aucune contrainte en base** n'interdit un solde négatif ni un seuil nul (`CHECK`
  absents sur `clients.stored_value` et `marchands.max_value` dans le dépôt, dont les
  contraintes sont identiques à la production, 00a). Rien ne le produit
  aujourd'hui ; c'est un garde-fou manquant pour le jour où d'autres écrivains existeront
  (API machine).

---

## 5. Comportement : ce que coûte un scan

### 5.1 Avant la réponse

**PROUVÉ (code, S7).** 4 échanges avec la base, l'un après l'autre (5 si le cache a
expiré), environ 0,2 s chacun.

| Échange | Nécessaire ? | Remarque |
|---|---|---|
| état du marchand (une fois par minute et par marchand) | oui : suspension et révocation | le cache en évite l'essentiel (00a) |
| boutique ou test du réseau | oui : coupure et durcissement (passation §10) | garde-fou ; pourrait voyager avec le cache du marchand, garde-fou conservé |
| client | oui | — |
| crédit | oui | — |
| carte et journal, en parallèle | oui | **pourraient être écrits dans la même transaction que le crédit** : un échange de moins (0,2 s) et la fin des constats 1 et 5 (P1) |

### 5.2 Après la réponse, pour un seul scan

**PROUVÉ (code, relevé).**

| Travail | Coût | Nécessaire ? |
|---|---|---|
| lecture des jetons de l'appareil, puis une poussée Apple par jeton | 1 requête + 1 appel Apple par jeton (`scan.js:238-258`) | oui : c'est la carte qui se met à jour |
| mise à jour de l'objet Google, puis message Google | 2 appels Google (`scan.js:260-280`) ; le message compte dans le plafond de 3 notifications par carte et par jour (A §5.2) | la mise à jour, oui ; le message part aussi vers les cartes installées sur iPhone (63 % des envois Google, A §5.1) → segments 1 et 4 |
| registre des envois | jusqu'à 2 écritures | oui (instrument) |
| **en tampons : téléchargement complet de l'image du bandeau, seulement pour vérifier qu'elle existe** | 1 téléchargement depuis le Storage de Paris à chaque scan (`strip-cache.js:214`), sans passer par le cache mémoire | **non** : un test d'existence ne demande pas le fichier (00b §6) |
| parfois, **rendu synchrone de trois images** (après un changement de design, ou une valeur de tampons encore jamais rendue) | bloque le serveur entier le temps du rendu, non mesuré (`strip-generator.js:808-818`, `:868-870`) | le rendu, oui ; le blocage, non (§7.3) |
| **l'iPhone revérifie toutes ses cartes** (jusqu'à 31 sur un même appareil, 00b C4), puis télécharge celle qui a changé | 1 requête pour la liste + 1 par carte + une génération complète (3 requêtes, images, signature `openssl`, **environ 100 Ko**, relevé) | la carte scannée, oui ; les autres, non (dette #11) |
| **régénération de cartes qui n'ont pas changé** | erreurs d'Apple relevées le 27/09 à 09:29:59 : « Server requested update … but the pass was unchanged » et « Server ignored the if-modified-since header (Fri, 18 Sep 2026 08:00:41 GMT) and returned the full unchanged pass data » | **non** |

**La seconde erreur d'Apple s'explique par le code — PROUVÉ (code) / HYPOTHÈSE (cause
exacte).** Le serveur renvoie la carte entière dès que `passes.updated_at` est plus
récent que la date donnée par l'iPhone (`apple-wallet.js:129-133`, `:161`). Toute
écriture sur `passes` avance cette date : un déclencheur la remet à l'heure de la base à
chaque mise à jour (`schema.sql:150-156`, `:166-168`, identique en production, 00a),
même quand rien ne change sur la carte Apple : un texte identique réécrit, ou le lien
Google réécrit à chaque appel de la route qui le génère (`google-wallet.js:32-36` : le
commentaire dit « si pas encore définie », le code ne le vérifie pas). La date de
l'iPhone, 08:00:41, tombe dans le passage du cron de 08:00 UTC, qui réécrit le même
texte de relance d'un jour à l'autre (A §1). **HYPOTHÈSE** : des réécritures à
l'identique du cron ont fait régénérer cette carte pour rien, au moment où un scan (ou
une autre poussée) a réveillé l'appareil. → segments 4 et 1.

### 5.3 À la cible

**HYPOTHÈSE (calcul).** À 3 000 scans par jour (100 boutiques à 30 scans), le scan seul
représente environ 25 000 à 40 000 requêtes à la base (4 à 5 avant la réponse, 3 après,
4 à 5 quand l'iPhone télécharge la carte), 6 000 appels Google, jusqu'à 3 000
téléchargements d'image pour rien (marchands en tampons) et jusqu'à 3 000 générations
de cartes Apple (environ 300 Mo par jour si tous les clients sont sur iPhone), sans
compter les cartes voisines revérifiées. Pour la base,
ce n'est pas un volume critique. **Le coût qui compte est ailleurs** : les générations de
cartes et les rendus d'images tournent dans le process qui sert aussi les scans (00b
§4.4). C'est à mesurer au segment 6.

---

## 6. Projection : le trafic machine (gravité 2)

### 6.1 Ce qu'une machine fait autrement qu'une caissière

- Elle **renvoie d'elle-même** une demande restée sans réponse, après un délai qui lui
  est propre, souvent de quelques secondes.
- Elle **ne lit pas l'historique** et n'annule rien.
- Elle peut **envoyer en rafale** (e-commerce : une campagne, une reprise après une
  panne).
- Elle **n'a pas de QR à scanner** quand c'est une caisse qui crédite à l'encaissement.

### 6.2 Ce que produirait chaque coupure

Les lignes du tableau des coupures (§3.2) se lisent ainsi pour une machine :

| Coupure | Borne ou caisse qui renvoie | Pourquoi ça arrivera |
|---|---|---|
| c, d : crédit validé, ligne jamais écrite | **double crédit invisible**, à chaque fois | chaque redéploiement, chaque perte de réponse entre Californie et Paris |
| f : réponse perdue vers la machine | **double crédit**, deux lignes, personne pour annuler | réseau du commerce, délai de la machine |
| g : second envoi avant la fin du premier | double crédit, **parfois inannulable** (D1) | dès que le délai de la machine est plus court que la queue des scans : jusqu'à 7 s de relances (§4.7), 3 à 4 s derrière une grosse campagne (D4), rendus d'images (§5.2) |
| h : doublon au seuil | **remise avancée**, récompense acquise un passage trop tôt | tout doublon près du seuil |

**PROUVÉ (mécanisme)** pour chaque ligne ; **HYPOTHÈSE** sur les délais des machines,
qui n'existent pas encore.

### 6.3 Ce qu'une intégration exigera, et qui n'existe pas

**PROUVÉ (absence, code et schéma).**

| Besoin | État aujourd'hui |
|---|---|
| **une clé d'idempotence** : la même demande, renvoyée, rend le premier résultat | aucune colonne, aucune contrainte, aucune route (§4.2) |
| **un identifiant de demande pour rapprocher** (« mon crédit est-il passé ? ») | l'historique ne porte aucun identifiant de demande ; une machine ne peut pas distinguer son renvoi d'une seconde visite |
| **des clés et une révocation propres aux intégrations** (brief §3) | seuls les jetons marchand et boutique existent (`auth.js:77-108`) |
| **une limite par clé**, pas par adresse IP | limites par adresse, et l'adresse est celle du proxy (§4.8) |
| **le sens du montant** | en points, un entier saisi par la caissière (`scan.js:106-114`), sans règle de conversion ; un montant envoyé en centimes créditerait cent fois trop |
| **l'heure réelle de l'événement** (file d'attente hors ligne d'une borne) | l'heure est celle de l'écriture (`schema.sql:113`) |
| **identifier le client sans QR** (caisse) | seuls le numéro de série et le code de secours existent ; le code de secours devient ambigu avec le stock, et un 409 est une impasse pour une machine (§4.7) |
| **une remise explicite** (§6.4) | la remise est implicite au passage suivant le seuil |

Aucune de ces portes n'est fermée. Mais **`POST /api/scan` ne peut pas servir tel quel
aux machines** : sa sémantique suppose un humain qui regarde l'écran.

### 6.4 La récompense à une borne

**PROUVÉ (code).** La remise est déclenchée par le passage qui suit le seuil
(`migration_023:78-86`), quel que soit l'appareil, et la réponse dit alors « remettez la
récompense » (`scan.js:215`). Ce différé est **vital** pour le fond doré des cartes Apple
(passation §3.6) : il ne peut pas être simplement retiré.

**HYPOTHÈSE (usage).** À une borne, personne ne remet le cadeau : en tampons, le
compteur repart à zéro et **la récompense est perdue pour le client** ; en points, le
seuil est déduit du solde. **45 clients** ont aujourd'hui une récompense en attente (S6).
Une API de borne devra dire ce qu'elle fait d'un client au seuil (remise différée à un
passage humain, bon imprimé, refus) : c'est une décision produit, à prendre avant de
coder.

### 6.5 E-commerce et vagues

**HYPOTHÈSE (pratique courante, non vérifiée ici).** Les plateformes d'e-commerce
délivrent leurs notifications « au moins une fois » et les renvoient en cas de doute :
sans clé d'idempotence, chaque renvoi est un crédit. En vague, chaque crédit déclenche
aussi une génération de carte Apple et deux appels Google dans le process qui sert les
scans au comptoir (§5.3) : **une vague e-commerce ralentirait les caisses** (gravité 3),
à mesurer au segment 6.

---

## 7. Questions transversales

### 7.1 Deux serveurs, et au redémarrage

**Au redémarrage — PROUVÉ (code, observation).** `index.js` ne gère pas `SIGTERM` et ne
ferme pas son serveur (`index.js:149-157` ; aucune occurrence de `SIGTERM`,
`process.on` ni `server.close` dans `src/`). Sur un serveur de dix lignes construit de
la même façon, un `SIGTERM` envoyé pendant une requête arrête le process sur-le-champ
(code de sortie 143) : **la seconde moitié de la requête n'est jamais exécutée**
(annexe B, D5). Pour un scan, c'est la coupure d du §3.2. L'état en mémoire disparaît
avec le process : les demandes d'avis armées dans la demi-heure qui précède ne partent
jamais (`services/avis.js:53`, `:97`, minuteurs en mémoire), G5, une seule enseigne
concernée aujourd'hui.

**Le délai que laisse Railway — HYPOTHÈSE.** D'après la documentation (par extraits),
Railway envoie `SIGTERM` à l'ancienne version une fois la nouvelle en ligne, puis
`SIGKILL` après un délai qui vaut **0 s par défaut** ; le temps pendant lequel l'ancienne
version reste en service est donné à 0 ou 20 s selon les extraits. Aucune des deux
variables qui les règlent n'est posée (relevé de 00b §4.1 : la seule variable posée et
jamais lue est `LANDING_BASE_URL`), et les valeurs affichées dans les réglages du
service n'ont pas été relevées.

**Ordre de grandeur — HYPOTHÈSE (calcul).** Un scan occupe le serveur environ 1 s, dont
0,2 à 0,5 s entre le crédit et sa ligne de journal (S7 : médiane et p90). Sur une
journée d'ouverture de 12 heures, un redéploiement a aujourd'hui (54 scans par jour)
environ **0,1 %** de chances de tomber pendant un scan, et 0,03 à 0,06 % de tomber dans
cette fenêtre ; à 3 000 scans par jour, environ **7 %**, et **1,5 à 3,5 %**. Avec une
machine qui renvoie, une coupure dans la fenêtre devient un double crédit invisible
(ligne d), une coupure entre la ligne et la réponse un double crédit visible (ligne f).

**Avec deux serveurs — PROUVÉ (code).** Rien ne se double dans la chaîne du crédit : le
verrou est en base. Le cache du marchand ne s'invalide que sur une instance (jusqu'à 60 s
de suspension ou de révocation non appliquée, passation §15 ter) ; les limiteurs comptent
par instance (00b, F5) ; un minuteur d'avis vit sur l'instance qui a servi le scan.
Deux instances ne suppriment pas la coupure au redéploiement : chaque ancienne instance
reçoit le même `SIGTERM`. C'est l'arrêt propre (P3) qui la supprime.

**Le cron de 08:00 UTC** : 00b a établi que son voisinage avec le rush de Dubaï n'est
pas observé aujourd'hui. À la cible, le passage dure des heures (00b §4.4) et chaque
carte notifiée réveille un iPhone, qui fait générer des cartes **dans le process des
scans** (§5.2). **HYPOTHÈSE** : c'est par là que le cron ralentira le scan, plus que par
ses propres requêtes. *Ce qui le confirmerait* : l'activité CPU de Railway pendant le
passage (segment 6).

### 7.2 Le serveur sait faire, l'interface le demande-t-elle ?

**PROUVÉ (code).**

| Capacité serveur | Scanner (PWA) | Onglet scanner du dashboard |
|---|---|---|
| annulation du dernier scan | oui | **non** (aucun appel à `/annuler`) : un marchand mono-site qui scanne depuis le dashboard n'a que l'ajustement absolu (§4.6) |
| refus 403 `access_disabled`, `use_boutique_login` | oui (`:1077-1085`) | affichés bruts |
| 401 (jeton expiré), 403 `session_revoked`, `account_suspended` | **affichés bruts, pas de retour à la connexion** | idem (le dashboard gère le 401 dans son `api()`, `:965-972`, que l'onglet scanner n'utilise pas) |
| refus du limiteur (429) | lu comme une erreur réseau | idem |
| collision de code de secours (409) | boutons de choix | boutons de choix |
| « seuil franchi » et « remise » séparés (`recompense`, `is_reset`) | oui | oui |
| connexion mémorisée (`remember_device`) | toujours activée (`:804`), jeton de 365 jours | case à cocher |

Quelle interface scanne réellement ? **NON VÉRIFIABLE** : les deux utilisent le même
jeton marchand en mono-site, et les journaux n'ont pas de page d'origine, parce que
`helmet` impose `Referrer-Policy: no-referrer` (7.2.0, `index.cjs:191`).

### 7.3 Les changements de masse

| Changement | Ce qui souffre au scan | Statut |
|---|---|---|
| **campagne** : texte de toutes les cartes du marchand réécrit en une instruction (`notifications.js:101-103`) | la carte du scan attend la fin de l'instruction : 9 à 16 ms à 267 cartes, 25 à 35 ms à 1 000, 0,23 à 0,36 s à 10 000, **3,4 à 4,1 s à 100 000** ; une carte déjà traitée a attendu 3,8 s (D4) | PROUVÉ (mécanisme) / HYPOTHÈSE (durées en production, instance plus petite et plus loin) |
| **changement de design** (et future bascule saisonnière « au fil des scans ») | chaque première valeur de tampons rendue après le changement fait un rendu synchrone de trois images, qui gèle le process le temps du rendu | PROUVÉ (code) / NON VÉRIFIABLE ici (durée du rendu) |
| **changement de seuil ou de mode** en cours de programme | le sens de tous les soldes change au passage suivant : un seuil abaissé déclenche des remises ; S6 garde la trace de 4 lignes qui ne suivent plus les règles actuelles | PROUVÉ (code) / HYPOTHÈSE (origine des 4 lignes) |
| **migration sur `marchands`** (verrou exclusif) | tout scan attend ; les migrations récentes plafonnent l'attente à 3 s (`SET lock_timeout = '3s'`, migrations 043, 045, 046 et 047) | PROUVÉ (fichiers) |
| **révocation d'un marchand** (bouton de l'admin) | toutes ses caisses affichent `session_revoked` à chaque scan jusqu'à une déconnexion manuelle (§4.7) | PROUVÉ (code) |

Le plafond de 8 s sur les requêtes du serveur (00a §6.5, HYPOTHÈSE) s'appliquerait à la
campagne : au-delà d'environ 200 000 cartes au rythme de D4, elle échouerait, et un scan
qui l'attendrait perdrait l'écriture de sa carte, sans que l'erreur soit lue.

### 7.4 Ponytail

**Méthode.** Commande d'audit de Ponytail (v4.10.0) : une ligne par candidat, étiquetée
`delete` (code mort, souplesse inutile), `stdlib`, `native`, `yagni` (abstraction à une
seule utilisation), `shrink` (même logique en moins de lignes), classée par taille de
coupe ; bilan en lignes. Ponytail exclut la justesse, la sécurité et la performance :
elles sont dans les constats. S'y ajoutent les règles du brief (§5) : **un garde-fou
n'est jamais candidat** sans protection équivalente, et une suppression ne se propose
que **sur preuve** d'usage nul. **Liste de candidats, pas feu vert** : chaque
suppression serait un chantier testé, décidé par Yass.

1. `delete:` **l'outil de diagnostic caméra**, « instrument temporaire (palier 0.5) »
   selon son propre en-tête (`diag.js:8-15`) : `public/diag/` (313 lignes, plus 1,26 Mo de
   bibliothèques copiées : jsQR, lecteur zxing en WebAssembly), `routes/diag.js`
   (110 lignes), `admin/diag-resultats.html` (196 lignes), son limiteur
   (`rateLimiters.js:41-51`), la table `diagnostics_camera`. Dernière mesure le 13/09
   (S5 : 15 mesures, 6 étiquettes). Rien ne le remplace. **Condition** : que Yass
   considère la campagne de mesure close. [`public/diag`, `src/routes/diag.js`,
   `public/admin/diag-resultats.html`]
2. `shrink:` **la machine d'état du scan est écrite deux fois** : scanner (817 lignes de
   script) et onglet scanner du dashboard (environ 435 lignes, `dashboard/index.html:1380-1815`) :
   boucle caméra, verrou de carte, confirmation, pavé des points, choix en cas de
   collision, résultat. Un seul script partagé (`<script src>`, rien à construire), soit
   environ **−350 lignes**. C'est aussi la fin des corrections faites dans un écran et
   pas dans l'autre : la confirmation est arrivée avec un mois d'écart, l'annulation
   manque encore au dashboard (§4.2, §7.2). [`public/scanner/index.html`,
   `public/dashboard/index.html`]
3. `shrink:` **la mise à jour de la carte après un changement de solde est écrite
   plusieurs fois** : `scan.js:238-280` et `clients.js:271-304` (et `cron.js`,
   `services/avis.js` au segment 1). Une fonction commune, environ −35 lignes dans le
   périmètre. [`src/routes/scan.js`, `src/routes/clients.js`]
4. `delete:` **l'extraction d'un numéro de série depuis une adresse web lue dans le QR**
   (`scanner/index.html:977-984`, `dashboard/index.html:1520-1525`) : aucune carte n'a
   jamais porté d'adresse dans son QR, seulement le numéro de série (`apple-pass.js:410-413`
   depuis `2bbccc9`, le 23/05 ; objet Google : `google-pass.js:274`). −16 lignes.
5. `delete:` **le repli de connexion caisse par e-mail** (`scanner-auth.js:68-74`) :
   la passation tient `email_contact` pour un champ « bidon, inutilisé » (dette #10,
   classée sans suite le 13/07) ; s'il l'est, ce repli n'a pas d'usage. −7 lignes, et une
   requête de moins quand l'identifiant saisi n'est pas un slug. La dette #10 elle-même
   n'est pas ressortie ici. Seul fait nouveau : ce repli a été ajouté au login caisse le
   16/08 (`1d138a6`), après l'arbitrage ; à Yass de dire si c'est un changement d'usage
   du champ au sens de la dette #10. **Décision de Yass** : c'est une porte de connexion.
6. `shrink:` **le test du réseau écrit deux fois** (`scan.js:43-52`,
   `scanner-auth.js:84-93`). Une fonction commune, −8 lignes.
7. `delete:` **le repli du dashboard quand le serveur n'envoie pas `is_reset`**
   (`dashboard/index.html:1673-1677`) : l'écran et l'API sont servis par le même process
   et déployés ensemble ; le serveur envoie `is_reset` depuis `2b01109` (15/09). −3 lignes.

**Écartés** (garde-fou ou usage prouvé) : le seuil affiché distinct du seuil réel (2
marchands, S5) ; l'annulation (11 usages, S5) ; le choix en cas de collision du code de
secours (jamais de crédit à l'aveugle) ; la relecture de `actif` dans `scan.js:94` (plus
fraîche que le cache de 60 s) ; la confirmation et le verrou de carte ; `asyncHandler`,
nécessaire en Express 4.22 (qui ne transmet pas les promesses rejetées) ; le module du
code de secours (une règle, trois utilisateurs).

**net : environ −1 050 lignes de code propre, −1,26 Mo de fichiers copiés, −1 table ;
aucune dépendance npm** (les bibliothèques de l'outil de diagnostic sont copiées, pas
déclarées).

Ponytail pose aussi une règle qui rejoint le brief (§8) : une logique d'argent sans
vérification exécutable est « inachevée ». Le périmètre n'en a aucune (§10).

---

## 8. Seuils de rupture

Chaque seuil est exprimé dans l'unité qui le provoque (brief §3).

| Ce qui casse | Unité | Seuil | Aujourd'hui | Ce qui souffre en premier | Statut |
|---|---|---|---|---|---|
| double crédit par renvoi | **intégrations machine** | **dès la première** | 0 intégration ; 15 marchands en points | l'argent des clients, sans que personne le voie | PROUVÉ (mécanisme) |
| coupure d'un scan au redéploiement | scans par jour × redéploiements en journée | environ 0,1 % des redéploiements faits en journée aujourd'hui (0,03 à 0,06 % entre le crédit et la ligne) ; 7 % (1,5 à 3,5 %) à 3 000 scans par jour | 54 scans par jour | un crédit sans ligne, ou un doublon invisible | HYPOTHÈSE (calcul, réglages Railway non relevés) |
| attente derrière une campagne | cartes du marchand | environ 3,5 à 4 s à 100 000 ; échec au-delà d'environ 200 000 si le plafond de 8 s existe | 267 cartes au plus (Dinapoli) | la réponse au scan, puis la campagne | PROUVÉ (D4) / HYPOTHÈSE (production) |
| lecture en panne au scan | durée d'une panne de la base | au-delà d'environ 7 s par lecture, fausse erreur à la caisse | — | la caisse | PROUVÉ (bibliothèque) |
| surcoût après inactivité | minutes sans scan sur la plateforme | après 10 min : +0,26 s mesurés sur les écritures qui suivent le crédit | 30 % des scans | le temps d'un scan isolé | PROUVÉ (S7) / HYPOTHÈSE (cause) |
| collision du code de secours | clients par marchand | 0,06 % des saisies à 10 000 clients, 0,6 % à 100 000 | 267 au plus, 0 collision | la saisie manuelle ; impasse pour une machine | PROUVÉ (calcul, S5) |
| limiteur global | requêtes par 15 min sur une même adresse du proxy | 300 | pire quart d'heure : 14 scans sur la plateforme | scans et mises à jour de cartes refusés | HYPOTHÈSE (répartition des adresses inconnue) |
| récompense perdue à une borne | clients au seuil | dès la première borne | 45 clients avec une récompense en attente | la récompense du client | PROUVÉ (données) / HYPOTHÈSE (usage) |

**Ce qui casse en premier à la cible.** Pas le débit : au pire, 8 scans en une minute
chez un seul marchand (Hilal Kebab, 17/09, S4), ce que le serveur absorbe. **La justesse
face aux renvois** casse dès la première machine, puis **les attentes rares mais longues**
(relances, campagnes, rendus), qui déclenchent justement les renvois.

---

## 9. Propositions

Chaque proposition dit ce qu'elle retire, ce qu'elle protège, son coût et ses limites.
Aucune n'est un correctif : l'audit ne corrige rien, Yass décide.

**P1 — Écrire le crédit, sa ligne et la carte dans une seule transaction, avec une clé
d'idempotence.** La caisse (puis la machine) donne à chaque tentative un identifiant ;
la base le garde avec la ligne, sous une contrainte d'unicité ; un renvoi rend le
premier résultat au lieu de créditer.
- *Retire* : rien au commerçant ni au client ; un échange avec la base par scan (0,2 s de
  gagné).
- *Protège* : constats 1, 2 et 5, et la ligne h ; préalable de toute intégration machine.
- *Coût* : une migration (colonne, contrainte, nouvelle fonction) ; les deux écrans
  génèrent l'identifiant ; le filet de tests d'abord (§10).
- *Limites* : ne protège que les clients qui envoient l'identifiant ; l'ancienne route
  reste exposée tant qu'elle existe. Une fonction de plus qui écrit le solde : même
  discipline que la passation §3.3 et §5.

**P2 — Côté caisse : après une erreur, ne pas reproposer la carte, et le dire.** Un délai
maximal sur l'appel, un message « vérifiez l'historique avant de rescanner », et le
traitement explicite des 401, 403 et 429.
- *Retire* : un geste de plus à la caissière après une erreur.
- *Protège* : constats 4 et 10 ; réduit les doublons humains avant même P1.
- *Coût* : les deux écrans (moitié moins si Ponytail n°2 est fait avant).
- *Limites* : ne protège pas les machines ; ne remplace pas P1.

**P3 — Arrêt propre au redéploiement.** Sur `SIGTERM`, ne plus accepter de requêtes,
finir celles en cours, puis s'arrêter ; régler le délai d'arrêt de Railway en
conséquence.
- *Retire* : quelques secondes de déploiement.
- *Protège* : la coupure d du §3.2, à chaque push.
- *Coût* : quelques lignes et un réglage Railway.
- *Limites* : ne couvre pas un plantage ; l'état en mémoire (minuteurs d'avis, caches)
  reste perdu (§7.1).

**P4 — Si le parrainage est conservé : aligner `credit_referral` sur la règle du scan**
(pas de plafond qui détruise un surplus) et **ne verrouiller que le client**.
- *Retire* : rien.
- *Protège* : constat 7, avant toute activation en mode points.
- *Coût* : une migration de fonction, testée sur les deux modes.
- *Limites* : sans objet si Yass supprime le parrainage (brief §5 : fonction
  questionnable).

**P5 — Ajustement conditionnel et journalisé.** L'ajustement envoie la valeur qu'il a
lue et n'écrit que si elle n'a pas changé ; il écrit une ligne de journal marquée comme
ajustement.
- *Retire* : un message « le solde a changé, rechargez » si un scan est passé entre-temps.
- *Protège* : constat 8 ; rend le journal complet, donc l'annulation et les statistiques
  justes.
- *Coût* : une migration (type de ligne), la route, la fiche client.
- *Limites* : la caisse mono-site garde le droit d'ajuster tant que son jeton est complet
  (segment 3).

**P6 — Une route dédiée aux machines**, après P1 : clés et révocation propres, limite par
clé, montant défini (unité, conversion), heure de l'événement, remise explicite, identifiant
de demande consultable.
- *Retire* : rien aux caisses actuelles.
- *Protège* : constats 2, 5, 6 et 11 pour les machines.
- *Coût* : un chantier.
- *Limites* : dépend de décisions produit (remise à une borne, identification du client
  en caisse).

---

## 10. Scénarios candidats pour le filet de tests (brief §8)

À rejouer sur une base jetable, avant la première correction qui touche l'argent ou le
scan. La base jetable devra recevoir les droits des 7 tables (00a §5.1).

1. Tampons : scan normal, scan gagnant (10/10, pas de remise), remise au passage
   suivant (0).
2. Points : scan normal, franchissement en un coup (480 + 50 = 530), remise avec report
   (530 → 80), report en cascade (achat plus grand que le seuil).
3. Deux crédits simultanés sur la même carte : aucun point perdu (verrou).
4. Renvoi d'une même demande : un seul crédit (après P1 ; aujourd'hui, deux : le test
   fixe l'état actuel avant de le changer).
5. Crédit validé sans ligne (coupure d) : état du solde et du journal.
6. Journal dans le désordre (D1) : état, puis annulations.
7. Annulation : dernier scan (accepté), scan plus ancien (refusé), après un ajustement
   (refusé), deux fois de suite ou deux en même temps (la seconde refusée, rien ne
   bouge ; D6).
8. Ajustement pendant un scan : valeur obtenue.
9. Code de secours : un client, collision (409 sans crédit), code inconnu.
10. Boutique coupée, boutique archivée, jeton marchand sur un réseau : refus avant toute
    écriture.
11. Parrainage (s'il est gardé) : crédit unique à vie, plafond en points, parrain à
    10/10.
12. Montant en points : 0, négatif, 100 000, 100 001, non entier.

---

## 11. Ce que ce segment transmet

| Segment | À instruire |
|---|---|
| **Synthèse** | P1 en tête des chantiers d'argent et préalable de l'API machine ; le filet de tests (§10) juste avant ; la décision produit sur la remise à une borne (§6.4) ; 15 marchands actifs en points, dont 3 de test (dette #9 dépassée) ; une question à Yass : le repli par e-mail du login caisse, ajouté le 16/08, est-il un changement d'usage au sens de la dette #10 (§7.4, n° 5) |
| 1 — notifications | demande d'avis envoyée après une remise annulée (§4.5), et perdue si le process redémarre dans la demi-heure (§7.1) ; aucune trace « annulation » au registre (H3) ; message Google envoyé à chaque scan, y compris vers les cartes iPhone, et plafond de 3 par jour (§5.2) ; réécritures du cron à l'identique qui font régénérer des cartes (§5.2) ; la bienvenue réécrit la carte juste après le premier scan et peut masquer le message du scan (H4) |
| 3 — accès et données | les limiteurs comptent par adresse du proxy de Railway (§4.8), au premier chef la protection contre la force brute du login caisse ; le 409 renvoie les numéros de série complets des candidats (§4.7) ; la caisse mono-site peut ajuster n'importe quel solde sans ligne de journal (§4.6) |
| 4 — cartes | erreurs d'Apple relevées le 27/09 (« pass unchanged », « if-modified-since ignored ») : régénération complète de cartes inchangées, environ 100 Ko chacune, parce que toute écriture sur `passes` avance `updated_at`, y compris le lien Google réécrit à chaque appel (§5.2) ; téléchargement complet d'une image à chaque scan en tampons (`strip-cache.js:214`) ; rendus synchrones au fil des scans, dont la bascule saisonnière progressive (§7.3) |
| 5 — statistiques | les statistiques qui comptent les scans héritent des lignes manquantes et des ajustements sans ligne (§4.1, §4.6) ; 4 lignes de journal hors règle (§4.9) |
| 6 — infrastructure | arrêt propre et réglages Overlap et Draining de Railway (§7.1) ; `trust proxy` et proxy à deux sauts (§4.8) ; journaux conservés 7 jours, journaux HTTP non filtrables depuis la page utilisée, format `combined` sans durée ; charge CPU des générations de cartes et des rendus dans le process des scans (§5.3, §7.1) ; UptimeRobot surveille déjà `/health` (relevé) |

---

## 12. Hypothèses et angles morts

| Point | Statut | Comment trancher |
|---|---|---|
| H1 — les 21 paires en points de même montant à moins de 10 min sont des doublons | HYPOTHÈSE | S1b, puis les tickets de caisse des marchands concernés |
| H2 — les 290 paires en tampons entre 2 et 10 s sont surtout le bouton « ajouter un tampon » | HYPOTHÈSE | S1c (avant et après les garde-fous) |
| H3 — aucune annulation depuis le 25/09, d'où 0 lot « annulation » au registre | HYPOTHÈSE | S5b |
| H4 — la queue de S7 (carte réécrite plus de 3 s après) vient de la bienvenue | HYPOTHÈSE | S7b |
| cause du surcoût de 0,26 s après dix minutes sans scan (connexion à rouvrir, côté serveur ou plus loin) | HYPOTHÈSE (le partage entre carte et journal ne colle pas avec une seule connexion côté serveur) | journaux HTTP de Railway avec durées (segment 6) ; en-tête Keep-Alive de Supabase ; version d'`undici` embarquée par Node 24.10 |
| surcoût du premier échange d'un scan isolé | HYPOTHÈSE, non mesuré | chronométrage d'un scan isolé (refusé en pilotage : S7 suffit) |
| temps total d'un scan (1,1 à 1,8 s à Dubaï) | HYPOTHÈSE (calcul sur mesures) | journaux HTTP de Railway (durée par requête), non filtrables depuis la page utilisée |
| lignes perdues avant le 25/09 (3 ruptures compatibles) | NON VÉRIFIABLE | aucune trace avant le registre |
| scans effacés par un ajustement | NON VÉRIFIABLE | aucune trace avant le registre ; après, P5 |
| codes d'erreur des scans sur 7 jours (500, 409, 429…) | NON VÉRIFIABLE | parcours complet des journaux non fait ; journaux HTTP non filtrables |
| origine des adresses `152.233.x.x` et `79.127.178.x` | HYPOTHÈSE forte / HYPOTHÈSE | en-têtes `X-Forwarded-For` et `X-Real-IP` reçus par le serveur (segment 6) |
| délai d'arrêt et recouvrement des versions chez Railway | HYPOTHÈSE (documentation par extraits, contradictoire pour le recouvrement) | réglages Overlap et Draining du service |
| comportement de Node 24 à `SIGTERM` | HYPOTHÈSE forte (observé sur Node 22 ; identique selon la documentation de Node) | à confirmer sur l'image de production |
| durées de D4 en production | HYPOTHÈSE | instance plus petite et plus loin ; mesure au segment 6 |
| délai des futures machines avant renvoi | HYPOTHÈSE | aucune intégration n'existe |
| cause des 4 lignes de journal hors règle | HYPOTHÈSE (seuil ou mode changé) | liste nominative des 4 lignes |
| quelle interface scanne (PWA ou dashboard) | NON VÉRIFIABLE | même jeton ; pas de page d'origine dans les journaux (`no-referrer`) |
| durée d'un rendu d'image (le blocage, lui, est prouvé par le code) | NON VÉRIFIABLE ici (code applicatif non exécuté) | segment 4 ou 6 |

---

## 13. Décisions de pilotage et décisions hors pilotage

Sur instruction de Yass, ce segment ne modifie pas `PASSATION_TECHNIQUE.md` : ce qui est
livré, les décisions et la dette découverte sont consignés ici.

**Livré** : ce rapport ; `docs/audit/02-requetes.sql` (S1 à S7, C8, et les requêtes de
suivi S1b, S1c, S5b, S7b). Aucun code modifié, aucune migration.
**Dette découverte** : §1, §4 à §7.

**Décisions de pilotage**

| Date | Décision | Où elle joue |
|---|---|---|
| 27/09 | Plan validé ; périmètre étendu à l'ajustement du solde, au coût du travail après la réponse et à l'outil de diagnostic (Ponytail seulement) | en-tête, §4.6, §5, §7.4 |
| 27/09 | Pas de scan chronométré sur le cobaye : S7 suffit, sinon HYPOTHÈSE | §3.3, §12 |
| 27/09 | C8 abandonnée : Yass a vérifié qu'aucun marchand actif en mode points n'a le parrainage | §4.4 |
| 27/09 | Parrainage en tampons : règle produit, 1 tampon par crédit ; seule perte, le parrain à 10/10 ; une ligne, sans démonstration ; l'effort porte sur le mode points | §4.4 |
| 27/09 | Relevés Railway limités au strict nécessaire, un seul relevé des journaux ; ce qui ne sort pas passe en NON VÉRIFIABLE | §4.8, §12 |
| 27/09 | Rapport sur `claude/keen-goldberg-MXslu`, poussé sur feu vert, hors de la fenêtre du cron de 08:00 UTC ; le redéploiement est accepté | — |

**Décisions hors pilotage** (prises par la session d'audit) :
- les documentations Railway et Supabase sont citées par extraits de moteur de recherche,
  les pages étant bloquées par le proxy ; deux pull requests publiques de projets tiers
  servent de sources pour l'adresse du proxy de Railway ; chacune est marquée HYPOTHÈSE
  là où elle porte un constat ;
- `undici` a été lu en 7.16.0 et 6.24.1 faute de pouvoir lire la version embarquée par
  le Node de production ;
- les démonstrations ont été faites sur la base rejouée dans le conteneur ; l'extension
  `pgrowlocks` y a été créée pour montrer les verrous (base locale seulement) ;
- un serveur Node de dix lignes, sans rapport avec l'application, a servi à observer
  l'arrêt d'un process sur `SIGTERM` ;
- quatre requêtes de suivi, facultatives et testées, ont été ajoutées à `02-requetes.sql`
  après lecture des résultats, pour trancher H1 à H4.

---

## Annexe A — Résultats bruts (production, 27/09)

**S1** — paires de scans consécutifs d'un même client

| Écart | Paires | Points | Points même montant | Jeton boutique | Deux boutiques | Une annulée | Remise après franchissement | Inversées | Première | Dernière |
|---|---|---|---|---|---|---|---|---|---|---|
| moins de 2 s | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 2026-08-02 | 2026-08-02 |
| 2 à 10 s | 291 | 1 | 0 | 0 | 0 | 1 | 6 | 0 | 2026-06-07 | 2026-09-26 |
| 10 à 60 s | 185 | 74 | 15 | 37 | 0 | 3 | 22 | 0 | 2026-06-01 | 2026-09-26 |
| 1 à 10 min | 74 | 42 | 6 | 24 | 0 | 5 | 9 | 2 | 2026-05-31 | 2026-09-24 |
| 10 min et plus | 371 | 291 | 28 | 86 | 6 | 6 | 9 | 1 | 2026-06-01 | 2026-09-27 |

Marchands concernés à moins de 2 s : Magic Cleaning. De 2 à 10 s : Bluemoon Boston, Demo
Winwin Card, Hamza Salon, Hilal Kebab, L'IWAN, La Passerelle Indienne, Magic Cleaning,
Maybach, Nails By Ness, NARA, Wam N Fade, WinWin Card DEMO. De 10 à 60 s : 22 marchands.

**S2** — 45 ruptures de chaîne : 20 « premier scan, solde de départ non nul », 24 « sans
explication en base », 1 « ajustement (registre) » ; aucune « paire inversée » ; aucun
intervalle couvert par le registre sans explication. Wam N Fade : 22 ruptures (16 sans
explication, 6 premiers scans). Ruptures d'une valeur d'un scan : Magic Cleaning
`83b1436f` (25/07, 0 → 1), Asie Express `e05ae400` (15/09, 45 → 69), NARA `cda1c426`
(18/09, 1 → 2). Ajustements jusqu'au seuil une à deux minutes après un scan : Bluemoon
Boston `32aece98` (22/07, 1 → 10, 1 min 25 s), WinWin Card DEMO `a4fc4683` (01/08, 1 →
10, 1 min 46 s), LDC Kitchen + Coffee `ff16b00d` (05/08, 2 → 9, 1 min 16 s). Dernière
rupture : Hamza Salon `606d3e14`, 26/09, 0 → 8, expliquée par le registre.

**S3** — 1 crédit : Pizza Sabbioni (points, seuil 500), 27/07/2026 14:19:53, bonus 1,
parrain `8e1a423a`, aucun scan avant le crédit (0 supposé), solde actuel 1 : intégral.

**S4** — boutique : 3 scans en une minute, 13 en 15 min (Pizz'Amore Saxe, 10/09
19:45-20:00 UTC) ; marchand : 8 en une minute (Hilal Kebab, 17/09 15:36 UTC), 13 en
15 min (15:00) ; plateforme : 8 en une minute, 14 en 15 min (17/09 15:30). Créneaux à 3
scans ou plus : 2 minutes et 16 quarts d'heure (boutique), 56 et 148 (marchand), 64 et
208 (plateforme).

**S5** — points : 15 marchands ; tampons : 32 ; seuil affiché différent : 2 (LDC Kitchen
+ Coffee 10/9, Nails By Ness 5/4) ; réseaux : 3 (8 boutiques) ; scans 30 j : 326 par jeton
boutique, 1 302 par jeton marchand, 0 par jeton marchand chez un réseau ; annulations :
11 (10 sur 30 j), 7 marchands, délai médian 53 s, maximum 167 190 s ; registre depuis le
25/09 : 1 lot d'ajustement, 0 lot d'annulation ; montants en points sur 90 j : médiane 37,
p95 200, maximum 2 000 (1 105 scans) ; collisions de code de secours : 0 ; clients par
marchand : maximum 267, médiane 4 ; `email_contact` : 48, dont 3 adresses partagées ;
diagnostic caméra : 15 mesures, dernière le 13/09, 6 étiquettes.

**S6** — reproduit au §4.9.

**S7** — reproduit au §3.3. Colonnes complètes :

| Tranche | Scans | Carte p50 | Carte p90 | Journal p50 | Journal p90 | J − C p10 | J − C p50 | J − C p90 | Du | Au |
|---|---|---|---|---|---|---|---|---|---|---|
| ensemble | 620 | 215 | 3 368 | 197 | 504 | −3 168 | −7 | 276 | 2026-07-11 | 2026-09-27 |
| moins de 5 s | 37 | 172 | 1 069 | 175 | 462 | −899 | 1 | 299 | 2026-08-24 | 2026-09-26 |
| 5 s à 1 min | 134 | 186 | 4 107 | 184 | 478 | −3 837 | −4 | 48 | 2026-08-19 | 2026-09-26 |
| 1 à 10 min | 263 | 219 | 3 233 | 199 | 494 | −3 062 | −11 | 58 | 2026-07-11 | 2026-09-26 |
| 10 min et plus | 186 | 478 | 3 427 | 216 | 526 | −3 250 | −9 | 300 | 2026-07-13 | 2026-09-27 |

(millisecondes ; « Carte » = du crédit à l'écriture de la carte ; « Journal » = du crédit à
la ligne ; « J − C » = journal moins carte.)

**Relevé Railway du 27/09** (Yass, page Logs du projet) :
- le filtre sur les attributs HTTP ne rend rien : la page ne propose que `@service`,
  `@level`, `@deployment` et `@replica` ;
- recherche texte `"POST /api/scan"` sur « Last month » : données du 20/09 au 27/09, soit
  **7 jours** conservés ; format `combined`, sans durée ; 13 lignes visibles du 26/09
  20:24 au 27/09 07:43 UTC, toutes en 200 ;
- adresses : scans depuis `79.127.178.81` et `.82` (iPhone), `152.233.13.165`
  (Windows), `152.233.33.161` (iPhone) ; `passd` depuis `152.233.13.166` et
  `152.233.12.245` ; UptimeRobot (`HEAD /health`) depuis `152.233.47.65` ;
- téléchargement d'une carte par `passd` : 102 907 octets ;
- deux erreurs d'Apple Wallet transmises au serveur (`POST /v1/log`) le 27/09 à 09:29:59
  UTC, pour la carte `cdc5252a-…` : « Server requested update … but the pass was
  unchanged » ; « Server ignored the 'if-modified-since' header (Fri, 18 Sep 2026
  08:00:41 GMT) and returned the full unchanged pass data ».
- Overlap et Draining : non relevés.

## Annexe B — Démonstrations sur la base rejouée

Base rejouée depuis le dépôt (00a, annexe B), fonctions `increment_stored_value`,
`annuler_scan` et `credit_referral` du dépôt, identiques à la production (00a §4). Les
lignes de journal sont écrites comme `scan.js:174-182` les écrit.

**D1 — Journal dans le désordre.** Solde 4. Crédit A : 4 → 5. Crédit B : 5 → 6. Ligne de
B écrite à 09:48:50.400, ligne de A à 09:48:50.703. Historique, du plus récent au plus
ancien : « 4 → 5 », « 5 → 6 ». Annuler A : `{"ok": false, "reason":
"solde_incoherent"}`. Annuler B : `{"ok": false, "reason": "pas_le_dernier"}`. État
final : solde 6, 2 lignes actives.

**D2a — Une visite, deux crédits, une ligne.** Solde 4 (dernière ligne d'hier : 3 → 4).
1er essai : crédit 4 → 5, pas de ligne. 2e essai : crédit 5 → 6 et ligne. Historique :
« 5 → 6 » (aujourd'hui), « 3 → 4 » (hier). Solde 6, alors qu'une visite vaut 5.

**D2b — Doublon au seuil, tampons.** 9 → 10, `is_reset` faux (« seuil franchi ») ; puis
10 → 0, `is_reset` vrai (« remettez la récompense »).

**D2c — Doublon au seuil, points (seuil 500, achat 50).** 480 → 530 (« seuil franchi ») ;
puis 530 → 80, `is_reset` vrai (« remettez la récompense », surplus reporté).

**D2d — Ajustement entre deux scans.** Crédit 0 → 1 et ligne ; ajustement à 5 (valeur
absolue) ; annulation du scan : `{"ok": false, "reason": "solde_incoherent"}`.

**D3 — Le verrou de `credit_referral`.** Session 1 : `credit_referral` sur un parrain,
transaction gardée ouverte 3 s. Verrous vus par `pgrowlocks` : `marchands` « Demo
Tampons » en « For Update », `clients` « Parrain » en « Update ». Session 2, pendant ce
temps : ligne de scan chez un autre marchand, 1,8 ms ; crédit d'un autre client du même
marchand, 1,7 ms ; mise à jour de la carte d'un autre client du même marchand, 0,7 ms ;
**ligne de scan d'un autre client du même marchand, 2 505 ms** ; **inscription d'un
nouveau client du même marchand, 2 524 ms**.

**D4 — Campagne et scan.** Réécriture du texte de toutes les cartes d'un marchand
(`notifications.js:101-103`), trois passages par taille : 267 cartes, 16, 10 et 9 ms ;
1 000 cartes, 29, 25 et 35 ms ; 10 000 cartes, 335, 233 et 363 ms ; 100 000 cartes,
3 435, 4 101 et 3 688 ms. Pendant une réécriture de 100 000 cartes, la mise à jour de la
carte d'un client scanné (`scan.js:170-173`), si la campagne l'a déjà traitée : **3 777 ms**.
Si elle ne l'a pas encore atteinte : 6 ms.

**D5 — Un process Node sans gestionnaire de `SIGTERM`** (Node 22, serveur de dix lignes
sans rapport avec l'application). Requête reçue, première étape faite ; `SIGTERM` 0,5 s
après ; process arrêté sur-le-champ (code 143) ; la seconde étape, prévue 1,5 s après la
première, n'est jamais exécutée.

**D6 — Deux annulations du même scan en même temps.** Solde 1, un scan actif 0 → 1.
Session 1 : `annuler_scan`, transaction gardée ouverte 2 s : `{"ok": true, …,
"stored_value": 0}`. Session 2, lancée 0,5 s après sur le même scan : elle attend le
verrou, rend la main 2,0 s après la session 1 avec `{"ok": false, "reason":
"pas_le_dernier"}`. État final : solde 0, une seule ligne annulée.

## Annexe C — Commandes reproductibles

```bash
# Âge du défaut : la ligne de journal telle qu'écrite dans les versions successives du scan
git show 67f0794:winwincard/backend/src/routes/scan.js | grep -n "from('scans').insert"
git show d0a43a6:winwincard/backend/src/routes/scan.js | grep -n "Promise.all"

# Dates des garde-fous de la caisse
git log --format='%h %ad %s' --date=iso-strict -S'awaitingConfirm' --reverse -- winwincard/backend/public/scanner/index.html | head -1
git log --format='%h %ad %s' --date=iso-strict -S'lockedSerial' --reverse -- winwincard/backend/public/dashboard/index.html | head -1

# Aucun arrêt propre
grep -rnE "SIGTERM|process\.on\(|server\.close" winwincard/backend/src

# L'annulation n'existe pas dans le dashboard
grep -c "annuler" winwincard/backend/public/dashboard/index.html   # 0

# Bibliothèques, lues sans installation (empreintes = package-lock.json)
npm pack @supabase/postgrest-js@2.107.0 express-rate-limit@7.5.1 morgan@1.11.0 helmet@7.2.0 --ignore-scripts
```

## Annexe D — Sources extérieures

| Source | Version, lieu | Ce qui y est lu |
|---|---|---|
| `@supabase/postgrest-js` | 2.107.0, sha512 = `package-lock.json` | 3 relances (`dist/index.cjs:7`) à 1 s, 2 s, 4 s (`:15`) ; sur 520 et 503 (`:21`) et sur erreur réseau (`:286-296`) ; GET, HEAD, OPTIONS seulement (`:25-29`, `:115-119`) ; actives par défaut (`:148`, `:159`) ; `rpc` en POST (`:5067-5083`) |
| `express-rate-limit` | 7.5.1, sha512 = `package-lock.json` | message par défaut en texte (`dist/index.cjs:633`), envoyé par `response.send` (`:661-668`) ; clé = `request.ip` (`:655-659`) |
| `morgan` | 1.11.0, sha512 = `package-lock.json` | format `combined` sans durée (`index.js:178`) ; adresse = `req.ip` (`:327`, `:519-521`) |
| `helmet` | 7.2.0, sha512 = `package-lock.json` | `Referrer-Policy` par défaut `no-referrer` (`index.cjs:191`) |
| `undici` (le `fetch` de Node) | 7.16.0 et 6.24.1 (celle du Node 22 du conteneur) ; version du Node 24.10 de production non vérifiée | une requête par connexion (`pipelining` 1), connexion inutilisée gardée 4 s par défaut, jusqu'à 600 s si le serveur l'indique (`lib/dispatcher/client.js:218-222` en 7.16.0, `:227-231` en 6.24.1) ; 300 s pour les en-têtes et le corps (`:229-230` en 7.16.0, `:238-239` en 6.24.1) ; 10 s pour ouvrir une connexion (`lib/core/connect.js:53` en 7.16.0, `:86` en 6.24.1) |
| Express | 4.22.2 (`package-lock.json`) | ne transmet pas une promesse rejetée : `asyncHandler` nécessaire |
| Documentation Railway « Logs » | docs.railway.com/observability/logs, **par extraits de moteur de recherche** (page bloquée) | syntaxe de filtre (`@attribut:valeur`, `AND`, `OR`, négation), attributs HTTP dont `@totalDuration` en ms ; conservation 7 jours (Hobby), 30 jours (Pro) |
| Documentation Railway « Deployment Teardown », « Deployments reference » | docs.railway.com, **par extraits** | `SIGTERM` puis `SIGKILL` après le délai de drainage, 0 s par défaut ; recouvrement des versions : 0 ou 20 s selon les extraits |
| Pull request publique Manu-code-all/Medicity #12, « audit IPs are Railway edge addresses » | github.com, lue le 27/09 | des adresses `152.233.x.x` du proxy d'entrée de Railway enregistrées à la place des clients |
| Pull request publique strevino20/Onix #227, « Fix rate limiter never triggering: trust proxy hop count was wrong » | github.com, lue le 27/09 | sur Railway, `trust proxy = 1` donne une adresse de routage interne, variable ; limiteur jamais déclenché ; corrigé avec 2 |
| Datacamp Limited, AS60068 (CDN77) | networksdb.io, bgp.tools, **par extraits** | blocs `79.127.x.x` |
| Ponytail | github.com/dietrichgebert/ponytail, v4.10.0 (`e3ba2aa`) | commande d'audit (`commands/ponytail-audit.toml`, `skills/ponytail-audit/SKILL.md`) |

## Annexe E — Requêtes de suivi

Dans `docs/audit/02-requetes.sql`, après C8, testées comme les autres :
- **S1b** (H1) : la liste des crédits en points de même montant, sur la même carte, à
  moins de 10 minutes ;
- **S1c** (H2) : les paires en tampons à moins de 10 s, avant le 26/07, du 26/07 au 23/08,
  et après ;
- **S5b** (H3) : annulations depuis le début du registre, et lots « annulation » ;
- **S7b** (H4) : S7 séparée entre le premier scan d'un client et les suivants.
