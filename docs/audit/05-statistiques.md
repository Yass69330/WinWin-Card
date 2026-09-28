# Audit WinWin — Segment 5 : les statistiques

> Cinquième segment de l'audit, après la photo de production (00a), la cartographie
> (00b), les notifications (01), le scan et le crédit (02), l'accès et les données (03) et
> les cartes (04). Question posée par le brief (§6) : **la justesse des chiffres** des
> dashboards marchand et réseau. Pour chaque chiffre affiché : d'où il vient, s'il est
> juste aujourd'hui, à quel volume il devient faux, à quel volume il tombe en erreur.
> Même règle que les rapports précédents : **tout constat est rattaché à une preuve**
> (fichier:ligne, commit, requête, démonstration, mesure). Ce qui n'a pas pu être prouvé
> est marqué comme tel et n'est jamais comblé par une reconstitution. Le dépôt étant
> public, les constats qui touchent un accès disent **qui** et **à quelles conditions**,
> jamais **comment** (décision de pilotage du 26/09).

| | |
|---|---|
| **Date** | 2026-09-28 |
| **Commit audité** | `14d67a7` (branche `claude/keen-goldberg-MXslu`). Le code applicatif y est identique à `ca0579a`, en production depuis le 25/09 à 22:08 UTC (`git diff ca0579a 14d67a7 -- winwincard/` est vide). |
| **Dernière migration du dépôt** | `047_avis_google` |
| **Périmètre** | chaque chiffre affiché par le dashboard marchand (Aperçu, Réseau, Clients, Scans, fiche client, Notifications) et par l'admin (compteurs globaux et par marchand) : routes `merchants.js` (`/me/stats`, `/me/group-stats`), `clients.js` (liste, export, fiche), `scan.js` (historique), `notifications.js` (quota, historique des campagnes), `admin.js` (`/marchands`, `/stats`) ; fonctions `group_stats` (migration 039) et `admin_marchands_stats` (044) ; rendus `public/dashboard/index.html` et `public/admin/index.html`. Le compte rendu des campagnes et l'admin ont été inclus en pilotage. |
| **Méthode** | lecture du code ; base de référence rejouée depuis le dépôt (PostgreSQL 16, 48 fichiers, 0 échec) pour tester les requêtes, démontrer (D1) et mesurer (M1) ; code source public de PostgREST pour la forme exacte des requêtes du serveur ; requêtes T1 à T4 en lecture seule (`docs/audit/05-requetes.sql`), exécutées par Yass le 28/09 ; fonctions d'affichage du dashboard exécutées telles quelles dans Node (D2) ; Ponytail appliqué à la main |
| **Limites de méthode** | aucun accès direct à la production ; le code applicatif n'a pas été exécuté, hors fonctions d'affichage extraites (D2) ; les durées de production viennent de `pg_stat_statements` (exécution dans la base, hors réseau) ; les mesures de volume viennent de la machine du conteneur, plus puissante que l'instance de production : ce sont des ordres de grandeur, calés sur T4 ; aucune donnée client n'a été lue |

### Légende

| Marque | Sens |
|---|---|
| **PROUVÉ** | vérifiable par le fichier:ligne, le commit, la requête, la démonstration ou la mesure cités |
| **HYPOTHÈSE** | raisonnement cohérent, non vérifié — ce qui le confirmerait est indiqué |
| **NON VÉRIFIABLE** | la preuve n'existe pas ou n'est pas accessible — la raison est donnée |

La **gravité** (colonne « G ») suit l'échelle du brief (§4) : **1** argent des clients ·
**2** trafic machine (projection) · **3** scan au comptoir · **4** données et accès ·
**5** notifications · **6** carte dans le téléphone · **7** statistiques · **8** apparence.

---

## 1. En une page

**Aujourd'hui, chaque chiffre est calculé comme le code le dit, et vite.** Aucune lecture
n'approche le plafond de 1 000 lignes : la plus chargée compte 337 scans sur 30 jours
(T1). Aucune n'approche les 8 s : 55 ms au pire depuis le 23/05 (T4). Toutes les lectures
du périmètre sont en lecture seule : **aucun défaut de gravité 1 ou 2 n'est dans le
périmètre des statistiques.**

Ce qui fait défaut tient au **sens** des chiffres et à leur **tenue dans le temps**.
Plusieurs ne mesurent pas ce que leur libellé annonce, deux écrans restent figés à
l'ouverture de la page, et une panne s'affiche comme un réseau vide. **À la cible, les
chiffres deviennent faux par la troncature bien avant de tomber en erreur** : la seule
lecture qui approcherait les 8 s est celle de l'onglet Réseau, à des volumes de type
e-commerce.

| # | Constat | G | Statut |
|---|---|---|---|
| 1 | **Le « taux de rétention » divise par tous les clients inscrits depuis l'ouverture.** Il dépend donc de l'âge de la base plus que de la fidélité : 6 % chez Dinapoli (base de 17 jours), 67 % chez Hilal Kebab (11 jours) ; chez Magic Cleaning, 23 %, avec 103 de ses 157 clients sans passage depuis 30 jours. Un client inscrit ne sort jamais du dénominateur : le taux baisse avec le temps, à fidélité égale. | 7 | PROUVÉ (code, T1) |
| 2 | **L'onglet Réseau compare un mois entamé à un mois complet.** Pour une boutique à activité parfaitement constante, « vs mois préc. » affiche −85 % le 5 du mois, −53 % le 15, −11 % le 28 et −92 % le 3 du mois suivant, et la « répartition des passages mensuels » range tout le monde dans la première tranche au début du mois (D1). Aujourd'hui, une seule évolution s'affiche : +708 % à Villeurbanne, calculée sur 13 scans d'août tous faits dans les 4 derniers jours du mois (T2). | 7 | PROUVÉ (code, D1, T2) |
| 3 | **« N/M reçues » compte des appareils et des cartes, pas des clients.** 2 900 destinataires affichés pour 1 679 clients sur les 51 campagnes : 1,73 par client (jusqu'à 2,5). Chaque client compte une fois côté Google, qu'il ait Android ou non, et une fois de plus par appareil Apple. « Reçues » veut dire « acceptées » : 2 896 sur 2 900. Les 4 messages Google tracés depuis le 25/09 visaient une carte iPhone. | 7 | PROUVÉ (code, T3) |
| 4 | **Une panne de l'onglet Réseau s'affiche comme un réseau vide** : tirets, « Porteurs fréquentant plusieurs boutiques : 0 », « Scans non attribués : 0 », « moins de undefined », « Aucun porteur actif », « Aucune boutique. », sans message d'erreur, et gardé jusqu'au rechargement de la page (D2). Un dépassement des 8 s produirait exactement cet écran. | 7 | PROUVÉ (code, D2) |
| 5 | **L'Aperçu et l'onglet Réseau sont figés à l'ouverture de la page** : ni un scan fait depuis le dashboard, ni un changement d'onglet ne les recalcule ; aucun bouton ne le permet. « Scans aujourd'hui » reste la valeur de l'ouverture. | 7 | PROUVÉ (code) |
| 6 | **Après une session expirée, la page garde les données du marchand précédent** : si un autre marchand se connecte sur la même page sans la recharger, il voit l'aperçu, le QR code, la liste des clients, l'historique des scans, les campagnes et le réseau du précédent. La déconnexion volontaire vide tout, sauf l'onglet Réseau. Transmis à la synthèse avec les constats du 03. | 4 | PROUVÉ (code) |
| 7 | **La troncature à 1 000 lignes (héritée de 00b) décide du moment où les chiffres deviennent faux** : l'Aperçu à 1 000 scans sur 30 jours par marchand, soit environ 33 par jour (Pizz'Amore à 337, avec une base de 36 jours) ; « N clients » et l'export à 1 000 porteurs (Dinapoli à 283). L'Aperçu des réseaux passe par la même lecture : à la cible, un réseau de 5 boutiques à 30 scans par jour en compte 4 500. | 7 | PROUVÉ (hérité, T1) / HYPOTHÈSE (cible) |
| 8 | **Tomber en erreur demande des volumes d'e-commerce.** Seule la fonction de l'onglet Réseau approche les 8 s : en local, 0,39 s pour 100 000 scans sur 90 jours dans un réseau, 4,2 s pour 1 million, 10,5 s pour 2 millions ; le seuil tombe vers 1,6 million. En production, entre 1 et 6 fois plus lent à volume égal (calage T4) : entre environ 300 000 et 1,6 million de scans sur 90 jours. À la cible (un réseau de 20 boutiques, 54 000 scans sur 90 jours) : environ 0,2 s en local. Les autres lectures restent sous 0,2 s jusqu'à 2,3 millions de scans et 500 000 porteurs. | 7 | PROUVÉ (mesures locales, M1) / HYPOTHÈSE (production) |
| 9 | **L'historique et la fiche client reconstruisent « Récompense » et « Remise à zéro » avec le seuil actuel**, alors que la base note la remise depuis la migration 031 (`recompense_distribuee`) ; en mode points, la remise n'est jamais signalée (dette #5) ; la fiche écrit « pts » même en tampons. | 7 · 8 | PROUVÉ (code) |
| 10 | **Des écarts de lecture moindres** : « aujourd'hui » et « ce mois » en heure UTC ; « Porteurs » compte des inscrits, pas des cartes installées ; « Scans non attribués » compte aussi des scans faits avant la création des boutiques ; un seuil bas de répartition à 1 laisse la première tranche toujours vide (Pizz'Amore) ; deux définitions de fidélité côte à côte pour un réseau. | 7 · 8 | PROUVÉ / HYPOTHÈSE (précisé au §4.9) |
| 11 | **Des mesures sans écran** : `montant_credite` est écrit à chaque scan et lu par aucun code ; les clics d'avis et le registre des envois ne s'affichent nulle part ; un marchand mono-site n'a aucun chiffre de récompenses remises. L'onglet Réseau a été ouvert 12 fois depuis le 16/08 ; l'export CSV, 2 fois. | — | PROUVÉ (code, T4) |
| 12 | **Hors segment, gravité 1 : l'ajustement du solde est plafonné au seuil.** En mode points, un solde au-dessus du seuil est normal (report du surplus) ; le dashboard refuse de l'enregistrer. Déjà signalé en pilotage le 27/09. Transmis à la synthèse avec le 02. | 1 | PROUVÉ (mécanisme) / NON VÉRIFIABLE (pertes réelles) |
| 13 | **Ponytail** : environ −25 lignes candidates (−35 si `montant_credite` n'a pas d'avenir), aucune dépendance. Le périmètre est presque maigre : ses défauts sont de justesse, pas d'excès de code. | — | liste de candidats |

**Ce que cela dit pour la roadmap.** Les statistiques sont de gravité 7 : leur place vient
des **dépendances**. Le dashboard mono-site « au niveau du dashboard réseau » (brief §3)
doit partir d'une lecture en base, comme l'onglet Réseau, et non de l'Aperçu actuel (P1),
et ses définitions doivent être tranchées avant d'être recopiées (P4, P5). La remise à
zéro de la page à chaque changement de session (constat 6) rejoint le verrouillage issu
du 03. L'ajustement plafonné (constat 12) rejoint le chantier de l'ajustement du 02. Une
future API machine devra dire de quel canal vient chaque crédit, sans quoi les
statistiques mêleront les passages au comptoir et les crédits des bornes ou de
l'e-commerce (§6.2).

---

## 2. Méthode

- **Code** : lecture intégrale du périmètre au commit `14d67a7` ; relevé de chaque
  endroit où un chiffre est calculé puis affiché. Aucun chiffre du dashboard ni de l'admin
  n'a été laissé de côté (§3).
- **Base de référence** rejouée depuis le dépôt (méthode de 00a, annexe B), complétée des
  droits `service_role` des 7 tables (00a §5.1), avec `pg_stat_statements` actif :
  - **T1 à T4** testées à vide, puis sur un jeu fabriqué dont chaque résultat était
    calculé à la main : tous conformes. Pour T4, chaque lecture des écrans a été rejouée
    sous le rôle `service_role` dans la forme que PostgREST lui donne, avec deux témoins
    négatifs (la lecture du cron, un appel lancé depuis l'éditeur) : aucun n'a été compté.
  - **D1** : une copie de `group_stats`, fabriquée automatiquement à partir du texte de la
    migration 039, dont seule l'horloge est un paramètre (annexe B).
  - **M1** : les dix lectures des écrans chronométrées sur des volumes croissants, avec les
    réglages mémoire de la production relevés par T4 (annexe B).
- **PostgREST** : son code source (dépôt officiel, lu le 28/09) donne la forme exacte des
  requêtes que le serveur envoie à la base ; c'est ce qui permet à T4 de ranger les
  requêtes enregistrées par écran sans jamais rendre leur texte.
- **Production** : T1 à T4 exécutées par Yass le matin du 28/09, UTC (résultats bruts :
  annexe A).
- **D2** : les fonctions d'affichage de l'onglet Réseau (`I18N`, `t`, `esc`, `rsEvolCell`,
  `renderReseau`), extraites telles quelles de `dashboard/index.html` et exécutées dans
  Node avec un faux document minimal.
- **Ponytail** : dépôt cloné en v4.10.0 (`e3ba2aa`, branche principale, comme en 02 et 04),
  commande d'audit (`commands/ponytail-audit.toml`, `skills/ponytail-audit/SKILL.md`) lue
  et appliquée à la main au périmètre ; rien d'installé ni d'exécuté (§7.4).
- **Une visite = un scan** : décision de pilotage du 27/09 ; aucune mesure ne regroupe des
  scans rapprochés (§13).

---

## 3. L'inventaire, chiffre par chiffre

Pour chaque chiffre : d'où il vient, ce qu'il compte réellement, s'il est juste
aujourd'hui, le volume où il devient faux et celui où il tombe en erreur, avec ce que
l'écran affiche alors. **Les seuils d'erreur sont des mesures locales** (M1), à diviser
par un facteur de 1 à 6 pour la production (calage T4, HYPOTHÈSE). « Hérité » renvoie aux
inventaires de 00b (F1 plafond, F3 erreurs non lues).

### 3.1 L'Aperçu du dashboard

Source : `GET /api/merchants/me/stats` (`merchants.js:57-83`), trois lectures en parallèle ;
affichage `dashboard/index.html:1231-1238`. Vu par tous les marchands, réseaux compris.

| Chiffre affiché | D'où il vient | Ce qu'il compte | Juste aujourd'hui ? | Faux à partir de | En erreur à partir de |
|---|---|---|---|---|---|
| **Clients au total** | comptage exact des clients non effacés (`:61`) | les inscrits, y compris ceux qui ont retiré leur carte (§4.9) | oui (T1) | jamais : comptage exact | au-delà de plusieurs dizaines de millions de clients par marchand en local ; l'écran afficherait « – » (erreur non lue, hérité F3) |
| **Scans aujourd'hui** | comptage exact des scans non annulés depuis minuit UTC (`:62`) | la journée UTC, pas la journée locale (§4.9) ; figé à l'ouverture de la page (§4.5) | conforme à sa définition | — | hors d'atteinte (scans d'une journée) |
| **Actifs (30 jours)** | clients distincts d'une **liste** de scans non annulés sur 30 jours (`:63`, `:66-67`) | les clients venus au moins une fois en 30 jours | oui : marge d'au moins 663 lignes (T1) | **1 000 scans sur 30 jours** par marchand, soit ≈ 33 par jour : sous-estimé et instable d'un chargement à l'autre (hérité, 00b L8) | jamais : la liste est bornée à 1 000 lignes ; en panne, « 0 » (hérité F3) |
| **Taux de rétention** | clients ayant au moins 2 scans dans la liste, divisé par **tous** les clients non effacés (`:71-73`) | pas une rétention : la part de toute la base venue deux fois en 30 jours (§4.1) | conforme au code, trompeur par son nom | idem Actifs | idem ; en panne, « 0 % » |
| **Visites moy. / client actif (30j)** | scans de la liste divisés par les actifs (`:74`) | des scans ; une visite = un scan (décision de pilotage, §13) | conforme au code | idem Actifs | idem ; en panne, « 0x » |

### 3.2 L'onglet Réseau

Source : `GET /api/merchants/me/group-stats` → fonction `group_stats` (migration 039,
appel `merchants.js:90-94`) ; affichage `dashboard/index.html:1148-1214`. Visible dès
qu'un marchand a une boutique non archivée (`:1092-1093`) : 3 réseaux aujourd'hui, dont
Franchise Test, sans client (T2). La fonction compte en base : aucun plafond de lignes.
**En erreur**, pour toutes les lignes ci-dessous : l'onglet entier affiche un réseau vide
(§4.4) ; la fonction dépasse 8 s en local entre 1 et 2 millions de scans sur 90 jours pour
un seul réseau (vers 1,6 million, M1).

| Chiffre affiché | D'où il vient | Ce qu'il compte | Juste aujourd'hui ? | Faux à partir de |
|---|---|---|---|---|
| **Porteurs** | clients non effacés | les inscrits (§4.9) | oui : 226 chez Pizz'Amore, comme l'Aperçu | jamais |
| **Actifs (30 j)** | clients distincts des scans non annulés sur 30 jours | idem Aperçu, mais sans plafond | oui : 184, comme l'Aperçu | jamais ; l'Aperçu, lui, devient faux à 1 000 scans : les deux chiffres divergeront sur le même dashboard |
| **Nouveaux ce mois** | clients non effacés créés depuis le 1er à 00:00 UTC | les inscriptions du mois | oui : 223 sur 226 chez Pizz'Amore, réseau ouvert fin août | jamais |
| **Taux de retour** | actifs du mois ∩ actifs du mois précédent, divisé par les actifs du mois | le mois en cours est entamé | conforme : 1 % chez Pizz'Amore, qui n'existait presque pas en août | — |
| **Porteurs fréquentant plusieurs boutiques** | clients ayant scanné dans plus d'une boutique sur 90 jours | idem ; la fenêtre de 90 jours n'est pas dite | oui : 3 | jamais ; en panne, « 0 » |
| **Répartition des passages mensuels** | scans par porteur **depuis le 1er du mois**, en trois tranches réglées par marchand | un mois entamé (§4.2) ; des scans | conforme au code, faussée en début de mois (D1) ; première tranche toujours vide si le seuil bas vaut 1 (Pizz'Amore, §4.9) | chaque début de mois |
| **Scans non attribués** | scans du mois faits sans jeton de boutique | tablettes non enrôlées, mais aussi scans antérieurs à la création des boutiques (§4.9) | conforme au code : 6 sur 7 chez Bangkok Factory | — ; en panne, « 0 » |
| Par boutique : **Scans**, **Clients servis**, **Récompenses** | scans, clients distincts et remises (`recompense_distribuee`) du mois | un mois entamé | oui | — |
| Par boutique : **vs mois préc.** | (scans du mois − scans du mois précédent complet) ÷ mois précédent | un mois entamé contre un mois complet (§4.2) | un seul chiffre aujourd'hui : +708 % (Villeurbanne) | toujours, sauf en toute fin de mois (D1) |

### 3.3 Clients, fiche client, historique des scans, export

| Chiffre affiché | D'où il vient | Juste aujourd'hui ? | Faux à partir de | En erreur à partir de |
|---|---|---|---|---|
| **« N clients »** (onglet Clients) | longueur de la liste renvoyée par `GET /api/clients` (`clients.js:99-109`, `dashboard/index.html:1286`), triée par solde | oui (283 au plus, Dinapoli) | **1 000 porteurs** : l'écran affiche 1 000 et contredit l'Aperçu ; les plus petits soldes disparaissent (hérité, 00b L2) | vers 30 à 40 millions de porteurs par marchand en local (tri) |
| Solde / seuil et 🎉 par client, fiche client | `stored_value`, seuil affiché, seuil réel (`:1288-1296`, `:1941-1958`) | oui | — | — |
| Badges de l'historique (**Récompense**, **Remise à zéro**) | reconstruits à partir de l'avant / après et du **seuil actuel** (`:1358-1367`, `:1987-1989`) | approximatif (§4.8) | à chaque changement de seuil ou de mode | hors d'atteinte : 100 et 10 derniers scans (`scan.js:358-375`, `clients.js:172-195`) |
| **Membre depuis** (fiche) | `clients.created_at`, formaté par le navigateur | oui | — | — |
| **Export CSV** | clients non effacés, triés par inscription (`clients.js:112-159`) | oui | **1 000 porteurs** : les plus anciens disparaissent (hérité L2) ; « Inscrit le » en date UTC au format français et colonne « Points » même en tampons (`:142`, `:149`) | idem « N clients » |

### 3.4 Notifications

| Chiffre affiché | D'où il vient | Juste aujourd'hui ? | Faux à partir de | En erreur à partir de |
|---|---|---|---|---|
| **« N / M notifications ce mois-ci »** (quota) | comptage des campagnes du mois (`notifications.js:18-41`), mois calculé à l'heure du serveur (`:12-15`) ; le même calcul contrôle l'envoi | oui : le registre voit autant de campagnes que le quota depuis le 25/09 (4 = 4, T3) | — (le mois commence à 04:00 à Dubaï, §4.9) | hors d'atteinte ; en panne, « 0 » (hérité F3) |
| **« N/M reçues »** par campagne | appareils Apple + cartes ayant un lien Google, acceptés / tentés (`notifications.js:153-156`, `dashboard/index.html:1903-1905`) | **non** : compte des appareils et des cartes, pas des clients (§4.3) | déjà ; M plafonné à 1 000 + 1 000 (hérité, 00b L10, L11) | hors d'atteinte |

### 3.5 L'admin

| Chiffre affiché | D'où il vient | Juste aujourd'hui ? | Faux à partir de | En erreur à partir de |
|---|---|---|---|---|
| **marchands actifs**, **clients totaux**, **scans cumulés** | comptages exacts sur toute la plateforme (`admin.js:492-503`, `admin/index.html:860-876`) | oui ; comptes de test compris (écarté en pilotage, A §6) | jamais | **scans cumulés** : un balayage de toute la table, jamais purgée ; 8 s vers 100 millions de scans en local (M1) ; l'écran afficherait « – » |
| Par marchand : **clients**, **scans aujourd'hui**, **boutiques** | fonction `admin_marchands_stats` (`admin.js:22-65`, migration 044) | oui | jamais | vers 25 millions de porteurs sur la plateforme en local ; l'écran affiche « – », ce qui est honnête (`admin.js:48-54`) |

---

## 4. Santé : les constats

### 4.1 Le taux de rétention divise par toute la base

**PROUVÉ (code).** `merchants.js:71-73` : le numérateur compte les clients ayant au moins
2 scans non annulés sur 30 jours ; le dénominateur, `totalClients`, compte **tous** les
clients non effacés, inscrits depuis l'ouverture du compte (`:61`). Le libellé dit « Taux
de rétention » (`dashboard/index.html:813`).

**Ce que cela produit — PROUVÉ (T1).**

| Marchand | Base | Clients | Actifs 30 j | Au moins 2 scans | Affiché |
|---|---|---|---|---|---|
| Dinapoli | 17 jours | 283 | 259 | 18 | **6 %** |
| Boucherie République | 18 jours | 231 | 202 | 35 | 15 % |
| Pizz'Amore | 36 jours | 226 | 184 | 62 | 27 % |
| Magic Cleaning | 75 jours | 157 | 54 | 36 | 23 % |
| Wam N Fade | 88 jours | 115 | 72 | 27 | 23 % |
| Demo Winwin Card | 85 jours | 83 | 14 | 1 | 1 % |
| Hilal Kebab | 11 jours | 58 | 47 | 39 | **67 %** |

- **Une base jeune paraît infidèle** : chez Dinapoli, ouvert depuis 17 jours, la plupart des
  clients n'ont pas encore eu le temps de revenir.
- **Une base ancienne est diluée** : chez Magic Cleaning, 103 des 157 clients ne sont pas
  venus depuis 30 jours, mais restent au dénominateur.
- **Le taux baisse avec le temps, à fidélité égale** : un client inscrit ne quitte jamais
  le dénominateur, sauf effacement RGPD. **PROUVÉ** (code) ; ampleur future : HYPOTHÈSE.

La scission de ce chiffre en « fidélité des actifs » et « part de la base encore active »
est une décision produit (P5).

### 4.2 Un mois entamé comparé à un mois complet

**PROUVÉ (code).** `group_stats` compare les scans du mois en cours, **depuis le 1er**, aux
scans du mois précédent **complet** (migration 039, lignes 62-67 et 108), et répartit les
porteurs selon leurs passages **depuis le 1er** (lignes 84-93). Rien, à l'écran, ne dit
que le mois est entamé (« vs mois préc. », « Répartition des passages mensuels »,
`dashboard/index.html:870-874`).

**Ce que cela produit — PROUVÉ (D1).** Une boutique à activité parfaitement constante
(10 scans par jour, 60 clients qui passent chacun tous les 6 jours), lue par une copie de
`group_stats` dont seule l'horloge est figée :

| Lu le | Scans du mois | Mois préc. | **vs mois préc. affiché** | Mois préc. à période égale | Répartition affichée (moins de 5 / 5 à 10 / plus de 10) | Sur 30 jours glissants |
|---|---|---|---|---|---|---|
| 05/09 12:00 | 45 | 310 | **−85 %** | 44 | 45 / 0 / 0 | 0 / 60 / 0 |
| 15/09 12:00 | 145 | 310 | **−53 %** | 144 | 60 / 0 / 0 | 0 / 60 / 0 |
| 28/09 12:00 | 275 | 310 | **−11 %** | 274 | 25 / 35 / 0 | 0 / 60 / 0 |
| 03/10 12:00 | 25 | 300 | **−92 %** | 24 | 25 / 0 / 0 | 0 / 60 / 0 |

- L'évolution affichée vaut à peu près (jours écoulés ÷ jours du mois précédent) − 1 :
  **toute boutique stable paraît en baisse**, en rouge (`rsEvolCell`, `:1142-1146`), sauf
  en toute fin de mois. À période égale, l'écart est nul à un scan près.
- La répartition range **tous** les porteurs dans la première tranche en début de mois,
  alors qu'ils passent tous cinq fois par mois.

**Aujourd'hui — PROUVÉ (T2).** Le 28/09, à 27,3 jours écoulés, l'effet sur la répartition
est faible (Pizz'Amore : 0 / 173 / 10 affiché, 0 / 173 / 11 sur 30 jours). Une seule
évolution s'affiche : **+708 % à Villeurbanne** (105 scans en septembre contre 13 en
août). À période égale, il n'y a rien à comparer : les 13 scans d'août ont tous eu lieu
dans les 4 derniers jours du mois, le réseau venant d'ouvrir. Les autres boutiques
affichent « — » (aucun scan en août). Le biais du tableau D1 apparaîtra dès que les
boutiques auront un mois précédent complet.

### 4.3 « N/M reçues » : des appareils et des cartes, pas des clients

**PROUVÉ (code).** L'historique des campagnes affiche, pour chacune, « N/M reçues »
(`dashboard/index.html:1903-1905`), avec :
- **M** = appareils Apple du marchand + cartes ayant un lien Google (`notifications.js:155-156`) ;
- **N** = poussées acceptées par Apple + messages acceptés par Google (`:153-154`).

**Ce que cela produit — PROUVÉ (T3).**
- **M compte chaque client côté Google** : sur les 51 campagnes, la partie Google de M égale
  exactement le nombre de clients du marchand à la date de chaque campagne (1 679 = 1 679,
  marchand par marchand). Toute carte a un lien Google (00b §10), que le client ait un
  Android ou non.
- **M compte en plus chaque appareil Apple** : 1 221 appareils, d'où **2 900 destinataires
  affichés pour 1 679 clients**, soit 1,73 par client ; 2,16 chez Wam N Fade, 2,50 chez
  L'IWAN.
- **« Reçues » veut dire « acceptées »** : 2 896 sur 2 900. Une poussée acceptée par Apple
  ne dit pas qu'une notification s'est affichée (passation §15 sexies) ; un message
  accepté par Google sur l'objet d'un client iPhone ne s'affiche nulle part. Depuis
  l'ouverture du registre (25/09), les 4 messages Google acceptés d'une campagne visaient
  tous une carte iPhone (Hamza Salon, où la recette de l'avis a eu lieu le 26/09) ; sur
  toutes les surfaces, la part mesurée était de 63 % le 26/09 (A §5.1).

Le rapport 01 (§5) attribuait l'écart surtout aux jetons Apple morts. **L'essentiel vient du
double compte** : 4 échecs seulement sur 2 900 (§10). Gravité 7 : le chiffre surestime la
portée réelle d'une campagne auprès du marchand qui la paie.

### 4.4 Une panne s'affiche comme un réseau vide

**PROUVÉ (code).** Quand `group_stats` échoue, dépassement de délai compris, la route
répond 500 avec un corps JSON (`merchants.js:92`). L'écran lit ce corps sans regarder le
statut et le range comme s'il s'agissait de chiffres (`dashboard/index.html:1136-1137`) ;
le message « Erreur de chargement » (`:1138`) n'apparaît que si la requête elle-même
échoue. La réponse d'erreur reste en mémoire : l'onglet ne la redemande jamais (`:1132`).

**Ce que voit le marchand — PROUVÉ (D2).** Fonctions d'affichage exécutées telles quelles
sur la réponse d'erreur :

> 👥 – Porteurs · 🔥 – Actifs (30 j) · ✨ – Nouveaux ce mois · 🔄 – Taux de retour ·
> Porteurs fréquentant plusieurs boutiques : **0** · Répartition des passages mensuels :
> moins de **undefined** — 0% (0) · undefined–undefined — 0% (0) · plus de undefined —
> 0% (0) · passages par mois — **Aucun porteur actif ce mois pour l'instant.** ·
> Boutiques · Scans non attribués : **0** · **Aucune boutique.**

Un franchiseur peut lire là un réseau à l'arrêt. L'Aperçu a le même défaut par un autre
chemin : une lecture en panne y donne « – » ou des zéros (hérité, 00b F3). L'admin, lui,
affiche « – » pour ses compteurs par marchand, choix écrit dans le code (`admin.js:48-54`).

### 4.5 Des chiffres figés à l'ouverture de la page

**PROUVÉ (code).** L'Aperçu est chargé une fois, puis servi depuis la mémoire de la page à
chaque retour sur l'onglet (`dashboard/index.html:1059`) ; l'onglet Réseau aussi (`:1132`).
Aucun des deux n'est jamais redemandé : `loadOverview(true)` et `loadReseau(true)` ne sont
appelés nulle part, et aucun bouton ne les rafraîchit (seuls les onglets Clients et Scans
en ont un, `:1308`, `:1377`). Un scan fait depuis l'onglet scanner du dashboard invalide
l'historique (`:1609`), pas l'Aperçu.

Conséquence : **« Scans aujourd'hui » reste la valeur de l'ouverture de la page**, même
après un scan fait depuis le même écran, et même le lendemain si la page (ou l'application
installée) reste ouverte.

### 4.6 Les données du marchand précédent restent affichées

**PROUVÉ (code) ; gravité 4 ; transmis à la synthèse avec les constats du 03.**
- Quand une session expire, le dashboard efface l'identité et le forfait
  (`clearSession`, `:918-921`), puis affiche l'écran de connexion (`:970`). **Il ne vide
  aucune des données chargées** : aperçu, QR code, boutiques, clients, scans, campagnes,
  réseau.
- À la connexion suivante, rien ne les vide non plus (`saveSession`, `:908-916`) ; l'Aperçu
  est servi depuis la mémoire tant qu'il y a des chiffres et un QR code (`:1059`), et les
  autres onglets de même (`:1132`, et les tests `!force && S.…` de chaque onglet).
- La déconnexion volontaire vide cinq de ces données (`:1030`), **pas celles du réseau**.

**Exposition** (qui et à quelles conditions, sans mode opératoire : décision de pilotage du
26/09) :
- **Qui** : un autre marchand qui se connecte sur la même page du navigateur.
- **Conditions** : la page n'a pas été rechargée depuis la session précédente, et celle-ci
  a pris fin sans déconnexion volontaire (échéance du jeton, 7 jours ou 365 jours avec
  « se souvenir de moi », ou changement de `JWT_SECRET`). Le cas se présente surtout sur
  un appareil partagé entre plusieurs comptes.
- **Ce qui est vu** : sous le nom du nouveau marchand, les chiffres, le QR code de la
  landing, les prénoms et soldes des clients, l'historique des scans, les textes des
  campagnes et le réseau du précédent. Après une déconnexion volontaire, seul l'onglet
  Réseau du précédent reste visible, si le nouveau marchand a lui-même une boutique.
- **Limite** : toute action sur ces éléments est refusée par le serveur (elle porte le
  jeton du nouveau marchand) : c'est une fuite en lecture, pas une porte d'écriture.
  Aucun cas observable : rien n'en garde trace.

### 4.7 La troncature, là où elle touche un chiffre

**Hérité (00b F1), relié ici aux chiffres affichés — PROUVÉ (T1).**
- **L'Aperçu** : les actifs, la rétention et la fréquence viennent d'une liste plafonnée à
  1 000 lignes, sans ordre défini, donc instable d'un chargement à l'autre au-delà.
  Aujourd'hui, la marge la plus faible est de 663 lignes (Pizz'Amore, 337 scans sur 30
  jours, avec une base de 36 jours). **Le plafond vaut aussi pour les réseaux** : leur
  Aperçu passe par la même lecture, alors que leur onglet Réseau compte sans plafond. Au
  franchissement, le même dashboard affichera deux « Actifs (30 j) » différents.
- **« N clients » et l'export** : à 1 000 porteurs, l'onglet Clients affiche 1 000,
  contredit l'Aperçu, et perd les plus petits soldes (la liste est triée par solde) ;
  l'export perd les plus anciens. Aujourd'hui, 283 au plus (Dinapoli).
- **« N/M reçues »** : M ne dépasse pas 1 000 + 1 000 (hérité, L10 et L11).

Les constats des passations (§12 et §16) sont confirmés, avec une précision : le défaut de
`/me/stats` ne touche pas que les mono-sites.

### 4.8 L'historique et la fiche client

**PROUVÉ (code).** L'onglet Scans et la fiche client affichent « 🎉 Récompense » quand le
solde après le scan atteint le seuil, et « ↩️ Remise à zéro » quand il retombe à 0
(`dashboard/index.html:1358-1367`, `:1987-1989`) :
- le badge « Récompense » tombe sur le scan qui **atteint** le seuil, alors que la
  récompense est **remise** au scan suivant. Le scanner distingue les deux depuis le
  15/09 (`2b01109`), l'onglet Réseau compte les remises (`recompense_distribuee`), mais
  l'historique ne le fait pas ;
- en mode points, la remise (530 → 130) ne reçoit aucun badge : c'est la dette #5,
  connue et acceptée en V1 ;
- le seuil utilisé est le **seuil actuel** : un seuil ou un mode changé depuis reclasse
  tout l'historique. 02 (§4.9) a relevé 4 lignes de journal qui ne suivent plus les règles
  actuelles ;
- la fiche écrit « pts » après chaque solde, même en mode tampons (`:1996`).

La base sait pourtant quel scan a remis une récompense, depuis la migration 031
(`recompense_distribuee`), et combien il a crédité (`montant_credite`) ; ni l'historique
(`scan.js:361-362`) ni la fiche (`clients.js:186-187`) ne lisent ces colonnes (§7.2).

### 4.9 Des écarts de lecture moindres

- **« Aujourd'hui » et « ce mois » en heure UTC — PROUVÉ (code, hérité de 00b).** L'Aperçu
  compte depuis minuit UTC (`merchants.js:62`), l'onglet Réseau depuis le 1er à 00:00 UTC
  (la base est réglée en UTC, T4), le quota depuis le 1er à l'heure du serveur
  (`notifications.js:12-15`, HYPOTHÈSE : UTC sur Railway). À Dubaï, la journée affichée
  court de 04:00 à 04:00 ; à Paris, de 02:00 à 02:00 en été. Les scans faits entre minuit
  et cette heure comptent pour la veille : environ 3 % des scans des marchands anglophones
  et 0,7 % des francophones sur 30 jours (00b, C5). Faible.
- **« Porteurs » compte des inscrits — PROUVÉ (définition) / NON VÉRIFIABLE (cartes
  gardées).** Un client qui supprime sa carte reste compté. Sur 1 728 cartes, 1 104 sont
  sur un iPhone qui s'est enregistré (04, K1) ; pour les 624 autres, rien ne dit si elles
  sont installées (aucun signal de Google, 04 §11).
- **« Scans non attribués » inclut des scans d'avant le réseau — PROUVÉ (T2) / HYPOTHÈSE
  forte (origine).** Chez Bangkok Factory, 6 des 7 scans du mois sont « non attribués ».
  Les scans au jeton marchand comptés après la création de la première boutique
  provisionnée étaient 0 (02, S5) : ces 6 scans sont donc très probablement antérieurs à la
  création des boutiques. Le libellé suggère des tablettes non enrôlées (passation §12).
- **Un seuil bas de répartition à 1 laisse la première tranche toujours vide — PROUVÉ
  (code, T2).** La tranche « moins de 1 passage » ne peut contenir personne : n'y figurent
  que des porteurs venus au moins une fois (migration 039, lignes 84-93). C'est le réglage
  de Pizz'Amore (1–4) ; l'admin l'accepte (contrainte `freq_seuil_bas >= 1`, migration
  035).
- **Deux « fidélités » côte à côte — PROUVÉ (code).** Pour un réseau, l'Aperçu affiche un
  « Taux de rétention » (§4.1) et l'onglet Réseau un « Taux de retour » (actifs du mois
  revenus du mois précédent) : 27 % et 1 % chez Pizz'Amore, pour deux définitions sans
  rapport entre elles.
- **Les clients effacés restent comptés parmi les actifs — PROUVÉ (code) ; sans effet
  aujourd'hui.** Leurs scans restent (`rgpd_effacement.sql:56-57`) ; aucun actif n'était
  effacé le 28/09 (T1 : 0 partout).
- **Les totaux de l'admin incluent les comptes de test ou de démonstration** (Pizza Sabbioni
  d'après la passation ; WinWin Card DEMO, Demo Winwin Card, Démo France, Ray Test, Franchise
  Test d'après leur nom) : écarté en pilotage (A §6), rappelé pour mémoire.

### 4.10 Hors segment, gravité 1 : l'ajustement du solde plafonné au seuil

Trouvé en relevant les chiffres de la fiche client ; signalé en pilotage le 27/09, qui a
décidé de ne pas bloquer et de le consigner ici. **Transmis à la synthèse avec le 02.**

**Le mécanisme — PROUVÉ (code).** La fenêtre « Ajuster les points » refuse toute valeur
supérieure au seuil réel (`dashboard/index.html:2076-2077`, message « Valeur entre 0 et
{seuil} » ; libellé `:2061`, « Nouveau solde (0 – {seuil} pts) » ; `S.maxValue` = seuil
réel, `:1072`). Le serveur, lui, accepte de 0 à 1 000 000 (`clients.js:210`).

**Pourquoi c'est de l'argent — PROUVÉ (code).** En mode points, un solde au-dessus du seuil
est un état normal : 480 + 50 = 530 pour un seuil de 500, et le surplus est reporté au
passage suivant (`migration_023:78-84` ; passation §1, « pas de clamp »). Pour corriger un
tel client, ou lui ajouter un achat oublié qui franchit le seuil, le marchand ne peut
enregistrer que 500 au plus : le surplus disparaît au scan suivant (500 − 500 + achat).

**Son âge — PROUVÉ (git).** Le contrôle date de la création de la fiche client (`9ac4abc`,
01/06), avant le mode points (report du surplus : `b7692dc`, 11/07). Il n'a jamais été
revu.

**L'exposition.** 15 marchands actifs sont en mode points, dont 3 de test (02, S5) ; le
27/09, 23 clients en points étaient au seuil ou au-dessus (02, S6), sans que l'on sache
combien strictement au-dessus. Les ajustements sont rares : 1 lot au registre depuis le
25/09 (02, S5). En mode tampons, le contrôle est sans effet (aucun solde au-dessus du
seuil, 02, S6). **Pertes réelles : NON VÉRIFIABLE** (avant le 25/09, un ajustement ne
laisse aucune trace ; après, le registre ne garde pas le solde de départ). Pas de requête
de suivi (décision de pilotage du 27/09). Le traitement relève du chantier de
l'ajustement proposé par le 02 (P5).

---

## 5. Comportement : ce que coûtent les chiffres

**PROUVÉ (code, T4).** Aucune statistique n'est calculée en arrière-plan : tout est lu à
l'ouverture d'un écran, puis gardé dans la page (§4.5).

| Écran | Lectures à chaque ouverture | Appels depuis le 23/05 (T4) | Durée en production (T4) |
|---|---|---|---|
| Aperçu | 3 (clients, scans du jour, liste 30 jours) + profil, QR code, boutiques | 1 002 comptages de clients | 2,4 ms en moyenne, 30 ms au plus |
| Réseau | 1 fonction | **12** depuis le 16/08 | 11,7 ms, 30,9 ms au plus |
| Clients | 1 liste | 481 | 0,7 ms, 18,9 ms au plus |
| Scans, fiche client | 1 liste chacun | 430 et 524 | 3,7 et 0,5 ms |
| Notifications | 1 liste + 1 comptage | 317 et 351 | 0,7 et 0,5 ms |
| Export CSV | 1 liste | **2** | 0,0 ms |
| Admin | 1 fonction + 3 comptages + la liste des marchands | 44 depuis le 21/09 ; 669 | 12,6 ms (54,6 au plus) ; 2 à 2,5 ms |

- **Nécessaire ?** Oui : ce sont des lectures à la demande, bornées par l'usage. Le seul
  travail qui grossit sans que personne ne le voie est le comptage des **scans cumulés**
  de l'admin : il relit toute la table `scans`, jamais purgée, à chaque ouverture de
  l'admin (§3.5). Il reste sans effet sensible jusqu'à des dizaines de millions de scans.
- Le QR code de la landing est recalculé par le serveur à chaque ouverture de l'Aperçu
  (`merchants.js:97-111`) : quelques millisecondes de calcul, pour une adresse qui ne
  change jamais. Sans enjeu.
- Les nombres d'appels ne se recoupent pas parfaitement entre lectures lancées ensemble
  (1 002, 532 et 765 pour les trois lectures de l'Aperçu). **HYPOTHÈSE** : les textes de
  requête ont changé avec le temps (filtre d'annulation ajouté par les migrations
  038-039, ancienne liste de l'admin avant la 044, versions de PostgREST). Les durées,
  toutes de l'ordre de la milliseconde, suffisent à la conclusion.

---

## 6. Projection

### 6.1 À 100 points de vente et 100 000 porteurs

**HYPOTHÈSE (calcul, mesures locales M1).**
- **Les chiffres deviennent faux avant de tomber en erreur.** Le premier seuil franchi est
  le plafond de 1 000 lignes : l'Aperçu d'un marchand ou d'un réseau à plus de 33 scans par
  jour, puis l'onglet Clients et l'export à plus de 1 000 porteurs. À la cible, 1 000
  porteurs par point de vente en moyenne : un réseau les dépasse dès son ouverture.
- **Aucune lecture ne tombe en erreur.** Plateforme à la cible (99 000 porteurs,
  267 000 scans sur 90 jours) et un réseau de 100 000 scans sur 90 jours : `group_stats`
  0,39 s, compteurs de l'admin de 22 à 56 ms (scans cumulés 43 ms), tout le reste sous
  10 ms, en local. Un réseau de 20 boutiques à 30 scans par jour (54 000 scans sur 90 jours) resterait
  vers 0,2 s en local, soit 0,2 à 1,3 s en production.
- **Le taux de rétention baissera mécaniquement** avec l'âge des bases (§4.1).

### 6.2 E-commerce, bornes et caisses

**HYPOTHÈSE (projection).**
- **Le seul chiffre qui tomberait en erreur** est l'onglet Réseau d'un gros réseau :
  4,2 s en local pour 1 million de scans sur 90 jours, 10,5 s pour 2 millions, 8 s vers
  1,6 million (M1) ; en production, entre environ 300 000 et 1,6 million de scans sur
  90 jours, soit **3 500 à 18 000 crédits par jour** pour un seul réseau. Il afficherait
  alors un réseau vide (§4.4). Hors de portée des caisses humaines, à la portée d'une
  intégration e-commerce.
- **Les statistiques ne distinguent pas l'origine d'un crédit.** `scans` n'a pas de colonne
  de canal (`schema.sql:107-114`, migrations 031, 033, 038) : un crédit de borne, de caisse
  ou d'e-commerce compterait comme une visite en boutique dans les actifs, la rétention, la
  fréquence et les passages. Il faudra une colonne de canal dans l'API machine (02, P6) ;
  les crédits passés n'en auront pas. **Porte ouverte**, à condition de l'ajouter avec
  l'API, pas après.
- **Le compte des scans cumulés de l'admin** relit toute la table : 8 s vers 100 millions
  de scans en local (M1), soit entre 18 et 100 millions en production. À 3 000 crédits par
  jour, des décennies ; avec l'e-commerce, plus tôt.

### 6.3 Les chantiers du brief

- **Dashboard mono-site au niveau du dashboard réseau.** `group_stats` fonctionne déjà pour
  un marchand sans boutique (tout y est calculé par marchand), mais trois de ses chiffres
  n'y auraient pas de sens (boutiques, non attribués, mobilité) et deux portent le biais du
  mois entamé (§4.2). Partir de l'Aperçu actuel, c'est hériter du plafond de 1 000 lignes.
  **Aucune porte fermée.**
- **Segmentation clients et push par boutique.** Les données existent : chaque scan porte
  sa boutique depuis la migration 033. Un client jamais scanné n'est rattaché à aucune
  boutique : la landing n'a pas de paramètre de boutique (`/l/:slug`). Porte ouverte.
- **Dubaï.** Aucun fuseau par marchand n'existe en base (01) : jours et mois restent en
  UTC (§4.9).

---

## 7. Questions transversales

### 7.1 Deux serveurs, et au redémarrage

**PROUVÉ (code).** Aucune statistique ne garde d'état côté serveur : chaque chiffre est
relu en base à la demande. Deux instances ou un redémarrage ne changent rien aux
chiffres. L'état qui compte est dans la page du navigateur (§4.5, §4.6).

### 7.2 Le serveur sait faire, l'interface le demande-t-elle ?

**PROUVÉ (code, T4).**

| Capacité ou donnée | Interface | État |
|---|---|---|
| remise d'une récompense par scan (`recompense_distribuee`, 031) | onglet Réseau seulement | l'historique et la fiche la reconstruisent à partir du seuil actuel (§4.8) ; un mono-site n'a aucun chiffre de remises |
| montant crédité par scan (`montant_credite`, 031) | aucune | écrit à chaque scan, **lu par aucun code** ; la règle du Socle interdit de le soustraire aux remises en un seul chiffre, pas de l'afficher à part |
| clics sur le lien d'avis (`avis_clics`, 047) | aucune | lu en SQL seulement ; le marchand ne voit pas l'effet de sa demande d'avis |
| registre des envois (`notification_envois`, 046) | aucune | l'historique des campagnes compte encore à partir de `notification_logs` (§4.3) |
| rafraîchir l'Aperçu et le Réseau (`loadOverview(true)`, `loadReseau(true)`) | aucune | le paramètre existe, aucun appel ne l'utilise (§4.5) |
| 30 jours glissants | l'Aperçu seulement | l'onglet Réseau compte depuis le 1er du mois (§4.2) |

### 7.3 Les changements de masse

**PROUVÉ (code).**
- **Changer le seuil ou le mode** d'un marchand reclasse tout l'historique des scans
  (badges, §4.8) ; les remises comptées par l'onglet Réseau, elles, sont figées au moment du
  scan. Les soldes affichés en « solde / seuil » changent de sens d'un coup.
- **Changer les seuils de répartition** redessine la répartition passée : c'est voulu, ce
  sont des seuils d'affichage.
- **Effacer des clients** (RGPD) les retire des porteurs, pas des actifs du mois (§4.9).

### 7.4 Ponytail

**Méthode.** Commande d'audit de Ponytail (v4.10.0) : une ligne par candidat, étiquetée
`delete` (code mort, souplesse inutile), `stdlib`, `native`, `yagni` (abstraction à une
seule utilisation, réglage que personne ne pose), `shrink` (même logique en moins de
lignes), classée par taille de coupe ; bilan en lignes. Ponytail exclut la justesse, la
sécurité et la performance : elles sont dans les constats. S'y ajoutent les règles du brief
(§5) : un garde-fou n'est jamais candidat sans protection équivalente, et une suppression
ne se propose que **sur preuve** d'usage nul. **Liste de candidats, pas feu vert** : chaque
suppression serait un chantier testé, décidé par Yass.

1. `shrink:` **l'agrégation de l'Aperçu en JavaScript** (`merchants.js:60-82` : liste de
   lignes, ensemble, table de comptage) : un comptage en base, comme `group_stats` (P1).
   ≈ −15 lignes, et le plafond de 1 000 lignes disparaît avec. [`src/routes/merchants.js`]
2. `shrink:` **deux reconstructions de « Récompense » et « Remise à zéro »** à partir de
   l'avant, de l'après et du seuil actuel (`dashboard/index.html:1358-1367`, `:1987-1989`) :
   une seule, qui lit `recompense_distribuee` (P7). ≈ −10 lignes. [`public/dashboard/index.html`]
3. `yagni?` **`montant_credite`**, calculé et écrit à chaque scan (`scan.js:140-148`, `:179`),
   lu par aucun code. ≈ −10 lignes et une colonne. **Condition** : qu'aucun écran ne doive
   l'afficher. La migration 031 et la règle du Socle le destinent à un affichage futur
   (points distribués par boutique, dashboard mono-site) : décision de Yass. [`src/routes/scan.js`]
4. `delete:` **le repli de l'historique des campagnes pour une réponse en tableau**
   (`dashboard/index.html:1877`) : le serveur renvoie toujours `{ logs, quota }`
   (`notifications.js:37-40`), et les deux sont déployés ensemble. −1 condition.
5. `delete:` **le paramètre `force` de `loadOverview` et `loadReseau`** (`:1058`, `:1131`),
   jamais passé à vrai. **Sauf** si P3 est retenue : il servirait alors au rafraîchissement.

**Écartés** (garde-fou, usage ou gain nul) : la fonction `cell()` de l'export CSV
(garde-fou contre l'injection de formules) ; l'export lui-même (2 usages en quatre mois,
T4, mais c'est une fonction payante du Pro+ : décision produit, pas de code) ; les
`COALESCE` des seuils dans `group_stats`, sur des colonnes `NOT NULL` (deux mots, une
migration pour rien) ; la migration 036, remplacée par la 039 (historique, pas du code) ;
la route `GET /api/clients/admin/all` (déjà listée par 00b, §6) ; le QR code calculé par le
serveur (la dépendance `qrcode` n'a pas d'équivalent natif).

**net : environ −25 lignes (−35 avec `montant_credite`), aucune dépendance npm.**

---

## 8. Seuils de rupture

Chaque seuil dans l'unité qui le provoque (brief §3). Durées locales (M1) ; en production,
de 1 à 6 fois plus lent à volume égal (calage T4, HYPOTHÈSE).

| Ce qui casse | Unité | Seuil | Aujourd'hui | Ce qui souffre en premier | Statut |
|---|---|---|---|---|---|
| Aperçu : actifs, rétention, fréquence faux et instables | scans sur 30 jours par marchand | 1 000, soit ≈ 33 par jour | 337 (Pizz'Amore) | l'Aperçu des réseaux et des gros mono-sites | PROUVÉ (hérité, T1) |
| « N clients », liste, recherche, export tronqués | porteurs par marchand | 1 000 | 283 (Dinapoli) | l'onglet Clients, l'export | PROUVÉ (hérité, T1) |
| Taux de rétention mécaniquement bas | âge de la base, clients inactifs | continu | 6 % à 67 % selon l'âge | l'Aperçu | PROUVÉ (T1) |
| « vs mois préc. » et répartition biaisés | jour du mois | chaque début de mois | une seule évolution affichée | l'onglet Réseau | PROUVÉ (D1) |
| Onglet Réseau en erreur, affiché vide | scans sur 90 jours d'un réseau | ≈ 1,6 million en local (10,5 s mesurées à 2 millions) ; 0,3 à 1,6 million en production | 351 (Pizz'Amore) | tout l'onglet | PROUVÉ (M1) / HYPOTHÈSE (production) |
| Admin : scans cumulés en erreur | scans cumulés, jamais purgés | ≈ 100 millions en local | 2 240 | le compteur global de l'admin | HYPOTHÈSE (extrapolation M1) |
| Admin : compteurs par marchand en erreur | porteurs de la plateforme | ≈ 25 millions en local | 1 730 | la liste admin (« – ») | HYPOTHÈSE (extrapolation M1) |
| Onglet Clients, export : tri trop long | porteurs par marchand | ≈ 30 à 40 millions en local | 283 | l'onglet Clients | HYPOTHÈSE (extrapolation M1) |

**Ce qui casse en premier.** Ni le débit ni la durée : **la justesse**. Le plafond de 1 000
lignes fausse l'Aperçu d'un réseau dès 33 scans par jour ; les définitions (§4.1 à §4.3)
faussent la lecture dès aujourd'hui.

---

## 9. Propositions

Chaque proposition dit ce qu'elle retire, ce qu'elle protège, son coût et ses limites.
**Aucune n'est un correctif** : l'audit ne corrige rien, Yass décide.

**P1 — Calculer l'Aperçu en base, comme l'onglet Réseau.** Une fonction en lecture seule,
avec la même discipline que `group_stats` et `admin_marchands_stats` (une seule signature,
toute métrique future dans le JSON).
- *Retire* : rien.
- *Protège* : le constat 7 (Aperçu juste et stable au-delà de 1 000 scans) ; prépare le
  dashboard mono-site au niveau réseau.
- *Coût* : une migration de fonction et la route `/me/stats`.
- *Limites* : ne change pas les définitions (P4, P5) ; la liste Clients et l'export gardent
  leur plafond (P1 bis : paginer, ou avertir au-delà de 1 000).

**P2 — Afficher une erreur comme une erreur.** Tester le statut de la réponse avant de la
ranger, ne pas garder une erreur en mémoire, afficher « Erreur de chargement » (Réseau) ou
« – » (Aperçu) plutôt que des zéros.
- *Retire* : rien.
- *Protège* : le constat 4, et le jour où une lecture dépassera 8 s.
- *Coût* : quelques lignes dans le dashboard (et dans `/me/stats`, qui ne lit pas ses
  erreurs, hérité F3).
- *Limites* : ne rend pas la lecture plus rapide.

**P3 — Vider toute la page à chaque changement de session, et permettre le
rafraîchissement.** Remettre à zéro toutes les données à la déconnexion **et** à
l'expiration ; recharger l'Aperçu après un scan fait depuis le dashboard, ou offrir un
bouton.
- *Retire* : rien.
- *Protège* : les constats 5 et 6.
- *Coût* : quelques lignes.
- *Limites* : un rafraîchissement automatique coûterait une lecture par scan ; le bouton
  n'en coûte aucune.

**P4 — Comparer à période égale.** « vs mois préc. » compté du 1er au même jour du mois
précédent ; répartition sur 30 jours glissants, ou sur le dernier mois complet.
- *Retire* : l'évolution « mois en cours contre mois complet », si Yass y tient.
- *Protège* : le constat 2.
- *Coût* : un `CREATE OR REPLACE` de `group_stats`, même signature (passation §14), et
  deux libellés.
- *Limites* : un réseau qui ouvre n'a toujours rien à comparer ; le libellé doit dire la
  période.

**P5 — Dire ce que la rétention mesure.** Décision produit : garder le chiffre et changer
son nom, ou le diviser par les actifs, ou montrer les deux (« 36 clients fidèles sur 54
actifs, et 103 clients sans passage depuis 30 jours »).
- *Retire* : le chiffre actuel sous son nom actuel.
- *Protège* : le constat 1.
- *Coût* : petit, une fois la définition choisie ; à faire avant P1 pour ne pas recopier la
  définition actuelle.
- *Limites* : aucune définition ne corrige l'absence de fuseau (§4.9).

**P6 — Un compte rendu de campagne en clients.** Compter les clients joints (« 173 clients :
120 sur iPhone, 53 sans iPhone »), et dire « acceptées » plutôt que « reçues ».
- *Retire* : le chiffre « N/M reçues » actuel.
- *Protège* : le constat 3.
- *Coût* : la route de l'historique (le registre, depuis le 25/09, donne déjà le détail par
  plateforme) et l'écran.
- *Limites* : l'installation réelle sur Android reste inconnue sans les rappels de Google
  (01, 04) ; « accepté » ne dit toujours pas « vu ».

**P7 — Historique et fiche client à partir de ce que la base sait.** Lire
`recompense_distribuee` et `montant_credite` au lieu de reconstruire les badges avec le
seuil actuel ; écrire « tampons » ou « pts » selon le mode.
- *Retire* : deux heuristiques de reconstruction (§7.4).
- *Protège* : le constat 9 et la dette #5, pour tout scan postérieur à la migration 031.
- *Coût* : deux colonnes de plus dans deux lectures, deux rendus.
- *Limites* : les scans antérieurs à la 031 n'ont pas ces colonnes (lignes « historique »,
  02 S6 : 403) ; il faut garder une reconstruction pour eux, ou les afficher sans badge.

**P8 (petite) — Un seuil bas de répartition utile.** Refuser 1 dans l'admin, ou afficher la
tranche « 1 passage » telle quelle.
- *Retire* : rien. *Protège* : la lisibilité de la répartition (§4.9). *Coût* : une ligne.
- *Limites* : aucune.

---

## 10. Corrections et compléments aux rapports antérieurs

Ces rapports ne sont pas modifiés ; la correction est consignée ici.

| Rapport | Ce qu'il disait | Ce qui est établi | Statut |
|---|---|---|---|
| 01 §5 | le taux d'envoi affiché au marchand est ininterprétable parce que les jetons Apple morts gonflent le dénominateur | l'essentiel de l'écart vient du **double compte** : chaque client compte une fois côté Google (toutes les cartes ont un lien) et une fois par appareil Apple ; les échecs ne sont que 4 sur 2 900 (T3) | PROUVÉ |
| 00b §11 ; passation §16 | `/me/stats` tronqué à 1 000 lignes, pour un mono-site au-delà de 1 000 scans sur 30 jours | confirmé ; il touche aussi l'Aperçu des **réseaux**, qui passe par la même route ; marge actuelle 663 (T1) | PROUVÉ |
| 00b C1 | L8 au plus à 322 (Pizz'Amore, 26/09) | 337 le 28/09 (T1, T4) | PROUVÉ |
| 00a §6.5 ; 00b §4.6 | plafond de 8 s probable pour `group_stats` et `admin_marchands_stats` à la cible | loin aujourd'hui (55 ms au pire, T4) ; hors de portée à la cible, seulement à des volumes de type e-commerce pour `group_stats` (M1) ; le plafond lui-même reste une HYPOTHÈSE (non redécouvert) | PROUVÉ (durées) / HYPOTHÈSE (plafond) |
| passation §13 | surfaces de comptage filtrées sur les scans annulés : `group_stats`, `/me/stats` ×2, admin | vérifié dans le code et par T1 (mêmes définitions) | PROUVÉ |
| 02 S5 | 0 scan au jeton marchand chez un réseau, sur 30 jours | compatible avec les 6 « non attribués » de Bangkok Factory : S5 ne comptait qu'après la création de la première boutique provisionnée (§4.9) | PROUVÉ (définition) / HYPOTHÈSE forte (dates) |

---

## 11. Ce que ce segment transmet

| Segment | À instruire |
|---|---|
| **Synthèse** | pas de gravité 1 ou 2 dans le périmètre ; **constat 12 (gravité 1, hors segment) avec le 02** : l'ajustement plafonné au seuil, à traiter dans le chantier de l'ajustement (02, P5) ; **constat 6 (gravité 4) avec les constats du 03** : vider la page à chaque changement de session ; P1 et P5 avant le dashboard mono-site ; une colonne de canal dans l'API machine (§6.2) ; les décisions produit de P4, P5 et P6 |
| 2 — scan et crédit | constat 12 ; l'historique et la fiche reconstruisent les remises avec le seuil actuel (§4.8) |
| 3 — accès et données | constat 6 (données du marchand précédent) ; la liste des clients sert aussi le compteur « N clients », qui n'a pas besoin des coordonnées (03, constat 7) |
| 6 — infrastructure | le fuseau du serveur (quota du mois à l'heure du serveur, §4.9) ; la table `scans` jamais purgée, relue en entier par l'admin (§5) ; le cache de l'instance (224 Mo) et `work_mem` (2 Mo) pour les lectures de gros volumes (M1) |

---

## 12. Hypothèses et angles morts

| Point | Statut | Comment trancher |
|---|---|---|
| Plafond de 8 s appliqué aux requêtes du serveur | HYPOTHÈSE (hérité de 00a) | documentation de la version de PostgREST déployée, ou mesure (segment 6) |
| Facteur de 1 à 6 entre la machine du conteneur et la production | HYPOTHÈSE (calage sur les petites lectures de T4) ; au-delà de la mémoire de l'instance, sans doute davantage | mesure sur un clone de production, ou `EXPLAIN ANALYZE` sur de gros volumes |
| Seuils d'erreur des lectures autres que `group_stats` | HYPOTHÈSE (extrapolation de M1, mesuré jusqu'à 2,3 millions de scans et 500 000 porteurs) | mesure au-delà |
| Fuseau du serveur Railway (mois du quota) | HYPOTHÈSE (UTC) | variable `TZ` ou journal de démarrage (segment 6) |
| Cartes encore installées parmi les « Porteurs » | NON VÉRIFIABLE | rappels de Google (01, 04) ; côté Apple, les enregistrements d'appareils |
| Pertes dues à l'ajustement plafonné (constat 12) | NON VÉRIFIABLE | aucune trace avant le 25/09 ; le registre ne garde pas le solde de départ |
| Occurrence réelle du constat 6 | NON VÉRIFIABLE | rien n'en garde trace |
| Écarts d'appels entre rubriques de T4 | HYPOTHÈSE (textes de requête changés au fil des versions) | sans effet sur la conclusion |
| Origine des 6 scans non attribués de Bangkok Factory | HYPOTHÈSE forte | date de création des boutiques et des scans |

---

## 13. Décisions de pilotage et décisions hors pilotage

Sur instruction de Yass, ce segment ne modifie pas `PASSATION_TECHNIQUE.md` : ce qui est
livré, les décisions et la dette découverte sont consignés ici.

**Livré** : ce rapport et `docs/audit/05-requetes.sql` (T1 à T4). Aucun code modifié,
aucune migration, aucune donnée lue hors comptages et métadonnées.
**Dette découverte** : §1, §4, §7.

**Décisions de pilotage**

| Date | Décision | Où elle joue |
|---|---|---|
| 27/09 | Plan validé ; périmètre étendu à l'admin et au compte rendu des campagnes | en-tête, §3.4, §3.5 |
| 27/09 | **Une visite = un scan.** L'écart dû aux scans rapprochés (plusieurs tampons en une visite, remise juste après le seuil) est une marge d'erreur acceptée : les chiffres « visites », « rétention », « passages » comptent des scans, et ce rapport ne propose pas de les corriger. T1 ne recalcule rien par visite. | §3.1, §3.2, §4.1 |
| 27/09 | Alerte de gravité 1 (ajustement plafonné au seuil) : pas de blocage ; consignée ici comme constat hors segment, transmise à la synthèse avec le 02 ; pas de requête de suivi | §4.10 |
| 27/09 | Constat f (données du marchand précédent) : consigné ici, transmis à la synthèse avec les constats du 03 | §4.6 |
| 27/09 | Noms de boutiques acceptés dans T2, comme les noms de marchands | T2 |
| 27/09 | T1 à T4 : lecture seule, comptages et métadonnées, testées, moins de 100 lignes, envoyées d'un coup | `05-requetes.sql` |
| 27/09 | Commit et push sur feu vert seulement, hors du passage de 08:00 UTC | — |
| 28/09 | Feu vert au commit et au push, après une vérification pour le dépôt public : aucun mode opératoire, aucune valeur réelle (ni UUID, ni e-mail, ni IP, ni secret) ; l'exposition du constat 6 reformulée en « qui et à quelles conditions » | §4.6 |

**Décisions hors pilotage** (prises par la session d'audit) :
- le **code source de PostgREST** (dépôt officiel, clone public) a été lu pour connaître la
  forme exacte des requêtes du serveur, et T4 rejouée sur cette forme ; la production peut
  tourner une version dont la forme diffère légèrement : les étiquettes de T4 ne reposent
  que sur les tables et colonnes lues ;
- une vérification de l'état du proxy du conteneur a été **refusée par l'environnement** et
  n'a pas été poursuivie ;
- T4 ne compte que les **requêtes de premier niveau** : une lecture interne à une fonction
  n'est jamais rangée dans une rubrique ;
- le **jeu d'essai**, le rejeu des écrans, les scripts de D1, D2 et M1 ne sont pas versés au
  dépôt ; leur méthode est décrite en annexe B ;
- **D1** repose sur une copie de `group_stats` fabriquée automatiquement à partir de la
  migration 039 ; les seules différences sont l'horloge et trois filtres de date,
  nécessaires parce que le jeu couvre plusieurs dates (annexe B) ;
- **D2** exécute dans Node les fonctions d'affichage extraites telles quelles du dashboard,
  avec un faux document ; aucun navigateur, aucun serveur ;
- **M1** a été mesurée avec les réglages mémoire de la production (T4) ; le facteur de 1 à
  6 vers la production est un calage sur de petites lectures (HYPOTHÈSE) ;
- le **crochet de fin de session** de l'environnement (pas du dépôt) a demandé un commit et
  un push des fichiers non suivis : refusé, conformément à la consigne de pilotage (feu vert
  d'abord) ;
- **Ponytail** : l'étiquette v4.10.0 du dépôt pointe sur `1d95ff7` (branche de publication) ;
  la lecture a été faite sur `e3ba2aa` (branche principale), comme en 02 et 04 ; la commande
  d'audit est identique dans les deux (comparaison des fichiers).

---

## Annexe A — Résultats bruts (production, matin du 28/09, UTC)

**T1** — l'Aperçu, marchand par marchand. Colonnes : programme · boutiques · clients ·
base (jours) · scans aujourd'hui (UTC) · scans sur 30 j · marge avant 1 000 · actifs ·
dont effacés · au moins 2 scans · rétention affichée · fréquence affichée.

| Marchand | prog. | bout. | clients | base | auj. | 30 j | marge | actifs | eff. | ≥ 2 | rét. | fréq. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Pizz'Amore | points | 5 | 226 | 36 | 0 | 337 | 663 | 184 | 0 | 62 | 27 | 1,8 |
| Dinapoli | points | 0 | 283 | 17 | 0 | 283 | 717 | 259 | 0 | 18 | 6 | 1,1 |
| Boucherie République | points | 0 | 231 | 18 | 0 | 256 | 744 | 202 | 0 | 35 | 15 | 1,3 |
| Hilal Kebab | stamps | 0 | 58 | 11 | 0 | 172 | 828 | 47 | 0 | 39 | 67 | 3,7 |
| Magic Cleaning | stamps | 0 | 157 | 75 | 0 | 138 | 862 | 54 | 0 | 36 | 23 | 2,6 |
| Nails By Ness | stamps | 0 | 72 | 6 | 0 | 138 | 862 | 62 | 0 | 38 | 53 | 2,2 |
| Wam N Fade | points | 0 | 115 | 88 | 0 | 112 | 888 | 72 | 0 | 27 | 23 | 1,6 |
| Asie Express | points | 0 | 53 | 13 | 0 | 42 | 958 | 27 | 0 | 8 | 15 | 1,6 |
| L'IWAN | stamps | 0 | 31 | 20 | 0 | 40 | 960 | 21 | 0 | 12 | 39 | 1,9 |
| La Passerelle Indienne | stamps | 0 | 68 | 40 | 0 | 30 | 970 | 22 | 0 | 7 | 10 | 1,4 |
| Bluemoon Boston | stamps | 0 | 42 | 72 | 2 | 26 | 974 | 15 | 0 | 8 | 19 | 1,7 |
| Shop By Ness | points | 0 | 19 | 6 | 0 | 18 | 982 | 17 | 0 | 1 | 5 | 1,1 |
| Hamza Salon | stamps | 0 | 1 | 58 | 0 | 18 | 982 | 1 | 0 | 1 | 100 | 18,0 |
| Crep' & Coffee | points | 0 | 24 | 16 | 0 | 16 | 984 | 13 | 0 | 2 | 8 | 1,2 |
| Demo Winwin Card | stamps | 0 | 83 | 85 | 0 | 15 | 985 | 14 | 0 | 1 | 1 | 1,1 |
| Maybach | stamps | 0 | 11 | 16 | 0 | 14 | 986 | 8 | 0 | 2 | 18 | 1,8 |
| NARA | stamps | 0 | 8 | 20 | 0 | 11 | 989 | 2 | 0 | 2 | 25 | 5,5 |
| Bangkok Factory | points | 2 | 15 | 20 | 0 | 7 | 993 | 7 | 0 | 0 | 0 | 1,0 |
| LDC Kitchen + Coffee | stamps | 0 | 2 | 56 | 0 | 4 | 996 | 1 | 0 | 1 | 50 | 4,0 |
| Le Grand Buffet Indien | stamps | 0 | 3 | 24 | 0 | 2 | 998 | 1 | 0 | 1 | 33 | 2,0 |
| WinWin Card DEMO | stamps | 0 | 151 | 116 | 0 | 1 | 999 | 1 | 0 | 0 | 0 | 1,0 |

Sans scan sur 30 jours (marge 1 000, tous les autres chiffres à 0) : Kasa Grill 25 clients
(base 117 j), Shawerman 8 (18), Pizza Sabbioni 7 (103), Central Coffee 4 (125), Nina
Salon 4 (65), Carbon Gaming 3 (87), MK Barbershop 3 (64), Naan 3 (32), Absolute Zero 2
(85), Cairo Gourmet 2 (83), Isabella's Italian Street Kitchen 2 (74), MK Café 2 (65),
Bella 1 (113), Chef Kitchen 1 (103), Démo France 1 (6), Kasa Grill Meyzieu 1 (83),
Kerwen flowers 1 (88), La Mezcaleria 1 (67), Naan Sweet 1 (32), Nail'd It Dubai 1 (81),
Ray Test 1 (43), Spa Salon 1 (86), Teatro 1 (88), Uncle Thai 1 (12). 45 lignes au total.

**T2** — l'onglet Réseau (27,3 jours écoulés, fuseau UTC).

| Réseau | Porteurs | Actifs 30 j | Nouveaux | Retour | Mobilité | Non attribués | Répartition du mois | Sur 30 j | Seuils |
|---|---|---|---|---|---|---|---|---|---|
| Bangkok Factory | 15 | 7 | 15 | 0 % | 0 | 6 | 7 / 0 / 0 | 7 / 0 / 0 | 5–10 |
| Franchise Test | 0 | 0 | 0 | 0 % | 0 | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 5–10 |
| Pizz'Amore | 226 | 184 | 223 | 1 % | 3 | 0 | 0 / 173 / 10 | 0 / 173 / 11 | 1–4 |

| Réseau | Boutique | Scans | Mois préc. | vs mois préc. affiché | Mois préc. à période égale | À période égale | Clients servis | Récompenses |
|---|---|---|---|---|---|---|---|---|
| Bangkok Factory | Dormoy | 1 | 0 | — | 0 | — | 1 | 0 |
| Bangkok Factory | Gruner | 0 | 0 | — | 0 | — | 0 | 0 |
| Franchise Test | Lyon | 0 | 0 | — | 0 | — | 0 | 0 |
| Franchise Test | Puz | 0 | 0 | — | 0 | — | 0 | 0 |
| Pizz'Amore | Bron | 130 | 0 | — | 0 | — | 80 | 4 |
| Pizz'Amore | Villeurbanne | 105 | 13 | +708 % | 0 | — | 63 | 2 |
| Pizz'Amore | St Priest | 43 | 0 | — | 0 | — | 26 | 2 |
| Pizz'Amore | Saxe | 30 | 0 | — | 0 | — | 8 | 3 |
| Pizz'Amore | Etats Unis | 16 | 0 | — | 0 | — | 11 | 0 |

Aucune boutique archivée affichée.

**T3** — le compte rendu des campagnes. Colonnes : campagnes · dernière · total affiché
(Apple + Google) · reçues affichées · clients à la date · total affiché par client.
Aucune campagne « sans appareil ».

| Marchand | Camp. | Dernière | Total affiché | Reçues | Clients | Par client |
|---|---|---|---|---|---|---|
| Boucherie République | 10 | 25/09 | 1 928 (780 + 1 148) | 1 928 | 1 148 | 1,68 |
| Wam N Fade | 3 | 31/08 | 384 (206 + 178) | 384 | 178 | 2,16 |
| Bluemoon Boston | 4 | 17/09 | 225 (105 + 120) | 225 | 120 | 1,88 |
| WinWin Card DEMO | 1 | 07/09 | 218 (69 + 149) | 218 | 149 | 1,46 |
| Kasa Grill | 6 | 07/06 | 35 (6 + 29) | 34 | 29 | 1,21 |
| Central Coffee | 3 | 24/06 | 24 (12 + 12) | 24 | 12 | 2,00 |
| L'IWAN | 4 | 10/09 | 20 (12 + 8) | 17 | 8 | 2,50 |
| Naan | 2 | 27/08 | 12 (6 + 6) | 12 | 6 | 2,00 |
| Carbon Gaming | 2 | 07/07 | 9 (4 + 5) | 9 | 5 | 1,80 |
| Hamza Salon | 4 | 26/09 | 8 (4 + 4) | 8 | 4 | 2,00 |
| Nails By Ness | 1 | 22/09 | 7 (3 + 4) | 7 | 4 | 1,75 |
| Demo Winwin Card | 1 | 07/07 | 5 (2 + 3) | 5 | 3 | 1,67 |
| Absolute Zero | 2 | 04/07 | 4 (2 + 2) | 4 | 2 | 2,00 |
| Bangkok Factory | 1 | 08/09 | 4 (2 + 2) | 4 | 2 | 2,00 |
| Chef Kitchen | 2 | 24/06 | 4 (2 + 2) | 4 | 2 | 2,00 |
| Dinapoli | 1 | 11/09 | 4 (2 + 2) | 4 | 2 | 2,00 |
| Hilal Kebab | 1 | 17/09 | 4 (2 + 2) | 4 | 2 | 2,00 |
| Ray Test | 2 | 15/08 | 3 (1 + 2) | 3 | 2 | 1,50 |
| Asie Express | 1 | 14/09 | 2 (1 + 1) | 2 | 1 | 2,00 |
| **TOTAL** | **51** | 26/09 | **2 900 (1 221 + 1 679)** | **2 896** | **1 679** | **1,73** |

Registre (envois manuels depuis le 25/09) : Hamza Salon seulement : Apple 4 envois,
4 acceptés ; Google 4 envois, 4 acceptés, dont 4 sur une carte iPhone ; 4 lots au
registre pour 4 campagnes comptées au quota. Tous les autres marchands : 0.

**T4** — durées, réglages, volumes.

| Rubrique | Appels | Moyenne (ms) | Max (ms) |
|---|---|---|---|
| réseau : `group_stats` | 12 | 11,7 | 30,9 |
| admin : compteurs par marchand (`admin_marchands_stats`) | 44 | 12,6 | 54,6 |
| aperçu : clients au total | 1 002 | 2,4 | 30,0 |
| aperçu : scans aujourd'hui | 532 | 0,5 | 8,4 |
| aperçu : scans des 30 jours (liste) | 765 | 2,7 | 30,7 |
| admin : clients totaux | 669 | 2,0 | 36,2 |
| admin : scans cumulés | 669 | 2,5 | 35,6 |
| admin : marchands actifs | 669 | 2,0 | 18,8 |
| notifications : quota du mois | 351 | 0,5 | 7,3 |
| notifications : historique des campagnes | 317 | 0,7 | 4,7 |
| clients : liste | 481 | 0,7 | 18,9 |
| clients : export CSV | 2 | 0,0 | 0,1 |
| scans : historique | 430 | 3,7 | 36,1 |
| fiche client : 10 derniers scans | 524 | 0,5 | 5,0 |

Mesure : `stats_reset` = 2026-05-23 22:34:06 UTC ; 1 561 entrées enregistrées, tous rôles ;
0 entrée illisible. Réglages : PostgreSQL 17.6 ; `work_mem` 2 184 kB ; `shared_buffers`
224 MB ; `effective_cache_size` 384 MB ; `max_parallel_workers_per_gather` 1 ; `jit`
off ; `random_page_cost` 1,1 ; `TimeZone` UTC ; `pg_stat_statements.max` 5 000,
`track` top. Volumes : 1 730 clients non effacés ; 2 240 scans non annulés cumulés ;
56,0 scans par jour sur 30 jours ; pire jour UTC 141 scans ; plus gros réseau sur 90 jours
Pizz'Amore (351 scans) ; plus gros marchand sur 30 jours Pizz'Amore (337) ; plus gros
stock de clients Dinapoli (283) ; 51 campagnes ; table `scans` 0,77 Mo, `clients` 0,89 Mo
(index compris).

---

## Annexe B — Démonstrations et mesures (base locale)

**D1 — Un mois entamé contre un mois complet.** Copie de `group_stats` fabriquée à partir du
texte de la migration 039 par un script qui ne remplace que l'horloge : `now()` devient un
paramètre (4 occurrences) ; les scans et clients postérieurs à ce paramètre sont écartés
(3 filtres). La comparaison des deux textes ne montre que ces différences. Données : un
marchand, une boutique, 60 clients, 10 scans par jour de 08:00 à 17:00 UTC du 01/06 au
10/10, chaque client passant une fois tous les 6 jours, sans interruption. Résultats :
tableau du §4.2.

**D2 — L'onglet Réseau face à une erreur.** Script Node qui extrait de
`dashboard/index.html`, sans les modifier, `I18N` et `t` (`:722-887`), `esc` (`:2154-2156`),
`rsEvolCell` et `renderReseau` (`:1142-1214`), les exécute dans un contexte isolé avec un
faux document, puis affiche le texte visible. Réponse d'erreur : texte cité au §4.4.
Témoin, une réponse normale (valeurs de Pizz'Amore) : « 👥 226 Porteurs · 🔥 184 Actifs
(30 j) · ✨ 223 Nouveaux ce mois · 🔄 1% Taux de retour · Porteurs fréquentant plusieurs
boutiques : 3 · moins de 1 — 0% (0) · 1–4 — 95% (173) · plus de 4 — 5% (10) … ».

**M1 — Le volume où chaque lecture approcherait 8 s.** Les dix lectures des écrans
(fonctions telles quelles, comptages et listes dans la forme des routes), trois passages,
médiane, avec les réglages de la production relevés par T4 (`work_mem` 2 184 kB, `jit`
off, `max_parallel_workers_per_gather` 1, `random_page_cost` 1,1, `effective_cache_size`
384 MB, `shared_buffers` 224 MB). Machine : conteneur de l'audit, 4 vCPU, 16 Go. Fond
constant à la cible (99 marchands de 1 000 porteurs, 30 scans par jour chacun) ; le réseau
mesuré a en plus autant de scans plus anciens que 90 jours à 100 000 et à 1 million, aucun
à 2 millions (même total de scans que la colonne précédente).

| Lecture (ms) | Taille de la production | Cible + réseau de 100 000 scans | Cible + réseau de 1 million de scans | Cible + réseau de 2 millions de scans |
|---|---|---|---|---|
| volume | 1 701 porteurs, 2 284 scans ; réseau 578 scans sur 90 j, 480 porteurs | 119 000 porteurs, 467 300 scans ; réseau 100 000 scans, 20 000 porteurs | 299 000 porteurs, 2 267 300 scans ; réseau 1 000 000 de scans, 200 000 porteurs | 499 000 porteurs, 2 267 300 scans ; réseau 2 000 000 de scans, 400 000 porteurs |
| `group_stats` (réseau) | 9,9 | 386 | **4 216** | **10 518** |
| `admin_marchands_stats` | 2,0 | 56 | 93 | 158 |
| aperçu : clients au total | 0,4 | 7,2 | 40 | 46 |
| aperçu : scans du jour | 0,3 | 1,3 | 5,4 | 11 |
| aperçu : scans 30 j (liste bornée) | 0,5 | 2,3 | 3,7 | 4,6 |
| admin : clients totaux | 0,4 | 22 | 32 | 46 |
| admin : scans cumulés | 0,6 | 43 | 165 | 175 |
| liste clients (tri, 1 000) | 0,8 | 9,2 | 49 | 84 |
| export (tri, 1 000) | 0,6 | 9,6 | 49 | 91 |
| historique des scans (100) | 0,3 | 0,6 | 0,6 | 0,7 |

Le temps de `group_stats` croît un peu plus vite que le volume (×2,5 entre 1 et 2 millions) :
avec 2 Mo de mémoire de travail, ses tris débordent sur disque. Le seuil de 8 s tombe vers
1,6 million de scans sur 90 jours en local (interpolation entre les deux mesures).

Calage sur la production (T4, moyennes) : `group_stats` 11,7 ms contre 9,9 ms en local
pour un réseau plus gros ; `admin_marchands_stats` 12,6 ms contre 2,0 ms ; comptages 2 à
2,5 ms contre 0,4 à 0,6 ms (en production, la forme PostgREST ajoute la construction d'une
réponse JSON de 1 000 lignes au plus). D'où un facteur de 1 à 6, retenu comme HYPOTHÈSE ;
au-delà de ce que la mémoire de l'instance peut garder (cache partagé de 224 Mo), la
production lirait davantage sur disque.

## Annexe C — Commandes reproductibles

```bash
# Le code audité est celui de la production
git diff --stat ca0579a 14d67a7 -- winwincard/                        # vide

# Les chiffres de l'Aperçu et leur calcul
sed -n 57,83p winwincard/backend/src/routes/merchants.js

# L'onglet Réseau range une réponse d'erreur comme des chiffres, et la garde
sed -n 1131,1140p winwincard/backend/public/dashboard/index.html

# Aucun rafraîchissement de l'Aperçu ni du Réseau
grep -n "loadOverview(true\|loadReseau(true" winwincard/backend/public/dashboard/index.html   # rien

# Ce que vident l'expiration de session et la déconnexion
sed -n 918,921p winwincard/backend/public/dashboard/index.html
sed -n 965,971p winwincard/backend/public/dashboard/index.html
sed -n 1027,1032p winwincard/backend/public/dashboard/index.html

# « N/M reçues »
sed -n 150,157p winwincard/backend/src/routes/notifications.js
sed -n 1901,1906p winwincard/backend/public/dashboard/index.html

# montant_credite n'est lu nulle part
grep -rn "montant_credite" winwincard/backend/src winwincard/backend/public    # écriture seule (scan.js)

# L'ajustement plafonné au seuil (hors segment)
sed -n 2072,2078p winwincard/backend/public/dashboard/index.html
git log --follow --format='%h %ad %s' --date=short -G'val > (S\.)?maxValue' -- winwincard/backend/public/dashboard/index.html

# Forme des requêtes du serveur (PostgREST, dépôt officiel)
git clone --depth 1 https://github.com/PostgREST/postgrest.git
grep -n "pgrst_source_count\|pg_catalog.count" postgrest/src/library/PostgREST/Query/SqlFragment.hs
```

Base de référence : méthode de 00a (annexe B), plus les droits `service_role` des 7 tables
et `pg_stat_statements` ; requêtes : `docs/audit/05-requetes.sql`. Les scripts de D1, D2
et M1 ne sont pas versés au dépôt ; leur méthode est décrite en annexe B.

## Annexe D — Sources extérieures

| Source | Version, lieu | Ce qui y est lu |
|---|---|---|
| PostgREST | dépôt officiel `PostgREST/postgrest`, commit `8d8dd23` (écrit le 24/09/2026, intégré le 27/09), lu le 28/09 | forme des lectures (`Query/Statements.hs`, `mainRead`, `mainCall`) ; comptage exact en `pg_catalog.count(*)` sur `pgrst_source_count` (`Query/SqlFragment.hs`, `countF`) ; `IS NULL`, `ORDER BY … DESC` ; appel d'une fonction par `"public"."nom"(…)` (`Query/QueryBuilder.hs`) |
| Ponytail | github.com/dietrichgebert/ponytail, v4.10.0 (`e3ba2aa` ; l'étiquette pointe sur `1d95ff7`, commande d'audit identique) | commande d'audit (`commands/ponytail-audit.toml`, `skills/ponytail-audit/SKILL.md`) |
