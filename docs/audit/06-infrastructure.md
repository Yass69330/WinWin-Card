# Audit WinWin — Segment 6 : infrastructure et calendrier des échéances

> Sixième segment de l'audit, après la photo de production (00a), la cartographie
> (00b), les notifications (01), le scan et le crédit (02), l'accès et les données (03),
> les cartes (04) et les statistiques (05). Question posée par le brief (§6) : **le
> serveur, la base, les tâches automatiques, les sauvegardes, la surveillance et le
> déploiement**, sous trois angles : **ce qui tient la charge, ce qui survit à une panne
> ou à un redéploiement, ce qui expire.** Livrable central : **un calendrier daté des
> échéances**, avec ce qui casse à chacune (§2).
> Même règle que les rapports précédents : **tout constat est rattaché à une preuve**
> (fichier:ligne, commit, requête, relevé, documentation). Ce qui n'a pas pu être prouvé
> est marqué comme tel et n'est jamais comblé par une reconstitution. Le dépôt étant
> public, le rapport décrit des constats et leurs preuves, **jamais un mode opératoire**
> (décision de pilotage du 26/09).

| | |
|---|---|
| **Date** | 2026-09-28 |
| **Commit audité** | `d166af8` (branche `claude/keen-goldberg-MXslu`). Le code applicatif y est identique à `ca0579a`, en production depuis le 25/09 à 22:08 UTC (`git diff ca0579a d166af8 -- winwincard/` est vide). |
| **Dernière migration du dépôt** | `047_avis_google` |
| **Périmètre** | Railway (service, construction, déploiement, offre), Supabase (base, instance, sauvegardes, quotas, clés d'API), GitHub (branches, accès), comptes Apple et Google, domaine et DNS, supervision ; dans le dépôt : `index.js`, `instrument.js`, `services/supabase.js`, `railway.toml`, `package.json`, `.nvmrc`, `.env.example`, la planification du cron |
| **Méthode** | lecture du code et de l'historique git ; documentation officielle lue à la source quand c'était possible (dépôts publics de Railway, Supabase, Nixpacks, Railpack, PostgREST, calendrier de Node ; pages Apple) ; API GitHub en lecture ; DNS public ; base de référence rejouée depuis le dépôt (PostgreSQL 16, 48 fichiers, 0 échec) pour tester chaque requête ; requêtes I1 à I3, puis I3b et I3c, en lecture seule (`docs/audit/06-requetes.sql`), exécutées par Yass le 28/09 ; relevés de Yass du 28/09 (Supabase, Railway, Apple, domaine) |
| **Limites de méthode** | aucun accès direct à la production ; les serveurs publics d'enregistrement des domaines (RDAP) et plusieurs sites de documentation (Google Cloud, apple.com, supabase.com, railway.com) sont bloqués par la politique réseau du conteneur : dates du domaine par relevé, règles de Google et d'Express par extraits de moteur de recherche (marquées HYPOTHÈSE forte) ; métriques Railway, clé Google, restrictions réseau de la base et réglages d'UptimeRobot non relevés (décision de pilotage du 28/09) |

### Légende

| Marque | Sens |
|---|---|
| **PROUVÉ** | vérifiable par le fichier:ligne, le commit, la requête, le relevé ou la documentation cités |
| **HYPOTHÈSE** | raisonnement cohérent, non vérifié — ce qui le confirmerait est indiqué |
| **NON VÉRIFIABLE** | la preuve n'existe pas ou n'est pas accessible — la raison est donnée |

La **gravité** (colonne « G ») suit l'échelle du brief (§4) : **1** argent des clients ·
**2** trafic machine (projection) · **3** scan au comptoir · **4** données et accès ·
**5** notifications · **6** carte dans le téléphone · **7** statistiques · **8** apparence.
« — » : sans conséquence directe, ou coût.

---

## 1. En une page

**La plateforme tient la charge d'aujourd'hui avec une marge considérable. Ce qui la
menace, ce sont des échéances et des réglages que personne ne suit.** La base fait
22 Mo, tient entièrement en mémoire et ne passe que 0,002 % de son temps à exécuter les
requêtes du serveur ; le serveur consomme 2,64 $ d'usage par mois. En revanche, **la clé
qui ouvre la base cessera de fonctionner d'ici la fin de 2026**, **une restauration
ferait perdre jusqu'à une journée de crédits**, et **quatre échéances tombent en huit
semaines au printemps 2027**, sans qu'aucune alerte n'existe.

| # | Constat | G | Statut |
|---|---|---|---|
| 1 | **Le serveur utilise une clé historique de Supabase, que Supabase supprime d'ici la fin de 2026** : ce jour-là, toute la plateforme s'arrête (scan, inscriptions, cartes, dashboards, cron). Le healthcheck ne verrait pas une clé de remplacement erronée. **En tête du calendrier.** | 3 | PROUVÉ (relevé, documentation Supabase) ; date exacte « à confirmer » par Supabase |
| 2 | **Une restauration ferait perdre jusqu'à 24 h de données** (sauvegarde quotidienne vers 03:06 UTC, sans Point in Time) : en moyenne **56 crédits** (dont 2 191 points en mode points), **40 inscriptions dont 27 cartes installées sur iPhone qui deviendraient orphelines**, 34 appareils enregistrés ; au pire **141 crédits** et 96 inscriptions en une fenêtre. Rien ne permet de reconstituer la journée perdue. | 1 | PROUVÉ (I2, relevé, documentation) |
| 3 | **Les sauvegardes vivent dans le même compte que la base, et disparaissent avec le projet.** Aucune copie ailleurs. L'identité qui commande Supabase (le compte GitHub, 03) peut effacer les données et leurs sauvegardes ensemble. | 1 (escalade, 03) | PROUVÉ (documentation, dépôt) / HYPOTHÈSE (aucun export manuel) |
| 4 | **Le temps d'un scan est presque entièrement du transport** : environ **12 ms d'exécution dans la base** pour environ **0,8 s d'allers-retours** avec elle (1,5 %). La puissance de la base n'y est pour rien ; la distance, si. | 3 | PROUVÉ (I3, code) |
| 5 | **Offre Pro, instance Nano** : 0,5 Go de mémoire, facturée au prix d'une Micro (1 Go) d'après la documentation. Suffisante aujourd'hui ; la taille de base conseillée pour une Nano (500 Mo) serait atteinte vers **35 000 à 40 000 porteurs**. Le Point in Time exige une instance Small. | 3 (projection) | PROUVÉ (relevé, documentation) / HYPOTHÈSE (projection) |
| 6 | **Spend cap activé** : la base passe en lecture seule à 95 % d'un disque de 8 Go, que le spend cap empêche de grandir ; le trafic sortant est plafonné à 250 Go par mois. Loin aujourd'hui (22 Mo ; environ 1 Go par mois estimé) ; à la cible, environ 13 ans de scans pour le disque et 6 à 8 fois la cible pour le trafic. Au-delà, le crédit échoue au comptoir. | 3 | PROUVÉ (documentation, relevé) / HYPOTHÈSE (volumes) |
| 7 | **Node est figé sur 24.10.0 par un constructeur en mode maintenance** (Nixpacks) : aucun correctif de sécurité de Node depuis octobre 2025, et un changement de constructeur ferait sauter la version majeure sans aucun commit. | 6 · 4 | PROUVÉ (code de Nixpacks, archive épinglée, relevé) |
| 8 | **Le redéploiement coupe net** : démarrage par `npm start` (le signal d'arrêt n'atteint pas l'application), recouvrement et drainage à 0 s par défaut, healthcheck au seul déploiement et sans la base, 3 redémarrages au plus puis arrêt. | 1 (hérité, 02) · 3 | PROUVÉ (config, documentation) |
| 9 | **34 commits en 30 jours sur la branche de production, dont 16 de documentation seule et 23 entre 10 h et 20 h UTC** ; branche non protégée ; **deux accès en écriture** au dépôt, le second voulu (décision du 28/09). | 4 | PROUVÉ (git, API GitHub) |
| 10 | **La supervision ne voit ni la base, ni le cron, ni les échéances** : une seule sonde externe, sur une route qui ne touche pas la base ; Sentry inactif ; journaux gardés 7 jours. Le premier à s'apercevoir d'une panne est un commerçant. | 3 · 5 | PROUVÉ / NON VÉRIFIABLE (réglages de la sonde) |
| 11 | **Printemps 2027** : adhésion Apple (fin avril – début mai), domaine (fin avril – début mai), premiers jetons caisse expirés (26/05), certificat Pass Type ID (juin). Le domaine arrête tout ; l'adhésion coupe les notifications des cartes Apple. | 3 · 6 | mois connu, jour et renouvellement automatique à relever |
| 12 | **`JWT_SECRET` n'existe qu'à un seul endroit connu, la variable Railway** : c'est le seul secret irremplaçable (sa perte fige toutes les cartes Apple installées). | 6 · 3 | HYPOTHÈSE (03, R1) / PROUVÉ (conséquence, 04) |
| 13 | **Près de 95 Go de fichiers temporaires écrits depuis le 07/05 pour une base de 22 Mo, dont aucun par le serveur de WinWin** (0 pour 501 264 appels depuis le 23/05). Les statistiques de requêtes n'en attribuent que 3,4 Go, tous au rôle de l'éditeur SQL ; le reste leur échappe. Sans effet sur le scan. | — | PROUVÉ (I3, I3b) / NON VÉRIFIABLE (origine des 91 Go restants) |
| 14 | **L'offre Railway Hobby ne bloque pas la cible technique** ; elle limite les journaux (7 jours), le support (communautaire) et la collaboration. | — | PROUVÉ (documentation, relevé) |
| 15 | **Recoupement pour le constat de gravité 1 du 02** : 2 271 crédits réussis pour 2 289 lignes de journal depuis le 23/05. Les 18 premières lignes précèdent le push du crédit par fonction (04/06, 10:50:41 UTC) ; 21 scans ont suivi le même jour. **Depuis la mise en ligne du crédit par fonction, au plus 21 crédits ont perdu leur ligne de journal, et aucun si le 19e scan est passé après cette mise en ligne** (I3d, facultative, le tranche). Du 23/05 au 04/06, le recoupement ne voit rien. | 1 (preuve) | PROUVÉ (I3, I3c, git, API GitHub) / HYPOTHÈSE (heure de mise en ligne) |
| 16 | **Ce qui va bien, mesuré** : serveur en UTC (hypothèse du 05 levée), base sans redémarrage depuis 128 jours, 6 connexions sur 60, 100 % des lectures servies par le cache, aucun interblocage, archivage des journaux de transactions sans échec, certificats TLS renouvelés automatiquement sans restriction DNS. | — | PROUVÉ |
| 17 | **Ponytail** : quelques candidats, surtout des liens morts déjà connus ; aucun garde-fou. | — | liste de candidats |

**Ce que cela dit pour la roadmap.** L'ordre est dicté par les dépendances :
1. **avant la fin de 2026, remplacer la clé historique**, et **d'abord** rendre visible au
   déploiement une base injoignable, sans quoi une erreur de clé remplacerait une version
   saine (§5.1, P1, P2) ;
2. **décider de la protection des données** : copie des sauvegardes hors du compte
   Supabase, Point in Time (qui suppose de quitter la Nano), ou ni l'un ni l'autre, en
   connaissant la perte (§6, P4, P5) ;
3. **préparer les renouvellements du printemps 2027** (P12) ;
4. **rapprocher le serveur de la base**, le seul levier qui réduise réellement le temps
   d'un scan, en France comme à Dubaï (§4.3, P10).

La protection de la branche de production et les chemins surveillés par Railway relèvent
du verrouillage post-audit déjà décidé (§15).

---

## 2. Le calendrier des échéances

Classé par date, **sauf la première ligne, placée en tête parce qu'elle est la plus
proche des échéances aux conséquences totales** (décision de pilotage du 28/09).

| # | Date | Échéance | Ce qui casse si on la rate | Qui agit | Statut et preuve |
|---|---|---|---|---|---|
| **1** | **Fin 2026** (« Late 2026 (TBC) » ; « by the end of 2026 ») | **Suppression des clés d'API historiques de Supabase. Le serveur en utilise une.** | **Toute la plateforme** : les appels du serveur à la base et au stockage échouent tous ; au comptoir, « carte introuvable » ou « accès coupé » (une panne se lit comme une absence, 00b F3) ; plus d'inscription, de mise à jour de carte, de dashboard ni de cron. Une clé de remplacement erronée passerait le healthcheck (§5.1). | Yass (Supabase, variables Railway) | **PROUVÉ** : `SUPABASE_SERVICE_KEY` commence par `eyJ` (relevé du 28/09) ; documentation Supabase : « deprecating the `anon` and `service_role` keys by the end of 2026 » ; discussion Supabase #29260 : « Legacy API keys will be deleted […] migrate […] by this point or your app will break ». Date exacte : « à confirmer » par Supabase. |
| 2 | 01/10/2026 au plus tôt | Fin de maintenance d'Express 4, objectif affiché du projet, qui peut être repoussé | plus de correctifs de sécurité pour le serveur web ; rien ne casse le jour même | dev | HYPOTHÈSE forte (extraits) ; Express 4.22.2 verrouillé (`package-lock.json`) |
| 3 | 20/10/2026 | Node 24 passe en maintenance | sans effet direct : la production est figée sur 24.10.0 (§5.2) | — | PROUVÉ (calendrier officiel de Node) |
| 4 | vers le 26/10/2026 | Première purge de la table de déduplication du cron (90 jours après sa plus ancienne ligne, 28/07, 04 K1) | rien : la table cesse de grandir (3 015 lignes, jamais purgée à ce jour, I1) | — | PROUVÉ (code `cron.js:262-273`, I1) |
| 5 | 28/10/2026 | Node 26 devient LTS | si le constructeur change (Railpack), la production passe à la version la plus récente autorisée par `>=22.0.0`, sans commit : signature des cartes Apple, `sharp`, `@resvg/resvg-js` non éprouvés | dev, Yass | PROUVÉ (calendrier ; règles des deux constructeurs) / HYPOTHÈSE (le changement de constructeur) |
| 6 | 30/10/2026 | Supabase étend aux projets existants la fin de l'exposition automatique des nouvelles tables | sans effet attendu : le réglage est déjà désactivé (relevé 00b) ; toute nouvelle table exige ses droits explicites, règle appliquée depuis la 028 | — | PROUVÉ (relevé) / HYPOTHÈSE (effet) |
| 7 | vers le 24/12/2026 | Première purge du registre des envois (90 jours après son ouverture, 25/09) | rien | — | PROUVÉ (code `cron.js:274-282`) |
| 8 | 30/04/2027 | Fin de vie de Node 22, la version annoncée par `.nvmrc` et le Socle | rien en production (Node 24) ; une reconstruction qui suivrait la documentation tournerait sans correctifs | dev | PROUVÉ |
| 9 | **fin avril – début mai** (année à relever ; HYPOTHÈSE : 2027) | **Adhésion Apple Developer** | **notifications push désactivées** : plus aucune carte Apple ne se met à jour d'elle-même ; plus d'accès aux certificats, donc impossible de renouveler celui de juin | Yass | **mois connu, jour et renouvellement automatique à relever** (relevé du 28/09) ; effets : page officielle Apple « Program Renewal » ; renouvellement automatique proposé en France et aux Émirats |
| 10 | **fin avril – début mai** (année à relever ; HYPOTHÈSE : 2027) | **Domaine `winwin-card.com`** (registraire et zone DNS chez le même fournisseur) | **tout** : API, scanner, dashboard, landing, vitrine, et l'adresse gravée dans chaque carte Apple installée (plus aucune mise à jour) | Yass | **mois connu, jour et renouvellement automatique à relever** (relevé du 28/09) ; même fournisseur pour la zone : DNS public du 28/09 |
| 11 | à partir du 26/05/2027 | Premiers jetons caisse de 365 jours : le scanner les demande depuis `4ac29e2` (26/05/2026) | une caisse qui ne s'est pas reconnectée depuis un an affiche un message brut et reste bloquée un matin (dette #1, 02 §4.7) | dev (dette #1) | PROUVÉ (git, `scanner/index.html:804`, `scanner-auth.js:25`) ; nombre de caisses concernées NON VÉRIFIABLE (jetons sans état) |
| 12 | **juin 2027** (jour à relever) | **Certificat de signature Pass Type ID** | plus aucune carte Apple installable ni mise à jour ; les cartes installées restent, figées sur leur dernier état | Yass (portail Apple, variables Railway) | date : Socle ; effets : **PROUVÉ** (page officielle Apple « Certificates ») |
| 13 | 30/04/2028 | Fin de vie de Node 24, la version de production | plus de correctifs | dev | PROUVÉ |
| 14 | 2030 | Intermédiaire Apple WWDR G4, émetteur des certificats Pass Type ID depuis le 27/01/2022 | chaîne de signature des cartes | Yass | PROUVÉ (page officielle Apple « WWDR Intermediate Certificate Expiration ») ; génération réellement en place : HYPOTHÈSE (certificat émis en 2026) |

**Le printemps 2027.** Entre la fin d'avril et la fin de juin 2027 tombent l'adhésion
Apple, le domaine, les premiers jetons caisse d'un an et le certificat Pass Type ID :
**quatre échéances en huit semaines**, dont deux (domaine, adhésion) arrêtent tout un
canal. Le certificat de juin ne peut être renouvelé que si l'adhésion l'a été.
**HYPOTHÈSE** sur l'année de l'adhésion et du domaine (la plateforme a ouvert en mai
2026 ; un premier engagement d'un an expirerait au printemps 2027).

### 2.1 Les échéances récurrentes

| Rythme | Échéance | Si elle échoue | Statut |
|---|---|---|---|
| mensuel | paiement Railway (offre Hobby, 5 $ par mois minimum) | relances pendant plusieurs jours, avertissement, puis **services arrêtés** jusqu'au paiement ; redéploiement automatique si l'impayé est réglé dans les 30 jours | PROUVÉ (documentation Railway, FAQ tarifs) |
| mensuel | paiement Supabase (offre Pro) | facture en retard : **projets mis en pause et organisation repassée en offre gratuite**, donc **sans sauvegardes** ; et, depuis le 01/11/2025, un projet rétabli revient **sans clés historiques** : avec la clé actuelle, la plateforme ne redémarrerait pas avant le changement de clé | PROUVÉ (documentation Supabase, discussion #29260) / HYPOTHÈSE (enchaînement) |
| mensuel | quotas Supabase couverts par le spend cap : disque (8 Go), trafic sortant (250 Go), fichiers (100 Go) | lecture seule ou refus de toutes les requêtes (§4.4) | PROUVÉ (documentation, relevé) |
| annuel | adhésion Apple, domaine | lignes 9 et 10 | mois connu |
| — | moyen de paiement commun aux comptes | toutes les échéances ci-dessus en même temps | NON VÉRIFIABLE (non relevé) |

### 2.2 Les fenêtres qui se referment seules

| Fenêtre | Durée | Ce qui est perdu au-delà | Statut |
|---|---|---|---|
| journaux Railway | 7 jours (offre Hobby ; 30 en Pro) | toute trace d'un incident signalé plus tard | PROUVÉ (documentation, relevé 02) |
| sauvegardes Supabase | 7 jours (offre Pro) | une corruption découverte après 7 jours ne se répare plus | PROUVÉ (documentation) ; plus ancienne sauvegarde non relevée |
| retour arrière Railway sur une version retirée | 72 h (Hobby ; 120 h en Pro) | au-delà, un « redéploiement » reconstruit depuis le code avec le constructeur du jour (§5.2) | PROUVÉ (documentation) |
| registre des envois, déduplication du cron | 90 jours | historique des envois | PROUVÉ (code) |
| statistiques des requêtes (`pg_stat_statements`) | depuis le 23/05, tant que la base ne les remet pas à zéro | les preuves des segments 03, 05 et 06 | PROUVÉ (I3) |

### 2.3 Sans échéance

| Élément | Pourquoi | Ce qui reste à surveiller | Statut |
|---|---|---|---|
| clé APNs (`.p8`) | une clé à jeton n'expire pas | elle ne se **télécharge qu'une fois** ; si ses deux copies connues (MacBook, variable Railway) étaient perdues, il faudrait en créer une autre | pas d'expiration : HYPOTHÈSE forte (extraits) ; téléchargement unique : PROUVÉ (page Apple) |
| clé du compte de service Google | une clé créée sans politique d'organisation n'expire pas | une politique d'expiration ne vaut que pour les clés créées après elle | HYPOTHÈSE forte (documentation par extraits ; relevé abandonné) |
| certificats TLS de `app.winwin-card.com` | Let's Encrypt, 90 jours, renouvelés à 30 jours de la fin par Railway | le domaine doit rester actif et pointer vers Railway ; **aucun enregistrement CAA** ne restreint l'émission | PROUVÉ (documentation Railway, DNS public) |
| certificat de la vitrine `winwin-card.com` | GitHub Pages | idem | HYPOTHÈSE (non instruit) |

---

## 3. Méthode

- **Code et git** : lecture des fichiers d'exploitation au commit `d166af8` ; historique
  complet de la branche de production (242 commits) pour dater les jetons, le crédit par
  fonction et le rythme des déploiements.
- **Documentation officielle**, lue à la source quand c'était possible : dépôts publics
  de la documentation de Railway (commit `93aea39`, 26/09) et de Supabase (commit
  `8e20712`, 28/09), code source de Nixpacks et de Railpack, archive `nixpkgs` épinglée par
  Nixpacks, calendrier officiel de Node, code de PostgREST ; pages Apple lues directement
  (certificats, renouvellement de l'adhésion, intermédiaires, clés) ; discussion Supabase
  #29260 ; Express et Google Cloud par extraits de moteur de recherche (HYPOTHÈSE forte).
- **API GitHub**, en lecture : branches (champ « protégée ») et collaborateurs du dépôt ;
  historique des pushes de la branche de production (activité du dépôt), pour dater la
  mise en ligne du crédit par fonction.
- **DNS public** : serveurs de noms, enregistrements CAA et SOA du domaine, résolution de
  `app.winwin-card.com`.
- **Base de référence** rejouée depuis le dépôt (méthode de 00a, annexe B), avec les
  droits `service_role` des 7 tables et `pg_stat_statements` actif. I1 à I3 y ont été
  testées à vide puis sur un jeu fabriqué dont chaque résultat était calculé à la main
  (tous obtenus), sous un rôle sans privilège de superutilisateur ; pour I3, chaque étape
  du scan rejouée sous `service_role` dans la forme exacte de PostgREST, avec quatre
  témoins négatifs (aucun compté). Durées au volume de la production : moins de 25 ms.
- **Production** : I1 à I3 exécutées par Yass le 28/09 vers 20:12 UTC, puis les requêtes
  de suivi I3b et I3c dans l'heure suivante (annexe A). I3d, facultative, n'est pas
  exécutée.
- **Relevés du 28/09** : spend cap, sauvegardes, instance (Supabase) ; début de la clé du
  serveur ; offre, plafonds et facture (Railway) ; mois d'expiration de l'adhésion Apple
  et du domaine.

---

## 4. Ce qui tient la charge

### 4.1 Le serveur : un seul fil d'exécution, presque inoccupé

**PROUVÉ (code).** Le serveur est un seul process Node : ni `cluster` ni `worker_threads`
dans `src/` (vérifié). Le JavaScript de toutes les requêtes s'exécute sur un seul cœur ;
seuls `sharp`, `openssl` (signature des cartes, process séparé) et les entrées-sorties
utilisent les autres. **Le plafond de l'offre (8 vCPU et 8 Go par instance, relevé) est
donc une limite que le code ne peut pas atteindre.**

**PROUVÉ (relevé, barème public).** La facture d'août-septembre est de 5,00 $, le minimum
de l'offre Hobby, pour **2,64 $ d'usage réel**. Au barème de Railway (20 $ par vCPU et
10 $ par Go de mémoire, par mois), cela borne la consommation moyenne à **moins de
0,13 vCPU ou moins de 0,26 Go** (chacun s'il avait porté seul toute la facture) : en
réalité, les deux sont plus bas. Les pointes (passage du cron, campagnes) ne sont pas
mesurées : métriques non relevées, **NON VÉRIFIABLE**.

Ce qui limitera le serveur n'est donc pas sa puissance mais **son fil unique** : un rendu
d'image (23 à 136 ms, 04 M2) ou une vérification de mot de passe (35 ms, 00b §4.4) bloque
toutes les requêtes en cours, scans compris (hérités).

### 4.2 La base : offre Pro, instance Nano

**Ce qu'est la combinaison — PROUVÉ (relevé, documentation Supabase).** La documentation
est explicite : on ne peut pas créer une instance Nano sur une offre payante ; **une Nano
n'existe sur une offre payante qu'après un passage de l'offre gratuite à l'offre Pro**,
et Supabase ne la met pas à niveau d'office, parce que cela interrompt le service. **Dans
une organisation payante, une Nano est facturée au prix d'une Micro.** La production paie
donc une Micro et tourne sur une Nano. **HYPOTHÈSE** sur l'histoire : projet créé en offre
gratuite (compteurs de la base depuis le 07/05, I3), passé en Pro plus tard, sans
changement d'instance.

| | Nano (production) | Micro (même prix) | Small |
|---|---|---|---|
| mémoire | jusqu'à 0,5 Go | 1 Go | 2 Go |
| taille de base conseillée | 500 Mo | 10 Go | 50 Go |
| connexions directes / via le pooler | 60 / 200 | 60 / 200 | 90 / 400 |
| processeur | partagé | partagé | partagé |
| Point in Time possible | non | non | **oui** |

Changer d'instance interrompt le service, « en général moins de 2 minutes » (documentation).

**Aujourd'hui — PROUVÉ (I1, I3).**

| Mesure | Valeur | Lecture |
|---|---|---|
| taille de la base | 22 Mo (application 7 Mo, fiches de fichiers 3,4 Mo, `auth` 1,2 Mo, catalogue et plateforme 10 Mo) | 4 % de la taille conseillée pour une Nano |
| lectures servies par le cache | 100,00 % | toute la base tient en mémoire (cache partagé de 224 Mo, 05 T4) |
| connexions ouvertes | 6 sur 60 : plateforme 2, PostgREST 1, pooler 1, éditeur 1, stockage 1 | marge très large |
| appels du serveur | 3 918 par jour, 0,42 ms d'exécution en moyenne | la base passe **0,002 %** de son temps sur les requêtes du serveur |
| transactions | 5,7 millions validées, 11 909 annulées (0,2 %) depuis le 07/05 | environ 39 600 par jour, dont 3 918 venues du serveur : **le reste vient de la plateforme Supabase** (HYPOTHÈSE sur la répartition) ; les annulations ne sont pas attribuables |
| interblocages | 0 | — |
| dernier redémarrage | 23/05 à 22:35 UTC | **128 jours sans redémarrage** |
| journaux de transactions écrits | 2,3 Mo par jour | très peu d'écritures |

**À la cible — HYPOTHÈSE (calcul, §8.2).** La base grossit d'environ **12 Ko par
porteur** (fiche, carte, appareil, 90 jours de registre et de déduplication) et de
**358 octets par scan**, jamais purgé. La taille conseillée pour une Nano (500 Mo) serait
atteinte **vers 35 000 à 40 000 porteurs**. Au-delà, la base ne tient plus dans la
mémoire, les lectures vont au disque, et une Nano a le plus petit budget d'entrées-sorties
(documentation : un surplus est permis, puis retour au débit de base). Les connexions ne
sont pas une limite.

### 4.3 Où passe le temps d'un scan

**PROUVÉ (I3, code).** Temps d'exécution **dans la base**, moyennes depuis le 23/05, appels
du serveur seulement :

| Étape du scan (00a §7.3, 02 §3.1) | Appels | Moyenne | Maximum |
|---|---|---|---|
| état du marchand (cache de 60 s expiré) | 409 | 0,40 ms | 2,8 ms |
| statut de la boutique du jeton | 356 | 0,40 ms | 3,1 ms |
| test du réseau (jeton marchand) | 1 604 | 0,13 ms | 1,9 ms |
| client par numéro de série | 2 199 | 0,85 ms | 13,4 ms |
| client par code de secours | 74 | 2,58 ms | 17,1 ms |
| **crédit** (`increment_stored_value`) | 2 271 | **5,52 ms** | 37,6 ms |
| texte de la carte (partagé avec parrainage, avis, ajustement, annulation) | 2 549 | 2,44 ms | 28,1 ms |
| **journal du scan** | 2 289 | **5,67 ms** | 47,1 ms |

Un scan ordinaire (boutique ou réseau, client, crédit, puis carte et journal en parallèle)
passe **environ 12 ms à s'exécuter dans la base**. Il paie pourtant **4 allers-retours
d'environ 200 ms** (00a, 02 S7), soit **environ 0,8 s : 98,5 % du temps passé avec la base
est du transport** entre la Californie et Paris, pas du calcul. Les écritures coûtent
environ 5 ms (validation sur un disque réseau), les lectures moins d'une milliseconde.
Cela tranche la question laissée ouverte par 00a (§7.3, §9) et 02 (§12).

**Conséquence.** Deux leviers seulement changent la durée d'un scan : **la distance**
entre le serveur et la base, et **le nombre d'allers-retours** (02, P1). Une base plus
puissante n'y changerait rien. Railway propose une région en Europe de l'Ouest (Amsterdam,
documentation des régions) : **HYPOTHÈSE** sur le gain, de l'ordre de 0,8 s à moins de
0,1 s pour la part base, et un trajet plus court aussi depuis Dubaï (P10). Les appels à
Apple et à Google partent après la réponse du scan : leur distance ne pèse pas sur la
caisse (00a §7.3).

### 4.4 Le spend cap : à quel volume la base se bloque, et ce que le scan en subirait

**Les règles — PROUVÉ (documentation Supabase, relevé).** Le spend cap est activé ; le
tableau de bord l'annonce : dépasser le quota inclus « peut rendre le projet injoignable
ou le passer en lecture seule ». Il couvre notamment le disque, le trafic sortant et le
volume des fichiers. Une fois un quota dépassé, l'usage est refusé jusqu'au cycle suivant,
et des restrictions s'appliquent à **tous les projets de l'organisation** : base en lecture
seule, ou **réponse 402 à toutes les requêtes**.

| Quota (offre Pro) | Règle | Aujourd'hui | Seuil, en volume | Statut |
|---|---|---|---|---|
| **disque** : 8 Go | avec le spend cap, **le disque ne s'agrandit pas au-delà de 8 Go** ; **lecture seule à 95 %**, levée d'elle-même sous ce seuil ; le disque compte la base, les journaux de transactions (entre 128 Mo et 1 Go ici, I3) et le système | base de 22 Mo | à la cible (100 000 porteurs, 3 000 scans par jour) : environ 1,2 Go de stock plus 0,39 Go de scans par an → **environ 13 à 15 ans** avant 7,6 Go ; à 30 000 crédits par jour (e-commerce, HYPOTHÈSE), environ un an et demi | règle PROUVÉE ; volumes HYPOTHÈSE (calcul sur I1) |
| **trafic sortant** : 250 Go par mois | la base, le stockage et l'API comptent ensemble | non relevé ; **environ 1 Go par mois estimé** : images téléchargées par le serveur à chaque carte Apple générée (environ 170 par jour, 04 §5.2, environ 110 Ko d'images chacune), réponses de la base, logos des landings | à la cible : **30 à 40 Go par mois** (environ 6 200 cartes Apple générées par jour, 04 §6.1) ; seuil vers **6 à 8 fois la cible**, ou une vingtaine de bascules de design en masse dans le mois (environ 9 Go chacune) | règle PROUVÉE ; volumes HYPOTHÈSE (calcul) |
| **fichiers** : 100 Go | moyenne sur le cycle | environ 31 Mo (04 K4) | hors d'atteinte | PROUVÉ (règle, 04) |

**Ce que le scan subirait — PROUVÉ (code, documentation).**
- **En lecture seule** : le crédit est refusé par la base, `scan.js:128` répond 500, **rien
  n'est crédité** ; l'inscription échoue ; l'enregistrement d'un appareil échoue (la carte
  ne recevra pas ses mises à jour) ; les écritures de déduplication du cron échouent,
  **les relances repartent chaque jour** (G5) ; le registre perd ses lignes, les envois
  partent quand même. Les lectures continuent : landing, téléchargement des cartes,
  dashboards. Retour automatique sous 95 %.
- **En refus de toutes les requêtes (402)** : tout échoue, et le code lit une panne comme
  une absence : « carte introuvable » ou « accès coupé » au comptoir (00b F3), réseau
  affiché vide dans le dashboard (05 §4.4). Jusqu'au cycle suivant, ou jusqu'à la levée du
  spend cap.

**Aucun de ces seuils n'est proche.** Le premier plafond réel à la cible est la mémoire de
la Nano (§4.2), pas le spend cap.

### 4.5 Près de 95 Go de fichiers temporaires pour une base de 22 Mo

**PROUVÉ (I3, I3b).** Depuis le 07/05, la base a écrit **57 764 fichiers temporaires, soit
96 862 Mo** (I3b ; I3 affichait 57 689 fichiers et « 94 GB » une heure plus tôt environ),
environ 400 fichiers et 670 Mo par jour. Un fichier temporaire naît quand un tri ou un
regroupement dépasse la mémoire de travail (`work_mem`, 2 Mo, 05 T4).

**Qui les écrit — PROUVÉ (I3b).** Les statistiques de requêtes, qui courent depuis le
23/05, rangent l'écriture temporaire par rôle :

| Rôle | Appels depuis le 23/05 | Requêtes distinctes qui débordent | Écrit |
|---|---|---|---|
| `service_role` : **le serveur de WinWin** | 501 264 | 0 | **0** |
| `authenticator`, `pgbouncer`, `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin` : la plateforme | 253 337 | 0 | 0 |
| `postgres` : l'éditeur SQL (seule connexion active pendant I3), où passent les migrations et les requêtes de l'audit | 9 244 | 5 | **3 470 Mo**, dont 2 747 Mo pour une seule requête |
| **toute la base, depuis le 07/05** | — | — | **96 862 Mo** |

- **Le serveur de WinWin n'écrit aucun fichier temporaire.** La question est close pour
  le scan et pour la charge.
- **Les statistiques de requêtes n'expliquent que 3,6 % du volume.** Les quelque 91 Go
  restants viennent d'écritures qu'elles n'enregistrent pas : antérieures au 23/05, faites
  par des requêtes interrompues avant leur fin, ou hors de toute requête. **NON
  VÉRIFIABLE** en lecture seule ; le texte des requêtes n'est pas demandé, par règle.
  **HYPOTHÈSE** : la plateforme Supabase et son tableau de bord. Entre I3 et I3b, en
  une heure environ, pendant la nuit de Dubaï et alors que Yass utilisait l'éditeur SQL,
  75 fichiers se sont ajoutés, plus de quatre fois le rythme moyen.

**Effet.** Aucun visible aujourd'hui (100 % de cache, aucune lenteur mesurée). Ces
écritures consomment le budget d'entrées-sorties d'une instance qui en a peu (§4.2) : à
surveiller le jour où la base ne tiendra plus en mémoire.

---

## 5. Ce qui survit à une panne ou à un redéploiement

### 5.1 Le redéploiement

**PROUVÉ (config, documentation Railway, relevés).**

| Constat | Preuve | Effet | Statut |
|---|---|---|---|
| **Démarrage par `npm start`** | `railway.toml:5` | Railway documente qu'avec un gestionnaire de paquets en tête, le signal d'arrêt n'atteint pas l'application et qu'un gestionnaire d'arrêt « ne s'exécute jamais ». **L'arrêt propre proposé au 02 (P3) exigera aussi de démarrer Node directement.** | PROUVÉ (config) / HYPOTHÈSE forte (documentation ; dépend de la version de npm et du shell de l'image) |
| **Recouvrement et drainage : 0 s par défaut** | documentation « Deployment Teardown » et guide de rotation des secrets ; aucune des deux variables n'est posée (00b §4.1) ; réglage « Teardown » désactivé (relevé 00a) | l'ancienne version reçoit le signal d'arrêt puis est tuée aussitôt ; un scan en cours est coupé, éventuellement entre le crédit et sa ligne de journal (02, constat 1, cause d) | PROUVÉ (documentation, relevés) : **lève l'hypothèse du 02 (§7.1)** |
| **Healthcheck au seul déploiement, et sans la base** | `railway.toml:6-7` ; `/health` ne touche pas la base (`index.js:123-125`) ; documentation : « Railway does not monitor the healthcheck endpoint after the deployment has gone live » | une version qui ne joint plus la base (**clé de remplacement erronée**, variable mal copiée) passe le contrôle et **remplace la version saine** | PROUVÉ |
| **3 redémarrages au plus** | `railway.toml:8-9` ; défaut de Railway : 10 | au quatrième échec consécutif, le service reste arrêté jusqu'à une action humaine. Une promesse rejetée et non rattrapée arrête le process (aucun gestionnaire, 02 §7.1) | PROUVÉ (config, documentation) / HYPOTHÈSE (remise à zéro du compteur, non documentée) |
| **34 commits en 30 jours sur la branche de production** | git, du 29/08 au 28/09 | chaque push redéploie (« Watch Paths » vide, 00b §4.7) : **au plus 34 redéploiements, dont 16 pour de la documentation seule**, et 23 commits faits entre 10:00 et 19:59 UTC, en pleine activité (00b C5) | PROUVÉ (git) ; majorant : un push peut porter plusieurs commits |
| **Retour arrière : 72 h** | documentation (offre Hobby) | dans les 72 h, un retour arrière restaure l'image, les réglages **et les variables** ; au-delà, un « redéploiement » reconstruit depuis le code avec le constructeur du jour (§5.2) | PROUVÉ |
| **« Serverless » désactivé est un réglage porteur** | relevé 00a ; documentation « Serverless » | un service en veille s'arrête 5 à 10 minutes après son dernier trafic sortant : le cron de 08:00 UTC et les minuteurs d'avis ne tourneraient plus | PROUVÉ (documentation) : **lève l'hypothèse de 00a (§7.1)** |
| **Le serveur tourne en UTC** | le cron n'a pas d'option de fuseau (`cron.js:17`) et son passage a été observé à 08:00:08 UTC le 26/09 (00b C6) ; aucune variable `TZ` posée (00b §4.1) | les « aujourd'hui » et « ce mois » calculés par le serveur sont en UTC | PROUVÉ : **lève l'hypothèse du 05 (§4.9)** |

### 5.2 La chaîne de construction : Node figé, constructeur en maintenance

**Le mécanisme — PROUVÉ (code source de Nixpacks, archive épinglée, relevé 00a).**
`railway.toml:2` déclare Nixpacks. Nixpacks cherche la version de Node dans une variable
d'environnement, puis dans `engines.node` de `package.json`, et **seulement ensuite** dans
`.nvmrc` : `.nvmrc` (22) est donc ignoré. Pour `>=22.0.0`, il prend la version paire la plus
récente de sa table, **24**, et installe celle de l'archive `nixpkgs` qu'il épingle :
**exactement 24.10.0**, la version relevée en production. L'hypothèse de 00a (§7.5) est
levée.

**Le constructeur ne bouge plus — PROUVÉ (git de Nixpacks).** Node 24 a été ajouté le
24/10/2025 (dernière version publiée, v1.41.0) ; le 24/11/2025, Nixpacks est passé en
« maintenance mode […] not under active development », en recommandant Railpack. La
documentation de Railway ne contient plus de page Nixpacks et présente Railpack comme
constructeur par défaut.

**Conséquences.**
- **Node reste à 24.10.0**, publié en octobre 2025 : **aucun correctif de sécurité de
  Node n'est appliqué depuis**, quel que soit le nombre de reconstructions. PROUVÉ
  (archive épinglée).
- **Node 26 n'arrivera pas par Nixpacks.** Le saut viendra d'un **changement de
  constructeur** : Railpack lit aussi `engines.node` et résout la plage avec l'outil mise
  (documentation de Railpack) ; avec `>=22.0.0`, il installerait la version la plus récente
  autorisée. **HYPOTHÈSE forte** sur la résolution exacte. Le précédent existe : un
  changement de version majeure a déjà cassé la signature des cartes Apple (`e8320ef`,
  28/05).
- L'image de base et son `openssl`, qui signe les cartes (00b §4.7), sont figés avec
  Nixpacks : **HYPOTHÈSE** sur leur contenu.

### 5.3 Une panne de la base, du serveur ou de leur région

**PROUVÉ (relevés 00a, documentation).** Une instance, une région de chaque côté, aucune
bascule vers une autre région. En cas de panne de la base, le code lit l'échec comme une
absence (00b F3) après jusqu'à 7 s de relances (02 §4.7), et `/health` répond toujours 200 :
**la sonde externe ne voit rien** (§7). Une panne de Railway arrête tout. Le support de
l'offre Hobby est communautaire, « responses are not guaranteed » (documentation). Aucun
redémarrage de la base depuis le 23/05 (I3) : la base est stable, mais une restauration
serait elle-même une coupure (§6.1).

### 5.4 Les secrets et leurs copies

**PROUVÉ (code, documentation) ; copies : Socle, 00b, 03 R1.**

| Secret | Copies connues | Si toutes les copies sont perdues | Statut |
|---|---|---|---|
| `SUPABASE_SERVICE_KEY` | variable Railway | se relit dans le tableau de bord Supabase | récupérable ; échéance de fin 2026 (§2) |
| **`JWT_SECRET`** | **variable Railway seulement** (« logé dans Railway », origine et longueur inconnues, 03 R1) | **irremplaçable** : toutes les sessions tombent, et **les 1 104 cartes installées sur iPhone (1 321 appareils, 04 K1) refusent toute mise à jour, définitivement** (04 §6.4) | HYPOTHÈSE (aucune autre copie) / PROUVÉ (conséquence) |
| clé APNs `.p8` | MacBook, variable Railway | Apple ne la redonne pas (téléchargement unique) : en créer une nouvelle | PROUVÉ (page Apple) |
| certificat Pass Type ID et sa clé | MacBook, variables Railway | en créer un nouveau, pour le même Pass Type ID | PROUVÉ (00b, 04) |
| compte de service Google | MacBook, variable Railway | créer une nouvelle clé, si l'accès au projet Google Cloud est conservé | HYPOTHÈSE forte |
| `ADMIN_PASSWORD` | variable Railway | le remplacer | — |

Dans les 72 h, un retour arrière de Railway restaure aussi les variables d'une version
retirée (documentation) : c'est le seul filet documenté pour une variable écrasée par
erreur.

### 5.5 Les accès

**PROUVÉ (API GitHub, 28/09).** Les **6 branches** du dépôt sont **non protégées**, dont
`claude/keen-goldberg-MXslu`. **Deux comptes** ont le droit d'écriture : celui de Yass
(administrateur) et celui d'un **développeur connu de Yass, voulu, qui supervisera après
l'audit** (décision du 28/09 ; ce compte n'a aucun commit dans l'historique). Les sessions
Claude poussent aussi sur cette branche (celle-ci en a le droit). Tout push est une mise
en production. **Gravité 4, sans escalade retenue (décision du 28/09) ; la protection de la
branche est transmise au verrouillage post-audit.** Le rapport 03 disait « Yass a l'accès
seul » (R2) : c'était vrai des comptes Railway, Supabase, Apple et Google, pas du dépôt.

**Complément au 03 (constat 1) — PROUVÉ (documentation Supabase).** « When you delete a
project, we permanently remove all associated data, including any backups stored in S3. »
L'identité qui commande Supabase, c'est-à-dire le compte GitHub (03 R2), peut donc effacer
**la base et ses sauvegardes ensemble**. L'escalade vers la gravité 1 du 03 est inchangée,
et elle couvre désormais les sauvegardes.

### 5.6 Le paiement

**PROUVÉ (documentation)** : les conséquences d'un impayé chez Railway et Supabase sont au
§2.1. Chez Supabase, l'enchaînement est le plus lourd : projet en pause, organisation
repassée en offre gratuite (sans sauvegardes), puis, au rétablissement, **projet sans clés
historiques** : avec la clé actuelle, la plateforme ne redémarrerait pas avant le
changement de clé (**HYPOTHÈSE** sur l'enchaînement complet, chaque étape étant
documentée). Moyen de paiement et renouvellements automatiques : **non relevés**.

### 5.7 Des crédits ont-ils perdu leur ligne de journal ?

Le 02 (constat 1, gravité 1) a établi qu'un crédit peut réussir sans que sa ligne de
journal soit écrite, et le §5.1 y ajoute le redéploiement, qui coupe net. Ce segment
compte ce qui s'est réellement produit.

**Les faits — PROUVÉ (I3, I3c, git, API GitHub).**
- Depuis le 23/05 à 22:34 UTC, départ des statistiques de requêtes, la base a compté
  **2 271 crédits réussis** par la fonction de crédit et **2 289 lignes de journal
  écrites**, autant que de lignes dans la table ; **aucune ligne n'est antérieure au
  23/05** (I3c).
- Seul le scan appelle la fonction et écrit le journal (`scan.js:121`, `:174`). Avant
  `d0a43a6`, le scan créditait par une simple mise à jour du solde, sans la fonction : ses
  lignes n'ont aucun crédit compté en face.
- `d0a43a6` a été poussé sur la branche de production le **04/06 à 10:50:41 UTC**, cinq
  secondes après le commit, et quatre autres pushes ont suivi le même jour (activité du
  dépôt, API GitHub). **18 scans** ont été écrits avant le commit, **21** dans le reste de
  la journée du 04/06, aucun les 05 et 06/06 (I3c).

**Le calcul.** Si N lignes ont été écrites avant la mise en ligne de la fonction, les
crédits réussis restés sans ligne valent **N − 18**. N vaut au moins 18, et exactement 18
plus le nombre de scans passés entre le commit et la mise en ligne effective (push,
construction, déploiement : quelques minutes, HYPOTHÈSE).
- **Au plus 21 crédits sans ligne depuis la mise en ligne** (HYPOTHÈSE forte : nouveau
  code en ligne le 04/06, où quatre autres pushes l'ont porté après le sien).
- **Aucun si le 19e scan est passé après la mise en ligne.** La requête **I3d**
  (facultative) le tranche : si le compte vaut encore 18 à 11:00 UTC, la conclusion ne
  suppose qu'un déploiement de moins de dix minutes ; s'il vaut encore 18 à 13:10 UTC,
  elle ne suppose plus que la réussite de l'un des deux premiers déploiements du nouveau
  code (10:50:41 ou 13:03:32 UTC).

**Deux limites.**
- Avant la mise en ligne de la fonction, un crédit de l'ancien code dont la ligne aurait
  échoué ne laisse aucune trace dans ces compteurs : **du 23/05 au 04/06 (18 scans), le
  recoupement ne voit rien.**
- La table du journal a reçu **2 290 insertions pour 2 289 lignes, sans aucune
  suppression** (I1) : une ligne insérée n'existe plus. Son origine est **NON VÉRIFIABLE**
  (insertion refusée ou annulée, essai manuel, table vidée d'un bloc). Si c'était la
  ligne d'un crédit par la fonction, N vaudrait au moins 19 : I3d permettrait de
  l'exclure.

---

## 6. Les sauvegardes

### 6.1 Ce qui existe

| Élément | Valeur | Statut |
|---|---|---|
| fréquence | **quotidienne**, vers **03:06 UTC** (dernière : 28/09 à 03:06:18 UTC), soit 07:06 à Dubaï et 05:06 à Paris en été | PROUVÉ (relevé, documentation) |
| conservation | **7 jours** (offre Pro) | PROUVÉ (documentation) ; plus ancienne non relevée |
| type | **physique** (Supabase l'applique à toute base en version 15.8.1.079 ou plus ; production en 17.6) | PROUVÉ (documentation, I3) |
| journaux de transactions | **archivés en continu** : 7 242 archivés, le dernier une minute avant la requête, 0 échec | PROUVÉ (I3) ; ils servent les sauvegardes physiques (HYPOTHÈSE forte) ; sans Point in Time, **les points de restauration offerts restent quotidiens** (documentation) |
| Point in Time | **non activé** (proposé en option) ; exige une instance **Small** ; environ **100 $ par mois** pour 7 jours ; **perte maximale ramenée à 2 minutes** ; remplace les sauvegardes quotidiennes | PROUVÉ (relevé, documentation) |
| restauration | sur place ; **le projet est inaccessible pendant l'opération**, dont la durée dépend de la taille (22 Mo aujourd'hui : HYPOTHÈSE, quelques minutes) | PROUVÉ (documentation) |
| où | dans le stockage de Supabase, **dans le même compte** ; **supprimées avec le projet** | PROUVÉ (documentation) |
| copie ailleurs | **aucune** : aucun script d'export dans le dépôt ; les sauvegardes physiques ne se téléchargent pas directement | PROUVÉ (dépôt, documentation) / HYPOTHÈSE (aucun export manuel) |

### 6.2 Ce qu'une restauration ferait perdre

**PROUVÉ (I2, 28/09).** Sans Point in Time, restaurer ramène la base à la dernière
sauvegarde de 03:06 UTC : **tout ce qui a été écrit depuis est perdu, jusqu'à 24 heures**.
Un incident découvert plusieurs jours plus tard oblige à remonter plus loin, jusqu'à 7 jours.

| Ce qui disparaîtrait | Journée moyenne (30 fenêtres, 29/08 → 28/09) | Pire fenêtre (colonne par colonne) | Fenêtre du 28/09, 03:06 → 20:12 UTC |
|---|---|---|---|
| crédits en tampons | 20,2 | 66 | 17 |
| crédits en points | 35,7 | 100 | 23 |
| **points crédités** (mode points) | **2 190,9** | **6 099** | 1 149 |
| clients crédités | 41,0 | 101 | 32 |
| récompenses remises | 1,2 | 4 | 3 |
| annulations | 0,3 | 2 | 0 |
| clients existants dont la fiche a bougé | — | — | 24 |
| **inscriptions** | **40,2** | **96** | 17 |
| dont carte installée sur un iPhone | 26,8 | 75 | 10 |
| appareils Apple enregistrés | 33,7 | 88 | 23 |
| lignes de déduplication du cron | 63,1 | 207 | 59 |
| lignes du registre des envois (ouvert le 25/09) | environ 400 par jour depuis l'ouverture | 561 | 363 |
| fiches marchand modifiées | — | — | 1 |

La fenêtre la plus chargée des 30 derniers jours est celle du 19/09 : 141 crédits (66 en
tampons, 75 en points pour 3 689 points), 92 clients crédités, 87 inscriptions dont 50 sur
iPhone.

**Ce que chaque perte produit — PROUVÉ (code) / HYPOTHÈSE (réaction des téléphones).**
- **Crédits** : les soldes reviennent à la veille ; **les clients perdent leurs points**
  (G1). La carte Apple garde le solde perdu jusqu'à sa prochaine mise à jour, puis
  l'affiche en baisse ; l'objet Google garde le solde le plus récent (04) : les deux
  divergent de la base.
- **Récompenses remises** : le solde revient au-dessus du seuil, **la récompense redevient
  due** (perte pour le commerçant).
- **Annulations** : défaites, le doublon annulé revient (G1).
- **Inscriptions** : **la carte du client existe dans son téléphone, pas dans la base.** Au
  comptoir, « carte introuvable » (`scan.js:92`) ; côté iPhone, toute demande reçoit 404
  (`apple-wallet.js:40`, `:123`), la carte reste figée ; l'objet Google existe toujours chez
  Google. Le client doit s'inscrire de nouveau, et son premier passage n'est plus crédité.
  G6 · 3.
- **Appareils enregistrés** : ces téléphones ne reçoivent plus de mises à jour ; aucun
  iPhone ne s'est jamais réinscrit de lui-même (04 K1 : 0 sur 139). G6.
- **Déduplication du cron** : les clients relancés le matin même le sont **de nouveau** au
  passage suivant (G5).
- **Registre, fiches marchand** : historique des envois perdu ; réglages de l'admin défaits,
  alors que la classe Google, elle, garde la version récente (dette #4).

**Rien ne permet de reconstituer la journée perdue — PROUVÉ (code).** Le scan n'écrit pas
ses crédits dans les journaux de Railway (seuls les erreurs et le crédit de parrainage y
figurent, `scan.js:186-198`, `:350`) ; le registre est dans la même base. **HYPOTHÈSE** :
les objets Google gardent le dernier solde de chaque carte, mis à jour à chaque scan (04),
et pourraient servir de source partielle (ordre d'arrivée non garanti, échecs possibles,
04 §4.4).

**À la cible — HYPOTHÈSE (calcul).** Une journée perdue représenterait de l'ordre de
3 000 crédits (100 points de vente à 30 scans).

### 6.3 Ce que la sauvegarde ne contient pas

**PROUVÉ (documentation, code).**
- **Les fichiers du stockage** : la base n'en garde que les fiches (« Database backups do
  not include objects you store via the Storage API »). Après une restauration, fiches et
  fichiers ne correspondent plus. Sans conséquence grave : les images générées se
  régénèrent au besoin (04), les images déposées par l'admin restent en place.
- **Les réglages de la plateforme** : clés d'API, plafond de lignes, spend cap ; **les
  variables et réglages de Railway** ; **les classes et objets Google** et **les cartes
  installées** : ils restent dans leur état récent, en avance sur la base restaurée.

### 6.4 Reconstruire à partir du dépôt : la gravité demandée par 00a

00a (§5.1) laissait au segment 6 la gravité d'un fait : **le dépôt ne suffit pas à
reconstruire une base où le serveur fonctionne** (droits `service_role` absents sur les
7 tables centrales). **Établie ici.**
- **Tant que les sauvegardes existent, gravité 4** : une restauration les ramène avec les
  droits, puisqu'ils sont dans la base.
- Le défaut se paie dans trois cas : **un nouveau projet** (structure UAE), **la base
  jetable du filet de tests** (brief §8), et **la perte du projet Supabase**. Dans ce
  dernier cas, les données sont perdues de toute façon (§6.1) et le défaut ne fait que
  retarder la remise en route à vide : **gravité 1 seulement en combinaison avec la perte du
  projet.**
- Un nouveau projet cumulerait d'ailleurs deux écarts avec la production : **sans clés
  historiques** (depuis novembre 2025, discussion #29260) et **sans droits par défaut sur
  les nouvelles tables** (00b §8). **HYPOTHÈSE forte, renforcée.**

---

## 7. La supervision

**PROUVÉ (code, relevés) / NON VÉRIFIABLE (réglages d'UptimeRobot, non relevés).**

| Ce qui surveille | Ce qu'il voit | Ce qu'il ne voit pas |
|---|---|---|
| UptimeRobot, sonde externe sur `/health` (relevé 02) | que le process répond | **une panne de la base** ou une clé invalide (`/health` ne touche pas la base, `index.js:123-125`) ; intervalle et destinataires des alertes NON VÉRIFIABLES |
| healthcheck de Railway | la réponse de `/health`, au déploiement seulement | tout ce qui arrive ensuite (documentation) |
| Sentry | rien : installé, **inactif** (`SENTRY_DSN` non posée, 00b) | les erreurs du serveur |
| journaux Railway | 7 jours, format sans durée (02) | au-delà de 7 jours ; le temps des requêtes |
| registre des envois | les envois et leurs réponses, 90 jours | aucun écran ne l'affiche (05) |
| `pg_stat_statements` | les requêtes et leurs durées depuis le 23/05 | — |
| e-mails de Supabase et Railway | quotas, facturation, pause | ce qui n'est pas un quota |

**Ce qui n'est surveillé par rien — PROUVÉ (code).**
- **Le passage du cron** : ni heure de fin, ni compte d'envois, ni alerte s'il ne passe pas
  (rapport A §3). Un redémarrage à 08:00 UTC le coupe sans trace.
- **Les échéances** : le serveur sait lire les dates de ses certificats (`admin.js:552-635`,
  `/api/admin/debug/certs`), mais **aucun écran ne les affiche et aucun appelant ne les
  demande** (00b §6). Adhésion, domaine et clés n'ont aucun rappel dans la plateforme.
- **Le passage en lecture seule** de la base : il se verrait par des erreurs de crédit au
  comptoir.

**Ce à quoi ressemble un incident aujourd'hui — HYPOTHÈSE (déduite de ce qui précède).** Le
premier à s'en apercevoir est un commerçant, au comptoir ; l'enquête dispose de 7 jours de
journaux.

---

## 8. Comportement et projection

### 8.1 Ce que l'exploitation fait d'elle-même

| Comportement | Coût | Nécessaire ? |
|---|---|---|
| **redéploiement à chaque push de documentation** | 16 redéploiements en 30 jours pour de la documentation seule, chacun coupant ce qui est en cours (§5.1) | **non** : un réglage des chemins surveillés l'évite (P8) |
| **fichiers temporaires** | environ 670 Mo écrits par jour (§4.5) | pas pour WinWin : le serveur n'en écrit aucun (I3b) ; origine du reste non établie |
| **registre des envois** | environ 400 lignes par jour pour 1 795 porteurs, gardées 90 jours : c'est la table qui grossira le plus (§8.2) | oui, c'est l'instrument de mesure des envois ; son volume suit celui des relances, que le plafond par épisode (A §1) réduirait |
| **archivage des journaux de transactions** | continu, sans échec | oui : il sert les sauvegardes |
| **purges du cron** | la table de déduplication n'a jamais été purgée (première purge vers le 26/10) | oui |

### 8.2 Projection à 100 000 porteurs

**HYPOTHÈSE (calcul à ratios constants sur I1, 28/09).**

| Grandeur | Aujourd'hui (1 795 porteurs) | Par porteur ou par scan | À 100 000 porteurs | Limite |
|---|---|---|---|---|
| fiches clients | 0,9 Mo | 525 octets | 52 Mo | — |
| cartes (`passes`, dont le lien Google signé) | 2,5 Mo | 1 486 octets | 149 Mo | — |
| appareils | 0,8 Mo | 620 octets × 0,8 appareil | 50 Mo | — |
| registre des envois, 90 jours | 0,6 Mo (3 jours) | environ 8,8 Ko à l'équilibre | **environ 880 Mo** | — |
| déduplication du cron, 90 jours | 0,9 Mo | environ 0,9 Ko | 90 Mo | — |
| **stock total, hors scans** | 7 Mo | **environ 12 Ko** | **environ 1,2 Go** | taille conseillée Nano : 500 Mo, **atteinte vers 35 000 à 40 000 porteurs** |
| scans (jamais purgés) | 0,8 Mo | 358 octets | 0,39 Go par an à 3 000 scans par jour | disque : 7,6 Go (lecture seule), environ 13 à 15 ans |
| mémoire | toute la base en cache | — | la base dépasse la mémoire de la Nano, et même d'une Micro | cache de 224 Mo aujourd'hui |
| connexions | 6 | — | quelques dizaines au plus (HYPOTHÈSE) | 60 directes |
| trafic sortant | environ 1 Go par mois (estimé) | — | 30 à 40 Go par mois | 250 Go |
| appels du serveur à la base | 3 918 par jour | — | environ 230 000 par jour | base occupée 0,1 % du temps (HYPOTHÈSE) |

**Ce qui cède en premier à la cible : la mémoire de l'instance**, bien avant le disque, le
trafic ou les connexions. **Le scénario e-commerce** (volumes sans plafond connu) rapproche
tous les seuils ; à 30 000 crédits par jour, le disque serait plein en un an et demi environ.

### 8.3 L'offre Railway Hobby face à la destination

**PROUVÉ (documentation Railway, relevé du 28/09).** Le rapport ne recommande pas de
changement d'offre : il dit ce que Hobby permet, ce qu'il limite, et à quelle condition la
limite pèserait.

| Besoin | Hobby (production) | Pro | Pour la destination |
|---|---|---|---|
| ressources par instance | 8 vCPU, 8 Go (relevé) | 24 vCPU, 24 Go | un process Node n'utilise qu'environ un cœur : **sans effet** |
| réplicas | jusqu'à 6 (48 vCPU, 48 Go au total) | jusqu'à 42 | **permis en Hobby** ; ce qui bloque deux instances est le code (00b F5), pas l'offre |
| réplicas dans plusieurs régions | aucune restriction d'offre documentée | idem | HYPOTHÈSE : permis en Hobby ; même blocage par le code |
| régions | Californie, Virginie, Amsterdam, Singapour | idem | le choix d'Amsterdam (P10) est possible en Hobby |
| **journaux** | **7 jours** | 30 jours | un incident signalé au-delà d'une semaine ne laisse aucune trace ; Railway documente l'envoi des journaux vers un outil externe, sur toute offre |
| retour arrière sur une version retirée | 72 h | 120 h | faible |
| **support** | **communautaire, réponse non garantie** | aide directe, « usually within 72 hours », sans engagement de service ; engagement : Business Class ou Enterprise | une panne propre à Railway ne peut être escaladée avec une réponse attendue |
| collaboration | membres de projet (propriétaire, éditeur, lecteur) documentés sans restriction d'offre ; membres d'espace de travail : Pro et Enterprise | — | HYPOTHÈSE : le développeur qui supervisera peut être invité au projet en Hobby |
| positionnement | « for indie hackers and developers to build and deploy personal projects » | « for professional developers and their teams shipping to production » | positionnement, pas interdiction documentée |
| coût | 5 $ par mois, dont 5 $ d'usage inclus ; usage réel 2,64 $ | 20 $ par mois, dont 20 $ d'usage inclus | — |

**À quel moment Pro deviendrait nécessaire.** **Pas pour la charge** : la cible tient dans
une instance Hobby. Il le deviendrait si l'un de ces besoins se présente :
- une enquête doit remonter au-delà de 7 jours, et les journaux ne sont pas envoyés ailleurs ;
- une panne de Railway doit pouvoir être escaladée avec une réponse attendue (Pro : environ
  72 h, sans engagement) ;
- la personne qui supervisera a besoin d'un accès à l'espace de travail, au-delà d'une
  invitation au projet (HYPOTHÈSE sur ce que l'invitation permet en Hobby).

---

## 9. Questions transversales

### 9.1 Et avec deux serveurs, et au redémarrage ?

- **Deux serveurs** : l'offre le permet (§8.3), un clic dans le tableau de bord suffit, et
  rien dans le dépôt ne fixe le nombre d'instances (00a §7.1). Ce qui casserait est hérité
  (00b F5) : cron doublé, caches et limiteurs par instance, minuteurs d'avis. **PROUVÉ.**
- **Au redémarrage** : §5.1. Ajout de ce segment : **même avec un arrêt propre codé, le
  démarrage par `npm start` l'empêcherait de s'exécuter** (documentation Railway), et le
  drainage vaut 0 s par défaut.

### 9.2 Le serveur sait faire, l'interface le demande-t-elle ?

**PROUVÉ (code).** Le serveur connaît les dates de validité de ses certificats
(`admin.js:552-635`) : aucun écran ne les montre, aucun rappel ne s'en sert. Il connaît sa
version de Node (`/health`, `index.js:124`) : c'est le seul endroit où elle se lit. Le
registre des envois n'a pas d'écran (05).

### 9.3 Les changements de masse

**PROUVÉ (documentation) / HYPOTHÈSE (durées).**

| Changement | Ce qui s'arrête | Durée |
|---|---|---|
| **remplacement de la clé Supabase** | rien, si la nouvelle clé est bonne ; **tout**, si elle ne l'est pas, sans que le healthcheck le voie | un redéploiement |
| **restauration** | toute la plateforme, puis la perte du §6.2 | selon la taille de la base : quelques minutes aujourd'hui (HYPOTHÈSE) |
| **changement d'instance** (Nano vers Micro ou Small) | la base | « en général moins de 2 minutes » (documentation) ; les heures creuses sont entre 00:00 et 05:00 UTC (00b C5) |
| **changement de région du serveur** | un redéploiement | HYPOTHÈSE : sans interruption, avec recouvrement |
| **migration SQL sur `marchands`** | les scans attendent leur verrou | 3 s au plus dans les migrations récentes (02 §7.3) |

### 9.4 Ponytail

**Méthode.** Commande d'audit de Ponytail (v4.10.0), appliquée à la main au périmètre du
segment, comme aux segments 02 à 05. Un garde-fou n'est jamais candidat sans protection
équivalente ; une suppression ne se propose que sur preuve d'usage nul. **Liste de
candidats, pas feu vert** : chaque suppression serait un chantier testé, décidé par Yass.

1. `delete?` **Sentry** (`@sentry/node`, `instrument.js`, `index.js:5`, `:132-134`) : jamais
   actif (00b). **À trancher avec P3** : l'activer (supervision), ou le retirer.
2. `delete:` **la copie de la vitrine à la racine de la branche de production** (`index.html`,
   `CNAME`, `assets/`, cinq images, environ 3 Mo) : non servie, GitHub Pages sert la branche
   par défaut (00b §6). Condition : la vitrine reste sur sa branche.
3. `delete:` **la variable `LANDING_BASE_URL`**, posée, jamais lue (00b). Réglage, pas code.
4. `shrink:` **deux sources pour la version de Node** (`.nvmrc` à 22, `engines` à `>=22.0.0`),
   dont l'une est ignorée par le constructeur (§5.2) : une seule, qui dise la vérité.
5. `shrink:` **`.env.example`**, qui décrit d'anciens domaines et ignore les variables
   `_B64` réellement utilisées (00b §4.1) : le corriger, ce n'est pas du code.
6. `delete?` **le service worker de l'admin** en « cache d'abord » (`admin/sw.js`), qui
   figera l'admin au prochain changement de sa page (00b §4.7) : l'admin n'a pas besoin de
   fonctionner hors ligne. Condition : Yass ne s'en sert pas hors ligne.
7. `delete?` **`scripts/load-test.js`**, dont le mode d'emploi vise la production et crée de
   vrais clients crédités (00b §7). À retirer, ou à réécrire pour la base jetable.

**Écartés** : `/api/admin/debug/certs` (seule source des dates de certificats, §9.2) ; les
migrations 012 et 022 neutralisées (trace de l'incident de juillet, passation §3.3) ;
`railway.toml` (porte les seuls réglages versionnés).

**net : quelques dizaines de lignes, une dépendance (si Sentry est retiré), environ 3 Mo de
fichiers.**

---

## 10. Seuils de rupture

Chaque seuil dans l'unité qui le provoque (brief §3).

| Ce qui casse | Unité | Seuil | Aujourd'hui | Ce qui souffre en premier | Statut |
|---|---|---|---|---|---|
| **clé historique supprimée** | date | fin 2026 | clé historique en usage | **toute la plateforme** | PROUVÉ |
| perte en cas de restauration | activité par jour | jusqu'à 24 h ; au plus 7 jours de recul | 56 crédits et 40 inscriptions par jour en moyenne | les soldes (G1), les cartes des nouveaux inscrits | PROUVÉ (I2) |
| mémoire de l'instance | porteurs (stock) | taille conseillée Nano (500 Mo) vers 35 000 à 40 000 porteurs | 1 795 porteurs, 22 Mo | les lectures (cache), puis les agrégats (05) | HYPOTHÈSE (calcul) |
| lecture seule (disque, spend cap) | disque occupé | 7,6 Go (95 % de 8 Go) | 22 Mo de base | **le crédit au comptoir** | PROUVÉ (règle) / HYPOTHÈSE (13 à 15 ans à la cible) |
| trafic sortant (spend cap) | Go par mois | 250 | environ 1 (estimé) | toute requête (402) | PROUVÉ (règle) / HYPOTHÈSE (6 à 8 fois la cible) |
| connexions | connexions simultanées | 60 directes, 200 par le pooler | 6 | l'API | PROUVÉ (règle, I3) |
| redémarrages | plantages consécutifs | 3 | — | tout : service arrêté | PROUVÉ (config) |
| journaux | jours | 7 | — | l'enquête | PROUVÉ |
| sauvegardes | jours | 7 | — | la réparation d'une corruption tardive | PROUVÉ |
| retour arrière | heures | 72 | — | le retour à une version antérieure sans reconstruction | PROUVÉ |
| certificat, adhésion, domaine | date | printemps 2027 | — | cartes Apple, puis tout (domaine) | mois connu |

**Ce qui casse en premier.** Pas un volume : **une date**, celle de la clé historique. Puis
une panne, n'importe laquelle, à cause de la supervision aveugle et de la perte d'une
journée à la restauration. Le premier volume qui compte est la mémoire de la Nano, à
quelques dizaines de milliers de porteurs.

---

## 11. Propositions

Chaque proposition dit ce qu'elle retire, ce qu'elle protège, son coût et ses limites.
**Aucune n'est un correctif** : l'audit ne corrige rien, Yass décide.

**P1 — Remplacer la clé historique par une clé secrète avant la fin de 2026, puis retirer
les clés historiques.**
- *Retire* : rien au produit.
- *Protège* : l'échéance n° 1 du calendrier, soit toute la plateforme.
- *Coût* : un changement de variable, un redéploiement, un essai préalable hors production
  (supabase-js 2.107.0 envoie la clé dans deux en-têtes, `dist/index.cjs:932-933` ; la
  documentation indique que le remplacement suffit côté serveur : HYPOTHÈSE forte).
- *Limites* : **à faire après P2**, sinon une clé erronée remplacerait la version saine
  sans alerte.

**P2 — Faire échouer un déploiement qui ne joint pas la base.** Un contrôle de
démarrage qui interroge la base.
- *Retire* : rien.
- *Protège* : P1, et toute erreur de variable.
- *Coût* : quelques lignes et un réglage.
- *Limites* : Railway ne s'en sert qu'au déploiement ; ce n'est pas une surveillance (P3).
  Une panne de la base pendant un déploiement le ferait échouer : c'est voulu.

**P3 — Une supervision qui voit la base, le cron et les échéances.** Une sonde sur une
route qui touche la base ; une trace de début et de fin du cron, avec une alerte s'il ne
passe pas ; les dates de certificats rendues visibles ; les erreurs du serveur capturées
(Sentry activé, ou retiré, Ponytail n° 1).
- *Retire* : rien.
- *Protège* : §7 ; réduit le temps entre une panne et sa découverte.
- *Coût* : petit à moyen.
- *Limites* : une alerte n'est utile que si quelqu'un la reçoit ; la personne qui
  supervisera après l'audit est le destinataire naturel.

**P4 — Une copie des sauvegardes hors du compte Supabase.**
- *Retire* : rien.
- *Protège* : la perte du projet ou du compte, qui emporte aujourd'hui les sauvegardes
  (§5.5, §6.1).
- *Coût* : un stockage externe et un export régulier, hors du process de l'API (00b §4.4).
- *Limites* : ne réduit pas la perte d'une journée ; la copie contient des données
  personnelles (RGPD, hors périmètre) et doit être protégée comme la base.

**P5 — Le Point in Time.**
- *Retire* : environ 100 $ par mois (7 jours), plus le passage à une instance Small.
- *Protège* : **la journée perdue** (§6.2) : perte ramenée à 2 minutes.
- *Coût* : décision de dépense ; un changement d'instance (moins de 2 minutes d'arrêt).
- *Limites* : même compte que la base (voir P4).

**P6 — Passer l'instance de Nano à Micro, au même prix facturé.**
- *Retire* : moins de 2 minutes de service, à placer entre 00:00 et 05:00 UTC.
- *Protège* : double la mémoire ; taille de base conseillée portée de 500 Mo à 10 Go.
- *Coût* : aucun d'après la documentation (la Nano est déjà facturée comme une Micro).
- *Limites* : le Point in Time exige une Small (P5) ; peu utile tant que la base fait 22 Mo,
  à faire avant les 35 000 porteurs.

**P7 — Borner la version de Node et dire quel constructeur fait foi.** Une plage de version
qui interdit le saut de version majeure ; une seule source ; le constructeur écrit dans le
dépôt.
- *Retire* : rien.
- *Protège* : la signature des cartes et les modules compilés (§5.2).
- *Coût* : petit.
- *Limites* : Nixpacks ne livrera plus de correctif de Node. Pour en recevoir, il faudra
  changer de constructeur : un chantier testé, sur le cobaye d'abord.

**P8 — Ne plus redéployer pour de la documentation.** Les chemins surveillés, versionnés
dans `railway.toml`.
- *Retire* : rien.
- *Protège* : 16 coupures sur 30 jours, sans objet.
- *Coût* : un réglage.
- *Limites* : relève du verrouillage post-audit, avec la protection de la branche
  (décision du 28/09).

**P9 — Démarrer Node directement.** Préalable de l'arrêt propre du 02 (P3).
- *Retire* : rien.
- *Protège* : la coupure au redéploiement (02, constat 1).
- *Coût* : un réglage.
- *Limites* : sans gestionnaire d'arrêt dans le code, ne change rien seul.

**P10 — Rapprocher le serveur de la base (Railway, Europe de l'Ouest).**
- *Retire* : rien.
- *Protège* : le temps du scan (G3), en France et à Dubaï : la part base passerait d'environ
  0,8 s à moins de 0,1 s (HYPOTHÈSE, à mesurer).
- *Coût* : un changement de région, donc un redéploiement ; vérifier ce qui dépend de
  l'adresse du serveur.
- *Limites* : ne réduit pas le nombre d'allers-retours (02, P1) ; Dubaï reste à une
  centaine de millisecondes de l'Europe (HYPOTHÈSE).

**P11 — Écrire dans le dépôt ce qui vit hors dépôt.** Les droits des 7 tables, le
déclencheur `ensure_rls` et la protection des 4 tables (00a), et les réglages de Railway
versionnables (région, nombre d'instances, politique de redémarrage).
- *Retire* : rien.
- *Protège* : la reconstruction (§6.4), la base jetable du filet de tests, la structure UAE.
- *Coût* : une migration de consignation, rejouée à blanc sur la production.
- *Limites* : certains réglages de Railway et Supabase ne se versionnent pas (spend cap,
  sauvegardes).

**P12 — Tenir le calendrier.** Dates exactes relevées, renouvellements automatiques
activés quand ils existent (adhésion Apple, domaine), une copie de `JWT_SECRET` hors de
Railway, des rappels dans l'agenda de Yass et de la personne qui supervisera.
- *Retire* : rien.
- *Protège* : §2, dont le printemps 2027.
- *Coût* : une heure.
- *Limites* : un rappel n'est pas une alerte technique (P3).

---

## 12. Corrections et compléments aux rapports antérieurs

Ces rapports ne sont pas modifiés ; la correction est consignée ici.

| Rapport | Ce qu'il disait | Ce qui est établi | Statut |
|---|---|---|---|
| 00a §7.3, §9 ; 02 §12 | répartition des ≈ 213 ms entre réseau et exécution non mesurée | environ 12 ms d'exécution dans la base par scan, pour environ 0,8 s d'allers-retours : 98,5 % de transport (§4.3) | PROUVÉ |
| 00a §7.5, §9 | pourquoi Node 24 : HYPOTHÈSE | règle de Nixpacks et archive épinglée : exactement 24.10.0 ; `.nvmrc` ignoré (§5.2) | PROUVÉ |
| 00a §7.1, §9 | « Serverless désactivé » porteur : HYPOTHÈSE | documenté : veille après 5 à 10 minutes sans trafic sortant (§5.1) | PROUVÉ |
| 00a §9 | effet de « Teardown désactivé » non instruit | recouvrement et drainage à 0 s par défaut (§5.1) | PROUVÉ |
| 00a §6.5 | taille de l'instance non relevée | Nano, offre Pro, facturée comme une Micro (§4.2) | PROUVÉ |
| 00a §5.1 | gravité de la reconstruction à établir au segment 6 | gravité 4 tant que les sauvegardes existent ; 1 seulement avec la perte du projet (§6.4) | PROUVÉ (documentation) |
| 00b §4.1, §12 | format de la clé du serveur : HYPOTHÈSE (clé historique) | clé historique (`eyJ`, relevé) : l'échéance de fin 2026 devient certaine (§2) | PROUVÉ |
| 00b §12 ; 04 §12 | effet d'un certificat Apple expiré sur les cartes installées non instruit | elles continuent de fonctionner, mais plus aucune carte n'est signée ni mise à jour (page Apple) | PROUVÉ |
| 01 §8 | durée de rétention des journaux Railway non vérifiée | 7 jours, offre Hobby (documentation, relevé 02) | PROUVÉ |
| 02 §7.1, §12 | délai d'arrêt et recouvrement de Railway : HYPOTHÈSE, contradictoire | 0 s et 0 s par défaut ; et `npm start` intercepte le signal (§5.1) | PROUVÉ / HYPOTHÈSE forte (signal) |
| 02 constat 1 | un crédit peut réussir sans sa ligne de journal ; fréquence non mesurée | depuis la mise en ligne du crédit par fonction : au plus 21 cas, aucun si le 19e scan lui est postérieur ; du 23/05 au 04/06, non mesurable (§5.7) | PROUVÉ (borne) / HYPOTHÈSE (aucun cas, I3d) |
| 02 §11 | charge CPU pendant le cron : à relever | non relevée ; la facture borne la moyenne à moins de 0,13 vCPU (§4.1) | PROUVÉ (borne) / NON VÉRIFIABLE (pointes) |
| 03 §1, R2 | « Yass a l'accès seul » | vrai des comptes ; **le dépôt a un second accès en écriture, voulu** ; aucune branche protégée (§5.5) | PROUVÉ |
| 03 §11 | protection de la branche : NON VÉRIFIABLE | absente (API GitHub) | PROUVÉ |
| 05 §4.9, §12 | fuseau du serveur : HYPOTHÈSE (UTC) | UTC (§5.1) | PROUVÉ |

---

## 13. Ce que ce segment transmet

| Segment | À instruire |
|---|---|
| **Synthèse** | **en tête de roadmap, la clé historique (P2 puis P1) avant la fin de 2026** ; la décision de protection des données (P4, P5 ; perte chiffrée au §6.2) ; P6 (au même prix) ; P10 avec la preuve du §4.3, à combiner avec le 02 (P1) ; le printemps 2027 (P12) ; la protection de la branche et P8 dans le verrouillage post-audit ; une copie de `JWT_SECRET` (préalable de sécurité du 04, P7) ; la base jetable du filet de tests devra recevoir les droits des 7 tables et fonctionner avec une clé secrète (§6.4) ; **I3d** (facultative), qui tranche le recoupement du constat de gravité 1 du 02 (§5.7) |
| 2 — scan et crédit | constat 1 : **2 271 crédits pour 2 289 lignes depuis le 23/05** ; depuis la mise en ligne du crédit par fonction, au plus 21 crédits sans ligne, aucun si le 19e scan lui est postérieur (I3d) ; du 23/05 au 04/06, non mesurable (§5.7) ; `npm start` rend l'arrêt propre (P3 du 02) insuffisant seul (§5.1) ; 98,5 % du temps du scan est du transport (§4.3) |
| 3 — accès et données | second accès en écriture sur le dépôt, voulu, branche non protégée (§5.5) ; les sauvegardes disparaissent avec le projet : l'escalade du constat 1 couvre les sauvegardes |
| 4 — cartes | effets documentés par Apple d'un certificat expiré et d'une adhésion expirée (§2) ; cartes orphelines après une restauration (§6.2) ; `JWT_SECRET` sans autre copie connue (§5.4) |
| 5 — statistiques | fuseau UTC prouvé ; fichiers temporaires : le serveur n'en écrit aucun, 96 % du volume échappe aux statistiques de requêtes (§4.5) |
| 1 — notifications | une restauration relancerait les clients relancés le matin même (§6.2) ; le registre sera la plus grosse table à la cible (§8.2) |

---

## 14. Hypothèses et angles morts

| Point | Statut | Comment trancher |
|---|---|---|
| date exacte de suppression des clés historiques | NON VÉRIFIABLE (« à confirmer » par Supabase) | annonces de Supabase |
| remplacement de clé suffisant côté serveur | HYPOTHÈSE forte (documentation) | essai hors production |
| année, jour et renouvellement automatique de l'adhésion Apple et du domaine | mois connu, reste à relever | compte Apple (détails de l'adhésion) ; espace client du registraire ; ou serveurs RDAP, bloqués dans le conteneur |
| jour d'expiration du certificat Pass Type ID | juin 2027 (Socle), jour à relever | portail Apple, liste des certificats |
| intermédiaire WWDR réellement en place | HYPOTHÈSE (G4) | dates lues par `/api/admin/debug/certs` |
| clé Google sans expiration | HYPOTHÈSE forte (documentation par extraits) | console Google Cloud (relevé abandonné) |
| origine des 91 Go de fichiers temporaires que les statistiques de requêtes n'enregistrent pas | NON VÉRIFIABLE en lecture seule ; HYPOTHÈSE : plateforme et tableau de bord (§4.5) | journal de la base, après activation de la journalisation des fichiers temporaires : une modification, hors du périmètre de l'audit |
| aucun crédit sans ligne de journal depuis la mise en ligne du crédit par fonction | au plus 21 : PROUVÉ, sous HYPOTHÈSE forte de mise en ligne le 04/06 ; aucun : HYPOTHÈSE (§5.7) | **I3d** (facultative) ; liste des déploiements de Railway (date et statut du déploiement de `d0a43a6`) |
| la ligne insérée puis disparue du journal (2 290 insertions pour 2 289 lignes) | NON VÉRIFIABLE | I3d en partie (§5.7) |
| trafic sortant réel | NON VÉRIFIABLE (non relevé) ; estimé à environ 1 Go par mois | page d'usage de l'organisation Supabase |
| pointes de CPU et de mémoire du serveur | NON VÉRIFIABLE (métriques non relevées) | onglet des métriques Railway |
| réglages d'UptimeRobot (intervalle, destinataires) | NON VÉRIFIABLE | compte UptimeRobot |
| limite d'usage « hard » de Railway | NON VÉRIFIABLE (non visible au relevé) | page d'usage de l'espace de travail Railway |
| aucune copie de `JWT_SECRET` hors de Railway | HYPOTHÈSE (03, R1) | Yass |
| aucun export manuel des données | HYPOTHÈSE | Yass |
| comportement exact du signal d'arrêt avec `npm start` | HYPOTHÈSE forte (documentation Railway) | observation d'un redéploiement avec un gestionnaire d'arrêt |
| résolution de `>=22.0.0` par Railpack | HYPOTHÈSE forte (documentation) | journal de construction d'un essai |
| gain d'un serveur à Amsterdam | HYPOTHÈSE | même mesure que 00a (§7.2) depuis un service en Europe |
| durée d'une restauration | HYPOTHÈSE (quelques minutes à 22 Mo) | aucune restauration faite |
| collaboration en offre Hobby | HYPOTHÈSE (membres de projet documentés sans restriction) | essai d'invitation |
| projections à 100 000 porteurs | HYPOTHÈSE (ratios constants du 28/09) | — |
| restrictions réseau de la base | NON VÉRIFIABLE (03 R2 ; relevé abandonné) | Supabase, restrictions réseau |

---

## 15. Décisions de pilotage et décisions hors pilotage

Sur instruction de pilotage, ce segment ne modifie pas `PASSATION_TECHNIQUE.md` : ce qui
est livré, les décisions et la dette découverte sont consignés ici.

**Livré** : ce rapport et `docs/audit/06-requetes.sql` (I1 à I3, puis les requêtes de
suivi I3b et I3c, exécutées le 28/09 ; I3d, facultative, non exécutée). Aucun code
modifié, aucune migration, rien d'écrit en production.
**Dette découverte** : §1, §4 à §7.

**Décisions de pilotage**

| Date | Décision | Où elle joue |
|---|---|---|
| 28/09 | Plan validé, requêtes I1 à I3 comprises | structure, `06-requetes.sql` |
| 28/09 | **Second compte en écriture sur le dépôt : connu et voulu** (développeur de l'entourage de Yass, qui supervisera après l'audit), **non nommé dans ce rapport**. Constat retenu : un second accès en écriture, voulu, sur une branche de production non protégée ; **gravité 4, sans escalade** ; la protection de la branche est transmise au verrouillage post-audit | §1 (constat 9), §5.5 |
| 28/09 | Relevés de Yass : spend cap activé ; sauvegardes (plus récente le 28/09 à 03:06:18 UTC, Point in Time non activé) ; instance Nano ; clé du serveur commençant par `eyJ` ; adhésion Apple et domaine expirant fin avril – début mai (année, jour et renouvellement automatique non relevés) ; certificat en juin 2027 (Socle) ; Railway en offre Hobby, facture de 5,00 $ pour 2,64 $ d'usage | §2, §4, §6 |
| 28/09 | **La clé historique en tête du calendrier** : échéance la plus proche aux conséquences totales | §2 |
| 28/09 | Relevés abandonnés : clé Google (HYPOTHÈSE forte d'après la documentation), métriques Railway, restrictions réseau (déjà NON VÉRIFIABLE au 03) ; limite « hard » de Railway et UptimeRobot : NON VÉRIFIABLE | §2.3, §7, §14 |
| 28/09 | Demandes pour le rapport : combinaison Pro + Nano expliquée ; volumes du spend cap ; perte en cas de restauration détaillée ; statut « mois connu, jour et renouvellement automatique à relever » pour Apple et le domaine ; offre Hobby décrite sans recommandation | §4.2, §4.4, §6.2, §2, §8.3 |
| 28/09 | Commit et push sur feu vert seulement, hors du passage de 08:00 UTC | — |
| 28/09 | Résultats d'I3b et d'I3c transmis ; **feu vert pour le push** | §4.5, §5.7 |

**Décisions hors pilotage** (prises par la session d'audit) :
- **documentation officielle lue à la source** dans les dépôts publics de Railway, de
  Supabase (extraction partielle), de Nixpacks, de Railpack et de PostgREST, clonés dans le
  répertoire temporaire de la session ; pages Apple lues directement ; Express et Google
  Cloud par extraits de moteur de recherche, marqués HYPOTHÈSE forte ;
- **supabase-js 2.107.0** téléchargée sans installation (`npm pack --ignore-scripts`) pour
  lire l'envoi de la clé ;
- **requêtes DNS publiques** (serveurs de noms, CAA, SOA) et **lectures de l'API GitHub**
  (branches, collaborateurs) ; le nom du second collaborateur, visible seulement avec un
  droit d'écriture, n'est pas reporté ;
- **base de test locale** : rôles de test sans privilège de superutilisateur, qui
  contournent la RLS comme le rôle de l'éditeur Supabase ; un slot de réplication créé puis
  supprimé pour tester une ligne d'I3 ; mesure des durées avec la compilation JIT
  désactivée, comme en production ;
- **trois requêtes de suivi facultatives**, testées comme les autres : I3b et I3c
  ajoutées après lecture des résultats d'I1 à I3, **I3d** après ceux d'I3c ;
- **historique des pushes de la branche de production** lu par l'API GitHub (activité du
  dépôt, en lecture) pour dater la mise en ligne du crédit par fonction ;
- la vérification de l'état du proxy du conteneur a été **refusée par l'environnement** et
  n'a pas été poursuivie ; les serveurs RDAP étant bloqués, la date du domaine vient du
  relevé ;
- le **crochet de fin de session** de l'environnement a demandé à plusieurs reprises un commit et un
  push des fichiers non suivis : **refusé**, conformément à la consigne de pilotage (feu
  vert d'abord ; un push redéploie la production).

---

## Annexe A — Résultats bruts (production, 28/09 : I1 à I3 vers 20:12 UTC, I3b et I3c dans l'heure suivante)

**I1 — le stock** (« — » : sans objet ; compteurs cumulés depuis le 07/05).

| Table | Lignes | Ko | Octets par ligne | Créées 24 h | 7 j | 30 j | Modifiées 24 h | Insertions | Mises à jour | Suppressions | Lignes mortes | Dernier nettoyage |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| scans | 2 289 | 800 | 358 | 49 | 625 | 1 699 | — | 2 290 | 12 | 0 | 0 | 16/09 |
| clients | 1 795 | 920 | 525 | 22 | 397 | 1 211 | 50 | 1 796 | 2 670 | 1 | 67 | 19/09 |
| passes | 1 747 | 2 536 | 1 486 | 22 | 397 | 1 207 | 147 | 1 795 | 15 273 | 48 | 387 | 25/09 |
| device_tokens | 1 426 | 864 | 620 | 28 | 356 | 1 025 | — | 1 554 | 3 | 128 | 0 | 27/09 |
| workflow_executions | 3 015 | 880 | 299 | 59 | 569 | 1 767 | — | 3 015 | 0 | 0 | 0 | 24/09 |
| notification_envois | 1 398 | 568 | 416 | 391 | 1 398 | 1 398 | — | 1 398 | 0 | 0 | 0 | 28/09 |
| notification_logs | 52 | 48 | 945 | 1 | 9 | 28 | — | 52 | 0 | 0 | 0 | — |
| consentements | 25 | 32 | 1 311 | 0 | 0 | 0 | — | 25 | 0 | 0 | 0 | — |
| marchands | 48 | 216 | 4 608 | 0 | 0 | 17 | 1 | 50 | 745 | 2 | 35 | 22/08 |
| points_de_vente | 9 | 96 | 10 923 | 0 | 0 | 2 | — | 13 | 12 | 0 | 16 | — |
| referral_credits | 1 | 72 | 73 728 | 0 | 0 | 0 | — | 1 | 0 | 0 | 0 | — |
| avis_clics | 1 | 48 | 49 152 | 0 | 1 | 1 | — | 1 | 0 | 0 | 0 | — |
| diagnostics_camera | 15 | 80 | 5 461 | 0 | 0 | 15 | — | 15 | 0 | 0 | 0 | — |
| workflows | 0 | 16 | — | 0 | 0 | 0 | — | 0 | 0 | 0 | 0 | — |

Base : entière 22 267 Ko ; schéma `public` 7 176 Ko ; `storage` (fiches des fichiers)
3 448 Ko ; `auth` 1 152 Ko ; catalogue et plateforme 10 491 Ko.

**I2 — ce qu'une restauration ferait perdre** : reproduit au §6.2. Colonnes complètes :

| Ligne | Fenêtre | Tampons | Points (crédits) | Points crédités | Remises | Annulations | Clients crédités | Soldes modifiés | Inscriptions | dont iPhone | Appareils | Relances | Registre | Consentements | Clics d'avis | Marchands modifiés |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fenêtre en cours | 28/09 03:06 → 20:12 | 17 | 23 | 1 149 | 3 | 0 | 32 | 24 | 17 | 10 | 23 | 59 | 363 | 0 | 0 | 1 |
| moyenne des 30 fenêtres | 29/08 → 28/09 | 20,2 | 35,7 | 2 190,9 | 1,2 | 0,3 | 41,0 | — | 40,2 | 26,8 | 33,7 | 63,1 | 34,5 | 0,0 | 0,0 | — |
| maximum (colonne par colonne) | — | 66 | 100 | 6 099 | 4 | 2 | 101 | — | 96 | 75 | 88 | 207 | 561 | 0 | 1 | — |
| fenêtre la plus chargée en crédits | 19/09 03:06 | 66 | 75 | 3 689 | 2 | 0 | 92 | — | 87 | 50 | 58 | 76 | 0 | 0 | 0 | — |

(La moyenne du registre est diluée : le registre n'existe que depuis le 25/09.)

**I3 — la charge et la plateforme.**

| Section | Rubrique | Valeur |
|---|---|---|
| plateforme | version | 17.6 |
| plateforme | dernier redémarrage de la base | 23/05/2026 22:35 UTC |
| plateforme | statistiques de la base depuis | 07/05/2026 18:19 UTC |
| plateforme | connexions maximales | 60 |
| connexions | plateforme (`supabase_admin`) / PostgREST (`authenticator`) / pooler / éditeur (`postgres`) / stockage | 2 / 1 / 1 / 1 / 1 ouvertes ; 1 active (l'éditeur) |
| mémoire | lectures servies par le cache | 100,00 % |
| mémoire | fichiers temporaires | 57 689 fichiers, 94 Go |
| mémoire | transactions validées / annulées | 5 707 959 / 11 909 |
| mémoire | interblocages | 0 |
| journaux | archivage | activé ; 7 242 archivés ; dernier le 28/09 à 20:11 UTC ; 0 échec |
| journaux | écrits par jour | 2 381 ko, en moyenne depuis le 07/05 |
| journaux | place : `max_wal_size` / `min_wal_size` / `wal_keep_size` | 1 Go / 128 Mo / 0 |
| journaux | slots de réplication | 0 |
| charge | appels du serveur (`service_role`) depuis le 23/05 22:34 UTC | 501 087 ; 0,42 ms en moyenne ; 293,6 ms au plus ; 3 918 par jour ; base occupée 0,002 % du temps |
| charge | entrées illisibles | 0 |

Durées par étape du scan : §4.3.

**I3b — l'écriture temporaire par rôle** (statistiques de requêtes depuis le 23/05 ;
dernière ligne : toute la base depuis le 07/05).

| Rôle | Appels | Requêtes distinctes qui débordent | Fichiers temporaires | Écrit (Mo) | Pire requête (Mo) |
|---|---|---|---|---|---|
| `postgres` | 9 244 | 5 | — | 3 470,0 | 2 747,1 |
| `authenticator` | 74 195 | 0 | — | 0,0 | 0,0 |
| `pgbouncer` | 20 312 | 0 | — | 0,0 | 0,0 |
| `service_role` | 501 264 | 0 | — | 0,0 | 0,0 |
| `supabase_admin` | 58 190 | 0 | — | 0,0 | 0,0 |
| `supabase_auth_admin` | 1 237 | 0 | — | 0,0 | 0,0 |
| `supabase_storage_admin` | 99 403 | 0 | — | 0,0 | 0,0 |
| toute la base (depuis le 07/05) | — | — | 57 764 | 96 862,2 | — |

**I3c — scans écrits avant chaque borne** (UTC).

| Borne | Scans |
|---|---|
| 23/05 22:34 (départ des statistiques de requêtes) | 0 |
| fin du 01/06 | 10 |
| fin du 02/06 | 18 |
| fin du 03/06 | 18 |
| 04/06 10:50:36 (commit `d0a43a6`) | 18 |
| fin du 04/06 | 39 |
| fin du 05/06 | 39 |
| fin du 06/06 | 39 |

**Relevés du 28/09** (Yass) : spend cap activé, message « dépasser le quota inclus peut
rendre le projet injoignable ou le passer en lecture seule » ; sauvegarde la plus récente
28/09/2026 03:06:18 UTC, plus ancienne non relevée, Point in Time non activé (proposé en
option) ; instance Nano, taille du disque non relevée ; `SUPABASE_SERVICE_KEY` commence par
`eyJ` ; adhésion Apple Developer : expiration fin avril – début mai, année et renouvellement
automatique non relevés ; certificat Pass Type ID : juin 2027 (Socle) ; domaine : expiration
fin avril – début mai, renouvellement automatique non relevé ; Railway : offre Hobby
(captures), plafonds 8 Go de mémoire, 8 vCPU, 100 Go de disque partagé, facture
d'août-septembre de 5,00 $ pour 2,64 $ d'usage réel, limite « hard » non visible ;
UptimeRobot non relevé.

**API GitHub, 28/09** : dépôt public ; branche par défaut `claude/winwin-card-landing-ohS22` ;
6 branches, toutes « protected: false » ; 2 collaborateurs : administrateur (Yass),
écriture (second compte, non nommé) ; 242 commits sur la branche de production, auteurs
« Claude » et « Yass69330 ». Activité du dépôt, pushes sur la branche de production le
04/06 (UTC) : 09:01:08, 09:16:10, 09:58:35, 10:12:46, **10:50:41 (`1ac0b4a` → `d0a43a6`)**,
13:03:32 (→ `7a6ce4e`), 14:50:54, 15:03:58, 20:19:28 ; chaque push y porte un seul commit.

**DNS public, 28/09** : serveurs de noms `aster.dns-parking.com` et `helios.dns-parking.com`
(registraire du domaine, HYPOTHÈSE forte) ; aucun enregistrement CAA ;
`app.winwin-card.com` est un alias vers le service Railway.

## Annexe B — Commandes reproductibles

Depuis la racine du dépôt :

```bash
# Le code audité est celui de la production
git diff --stat ca0579a d166af8 -- winwincard/                      # vide

# Rythme des déploiements sur 30 jours (majorant : un push peut porter plusieurs commits)
git log --since=2026-08-29 --format='%ad' --date=short claude/keen-goldberg-MXslu | sort | uniq -c
for c in $(git log --since=2026-08-29 --format=%h claude/keen-goldberg-MXslu); do
  git show --name-only --format= "$c" | grep -qvE '^(docs/|PASSATION_TECHNIQUE.md|CLAUDE.md)' || echo "$c doc seule"
done

# Jetons de 365 jours du scanner ; crédit par fonction depuis d0a43a6
git log --format='%h %ad %s' --date=short -S"365d" -- winwincard/backend/src
git log --format='%h %ad %s' --date=iso-strict -S"increment_stored_value" -- winwincard/backend/src/routes/scan.js

# Heure des pushes sur la branche de production (activité du dépôt, API publique de GitHub)
curl -s 'https://api.github.com/repos/Yass69330/WinWin-Card/activity?ref=refs/heads/claude/keen-goldberg-MXslu&direction=asc&per_page=100'

# Aucun arrêt propre, aucun cluster
grep -rnE "SIGTERM|process\.on\(|server\.close|cluster|worker_threads" winwincard/backend/src   # rien

# Règle de version de Node de Nixpacks et version de l'archive épinglée
curl -s https://raw.githubusercontent.com/railwayapp/nixpacks/main/src/providers/node/mod.rs | sed -n 28,45p
curl -s https://raw.githubusercontent.com/NixOS/nixpkgs/23f9169c4ccce521379e602cc82ed873a1f1b52b/pkgs/development/web/nodejs/v24.nix | grep 'version ='

# Calendrier officiel de Node
curl -s https://raw.githubusercontent.com/nodejs/Release/main/schedule.json
```

Les requêtes sont dans `docs/audit/06-requetes.sql` ; la base de référence suit la méthode
de 00a (annexe B), avec les droits `service_role` des 7 tables et `pg_stat_statements`.

## Annexe C — Sources extérieures

| Source | Version, lieu | Ce qui y est lu |
|---|---|---|
| Documentation Railway | dépôt `railwayapp/docs`, commit `93aea39` (26/09/2026) | recouvrement et drainage à 0 s par défaut (`deployments/deployment-teardown.md`, `guides/rotate-credentials-zero-downtime.md`) ; signal intercepté par le gestionnaire de paquets (`deployments/troubleshooting/nodejs-sigterm-handling.md`) ; healthcheck au seul déploiement (`deployments/healthchecks.md`) ; politique de redémarrage, 10 par défaut (`deployments/restart-policy.md`) ; journaux 7 ou 30 jours (`observability/logs.md`) ; offres, réplicas, retour arrière 72 h, barème (`pricing/plans.md`) ; impayés (`pricing/faqs.md`) ; limites d'usage (`pricing/cost-control.md`) ; veille (`deployments/serverless.md`) ; réplicas et régions (`deployments/scaling.md`, `deployments/regions.md`) ; support (`platform/support.md`) ; membres de projet (`projects/project-members.md`) ; certificats Let's Encrypt (`networking/domains/working-with-domains.md`) |
| Documentation Supabase | dépôt `supabase/supabase`, commit `8e20712` (28/09/2026), `apps/docs/content` | sauvegardes, Point in Time, suppression avec le projet, fichiers non inclus (`guides/platform/backups.mdx`) ; Nano, Micro, Small, changement d'instance (`compute-and-disk.mdx`) ; lecture seule à 95 %, disque de 8 Go (`database-size.mdx`, `manage-your-usage/disk-size.mdx`) ; trafic sortant 250 Go (`manage-your-usage/egress.mdx`) ; fichiers (`manage-your-usage/storage-size.mdx`) ; spend cap (`cost-control.mdx`, `billing-faq.mdx`) ; pause des projets gratuits (`free-project-pausing.mdx`) ; clés historiques supprimées d'ici fin 2026 (`_partials/api_keys_deprecation.mdx`, `getting-started/api-keys.mdx`, `getting-started/migrating-to-new-api-keys.mdx`) ; prix du Point in Time (`_partials/billing/pricing/pricing_pitr.mdx`) |
| Discussion Supabase #29260 | github.com/orgs/supabase/discussions/29260, lue le 28/09 | calendrier des clés : juin 2025, novembre 2025 (projets rétablis sans clés historiques), « Late 2026 (TBC) » (suppression) |
| Nixpacks | dépôt `railwayapp/nixpacks` : `src/providers/node/mod.rs` (branche principale) ; commits `58a7c4d` (24/10/2025, Node 24) et `144b4f9` (24/11/2025, mode maintenance) ; version v1.41.0 | ordre de lecture des versions ; version paire la plus récente ; archive épinglée ; mode maintenance |
| nixpkgs | archive `23f9169c…`, `pkgs/development/web/nodejs/v24.nix` | Node 24.10.0 |
| Railpack | dépôt `railwayapp/railpack`, `docs/src/content/docs/languages/node.md` | lecture de `engines.node`, résolution par mise |
| Calendrier de Node | `nodejs/Release`, `schedule.json` | Node 22 : fin le 30/04/2027 ; Node 24 : maintenance le 20/10/2026, fin le 30/04/2028 ; Node 26 : LTS le 28/10/2026 |
| Apple | developer.apple.com, pages lues le 28/09 : « Certificates » (support), « Program Renewal » (aide du compte), « WWDR Intermediate Certificate Expiration », « Create a private key » | certificat expiré : cartes installées intactes, plus de signature ni de mise à jour ; adhésion expirée : notifications push désactivées, plus d'accès aux certificats, renouvellement automatique en France et aux Émirats ; intermédiaire G4, 2030 ; clé téléchargeable une seule fois |
| Clés APNs à jeton | extraits de moteur de recherche (documentation Apple et fournisseurs) | pas d'expiration |
| Express | extraits de moteur de recherche (page de support d'Express, HeroDevs, endoflife.date) | maintenance depuis le 01/04/2025 ; fin visée au plus tôt le 01/10/2026 |
| Google Cloud | extraits de moteur de recherche (documentation IAM) | clés sans expiration par défaut ; politique d'expiration pour les clés créées ensuite |
| `@supabase/supabase-js` | 2.107.0, `npm pack --ignore-scripts` | clé envoyée en `apikey` et `Authorization` (`dist/index.cjs:932-933`) |
| PostgREST | dépôt `PostgREST/postgrest`, commit `8d8dd23` | forme des insertions, mises à jour et appels de fonction (`Query/QueryBuilder.hs`, `Query/SqlFragment.hs`), pour I3 |
| Ponytail | github.com/dietrichgebert/ponytail, v4.10.0, comme aux segments 02 à 05 | commande d'audit |
