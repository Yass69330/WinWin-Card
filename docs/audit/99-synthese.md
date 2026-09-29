# Audit WinWin — Synthèse (99) : état de santé, capacité, roadmap

> Dernier document de l'audit global (brief §6, §8). Il confronte les rapports 00a, 00b,
> 01 à 06 et A à la destination : **100 points de vente, environ 100 000 porteurs**. Il
> produit la roadmap technique, ordonnée **d'abord par les dépendances, ensuite par la
> gravité, jamais par la facilité**.
> Il ne corrige rien. Chaque affirmation renvoie au rapport et à la section qui la prouvent,
> sous la forme « (02 §4.2) ». Le dépôt est public : aucun mode opératoire, aucune valeur
> réelle (ni clé, ni identifiant, ni adresse).

| | |
|---|---|
| **Date** | 2026-09-29 |
| **Code audité** | celui de `ca0579a`, en production depuis le 25/09 à 22:08 UTC. Les commits suivants de la branche ne touchent que la documentation (en-têtes de 02 à 06). |
| **Sources** | `BRIEF.md`, `00a-photo.md`, `00b-cartographie.md`, `01-notifications.md` à `06-infrastructure.md`, `A-scalabilite-anterieure.md`, leurs fichiers de requêtes, `PASSATION_TECHNIQUE.md`, `CLAUDE.md` |
| **Méthode** | synthèse des rapports, sans requête nouvelle. Deux ajouts seulement : une lecture du code pour le cas relevé en exploitation (l'historique des 100 derniers scans, §10.3) ; des ratios recalculés sur les 17 marchands en production, à partir des résultats déjà publiés (05 T1, 04 K3), §5.1 |
| **Parc réel** | 47 marchands en base selon Yass (48 dans les relevés du 26 au 28/09), dont **17 en production** : Dinapoli, Bluemoon Boston, Wam N Fade, Pizz'Amore, Magic Cleaning, Boucherie République, Shop By Ness, Nails By Ness, La Passerelle Indienne, Asie Express, Shawerman, NARA, L'IWAN, Hilal Kebab, Maybach, Crep' & Coffee, Bangkok Factory. Plusieurs ont démarré récemment ; leur usage du programme n'est pas encore installé (précision de Yass). |

**Statuts** : **PROUVÉ** (vérifiable par la source citée) · **HYPOTHÈSE** (raisonnement non
vérifié ; ce qui le trancherait est indiqué) · **NON VÉRIFIABLE** (la preuve n'existe pas ou
n'est pas accessible).
**Gravités** (brief §4) : **1** argent des clients · **2** trafic machine · **3** scan au
comptoir · **4** données et accès · **5** notifications · **6** carte dans le téléphone ·
**7** statistiques · **8** apparence.

---

## 1. En une lecture

**Ce qui va bien.** La plateforme fait ce qu'elle doit. Les soldes sont justes : le crédit se
fait sous verrou et aucun solde n'est incohérent (02 §1, §4.9). La carte affiche le bon solde
(04 §1). La base de production est exactement celle du dépôt (00a §1). Et la charge
d'aujourd'hui est très loin des limites : la base passe 0,002 % de son temps à répondre au
serveur, qui coûte 2,64 $ d'usage par mois (06 §1).

**Ce qui est urgent.**
1. **La clé qui ouvre la base cessera de fonctionner d'ici la fin de 2026.** Ce jour-là, tout
   s'arrête : scan, inscriptions, cartes, dashboards (06 §2, n° 1).
2. **Deux choses irremplaçables n'ont qu'un exemplaire.** Le secret `JWT_SECRET`, dont la
   perte figerait toutes les cartes Apple installées (06 §5.4). Et les sauvegardes, qui
   disparaîtraient avec le compte Supabase ; une restauration ferait perdre jusqu'à une
   journée de crédits (06 §6).
3. **Quatre échéances tombent en huit semaines au printemps 2027** : l'adhésion Apple, le
   domaine, les premiers jetons de caisse d'un an, le certificat des cartes Apple (06 §2).

**Ce qu'il faut décider** (détail au §9.1, par ordre d'impact) : comment protéger les données ;
comment rattraper une erreur de caisse quand l'annulation n'est plus proposée ; le sort du
parrainage ; ce que fait une borne face à un client qui a atteint sa récompense, et l'unité
des montants envoyés par une caisse ; la forme de l'e-commerce.

**Ce qui ne presse pas, et pourquoi.** Aucun défaut d'argent ne se produit en ce moment :
aucun crédit sans ligne de journal depuis l'ouverture du registre, le 25/09 (02 §4.1).
Mais aucun correctif d'argent ne doit partir avant le filet de tests (§4, étape 10).

---

## 2. Les questions de Yass, les réponses

### L'état actuel

**1. La plateforme est-elle saine aujourd'hui ?**
Oui, pour ce qu'elle fait chaque jour : la base est celle du dépôt, le crédit se fait sous
verrou, la carte affiche le bon solde, les chiffres sont calculés comme le code le dit, et la
charge est très loin des limites. Sa faiblesse est ailleurs : elle ne sait pas se défendre
quand quelque chose casse au milieu d'un scan (une réponse perdue, un redéploiement), et
personne ne voit une panne avant un commerçant. → §3.1

**2. En l'état, qu'est-ce qui ferait couler le bateau ?**
Pas un volume, mais des dates et des points uniques. La clé historique supprimée par Supabase
fin 2026 : arrêt total. La perte ou le piratage du compte GitHub, qui ouvre Railway et
Supabase, donc la base et ses sauvegardes. La perte de `JWT_SECRET` : toutes les cartes Apple
figées pour toujours. Le domaine ou l'adhésion Apple non renouvelés au printemps 2027.
Demain, une machine branchée sans protection contre le double crédit. → §3.2, §6

**3. Qu'est-ce qui est urgent ?**
Avant la fin de 2026 : remplacer la clé historique, après avoir fait échouer tout déploiement
qui ne joint pas la base (étapes 1 et 2). Tout de suite, parce que c'est irremplaçable :
décider de la protection des sauvegardes, copier `JWT_SECRET` hors de Railway, noter les
dates de 2027 avec leur renouvellement automatique (étapes 3 et 4). Les correctifs d'argent
sont importants, pas urgents : ils attendent le filet de tests. → §4, §6

**4. Qu'est-ce qui dépend d'une seule personne, d'un seul compte ou d'une seule machine ?**
Le compte GitHub : il commande Railway, Supabase et chaque mise en production ; le perdre,
c'est tout perdre, sauvegardes comprises. `JWT_SECRET` : une seule copie connue. Le mot de
passe admin, unique, qui permet d'atteindre n'importe quel solde. Un seul process, une seule
instance, une région, un projet Supabase qui porte aussi ses sauvegardes, un domaine. Et
Yass, seul à passer les migrations et à rendre l'accès aux marchands. → §3.3

### La croissance

**5. Tiendra-t-elle à 100 points de vente et 100 000 porteurs ?**
Pas en l'état, mais pas faute de puissance. Lâchent d'abord les lectures limitées à 1 000
lignes, dès qu'un marchand dépasse 1 000 porteurs ou 33 scans par jour : relances envoyées à
tort, listes et campagnes amputées. Puis la mémoire de la base, vers 35 000 à 40 000
porteurs. À 100 000, un passage du cron d'environ 1 h 10 à 1 h 20 (jusqu'à 2 h si la moitié
du parc devient inactive), en plein midi à Dubaï. → §5

**6. Un réseau de 10 à 15 boutiques en plein rush, aujourd'hui ?**
Le débit, oui : 8 scans par minute sont déjà absorbés, et deux caisses ne se gênent que sur
une même carte. La justesse, non : pour tout le réseau, l'Aperçu et les relances se faussent
dès 33 scans par jour, soit 2 à 3 par boutique ; les campagnes s'arrêtent à 1 000 cartes ;
une révocation ou l'échéance des jetons d'un an bloque toutes les caisses ensemble, sur un
message brut. Avant : les étapes 11, 12, 17 et 21 de la roadmap. → §4, §5

**7. Le scan est-il aussi rapide à Dubaï qu'en France ?**
Non : environ 1,1 à 1,3 s à Dubaï, contre environ 1,0 s estimé en France, et jusqu'à 1,8 s
après dix minutes sans scan. La base calcule en 12 ms ; 0,8 s sont des allers-retours entre
la Californie et Paris, communs aux deux marchés. Installer le serveur en Europe (étape 6) et
écrire le scan en une seule transaction (étape 11) retirent l'essentiel. Dubaï gardera une
centaine de millisecondes d'écart : aucune région Railway n'est plus proche (HYPOTHÈSE). → §4, §5.3

**8. Combien coûtera l'infrastructure à 20 000, 50 000 et 100 000 porteurs ?**
Aujourd'hui, environ 40 à 45 $ par mois pour tout (Socle), dont 5 $ de Railway. À 20 000 et
50 000 : le même ordre, car Railway reste dans son offre de base et l'instance de la base
passe à la taille suivante au même prix. À 100 000 : une instance plus grosse est probable
(prix non relevé), et environ 100 $ par mois de plus si tu choisis la restauration à la
minute près. HYPOTHÈSE. → §5.4

### Les projets

**9. Chacun de mes projets est-il faisable, et à quelle condition ?**
Bornes et caisses : oui, après la protection contre le double crédit et une API avec ses
propres clés. E-commerce : après des prérequis lourds, et sa forme mérite d'être revue.
Landing enrichie, dashboard mono-site, cartes saisonnières : prérequis légers. Notifications
programmées, relance configurable, segmentation, push par boutique : après les lectures sans
plafond et un envoi par lots. Géolocalisation : faisable sous conditions. Structure UAE :
hors périmètre technique. → §7.1

**10. Qu'est-ce qui existe déjà, et qu'est-ce qui est entièrement à construire ?**
Se réutilisent : le crédit sous verrou, l'annulation (un modèle pour les machines), le
multi-boutiques et son onglet Réseau, la landing premium (e-mail, téléphone, anniversaire,
consentement), le cron et le registre des envois, la bascule de design déjà progressive. Sont
à construire : les clés d'intégration et la route des machines, un planificateur qui survit
aux redémarrages, le ciblage en base, les coordonnées des boutiques, le produit favori. → §7.2

**11. Quels projets dépendent les uns des autres, lesquels partagent une brique ?**
Trois familles. Bornes, caisses et e-commerce partagent l'API d'intégration, dans cet ordre.
Segmentation, push par boutique, notifications programmées et relance configurable partagent
le ciblage en base, l'envoi par lots et le plafond de relance : ils gagnent à être construits
ensemble. La landing enrichie alimente la géolocalisation (produit favori) et la segmentation
(boutique d'inscription). → §7.3

**12. Quels projets touchent à l'argent ou au scan ?**
Bornes, caisses et e-commerce créditent sans humain : gravités 1 et 2. Les cartes
saisonnières et les campagnes massives touchent le scan indirectement : rendus d'images qui
bloquent le serveur, cartes verrouillées pendant une campagne. Peuvent avancer sans risque
pour l'argent et le scan : la landing enrichie, le dashboard mono-site, la segmentation, la
partie carte de la géolocalisation. → §7.4

**13. Quelle charge chaque projet ajoute-t-il ?**
Un crédit de borne ou de caisse coûte ce que coûte un scan : une carte Apple régénérée, deux
autres vérifiées, une mise à jour et un message Google. Il pose problème au troisième crédit
du jour sur une même carte (quota Google), et en rafale derrière le limiteur par adresse.
L'e-commerce ajoute des inscriptions qui attendent Google et approche les limites de
l'onglet Réseau vers 3 500 crédits par jour et par réseau. Les envois de masse pèsent sur le
service web Apple. → §7.5

**14. Quelles limites d'Apple et de Google brident un projet ?**
Google : 3 notifications par carte et par 24 h, 10 messages au plus par carte, dos de carte
jamais remis à jour, quotas d'API inconnus. Apple : une poussée réveille le téléphone entier,
qui revérifie toutes ses cartes WinWin, et iOS n'affiche pas deux fois le même texte. Parades :
un message par visite et non par crédit, des textes qui changent, la bascule au fil des scans,
un plafond de relance. → §7.6

**15. Bornes, caisses, e-commerce : que garantir avant qu'une machine crédite sans humain ?**
Qu'un renvoi ne crédite jamais deux fois. Que crédit, journal et carte s'écrivent ensemble.
Que la machine puisse demander si son crédit est passé. Qu'elle ait sa propre clé, révocable
et limitée. Que le montant ait une unité et un plafond. Qu'on ait décidé quoi faire d'un
client au seuil. Et, dès le premier jour, qu'on sache de quel canal vient chaque crédit. → §7.7

**16. Cartes saisonnières : au fil des scans ou en masse ?**
Au fil des scans, sur les deux plateformes : le code le fait déjà pour l'image et la couleur,
sans coût de masse. Limites : sur Apple, un client inactif garde l'ancien design ; sur Google,
logo et nom basculent d'un coup et le dos ne change pas. En masse, à 100 000 porteurs :
environ 81 000 cartes Apple régénérées (8 Go) et 100 000 mises à jour Google, à étaler.
Préalable : l'étape 18. → §7.8

**17. Un projet est-il disproportionné, ou à revoir dans sa forme ?**
L'e-commerce est le seul qui change l'ordre de grandeur des volumes. Réduit à « créditer des
cartes existantes », il réutilise la brique des bornes ; « créer des porteurs par vagues »
demande de découper le serveur en plusieurs process. La bascule saisonnière en masse coûte
beaucoup pour ce que le mode progressif fait déjà. Une relance « configurable en fréquence »
sans plafond multiplierait le travail dans le vide. → §7.9

**18. Un choix actuel me ferme-t-il une porte, mailing, SMS et IA compris ?**
Oui, quatre : des identités écrites en dur dans le code (domaine, identité Apple, « pays :
Émirats » pour tous les marchands) ; un même secret pour les sessions et les cartes Apple ;
aucune trace du canal d'un crédit ni de la boutique d'inscription, deux portes qui se ferment
avec le temps. Mailing et SMS : pas de porte fermée, mais un consentement écrit sans
vérification. Assistant IA : il faudrait un accès en lecture seule distinct de la clé unique
qui ouvre toute la base. → §8

### L'action

**19. Que puis-je sacrifier, et qu'est-ce que je perds à chaque fois ?**
Des réglages, jamais l'argent, le scan ni les machines : plafonner la relance par épisode, ne
plus repousser un texte identique, ne plus envoyer de message Google aux cartes iPhone,
dessiner la barre de points par paliers, retirer des outils sans usage. Chaque sacrifice dit
ce qu'il retire au commerçant et au client. Accepter de perdre une journée de crédits à la
restauration serait un sacrifice de gravité 1 : le brief ne l'admet pas. → §9.2

**20. Dans quel ordre travailler, et pourquoi ?**
D'abord la date qui arrête tout (la clé). Puis ce qui est irremplaçable, le serveur en
Europe, la supervision et le verrouillage : autant de réglages sans code d'argent. Ensuite,
rendre la base reconstructible et poser le filet de tests, car rien ne touche l'argent
avant. Puis l'argent, le comptoir (mesuré par un test de charge), ce qui grossit avec le
stock, et enfin les projets, chacun derrière ses briques. → §4

**21. Que doit relire en priorité le développeur qui supervisera ?**
Cette synthèse (§4 et §9). La passation §3, §5, §14 et §15 ter, avec les écarts relevés par
l'audit. Le 02 §3 et §10 (la chaîne du scan et ses tests). Le 06 §2, §5 et §6 (calendrier,
redéploiement, sauvegardes). Le 00a §5.1 (droits absents du dépôt). Le 04 §4.2 et §6.4. Dans
le code : `scan.js`, les migrations 023 et 038, l'ajustement de `clients.js`, `auth.js`. → §11

**22. Qu'est-ce que je dois décider moi-même ?**
Par ordre d'impact : la protection des données ; le rattrapage d'une erreur de caisse (trois
questions) ; le parrainage ; ce que fait une borne face à un client au seuil, et l'unité des
montants d'une caisse ; la forme de l'e-commerce. Puis le moment d'une éventuelle rotation du
secret, l'heure du cron, le plafond de relance, le mode des cartes saisonnières, les
définitions des statistiques et le nettoyage. → §9.1

---
## 3. L'état de santé

### 3.1 Par gravité

| G | Ce qui tient | Ce qui fait défaut | Statut et source |
|---|---|---|---|
| 1 argent | Crédit sous verrou par carte, code identique au dépôt (00a §4, 02 §1) ; aucun solde négatif, calcul conforme aux règles (02 §4.9) ; annulation sûre face aux renvois (02 §4.5) ; aucune écriture de solde sans jeton (03 §4.1) | Crédit et ligne de journal écrits séparément, sans vérification : un crédit peut rester sans trace (02 c1) ; aucune protection serveur contre le double crédit, et la caisse repropose la carte après une erreur (02 c2, c4) ; ajustement en valeur absolue, sans verrou ni journal, plafonné au seuil en mode points (02 c8, 05 c12) ; restauration = jusqu'à 24 h de crédits perdus, sauvegardes dans le même compte (06 c2, c3) ; le redéploiement coupe net (06 c8) | PROUVÉ (mécanismes) ; aucune occurrence depuis le 25/09 (02 §4.1) ; avant, NON VÉRIFIABLE |
| 2 machines | Aucune intégration aujourd'hui | Tout ce qu'une machine exige manque : idempotence, clés propres, limite par clé, unité du montant, heure de l'événement, remise explicite, canal (02 §6.3, 03 §6, 05 §6.2) | PROUVÉ (absence) |
| 3 comptoir | Débit largement suffisant : 8 scans/minute absorbés (02 §8) ; 12 ms d'exécution en base par scan (06 §4.3) | Clé historique supprimée fin 2026 (06 c1) ; 0,8 s de trajet par scan (06 c4) ; une panne se lit « carte introuvable » après jusqu'à 7 s (02 c10) ; limiteurs qui voient l'adresse du proxy (02 c11) ; supervision aveugle (06 c10) ; échéances du printemps 2027 (06 c11) | PROUVÉ / HYPOTHÈSE forte (proxy) |
| 4 accès | Aucune brèche sans jeton (03 §1) ; stockage verrouillé (03 c8) ; échappement des données saisies (03 §4.9) | Une identité (GitHub) commande tout (03 c1) ; mot de passe admin unique, force inconnue (03 c2) ; force de `JWT_SECRET` inconnue (03 c3) ; `effacer_client` appelable avec la clé publique (03 c4) ; coordonnées renvoyées à toute caisse (03 c7) ; données du marchand précédent visibles après expiration (05 c6) ; branche non protégée (06 c9) | PROUVÉ / NON VÉRIFIABLE (forces, 2FA) |
| 5 notifications | Registre des envois opérationnel depuis le 25/09 (passation §15 quinquies) | Relance sans fin (A §1) ; lectures du cron limitées à 1 000 lignes, et le cron retire ses filtres en cas de panne de lecture (00b F1, F3) ; jetons morts jamais purgés (01 §5) ; messages Google empilés (04 c5) | PROUVÉ |
| 6 carte | Solde juste à chaque mise à jour (04 §1) | Régénérations inutiles (04 c1) ; toutes les cartes de l'appareil revérifiées (04 c2) ; l'inscription attend Google (04 c3) ; carte Google figée hors solde (04 c4) ; Node figé sans correctifs (06 c7) | PROUVÉ |
| 7 statistiques | Chiffres calculés comme le code le dit, en quelques millisecondes (05 §1) | Rétention trompeuse, mois entamé comparé à un mois complet, « N/M reçues » en appareils, panne affichée comme un réseau vide (05 c1 à c4) | PROUVÉ |
| 8 apparence | — | Aperçu de la landing figé, marchands déclarés aux Émirats (04 c11, 00b F9) | PROUVÉ |

**Ce qui va bien, mesuré** (06 c16) : serveur en UTC, base sans redémarrage depuis 128 jours,
6 connexions sur 60, 100 % des lectures servies par le cache, aucun interblocage, journaux de
transactions archivés sans échec, certificats TLS renouvelés d'eux-mêmes.

### 3.2 Ce qui ferait couler le bateau

| Événement | Conséquence | Probabilité | Source |
|---|---|---|---|
| Suppression des clés historiques par Supabase (fin 2026) | arrêt total, lu comme « carte introuvable » au comptoir | certaine si rien n'est fait | 06 §2 n° 1 |
| Compte GitHub perdu ou piraté | tout : secrets, base, sauvegardes, mises en production | inconnue (2FA non vérifiée) | 03 c1, 06 §5.5 |
| `JWT_SECRET` perdu | toutes les sessions tombent ; les 1 104 cartes installées sur iPhone ne se mettent plus jamais à jour | faible, irréversible | 06 §5.4, 04 §6.4 |
| Domaine non renouvelé (printemps 2027) | tout, y compris l'adresse gravée dans chaque carte Apple | évitable par un réglage | 06 §2 n° 10 |
| Adhésion Apple non renouvelée (printemps 2027) | plus de mise à jour des cartes Apple ; certificat de juin impossible à renouveler | idem | 06 §2 n° 9, 12 |
| Impayé Supabase | projet en pause ; au rétablissement, plus de clé historique | faible | 06 §2.1, §5.6 |
| Première machine branchée sur l'actuel scan | doubles crédits invisibles à chaque renvoi | certaine sans idempotence | 02 §6.2 |

### 3.3 Les points uniques, et ce que leur perte coûte

| Point unique | Ce qu'il commande | Si on le perd | Source |
|---|---|---|---|
| Compte GitHub de Yass (identité de connexion de Railway et Supabase) | dépôt, secrets, base, sauvegardes, déploiement | tout | 03 c1, 06 §5.5 |
| Dépôt : deux accès en écriture (le second voulu), branche non protégée | la production (un push = un déploiement) | une erreur ou un compte compromis met en ligne n'importe quoi | 06 c9 |
| `JWT_SECRET`, une copie (Railway) | toutes les sessions et le jeton de chaque carte Apple | cartes Apple figées pour toujours | 06 §5.4 |
| `ADMIN_PASSWORD`, unique, choisi de tête | l'admin, donc tout solde (par réinitialisation du mot de passe d'un marchand) | rien à la perte ; tout en cas de fuite | 03 c2 |
| Clé APNs, certificat Apple, compte Google (MacBook et Railway) | poussées, signature des cartes, API Google | à recréer ; la clé APNs ne se télécharge qu'une fois | 06 §5.4 |
| Un process Node, une instance, une région (Californie) | API, cron, minuteurs, rendus, signatures | tout s'arrête ensemble ; un redémarrage efface l'état en mémoire | 00b c3, F5 |
| Un projet Supabase (Paris), sauvegardes comprises | toutes les données | données et sauvegardes perdues ensemble | 06 c3 |
| Un domaine | API, cartes Apple, liens | tout | 06 §2 n° 10 |
| Yass, seul opérateur | migrations à la main, accès des marchands (e-mail marchand arbitraire), comptes Apple, Google, domaine | plus personne pour agir | passation §1, 03 §4.10, R2 |

---
## 4. La roadmap

### 4.1 Les règles d'ordre

- **Dépendances d'abord** : une étape qui en rend une autre possible passe devant, même si
  elle est moins grave (brief §4). **Gravité ensuite. Jamais la facilité.**
- **Aucune correction sur l'argent ou le scan avant le filet de tests** (brief §8). Le filet
  est placé juste avant la première (étape 11).
- **Deux voies.** Les réglages de Yass (Supabase, Railway, GitHub, Apple, domaine) ne touchent
  ni le code de l'argent ni celui du scan. Ils avancent en parallèle du code, dans l'ordre
  des paliers 0 et 1. Le code suit la numérotation.
- **Déclencheurs de volume.** Certaines étapes remontent si un événement arrive plus tôt que
  prévu : l'arrivée d'un réseau, un marchand à 1 000 porteurs, 35 000 porteurs. Elles le
  disent.

### 4.2 Les étapes

**Palier 0 — L'échéance qui arrête tout (avant la fin de 2026)**

| # | Étape | Pourquoi à cette place | Protège | G | Qui | Source |
|---|---|---|---|---|---|---|
| 1 | Un déploiement qui ne joint pas la base doit échouer | dépendance de 2 : aujourd'hui, une clé erronée passerait le contrôle et remplacerait la version saine | toute erreur de variable | 3 | dev | 06 P2 |
| 2 | Remplacer la clé historique par une clé secrète, puis retirer les clés historiques | date imposée : fin 2026 ; supprime aussi le piège de l'impayé (projet rétabli sans clé historique) | toute la plateforme | toutes | Yass | 06 P1, §2 n° 1 |

**Palier 1 — Ne rien perdre d'irremplaçable, voir, verrouiller (réglages et code hors argent et scan)**

| # | Étape | Pourquoi à cette place | Protège | G | Qui | Source |
|---|---|---|---|---|---|---|
| 3 | Décider la protection des données : restauration à la minute (Point in Time), copie hors du compte, ou les deux | gravité 1, sans dépendance | jusqu'à 24 h de crédits (moyenne : 56 crédits, 40 inscriptions) ; la perte du compte | 1 | Yass | 06 P4, P5, §6 |
| 4 | Copier `JWT_SECRET` hors de Railway ; relever les dates exactes de 2027 et activer les renouvellements automatiques | irréversible ; dépendance de 7 (séparation des secrets) ; dates | les cartes Apple, le domaine, l'adhésion | 3, 6 | Yass | 06 P12, §2 |
| 5 | Supervision : une sonde qui touche la base, une trace de début et de fin du cron, les dates des certificats visibles | voir avant de toucher : dépendance de toutes les étapes suivantes | le délai entre une panne et sa découverte | 3, 5 | dev | 06 P3 |
| 6 | **Serveur en Europe** (région Railway d'Amsterdam), avec une mesure de latence avant et après (méthode de 00a §7.2) | réglage d'hébergement, sans code applicatif ; l'essentiel du temps du scan est déjà attribué au trajet (00a §7.3, 06 §4.3) | environ 0,7 s par scan, en France comme à Dubaï (HYPOTHÈSE, à mesurer) | 3 | Yass | 06 P10 |
| 7 | Verrouillage décidé après l'audit : double authentification GitHub ; protection de la branche et chemins surveillés par Railway (−16 redéploiements pour rien sur 30 jours) ; droits d'exécution des fonctions retirés aux rôles publics ; mot de passe admin long, comparé à temps constant ; secret des cartes Apple séparé du secret des sessions ; visibilité du dépôt, après avoir déplacé le logo de secours Google ; coordonnées des clients réservées au Pro+ ; page du dashboard vidée à chaque changement de session ; service worker de l'admin, **avant toute modification de l'admin** | décidé par Yass ; gravité 4 avec escalade vers 1 ; aucune dépendance sauf le secret (étape 4) | l'exploitation, l'admin, les cartes, les coordonnées | 4 (1) | Yass, dev | 03 P1, P2, P5, P6 ; 04 P7 ; 05 c6 ; 06 P8 ; 00b §4.7 |
| 8 | Borner la version de Node et écrire le constructeur dans le dépôt | date : Node 26 devient LTS le 28/10/2026 ; un changement de constructeur ferait sauter de version sans commit | la signature des cartes Apple, les modules compilés | 6 | dev | 06 P7 |

**Palier 2 — Pouvoir tester l'argent et le scan**

| # | Étape | Pourquoi à cette place | Protège | G | Qui | Source |
|---|---|---|---|---|---|---|
| 9 | Écrire dans le dépôt ce qui vit hors dépôt : droits des 7 tables centrales, déclencheur `ensure_rls`, protection des 4 tables, réglages Railway versionnables | dépendance de 10, 15, et d'une restauration après perte du projet | la reconstruction de la base | 4 (1 avec la perte du projet) | dev | 06 P11, 00a §5.1, 06 §6.4 |
| 10 | **Le filet de tests argent et scan** (§4.3) | juste avant la première correction qui touche l'argent ou le scan (brief §8) | toutes les étapes du palier 3 | 1, 3 | dev | 02 §10 |

**Palier 3 — L'argent**

| # | Étape | Pourquoi à cette place | Protège | G | Qui | Source |
|---|---|---|---|---|---|---|
| 11 | Crédit, ligne de journal et carte écrits dans une seule transaction, avec une clé d'idempotence ; garde-fous en base (solde jamais négatif, seuil positif) | cause commune de trois défauts de gravité 1 ; dépendance de 12 et de toute machine ; retire un aller-retour (0,2 s) | crédit sans trace, double crédit, journal dans le désordre | 1 | dev | 02 P1, §4.9 |
| 12 | La caisse après une erreur : ne pas reproposer la carte, le dire, délai maximal, refus 401, 403 et 429 traités ; **puis seulement**, si Yass la décide, la rotation du secret des sessions | s'appuie sur 11 (un renvoi peut réutiliser la même clé) ; date : premiers jetons d'un an expirés dès le 26/05/2027 ; une rotation avant ce correctif bloquerait toutes les caisses sur un message brut | les doubles crédits humains ; les caisses mortes un matin | 1, 3 | dev | 02 P2, dette #1, 03 P3 |
| 13 | Rattraper une erreur de caisse : ajustement conditionnel, journalisé, **sans plafond au seuil en mode points** ; annulation atteignable au-delà des 100 derniers scans et depuis le dashboard, selon les réponses de Yass (§9.1, A2) | gravité 1 ; dépend des décisions A2 | le solde écrasé, le surplus perdu, les statistiques faussées par un ajustement | 1 | dev | 02 P5, 05 c12, §10.3 |
| 14 | Arrêt propre au redéploiement : démarrer Node directement, finir les requêtes en cours, régler le délai d'arrêt ; si le parrainage est gardé et activé en mode points, corriger `credit_referral` | après 11, qui couvre déjà la part « argent » d'une coupure ; reste la part comptoir et les travaux en cours | le scan coupé en plein milieu, les demandes d'avis, le cron | 1, 3, 5 | dev | 02 P3, P4 ; 06 P9 |

**Palier 4 — Le comptoir, mesuré**

| # | Étape | Pourquoi à cette place | Protège | G | Qui | Source |
|---|---|---|---|---|---|---|
| 15 | **Environnement de test et test de charge de référence** (§4.4) | dépendance de 17 à 19 et de toute machine ; exige les étapes 2 et 9 | les décisions de capacité, calculées par l'audit et jamais mesurées | 3 | dev, Yass | §4.4 |
| 16 | Une panne de la base se lit comme une panne au comptoir, pas « carte introuvable » ; délais maximaux sur les appels | gravité 3 ; touche le chemin du scan (après 10) | la caissière qui recommence sur une fausse erreur | 3 | dev | 00b F3, 02 §4.7 |
| 17 | Limiteurs : lire la vraie adresse du client ; une limite propre au service web Apple ; une limite par clé pour les machines | mesuré par 15 ; dépendance des machines | scans et mises à jour refusés (429), protection contre la force brute | 3, 4 | dev | 02 §4.8, 04 P8, 03 P7 |
| 18 | Images du bandeau : n'invalider que si un champ visuel change, purger sans attendre un rendu, tester une existence sans télécharger | gravité 3 latente (un rendu bloque tout le serveur 23 à 136 ms) ; dépendance des cartes saisonnières | les scans pendant les rendus, le stockage | 3 | dev | 04 P4 |
| 19 | Instance de la base : Nano vers Micro, au même prix, de nuit | **déclencheur de volume : avant 35 000 porteurs** | la mémoire de la base | 3 | Yass | 06 P6 |
| 20 | Node et Express à jour (changement de constructeur), essayés sur le cobaye | aucun correctif de sécurité de Node depuis octobre 2025 ; fin de maintenance d'Express 4 visée au 01/10/2026 | la sécurité du serveur | 4, 6 | dev | 06 §5.2, §2 |

**Palier 5 — Ce qui grossit avec le stock (briques des projets)**

| # | Étape | Pourquoi à cette place | Protège | G | Qui | Source |
|---|---|---|---|---|---|---|
| 21 | Lectures sans plafond de 1 000 lignes : cron, liste, export, campagnes, Aperçu calculé en base (après les définitions, étape 26) | **déclencheur de volume : avant l'arrivée d'un réseau ou d'un marchand à 1 000 porteurs ou 33 scans par jour** ; brique de la segmentation, du push par boutique, des notifications programmées et du dashboard mono-site | relances à tort, listes et campagnes amputées, Aperçu faux | 5, 7 | dev | 00b F1, 05 P1 |
| 22 | Relance : plafond par épisode d'inactivité ; arrêt du cron sur une panne de lecture (il retire aujourd'hui ses filtres) ; pas de réécriture d'un texte identique ; heure du passage | le seul défaut qui s'aggrave sans que rien ne change ; brique de la relance configurable | la durée du cron, les régénérations inutiles, le quota Google | 5, 6 | dev, Yass | A §1, 00b F3, 04 P1 |
| 23 | Envois : jetons morts (410) ; messages Google bornés, cartes Google tenues à jour ; message Google envoyé aux cartes iPhone | brique de toute nouvelle surface d'envoi (qui doit écrire au registre, `CLAUDE.md`) | le quota de 3 par 24 h, le plafond de 10 messages | 5, 6 | dev | 01 §5, 04 P5, A §5.1 |
| 24 | Liste Apple « mises à jour depuis » et son horodatage, **corrigés ensemble** ; désinscription d'un appareil sous jeton | corriger l'un sans l'autre ferait manquer des mises à jour | 2,2 vérifications inutiles par scan, le limiteur | 6 | dev | 04 P2, dette #11, 03 c9 |
| 25 | L'inscription répond sans attendre Google ; l'objet Google est créé à la demande | dépendance de l'e-commerce | 1,4 s (jusqu'à 22 s) pour chaque client iPhone | 6 | dev | 04 P3 |
| 26 | Statistiques : définitions tranchées par Yass, puis période égale, erreurs affichées comme des erreurs, compte rendu de campagne en clients | dépendance du dashboard mono-site (définitions avant de les recopier) | la lecture des chiffres | 7 | dev, Yass | 05 P2 à P7 |
| 27 | Nettoyage décidé par Yass (Ponytail) : chaque retrait est un chantier testé | après le filet pour tout ce qui touche le scan | environ 1 800 lignes candidates | — | dev | 02 §7.4, 04 §7.4, 05 §7.4, 06 §9.4 |

**Palier 6 — Les projets** (verdicts au §7.1)

| # | Étape | Pourquoi à cette place | Source |
|---|---|---|---|
| 28 | Brique « API d'intégration » : route dédiée, clés et révocation par intégration, limite par clé, montant défini, heure de l'événement, remise explicite, colonne de canal, ce que la carte affiche et notifie à chaque crédit | exige 11, 15, 17 ; puis bornes, caisses, e-commerce, dans cet ordre | 02 P6, 03 P7, 04 §6.2, 05 §6.2 |
| 29 | Les autres projets, chacun derrière ses briques (§7.3) | — | §7 |

### 4.3 Le filet de tests (brief §8)

Scénarios rejouables d'une commande sur une base jetable, dans le conteneur, résultat en une
ligne « N/N OK ». Le filet **fige l'état actuel avant de le changer** : un scénario qui
constate aujourd'hui un double crédit est écrit comme tel, puis inversé par l'étape 11.

- **Prérequis** : la base rejouée depuis le dépôt doit porter les droits des 7 tables
  (étape 9 ; 00a §5.1). La production tourne en PostgreSQL 17.6, le conteneur en 16 (00a §8).
- **Deux niveaux** : les fonctions qui écrivent le solde, directement en base ; la route du
  scan à travers une API locale équivalente à celle de Supabase (choix de l'outil : dev).
- **Scénarios** : les 12 du 02 §10 (tampons, points, crédits simultanés, renvoi, crédit sans
  ligne, journal dans le désordre, annulations, ajustement pendant un scan, code de secours,
  boutique coupée et jeton marchand sur un réseau, parrainage s'il est gardé, montants
  limites). Ajouts de la synthèse :
  - l'ajustement en mode points au-dessus du seuil (le serveur accepte, l'écran refuse :
    05 c12) ;
  - l'annulation du dernier scan d'un client plus ancien que les 100 derniers scans de la
    boutique (le serveur accepte : §10.3) ;
  - après l'étape 11 : un renvoi avec la même clé ne crédite qu'une fois, une coupure laisse
    tout ou rien ;
  - la base rejouée porte bien ses droits (sinon tout échoue pour une mauvaise raison).

### 4.4 Le test de charge

L'audit n'a pu que calculer. Le test de charge vérifie ces calculs sur un environnement de
test.

- **Place** : étape 15, en tête du palier 4. Il suppose les étapes 2 (un nouveau projet
  Supabase n'a pas de clé historique, 06 §6.4) et 9 (la base doit se reconstruire). Il
  précède les étapes 17 à 19 et toute machine. On le relance après l'étape 22 (cron) et
  avant la première borne, avec des renvois de machine. Il n'est pas le prérequis du
  serveur en Europe (étape 6), mesuré à part.
- **Environnement** : un second projet Supabase et un second service Railway (les réplicas
  et les services sont permis en offre Hobby, 06 §8.3), dans la région de production. Les
  appels à Apple et à Google sont simulés, avec des délais réalistes. Le script de charge
  actuel vise la production et crée de vrais clients crédités : il est à réécrire (00b §7).
- **Trois scénarios** :
  1. **Base factice à la cible** : 100 points de vente dont quelques réseaux, 100 000
     porteurs, 90 jours de scans (environ 270 000), registre et déduplication à l'équilibre.
  2. **Heure de pointe** : 12 à 16 % des scans du jour en une heure (00b C5), des pointes de
     8 scans par minute chez un marchand (02 S4), plusieurs caisses par boutique, les iPhone
     qui viennent chercher leur carte, et **le cron qui passe en même temps** (08:00 UTC,
     midi à Dubaï).
  3. **Envoi de masse** : un passage du cron à la cible, une campagne vers tout un réseau,
     une bascule saisonnière en masse.
- **Ce qu'il mesure** : le temps d'un scan (médiane et queue) pendant chaque scénario, le
  blocage de la boucle du serveur, les refus 429, la mémoire et le cache de la base (Nano,
  puis Micro), la durée du cron, le débit du service web Apple, la durée de l'onglet Réseau.

---
## 5. La capacité

### 5.1 Le parc réel : ratios et décomptes recalculés

Tous les chiffres de ce paragraphe sont **calculés par la synthèse** à partir de résultats déjà
publiés (05 T1 du 28/09, 04 K3 du 27/09), sur les **17 marchands en production** (liste en
tête du document). Ils sont marqués **HYPOTHÈSE** : plusieurs bases ont moins d'un mois, et
leur usage n'est pas encore installé.

**Le parc en production (28/09).**

| Grandeur | Valeur | Part de la plateforme |
|---|---|---|
| scans non annulés sur 30 jours | 1 640 | 98 % des 1 680 (05 T4) |
| porteurs (clients non effacés) | 1 421 | 82 % des 1 730 |
| points de vente (15 mono-sites, Pizz'Amore 5, Bangkok Factory 2) | 22 | — |
| scans par jour et par point de vente | **2,5** | — |
| porteurs par point de vente | **65** | cible : 1 000 |
| scans par porteur et par mois, les 17 | **1,15** | — |
| idem, les 4 bases de 40 jours et plus (Magic Cleaning, Wam N Fade, Bluemoon Boston, La Passerelle Indienne) | **0,80** | — |

**L'hypothèse de 30 scans par jour et par point de vente, confrontée au ratio mesuré.** Les
rapports 02 (§5.3), 05 (M1) et 06 (§4.4, §6.2) retiennent 3 000 scans par jour à la cible,
soit 30 par point de vente. Ce chiffre n'est pas une mesure. Le ratio mesuré par point de
vente (2,5) ne s'extrapole pas tel quel : les points de vente d'aujourd'hui ont 65 porteurs,
ceux de la cible en auront 1 000. Ramené au porteur, le ratio mesuré donne **27 à 38 scans par
jour et par point de vente** à 1 000 porteurs (bases anciennes, puis ensemble des 17), soit
**2 700 à 3 850 scans par jour** à la cible. **L'hypothèse de 30 est compatible avec la
mesure.** HYPOTHÈSE : l'activité par porteur reste celle d'aujourd'hui.

**Les décomptes faits sur toute la base, recomptés sur les 17.**

| Rapport | Ce qu'il comptait | Sur les 17 en production |
|---|---|---|
| 02 §4.2 | 15 marchands actifs en mode points, dont 3 de test | **8** : Asie Express, Bangkok Factory, Boucherie République, Crep' & Coffee, Dinapoli, Pizz'Amore, Shop By Ness, Wam N Fade. Ils font **65 % des scans réels** : les deux tiers de l'activité portent une valeur monétaire. |
| 03 c7 | 45 marchands sur 48 scannent avec un jeton marchand complet | **15 sur 17** : tous sauf Pizz'Amore et Bangkok Factory, les deux réseaux en production. Déduit de 03 Q4 (3 réseaux) et 05 T2 (Bangkok Factory, Franchise Test, Pizz'Amore). |
| 02 S5 | clients par marchand : médiane 4 | **médiane 53** (Asie Express), maximum 283 (Dinapoli). La médiane de 4 était tirée par les comptes de test. |

**Les projections gonflées par les comptes de démonstration.** Les projections à 100 000
porteurs du 04 (§6.1) et du 06 (§8.2) multiplient l'activité de toute la plateforme par
100 000 / 1 728. Or 247 cartes de marchands hors production sont sous relance (K3), dont 234
chez les deux comptes de démonstration, pour 16 scans en 30 jours. Presque toutes sont
inactives, donc relancées tous les 8 jours : jusqu'à 31 relances par jour, sur environ 80
(04 K1, 7 jours). Correction, au facteur 100 000 / 1 421 :

| Projection | Rapport | Corrigée (HYPOTHÈSE) |
|---|---|---|
| exécutions du cron par jour à 100 000 porteurs | ≈ 4 600, soit ≈ 1 h 30 par passage | **≈ 3 500 à 3 900, soit ≈ 1 h 10 à 1 h 20** ; jusqu'à ≈ 2 h si la moitié du parc devient inactive (A §1, 04 §6.1) |
| régénérations inutiles de cartes Apple par jour | ≈ 2 230 | **≈ 1 700 à 1 900** (96 cartes iPhone hors production sous relance, 1,27 appareil par carte) |
| registre des envois à l'équilibre | ≈ 880 Mo | **≈ 800 à 880 Mo** : la correction est faible, car le dénominateur baisse aussi |
| stock total et seuil de la Nano | ≈ 1,2 Go ; 35 000 à 40 000 porteurs | inchangés à la précision du calcul |

*Ce qui trancherait* : la requête K1 du 04, filtrée sur les 17 marchands.

**Aucun rapport n'a divisé une activité par les 47 ou 48 marchands** pour extrapoler :
les écarts ci-dessus viennent de décomptes et de ratios par porteur qui incluaient les
comptes de test.

### 5.2 Le tableau de capacité

**Conversion des horizons** (HYPOTHÈSE, §5.1) : l'activité suit le stock, à 0,027 à 0,038
scan par porteur et par jour. **5 000 porteurs ≈ 135 à 190 scans par jour ; 20 000 ≈ 530 à
770 ; 100 000 ≈ 2 700 à 3 850.** Les seuils par marchand ne dépendent pas de la taille de la
plateforme mais du plus gros marchand (aujourd'hui 20 % des porteurs en production) ; un
réseau les franchit dès son ouverture.

Légende : ✅ tient · ⚠️ souffre · ❌ casse.

| Système | Unité qui le provoque | Seuil | Ce qui lâche en premier | 5 000 | 20 000 | 100 000 | Source |
|---|---|---|---|---|---|---|---|
| Clé de la base | date | fin 2026 | tout | ❌ quel que soit le volume | ❌ | ❌ | 06 §2 n° 1 |
| Domaine, adhésion Apple, certificat | date | printemps 2027 | tout ; les cartes Apple | ❌ si non renouvelés | ❌ | ❌ | 06 §2 |
| Lectures limitées à 1 000 lignes, activité | scans sur 30 jours par marchand | 1 000, soit ≈ 33 par jour | relances envoyées à des clients actifs ; Aperçu faux et instable | ⚠️ un réseau les franchit | ❌ probable | ❌ certain | 00b §9, 05 c7 |
| Lectures limitées à 1 000 lignes, stock | porteurs par marchand | 1 000 | clients jamais examinés par la relance ; liste, export, campagnes amputés | ⚠️ le plus gros marchand approche | ❌ probable | ❌ (moyenne 1 000 par PDV) | 00b §9 |
| Déduplication de la relance | relances par marchand sur 7 jours | 1 000 | relance quotidienne au lieu de tous les 8 jours | ✅ | ✅ | ⚠️ gros réseaux | A §4 |
| Limiteur global par adresse | requêtes par 15 min par adresse vue | 300 (inscription : 20 par heure) | scans et mises à jour de cartes refusés, lus « erreur réseau » | ⚠️ possible dès une grosse campagne | ⚠️ | ❌ si peu d'adresses | 02 §4.8, 04 §4.9 — NON VÉRIFIABLE (adresses) |
| Durée du cron (process unique, un client après l'autre) | cartes notifiées par jour | 1,2 s par carte | le service web Apple et le process pendant le midi de Dubaï | ✅ quelques minutes | ⚠️ ≈ 15 à 25 min | ❌ ≈ 1 h 10 à 2 h | 00b C6, §5.1 |
| Régénérations inutiles, revérifications | relances identiques ; cartes par appareil | ≈ 0,5 par exécution du cron ; 3,4 par scan | le calcul du process, le limiteur | ✅ | ⚠️ | ⚠️ ≈ 1 700 à 1 900 par jour | 04 c1, c2 |
| Relance sans fin | stock d'inactifs, âge de la plateforme | continu, ≈ 45 envois par an et par inactif | cron, registre, quota Google | ⚠️ | ⚠️ | ❌ | A §1 |
| Mémoire de la base (Nano) | porteurs | ≈ 35 000 à 40 000 | lectures au disque, agrégats | ✅ | ✅ | ❌ Micro au minimum, Small à l'aise | 06 §4.2 |
| Disque (spend cap) | Go occupés | 7,6 Go, puis lecture seule | **le crédit au comptoir** | ✅ | ✅ | ✅ 13 à 15 ans ; e-commerce : ≈ 1,5 an | 06 §4.4 |
| Trafic sortant (spend cap) | Go par mois | 250 | toute requête (402) | ✅ | ✅ | ✅ 30 à 40 Go ; ≈ 9 Go par bascule en masse | 06 §4.4 |
| Connexions, calcul du serveur | — | 60 connexions ; un cœur | — | ✅ | ✅ | ✅ | 06 §4.1, §4.2 |
| Temps d'un scan | allers-retours avec la base | 0,8 s de trajet, constant | la caisse | ⚠️ | ⚠️ | ⚠️ (indépendant du volume) | 06 §4.3 |
| Attentes longues au scan | cartes d'un marchand ; rendus | campagne : 0,3 s à 10 000 cartes, 3,4 à 4,1 s à 100 000 ; rendu : 23 à 136 ms | le scan pendant une campagne ou une bascule | ✅ | ✅ | ⚠️ grand réseau | 02 D4, 04 M2 |
| Coupure au redéploiement | scans par jour × redéploiements | 0,1 % des redéploiements en journée aujourd'hui | un crédit sans trace ou un doublon invisible | ⚠️ | ⚠️ | ❌ ≈ 7 % à 3 000 scans par jour | 02 §7.1 |
| Perte à la restauration | activité par jour | jusqu'à 24 h | les soldes, les cartes des nouveaux inscrits | ⚠️ ≈ 150 crédits | ⚠️ ≈ 600 | ❌ ≈ 3 000 crédits | 06 §6.2 |
| Onglet Réseau | scans sur 90 jours d'un réseau | 8 s vers 0,3 à 1,6 million | réseau affiché vide | ✅ | ✅ | ✅ (e-commerce seulement) | 05 c8 |
| Notifications Google | notifications par carte et par 24 h ; messages par carte | 3 ; 10 | envois écrêtés en silence ; effet au-delà de 10 inconnu | ⚠️ machines, campagnes | ⚠️ | ⚠️ | A §5.2, 04 c5 |
| Code de secours | porteurs par marchand | 0,06 % des saisies à 10 000 | 409 : choix humain, impasse pour une machine | ✅ | ✅ | ⚠️ | 02 §4.7 |
| Historique du scanner | scans par boutique | 100 derniers | annulation impossible au comptoir au-delà | ⚠️ ≈ 3 semaines à Bron | ⚠️ | ❌ ≈ 3 jours d'activité à 30 scans par jour | §10.3 |
| Deux serveurs | — | bloqué par le code | cron doublé, caches et limiteurs par instance | — | — | prérequis de l'e-commerce en vagues | 00b F5 |

**Ce qui lâche en premier.** Une date, avant tout volume : la clé de la base. Puis les
lectures limitées à 1 000 lignes, au premier gros marchand ou au premier réseau. Puis la
mémoire de la base, vers 35 000 porteurs. À 100 000, la durée du cron. Aucune de ces
ruptures ne vient d'un manque de puissance (06 §4.1). L'argent, lui, n'a pas de seuil de
volume : son risque grandit avec l'activité (redéploiement, restauration) et bondit au
premier crédit de machine (02 §8).

### 5.3 Le temps d'un scan, en France et à Dubaï

| | Dubaï | France |
|---|---|---|
| aller-retour caisse ↔ serveur | 0,29 s (mesuré) | ≈ 0,15 à 0,2 s (estimé) |
| 4 allers-retours serveur ↔ base | ≈ 0,8 s | ≈ 0,8 s |
| **scan, connexions ouvertes** | **≈ 1,1 à 1,3 s** | **≈ 1,0 s** |
| après dix minutes sans scan | ≈ 1,6 à 1,8 s | ≈ 1,5 s |

Sources : 00a §7.3, 02 §3.3 (HYPOTHÈSE : calcul sur mesures). Le calcul dans la base prend
12 ms ; 98,5 % du temps passé avec la base est du trajet (06 §4.3). Le serveur en Europe
(étape 6) ramènerait la part de la base sous 0,1 s, et la transaction unique (étape 11)
retirerait un aller-retour (HYPOTHÈSE, à mesurer). Railway ne propose que la Californie, la
Virginie, Amsterdam et Singapour (06 §8.3) : Dubaï restera à une centaine de millisecondes de
l'Europe (HYPOTHÈSE).

### 5.4 Le coût de l'infrastructure

Point de départ : **environ 40 à 45 $ par mois aujourd'hui pour toute l'infrastructure,
Supabase Pro compris** (Socle, relevé par Yass), dont 5 $ de Railway pour 2,64 $ d'usage réel
(06 §4.1).

| Porteurs | Ce qui change | Ordre de grandeur mensuel |
|---|---|---|
| 20 000 | rien : Railway reste dans son offre de base (la cible tient dans une instance, 06 §8.3) ; la base tient en mémoire | ≈ 40 à 45 $ |
| 50 000 | instance de la base de Nano à Micro, **au même prix** (la Nano est déjà facturée comme une Micro, 06 §4.2) | ≈ 40 à 45 $ |
| 100 000 | la base (≈ 1,2 Go) dépasse la mémoire d'une Micro : une Small est probable, prix non relevé par l'audit ; le trafic reste sous le quota inclus | ≈ 40 à 45 $ plus l'écart vers une Small |
| en option, tout volume | restauration à la minute (Point in Time), qui exige une Small | ≈ +100 $ (06 §6.1) |

Tout le tableau est une HYPOTHÈSE. Les coûts fixes (adhésion Apple, domaine) ne dépendent pas
du volume et n'ont pas été relevés. *Ce qui trancherait* : la grille de prix des instances
Supabase, et la page d'usage de l'organisation.

---
## 6. Le calendrier des échéances

Repris du 06 §2, trié par date, **la clé historique en tête** (conséquence totale, échéance la
plus proche). Chaque ligne renvoie à l'étape de la roadmap qui la traite.

| # | Date | Échéance | Ce qui casse si on la rate | Étape | Qui | Statut |
|---|---|---|---|---|---|---|
| **1** | **fin 2026** (« Late 2026 », date exacte à confirmer par Supabase) | **suppression des clés historiques ; le serveur en utilise une** | **toute la plateforme** ; au comptoir, « carte introuvable » ; une clé de remplacement erronée passerait le contrôle de déploiement | 1, 2 | Yass, dev | PROUVÉ (relevé du 28/09 : clé au format historique ; documentation) |
| 2 | 01/10/2026 au plus tôt | fin de maintenance d'Express 4 | plus de correctifs de sécurité ; rien ne casse le jour même | 20 | dev | HYPOTHÈSE forte |
| 3 | 20/10/2026 | Node 24 passe en maintenance | rien : la production est figée sur 24.10.0 | 8, 20 | — | PROUVÉ |
| 4 | vers le 26/10/2026 | première purge de la déduplication du cron | rien | — | — | PROUVÉ |
| 5 | 28/10/2026 | Node 26 devient LTS | un changement de constructeur ferait sauter de version sans commit | **8, avant cette date** | dev | PROUVÉ / HYPOTHÈSE (changement de constructeur) |
| 6 | 30/10/2026 | fin de l'exposition automatique des nouvelles tables sur les projets existants | rien (réglage déjà désactivé) ; toute nouvelle table exige ses droits, comme dans l'étape 9 | 9 | — | PROUVÉ / HYPOTHÈSE |
| 7 | vers le 24/12/2026 | première purge du registre des envois | historique des envois au-delà de 90 jours perdu | — | — | PROUVÉ |
| 8 | 30/04/2027 | fin de vie de Node 22, la version que dit la documentation | rien en production ; une reconstruction qui suivrait la documentation tournerait sans correctifs | 8 | dev | PROUVÉ |
| 9 | **fin avril – début mai** (2027, HYPOTHÈSE) | **adhésion Apple Developer** | plus aucune carte Apple ne se met à jour d'elle-même ; certificat de juin impossible à renouveler | **4** | Yass | mois connu ; jour et renouvellement automatique à relever |
| 10 | **fin avril – début mai** (2027, HYPOTHÈSE) | **domaine** | **tout**, y compris l'adresse gravée dans chaque carte Apple | **4** | Yass | idem |
| 11 | dès le 26/05/2027 | premiers jetons de caisse d'un an expirés | une caisse affiche un message brut et reste bloquée un matin ; sur un réseau, toutes ensemble | **12, avant cette date** | dev | PROUVÉ |
| 12 | **juin 2027** | **certificat de signature des cartes Apple** | plus aucune carte Apple installable ni mise à jour ; exige l'adhésion (n° 9) | **4** | Yass | date du Socle, jour à relever |
| 13 | 30/04/2028 | fin de vie de Node 24 | plus de correctifs | 20 | dev | PROUVÉ |
| 14 | 2030 | intermédiaire Apple WWDR G4 | chaîne de signature des cartes | 5 (dates visibles) | Yass | PROUVÉ / HYPOTHÈSE (version en place) |

**Récurrentes** (06 §2.1) : paiement Railway (services arrêtés), paiement Supabase (projet en
pause, sauvegardes perdues, et au rétablissement plus de clé historique : l'étape 2 retire ce
piège), quotas du spend cap. Un moyen de paiement commun à tous les comptes n'a pas été
relevé (NON VÉRIFIABLE).

**Fenêtres qui se referment seules** (06 §2.2) : journaux Railway 7 jours, sauvegardes 7
jours, retour arrière 72 heures, registre et déduplication 90 jours.

**Échéances de volume**, ajoutées par la synthèse :

| Déclencheur | Ce qui casse | Étape à faire avant | Source |
|---|---|---|---|
| arrivée d'un réseau, ou d'un marchand à 1 000 porteurs ou 33 scans par jour | relances, listes, campagnes, Aperçu | 21 | 00b §9, 05 c7 |
| 35 000 porteurs | mémoire de la base | 19 | 06 §4.2 |
| première machine (borne, caisse, e-commerce) | double crédit, récompense perdue | 11, 15, 17, 28 | 02 §6 |
| premier marchand qui veut changer son identifiant (slug) | classe Google orpheline, images perdues | à traiter avant | passation §3.4 |

---
## 7. Les projets

### 7.1 Les verdicts

Trois verdicts possibles : **faisable tel quel** ; **faisable après tel prérequis** (étape de
la roadmap) ; **porte fermée** (un choix actuel à changer d'abord).

| Projet | Verdict | Prérequis, et pourquoi | Source |
|---|---|---|---|
| **Bornes** | faisable après prérequis | 10, 11 (un renvoi de borne crédite deux fois aujourd'hui), 15, 17 (limite par clé, pas par adresse), 28 (API d'intégration), et la décision B1 : ce que fait la borne face à un client au seuil (45 clients avaient une récompense en attente le 27/09) | 02 §6, 03 §6 |
| **Caisses** | faisable après prérequis | ceux des bornes, plus : identifier le client sans QR (le code de secours devient ambigu avec le stock) et la règle du montant (B2 : un montant en centimes créditerait cent fois trop) | 02 §6.3 |
| **E-commerce** | faisable après prérequis lourds ; forme à revoir (§7.9) | ceux des caisses, plus : 25 (inscription sans attendre Google), deux serveurs ou un process séparé pour les vagues (00b F5), limiteur d'inscription (20 par heure et par adresse), capacité de l'onglet Réseau et du disque | 02 §6.5, 04 §6.2, 05 §6.2, 06 §4.4 |
| **Landing enrichie** (anniversaire, produit favori, e-mail, consentement) | faisable après prérequis léger | 7 (coordonnées réservées au Pro+ ; page vidée entre deux sessions), car la surface de données personnelles grossit ; le consentement est aujourd'hui écrit sans vérification. À ajouter tout de suite : la boutique d'inscription (porte qui se ferme, §8) | 03 c7, 05 c6, 00b F2, 05 §6.3 |
| **Notifications programmées** | faisable après prérequis | 21 (ciblage sans plafond), 23 (messages Google bornés) ; un planificateur qui survit aux redémarrages (les minuteurs en mémoire se perdent) ; un envoi par lots hors de la requête du dashboard ; écriture au registre (`CLAUDE.md`) | 00b F4, F7 ; passation §15 sexies |
| **Relance configurable** (message et fréquence) | faisable après prérequis | 22 (plafond par épisode) et 21 ; le message et le délai d'inactivité sont déjà réglables par l'admin, la fréquence (8 jours) est fixe | A §1 ; migrations 010, 016 |
| **Segmentation clients** | faisable après prérequis | 21 : un ciblage calculé en base, pas en listes limitées à 1 000 ; un client jamais scanné n'a pas de boutique | 05 §6.3 |
| **Push par boutique** | faisable après prérequis | segmentation, plus l'envoi par lots des notifications programmées | 05 §6.3 |
| **Dashboard mono-site** au niveau du réseau | faisable après prérequis léger | 26 : définitions tranchées, puis calcul en base (la fonction du réseau fonctionne déjà sans boutique) ; ne pas partir de l'Aperçu, limité à 1 000 lignes | 05 §6.3 |
| **Géolocalisation** | faisable après prérequis, côté carte seulement ; HYPOTHÈSE sur les fonctions de Wallet | coordonnées des boutiques (aucune en base : migration 032) ; produit favori (landing enrichie). Détail au §7.10 | — |
| **Cartes saisonnières** | faisable après prérequis léger (au fil des scans) | 18 (invalidation des images seulement sur changement ; adresse nouvelle pour chaque image saisonnière). Détail au §7.8 | 04 §6.3 |
| **Structure UAE** (entité juridique, second compte Stripe) | **hors périmètre technique** (facturation hors plateforme, brief §11) | ce qui toucherait la plateforme : §7.11 | — |

### 7.2 Ce qui existe et se réutilise, ce qui est à construire

| Projet | Existe et se réutilise | Entièrement à construire |
|---|---|---|
| Bornes, caisses, e-commerce | crédit sous verrou (`increment_stored_value`) ; annulation atomique, sûre face aux renvois : le modèle à suivre (02 §4.5) ; boutiques et attribution des scans ; registre des envois | route dédiée, clés et révocation par intégration, idempotence, canal, montant, heure, remise explicite, identification sans QR |
| Landing enrichie | landing premium Pro+ (e-mail, téléphone, date de naissance), table des consentements, workflow anniversaire qui fonctionne avec elle (passation §15 quinquies) | produit favori, boutique d'inscription, écriture vérifiée du consentement |
| Notifications programmées, push par boutique | campagne manuelle, quota mensuel, registre, poussée Apple et message Google | planificateur persistant, ciblage en base, envoi par lots |
| Relance configurable | trois workflows, message et délai réglables par l'admin, déduplication | plafond par épisode, réglage côté marchand |
| Segmentation | scans rattachés à leur boutique depuis la migration 033, montant crédité et remises notés depuis la 031 | segments calculés en base, écran |
| Dashboard mono-site | `group_stats` | définitions, adaptation des trois chiffres propres au réseau |
| Géolocalisation | génération des cartes Apple et Google | coordonnées, lieux sur la carte, texte par client |
| Cartes saisonnières | bascule progressive de l'image et de la couleur, déjà en place ; resynchronisation des classes Google | adresse nouvelle par image, invalidation ciblée |

### 7.3 Dépendances et briques communes

| Brique | Projets qui la partagent | Étapes |
|---|---|---|
| API d'intégration (idempotence, clés, canal, remise) | bornes → caisses → e-commerce, dans cet ordre | 11, 17, 28 |
| Ciblage en base sans plafond | segmentation, push par boutique, notifications programmées, relance configurable, dashboard mono-site | 21, 26 |
| Envoi par lots, planificateur persistant, quotas Google tenus | notifications programmées, push par boutique, relance configurable | 22, 23 |
| Données client (produit favori, boutique d'inscription, consentement) | landing enrichie → géolocalisation, segmentation, identification en caisse | 7 |
| Images et cache du bandeau | cartes saisonnières, thèmes | 18 |

**À construire ensemble** : segmentation, push par boutique, notifications programmées et
relance configurable forment un seul chantier « envois ciblés », après les étapes 21 à 23.

### 7.4 Argent et scan

| Touchent l'argent (G1, G2) | Touchent le scan (G3) | Sans risque pour l'argent et le scan |
|---|---|---|
| bornes, caisses, e-commerce | cartes saisonnières (rendus d'images qui bloquent le serveur, 04 §4.6) ; envois massifs (cartes verrouillées pendant une campagne, 02 D4 ; cron pendant le midi de Dubaï) | landing enrichie, dashboard mono-site, segmentation, géolocalisation côté carte |

### 7.5 La charge ajoutée

| Projet | Ce qu'il ajoute | Devient un problème à | Source |
|---|---|---|---|
| Borne ou caisse | par crédit : 4 à 5 échanges avec la base, 1,3 carte Apple régénérée, 2,2 vérifications, une mise à jour et un message Google | 3 crédits par jour sur une même carte (quota Google) ; en rafale, 300 requêtes par 15 min derrière une même adresse | 04 §6.2 |
| E-commerce | créations de porteurs qui attendent Google (1,4 s en médiane, sans délai maximal) ; vagues de crédits dans le process des scans | onglet Réseau en erreur vers 3 500 à 18 000 crédits par jour et par réseau ; disque plein en ≈ 1,5 an à 30 000 par jour | 05 §6.2, 06 §4.4 |
| Envois ciblés, relance | par envoi : réécriture de la carte, poussée, message Google ; ≈ 2 à 3 requêtes par iPhone au service web Apple | ≈ 600 requêtes pour une campagne chez Dinapoli aujourd'hui (limiteur) ; 3,4 à 4,1 s de verrou à 100 000 cartes d'un marchand | 04 §4.9, 02 D4 |
| Cartes saisonnières | au fil des scans : un rendu par nouvelle valeur (23 à 136 ms de blocage) ; en masse : 81 000 générations Apple et 100 000 mises à jour Google à 100 000 porteurs | en masse, dès quelques milliers de porteurs | 04 §6.3 |
| Landing enrichie, dashboard mono-site, segmentation | quelques colonnes et lectures en base | — | 05 §5 |
| Géolocalisation (côté carte) | la carte Apple régénérée quand la liste des lieux change | un changement de lieux vaut une bascule en masse | HYPOTHÈSE |

### 7.6 Les limites d'Apple et de Google

| Limite | Ce qu'elle bride | Comment faire avec | Source |
|---|---|---|---|
| Google : 3 notifications par carte et par 24 h ; seuls les messages comptent, pas les mises à jour de carte | bornes, e-commerce, envois ciblés, relances | un message par visite et non par crédit ; plafonner la relance | A §5.2, 04 §4.5 |
| Google : 10 messages au plus par carte, affichés sans fin ; au-delà, effet inconnu | tout ce qui ajoute des messages | date de fin ou nombre gardé (étape 23) ; la requête K5 trancherait | 04 §4.5 |
| Google : logo et nom dans la classe, image et couleur dans l'objet, dos jamais remis à jour | cartes saisonnières, landing enrichie | au fil des scans pour l'image ; tenir le dos à jour (étape 23) | 04 §4.4 |
| Google : quotas d'API inconnus ; aucun signal d'installation | bascules en masse, statistiques d'installation | étaler ; brancher les rappels de Google | 00b §4.6, 01 §5 |
| Apple : une poussée vise l'appareil ; un seul Pass Type ID pour tous les marchands | tout envoi : l'iPhone revérifie toutes ses cartes WinWin | corriger ensemble liste et horodatage (étape 24) | 01 cause B, 04 §4.2 |
| Apple : iOS n'affiche pas un texte identique au précédent | relances, notifications programmées | des textes qui changent ; ne pas repousser un texte identique | passation §15 sexies |
| Apple : le jeton de chaque carte dépend de `JWT_SECRET` ; le porteur ne peut pas retélécharger sa carte | toute rotation du secret | séparer le secret des cartes (étape 7) | 04 §6.4 |

### 7.7 Avant qu'une machine crédite sans humain

1. **Un renvoi ne crédite jamais deux fois** : clé d'idempotence, même résultat pour la même
   demande (02 P1, étape 11).
2. **Crédit, journal et carte écrits ensemble** : plus de crédit sans trace (02 c1).
3. **Une réponse consultable** : « mon crédit est-il passé ? », par identifiant de demande
   (02 §6.3).
4. **Une clé propre à chaque intégration**, révocable seule, limitée par clé et non par
   adresse (03 §6, 02 §4.8).
5. **Un montant défini** : unité, conversion, plafond par crédit (le serveur accepte jusqu'à
   100 000 aujourd'hui, 02 §4.2).
6. **L'heure réelle de l'événement**, pour une borne qui a mis ses crédits en file d'attente
   (02 §6.3).
7. **Une remise explicite** : décider ce que fait la machine face à un client au seuil ; la
   remise différée est vitale pour le fond doré Apple et ne peut pas être retirée
   (02 §6.4, passation §3.6).
8. **Le canal de chaque crédit**, dès le premier jour : sans lui, les statistiques mêleront
   comptoir et machines, et les crédits passés ne pourront plus être séparés (05 §6.2).
9. **Ce que la carte affiche et notifie à chaque crédit** (quota Google, 04 §6.2).
10. **Des garde-fous en base** : solde jamais négatif, seuil positif (02 §4.9).
11. **Un arrêt propre, un filet de tests, un test de charge avec renvois, une supervision**
    (étapes 5, 10, 14, 15).

### 7.8 Les cartes saisonnières

**Recommandation : au fil des scans, sur Apple comme sur Google.** C'est le mode voulu par
Yass, et le code le fait déjà pour l'image et la couleur (04 §6.3), ce qui contredit
l'hypothèse du brief (bascule progressive réservée à Apple).

| | Au fil des scans | En masse |
|---|---|---|
| Apple | chaque carte prend le nouveau design à sa prochaine réécriture ; un client inactif sans relance garde l'ancien | ≈ 81 000 générations complètes à 100 000 porteurs (≈ 8 Go), à étaler |
| Google, image et couleur | réécrites sur l'objet à chaque scan | 100 000 mises à jour ; quotas inconnus |
| Google, logo et nom | impossible : ils vivent dans la classe | un appel par marchand, immédiat |
| Google, dos de carte | impossible : jamais réécrit | à ajouter au code (étape 23) |

**Limites** : chaque image saisonnière doit avoir une adresse nouvelle (Google garde les
images en cache) ; un enregistrement de la fiche ne doit plus ré-invalider toutes les images
(étape 18) ; les premiers scans après la bascule font chacun un rendu qui bloque le serveur
23 à 136 ms (04 §4.6).

### 7.9 Les projets à revoir dans leur forme

- **E-commerce.** Seul projet qui change l'ordre de grandeur des volumes : porteurs créés sans
  passage en caisse, vagues de crédits, disque plein en ≈ 1,5 an à 30 000 crédits par jour
  (06 §4.4), onglet Réseau en erreur (05 §6.2). Réduit à « créditer des cartes existantes »,
  il réutilise la brique des bornes et des caisses. « Créer des porteurs par vagues » demande
  en plus deux serveurs ou un process séparé (00b F5) et l'inscription sans Google (étape 25).
- **Bascule saisonnière en masse** : un coût élevé pour ce que le mode progressif fait déjà.
- **Relance « configurable en fréquence »** : sans plafond par épisode, elle multiplierait un
  travail que personne ne voit (A §1).
- **Géolocalisation** : si elle exigeait une notification envoyée par le serveur selon la
  position du téléphone, il faudrait une application, ce qui contredirait une fonction
  intouchable, la carte dans le Wallet sans application (brief §5). HYPOTHÈSE.

### 7.10 La géolocalisation : ce qu'il faudrait

- **Des coordonnées pour chaque boutique** : aucune en base aujourd'hui (la table
  `points_de_vente` n'a que son nom, migration 032). PROUVÉ.
- **Le produit favori du client** : à collecter par la landing enrichie. PROUVÉ (absent).
- **Côté Apple** : une carte peut porter des lieux, avec un texte qu'iOS affiche quand le
  téléphone s'en approche, sans poussée du serveur ; le nombre de lieux par carte est limité
  (une dizaine), ce qui borne un réseau. **HYPOTHÈSE** : documentation Apple non vérifiée par
  l'audit ; le comportement réel dépend de la version d'iOS.
- **Côté Google** : l'existence et les règles d'une notification liée à un lieu ne sont pas
  établies. **HYPOTHÈSE** à vérifier dans la documentation Google Wallet avant tout chantier.
- **Charge** : aucune au fil du temps, puisque la carte porte les lieux ; mais changer la
  liste des lieux ou le produit favori oblige à régénérer les cartes concernées (une bascule
  en masse pour tout un réseau, §7.8).
- **Verdict** : faisable côté carte, après les coordonnées et la landing enrichie, si la
  vérification de la documentation confirme ces fonctions ; sinon, porte fermée sans
  application.

### 7.11 La structure UAE

Entité juridique et second compte Stripe : **hors périmètre technique** (facturation gérée
hors plateforme, brief §11). Ce qui toucherait la plateforme :
- **tous les marchands sont déclarés aux Émirats** sur Google (`countryCode: 'AE'`, 00b F9,
  04 §4.4) : sans effet pour la nouvelle entité, mais faux pour la France (G8) ;
- **les comptes Apple Developer, Google Cloud et le domaine** portent l'identité des cartes
  (Team ID, Pass Type ID, émetteur Google, adresse gravée) : les transférer à une autre entité
  changerait cette identité, et les cartes installées devraient être réinstallées (HYPOTHÈSE,
  00b §4.2). À garder en tête si la nouvelle entité devait les détenir.

---
## 8. Les portes fermées

Un choix actuel qui rendrait un projet ou une idée lointaine impossible ou très coûteux
(brief §3).

| Choix actuel | Ce qu'il ferme | Pour rouvrir | Source |
|---|---|---|---|
| Identités écrites en dur : domaine (origine admise, replis, lien de parrainage Google), Pass Type ID, Team ID, « pays : Émirats » pour tous, logo de secours hébergé sur le dépôt | un changement de domaine ; une seconde identité ; rendre le dépôt privé | des variables, et le logo déplacé | 00b F9, §4.7 |
| Un même secret pour les sessions et le jeton de chaque carte Apple | toute rotation du secret des sessions sans casser les cartes installées | séparer les deux secrets (étape 7) | 04 §6.4 |
| Une clé unique qui ouvre toute la base | tout accès partiel : un outil d'analyse, un assistant IA, un prestataire | un rôle en lecture seule, ou des fonctions dédiées | 00b §4.1 |
| **Aucune colonne de canal** sur les crédits | séparer, plus tard, comptoir, bornes, caisses et e-commerce dans les statistiques | l'ajouter **avec** l'API machine : les crédits passés ne l'auront jamais | 05 §6.2 |
| **Aucune boutique d'inscription** | cibler par boutique un client jamais scanné | l'ajouter maintenant à la landing : chaque inscription sans elle est perdue pour la segmentation | 05 §6.3 |
| L'identifiant (slug) du marchand porte la classe Google, les images et les liens | renommer un marchand | un identifiant stable distinct du slug | passation §3.4 |
| Le dépôt ne reconstruit pas la base | un nouveau projet, une base de test, une restauration après perte du projet | étape 9 | 00a §5.1 |
| Un seul process qui fait tout, et un état en mémoire | deux serveurs, donc les vagues de l'e-commerce | cron à instance unique, cache et limiteurs partagés, minuteurs en base | 00b F5 |

**Idées lointaines** (rien n'est conçu ici, brief §3) :
- **Mailing** : pas de porte fermée. L'e-mail n'est collecté que par la landing premium, et le
  consentement est écrit sans que son échec soit vu (00b F2). Les coordonnées sont renvoyées
  à toute caisse (03 c7) : à réserver avant d'en collecter davantage (étape 7).
- **SMS** : même situation, avec le téléphone.
- **Assistant IA** : pas de porte fermée, si on lui donne un accès en lecture seule distinct
  de la clé unique, et des chiffres calculés en base plutôt que des listes limitées à 1 000
  lignes (étape 21).

---

## 9. Ce qu'il faut décider

### 9.1 Les questions à trancher, par impact

Chaque question tient en une phrase, avec ses options et leurs conséquences. Les gravités 1
à 3 sont en tête ; les questions qui se décident ensemble sont regroupées.

**A. L'argent (gravité 1)**

- **A1. Protection des données** — Restauration à la minute (Point in Time, environ 100 $ par
  mois, instance Small : perte ramenée à 2 minutes), copie des sauvegardes hors du compte
  (protège de la perte du compte, pas de la journée), les deux, ou rien (jusqu'à 24 heures de
  crédits perdus : un sacrifice de gravité 1, que le brief n'admet pas). (06 §6)
- **A2. Rattraper une erreur de caisse** (cas relevé en exploitation, §10.3), trois questions
  liées :
  - **A2a.** Retrouver le dernier scan d'un client sans liste bornée : la caisse scanne la
    carte et le serveur rend le dernier scan annulable de ce client (le problème disparaît),
    ou l'historique s'allonge jusqu'à 200 (il recule sans disparaître).
  - **A2b.** Une annulation depuis la fiche client du dashboard, qui montre déjà les 10
    derniers scans du client : elle couvre aussi le marchand mono-site qui scanne depuis le
    dashboard, où aucune annulation n'existe (02 §7.2) ; sans elle, il n'a que l'ajustement.
  - **A2c.** Un rattrapage qui passe par l'annulation (solde, journal et statistiques justes :
    les compteurs excluent les scans annulés, passation §13), ou l'acceptation que
    l'ajustement laisse les statistiques fausses (le scan reste compté comme une visite) et
    rompe la chaîne du journal (l'annulation suivante devient impossible, 02 D2d).
- **A3. Parrainage** — Le garder (corriger `credit_referral` avant tout marchand en points ;
  9 marchands l'ont aujourd'hui, dont aucun en production en mode points) ou le supprimer (un
  défaut de gravité 1 disparaît, le numéro de série n'est plus imprimé dans les liens ; les
  cartes Google existantes gardent leur lien). Dans les deux cas : que faire des filleuls
  déjà liés, qui créditeraient leur parrain une fois si le parrainage était rallumé ?
  (00b §13, 02 §4.4, 04 §4.8)

**B. Les machines (gravité 2)**, à décider ensemble avant l'étape 28

- **B1. Une borne face à un client au seuil** — Remise différée au prochain passage humain,
  bon imprimé, ou refus du crédit ; sans décision, la récompense est perdue en tampons et
  déduite sans cadeau en points. (02 §6.4)
- **B2. Le montant envoyé par une caisse** — Unité (centimes ou points), règle de conversion,
  plafond par crédit ; sans règle, un montant en centimes crédite cent fois trop. (02 §6.3)
- **B3. La forme de l'e-commerce** — Créditer des cartes existantes (brique des bornes) ou
  créer des porteurs par vagues (deux serveurs, inscription sans Google, capacité). (§7.9)

**C. Le comptoir et la continuité (gravité 3)**

- **C1. La rotation du secret, si `JWT_SECRET` s'avère court** — Tout de suite (toutes les
  caisses à reconnecter à la main, les cartes Apple intactes si leur secret est séparé
  d'abord), ou après le correctif de la caisse, étape 12 (exposition plus longue, sans
  caisses bloquées). (03 §4.2, 04 §6.4)
- **C2. L'heure du cron** — 08:00 UTC, soit midi à Dubaï et la fin de matinée en France à la
  cible ; étalé dans la nuit ; ou par fuseau de marchand (aucun fuseau en base). (00a §7.4,
  01 §9)
- **C3. L'exploitation**, qui se décide d'un bloc — Qui reçoit les alertes de la supervision
  (étape 5) ; l'offre Railway : rester en Hobby (journaux 7 jours, support communautaire) ou
  passer en Pro (30 jours, support direct). (06 P3, §8.3)

**D. Les notifications et la carte (gravités 5 et 6)**

- **D1. Plafond de relance** — Combien d'envois par épisode d'inactivité ; global ou par
  workflow ; réglable par marchand ou non. (A §1)
- **D2. Message Google vers les cartes iPhone** — Le couper maintenant (63 % des envois
  Google, avec un risque, non mesuré, d'éteindre une carte Google réellement installée), ou
  attendre les rappels de Google. (A §5.1)
- **D3. Cartes saisonnières** — Au fil des scans (les inactifs Apple gardent l'ancien design)
  ou en masse (≈ 81 000 régénérations à 100 000 porteurs). (§7.8)
- **D4. Géolocalisation** — Côté carte seulement, sans application (sous réserve de la
  documentation), ou avec une application, ce qui contredit une fonction intouchable. (§7.10)

**E. Les statistiques et l'apparence (gravités 7 et 8)**

- **E1. Les définitions** — Ce que mesure la « rétention » ; comparer à période égale ;
  compte rendu de campagne en clients plutôt qu'en appareils. À trancher avant le dashboard
  mono-site. (05 P4 à P6)
- **E2. La barre de points** — Au solde exact (un rendu bloquant par nouveau solde) ou par
  paliers de 5 %. (04 §5.3)

**F. Le nettoyage**

- **F1. Les candidats de Ponytail** — Retirer ou garder : outil de diagnostic caméra
  (campagne de mesure close ?), aperçu admin autonome, Sentry (l'activer ou le retirer), le
  service worker de l'admin, le script de charge qui vise la production, la colonne
  `montant_credite` (jamais lue). (02 §7.4, 04 §7.4, 05 §7.4, 06 §9.4)

### 9.2 Les sacrifices proposés

**Règle** (brief §5) : un sacrifice ne porte que sur un réglage, jamais sur l'argent, les
machines ni le scan (gravités 1 à 3). Les fonctions intouchables restent entières.

| Sacrifice | Ce qu'il retire | Ce qu'il protège | Coût | Limites | Source |
|---|---|---|---|---|---|
| Plafond de relance par épisode d'inactivité | des relances à un client qui ne revient pas et qui, sur iPhone, ne voit déjà plus que la première | la durée du cron, le registre, le quota Google, les régénérations | une colonne ou un comptage, un réglage | le nombre N est un choix (D1) | A §1 |
| Ne plus réécrire ni repousser une carte au texte identique | rien de visible : iOS ne l'affiche pas | ≈ 71 % des régénérations dues au cron | une condition | ne change rien côté Google | 04 P1 |
| Plus de message Google vers les cartes iPhone | la notification d'un client qui aurait la carte sur les deux plateformes (nombre non mesuré) | 63 % des envois Google, le quota | nul | faux positifs possibles ; les rappels de Google sont la vraie réponse | A §5.1 |
| Barre de points par paliers de 5 % | la barre au pixel près (le nombre exact reste dans le texte de la carte) | les rendus qui bloquent le serveur, le stockage | petit | décision d'apparence | 04 §5.3 |
| Un seul workflow par client et par nuit | un deuxième envoi le même matin, que le dernier écrase de toute façon | le quota Google, le cron | petit | ordre de priorité à choisir | dette #13 |
| Retrait des outils sans usage prouvé | des outils que personne n'ouvre | ≈ 1 800 lignes de code candidates, moins de surface | un chantier testé chacun | sur preuve d'usage nul seulement (F1) | Ponytail |
| Aperçu de la landing : l'image réelle au lieu de l'imitation | l'animation de l'aperçu | un seul rendu du bandeau à maintenir | petit | l'image doit exister | 04 P6 |

**Refusé par la règle, à décider autrement** : accepter la perte d'une journée de crédits à la
restauration (gravité 1, A1).

---
## 10. Transmissions intégrées et corrections consignées

Les rapports ne sont pas modifiés ; les corrections sont consignées ici.

### 10.1 Transmissions

| Transmission | Où elle est traitée |
|---|---|
| 05 c12 (gravité 1) : l'ajustement du solde est plafonné au seuil par l'écran (le serveur accepte jusqu'à 1 000 000) ; en mode points, le surplus disparaît au scan suivant ; pertes réelles NON VÉRIFIABLE | avec le chantier de l'ajustement du 02 (P5), étape 13 ; scénario du filet (§4.3) |
| 05 c6 (gravité 4) : après une session expirée, le dashboard garde les données du marchand précédent ; fuite en lecture seulement | avec les constats du 03, dans le verrouillage, étape 7 |
| Cas relevé en exploitation : l'historique du scanner ne montre que les 100 derniers scans | §10.3, étape 13, questions A2 |

### 10.2 Corrections

| Rapport | Ce qu'il disait | Ce qui est établi | Statut |
|---|---|---|---|
| 06 §5.7, c15 | 2 290 insertions pour 2 289 lignes du journal : « une ligne insérée n'existe plus », origine NON VÉRIFIABLE | Le compteur d'insertions de PostgreSQL compte aussi les lignes des transactions annulées : **une transaction annulée l'explique plus probablement qu'une ligne disparue**. **Nuance** : cette transaction annulée peut elle-même être une ligne de journal refusée, donc un crédit sans trace ; rien ne permet de le distinguer d'un essai manuel. I3d n'a pas été exécutée : le constat 15 reste **NON VÉRIFIABLE pour juin**. Sans effet sur la roadmap : l'étape 11 s'impose par le mécanisme, prouvé (02 §4.1). | HYPOTHÈSE forte |
| 00b §1 c2, §13 ; 02 §4.4 ; 03 §4.5 | parrainage coupé le 27/09 | pas coupé : 9 marchands l'ont encore (04 §10) ; aucun marchand en production n'est exposé en mode points (vérification de Yass) | PROUVÉ |
| 02 §4.2 ; 03 c7 ; 02 S5 | décomptes sur toute la base | recomptés sur les 17 marchands en production (§5.1) | HYPOTHÈSE (calcul) |
| 04 §6.1 ; 06 §8.2 | projections à 100 000 porteurs au facteur 100 000 / 1 728 | corrigées des comptes de démonstration (§5.1) | HYPOTHÈSE (calcul) |
| 02 §5.3 ; 05 M1 ; 06 §4.4, §6.2 | 30 scans par jour et par point de vente | non mesuré, mais compatible avec le ratio mesuré ramené au porteur : 27 à 38 (§5.1) | HYPOTHÈSE |
| Passation §2 [11] | le scanner demande l'historique avec `?limit=50` | il en demande 100 (`scanner/index.html:1313`) | PROUVÉ (code) |

### 10.3 Le cas des 100 derniers scans

**Le mécanisme, vérifié dans le code — PROUVÉ.**
- Le scanner charge les 100 derniers scans de la boutique (ou du marchand, avec un jeton
  marchand) (`scanner/index.html:1313` ; `scan.js:358-375`, 100 par défaut, 200 au plus).
- Il met le bouton « Annuler » sur le scan le plus récent de chaque client **dans cette
  liste** (`scanner/index.html:1337-1338`).
- Le serveur accepte d'annuler le dernier scan actif d'un client, **quelle que soit sa date**,
  si le solde n'a pas bougé depuis (`scan.js:376-403` ; 02 §4.5).
- Donc un scan encore annulable côté serveur disparaît de l'écran quand la boutique a fait 100
  scans depuis. Le seul recours est alors l'ajustement du dashboard, qui écrit une valeur
  absolue sans verrou (02 c8), plafonnée au seuil en points (05 c12), laisse le scan compté
  dans les statistiques et empêche toute annulation suivante (02 D2d).

**Exposition.** Aujourd'hui, 100 scans représentent environ trois semaines d'activité de la
boutique la plus chargée (Bron, 130 scans en septembre, 05 T2) ; l'annulation se fait en
médiane 53 secondes après le scan (02 S5). À 30 scans par jour, la fenêtre tomberait à
environ trois jours (HYPOTHÈSE). Aucun cas mesuré : rien n'en garde trace.

**Les trois questions de Yass** sont au §9.1 (A2a, A2b, A2c) ; le chantier, à l'étape 13,
après le filet.

---

## 11. Pour la personne qui supervisera

### 11.1 Ce qu'il faut relire d'abord

1. Cette synthèse : §4 (roadmap) et §9 (décisions).
2. `PASSATION_TECHNIQUE.md` : §3 (pièges), §5 et §14 (zones dangereuses), §15 ter
   (autorisation et cache), en tenant compte des écarts du §11.2.
3. 02 §3 (la chaîne du scan, pas à pas) et §10 (les scénarios du filet).
4. 06 §2 (calendrier), §5 (redéploiement), §6 (sauvegardes).
5. 00a §5.1 (les droits absents du dépôt : une base rejouée ne fonctionne pas).
6. 04 §4.2 (le piège de la liste et de l'horodatage) et §6.4 (la rotation du secret).
7. 00b annexes A et B : l'inventaire des erreurs non lues, à garder comme liste de contrôle.

**Dans le code, par ordre de risque** : `routes/scan.js` ; `migration_023` (le crédit) et
`migration_038` (l'annulation) ; l'ajustement dans `routes/clients.js` ;
`middleware/auth.js` et `services/marchand-cache.js` ; `workers/cron.js` ;
`routes/apple-wallet.js` ; `index.js` et `railway.toml`.

### 11.2 Là où la passation n'est plus exacte

| Passation | Ce que dit l'audit | Source |
|---|---|---|
| §1 : « Wam N Fade est en points ; tous les autres en tampons » | 8 marchands en production sont en points et font 65 % des scans réels | §5.1 |
| §1 : « aucune révocation possible » | révocation par marchand depuis la migration 045 (grossière : toutes les caisses ensemble) | 03 c11 |
| §2 [11] : historique du scanner à `?limit=50` | 100 | §10.2 |
| §3.9, §15 quater : les `.catch()` sur Storage sont légitimes | Storage ne rejette pas non plus | 00b §10 |
| §15 quater : le filtre « mises à jour depuis » inerte est une hypothèse | prouvé | 04 §4.2 |
| §15 sexies, A §5.2 : une mise à jour d'objet Google consomme peut-être le quota | non : seuls les messages le consomment | 04 §4.5 |
| A §5.1 : `google_pass_url` dit si une carte Google existe | non : toutes les cartes l'ont | 00b §10 |
| 03 R2 : « Yass a l'accès seul » | vrai des comptes ; le dépôt a un second accès en écriture, voulu | 06 §5.5 |

---

## 12. Hypothèses, angles morts et décisions

### 12.1 Hypothèses et angles morts propres à la synthèse

| Point | Statut | Ce qui trancherait |
|---|---|---|
| Ratios du parc réel (§5.1) : l'activité par porteur reste celle d'aujourd'hui, sur des bases jeunes | HYPOTHÈSE | le même calcul dans trois mois |
| Correction des projections gonflées : les cartes de démonstration sont relancées au rythme maximal | HYPOTHÈSE | K1 du 04, filtrée sur les 17 marchands |
| Coût à 100 000 porteurs | HYPOTHÈSE | grille des instances Supabase, page d'usage |
| Gain du serveur en Europe | HYPOTHÈSE | mesure avant et après (étape 6, méthode de 00a §7.2) |
| Fonctions de lieu d'Apple et de Google (géolocalisation) | HYPOTHÈSE | documentation officielle, puis essai sur le cobaye |
| Adresse vue par les limiteurs (proxy de Railway) | HYPOTHÈSE forte (02 §4.8) | en-têtes reçus par le serveur, étape 17 |
| Seuils du tableau de capacité | calculs de l'audit, jamais mesurés | le test de charge, étape 15 |
| Crédits sans trace avant le 25/09, et en juin | NON VÉRIFIABLE | aucune trace n'existe (I3d n'aurait tranché que juin) |

Les angles morts de chaque segment restent dans leur rapport (00a §9, 00b §12, 02 §12, 03 §11,
04 §12, 05 §12, 06 §14).

### 12.2 Décisions de pilotage appliquées

| Date | Décision | Où elle joue |
|---|---|---|
| 26-28/09 | Sécurité traitée après l'audit : dépôt public, droits d'exécution des fonctions, secrets, protection de branche | étape 7 |
| 27/09 | Constat 5 du 03 (boutique coupée qui garde l'annulation) : risque accepté | non repris dans la roadmap ni dans le filet |
| 27/09 | Une visite = un scan : marge d'erreur acceptée | §5, aucune proposition de regroupement |
| 27/09 | Parrainage en mode points : aucun marchand exposé aujourd'hui | question A3, correctif conditionnel à l'étape 14 |
| 28/09 | Second collaborateur GitHub connu et voulu, non nommé | §3.3, §11.2 |
| 29/09 | Plan validé ; serveur en Europe placé dans les réglages parallèles (étape 6), sans le test de charge pour prérequis ; structure UAE hors périmètre technique ; géolocalisation en verdict conditionnel ; nuance ajoutée à la correction du 06 ; questions classées par impact ; coût à partir du Socle ; parc réel de 17 marchands | tout le document |

### 12.3 Décisions hors pilotage

- La branche locale de la session avait 18 commits de retard sur la branche distante (les
  rapports 01 à 06) : elle a été avancée sans rien perdre, aucun changement local n'existant.
- Le cas des 100 derniers scans a été vérifié par lecture du code (§10.3) ; rien n'a été
  exécuté.
- Les ratios du parc réel ont été calculés sur les résultats publiés du 05 (T1) et du 04
  (K3), sans requête nouvelle.
- Sur instruction de Yass, `PASSATION_TECHNIQUE.md` n'est pas modifiée : ce qui est livré et
  décidé est consigné ici. **Livré** : ce document. Aucun code, aucune migration, aucune
  requête exécutée.
