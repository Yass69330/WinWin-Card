# Audit WinWin — Brief (à lire en premier, par chaque session d'audit)

> Rédigé en pilotage le 26/09/2026, validé par Yass. Ce brief cadre l'audit, il ne le limite pas.
> Tout ce qui est cité ici est un point de départ, jamais une liste fermée. Ce que tu trouves en dehors a autant de valeur, souvent plus.

---

## 1. Ta mission

Établir **l'état de santé** de la plateforme, la **confronter à sa destination**, et produire une **roadmap technique ordonnée** pour la consolider.

La plateforme a été construite vite, pour fonctionner vite. Elle est en production, elle tourne, et il n'y a **aucune urgence**. L'objectif maintenant est de la rendre pérenne. Une partie de ce qu'elle fait répond peut-être à des problèmes qui n'existaient pas, ou plus. Yass est prêt à faire des sacrifices pour la pérenniser (voir §5).

## 2. Règles de conduite

- **L'audit constate, il ne corrige rien.** Aucune ligne de code applicatif, aucune migration, même pour un correctif évident. Seuls commits autorisés : les rapports dans `docs/audit/`.
- **Tout constat se prouve** par le code (fichier:ligne), git ou SQL. Chaque constat porte un statut : **PROUVÉ**, **HYPOTHÈSE** (avec ce qui la confirmerait) ou **NON VÉRIFIABLE** (avec la raison).
- **Ta mémoire n'est pas fiable** (compressions, conteneur recréé). Relis les rapports précédents, `PASSATION_TECHNIQUE.md` et `CLAUDE.md` au démarrage.
- **Accès base** : tu n'as pas d'accès direct à la production. Fournis à Yass des requêtes **en lecture seule**, courtes, avec le résultat attendu. Il les exécute dans Supabase et te colle les résultats.
- **Une session par segment.** Chaque segment laisse son rapport dans `docs/audit/`, lisible sans toi. Nommage : `BRIEF.md` (ce fichier), `00a-photo.md` (étape préalable), `00b-cartographie.md` (segment 0), puis `01-notifications.md`, `02-scan-credit.md`, `03-acces-donnees.md`, `04-cartes.md`, `05-statistiques.md`, `06-infrastructure.md`, `99-synthese.md`.
- Écris pour un fondateur non technique **et** pour un dev humain qui relira : clair, concret, chaque risque illustré par un cas réel.

## 3. La destination

### Échelle
- **Aujourd'hui** : environ 45 marchands en base dont la moitié en prod, environ 1 600 porteurs, activité récente (moins d'un mois pour une vingtaine de PDV).
- **Cible** : **100 PDV, environ 100 000 porteurs**.
- **Scénario e-commerce** (troisième intégration, peut-être facultative) : volume sans plafond connu, porteurs créés sans passage en caisse, trafic de machines par vagues.

Exprime chaque **seuil de rupture** dans l'unité qui le provoque :
- **l'activité** (scans par jour, pic du rush de midi, requêtes par jour) pour ce qui souffre pendant le service ;
- **le stock** (porteurs, cartes, lignes en base) pour ce qui passe sur tout le monde, actif ou non.

Pour chaque système : à partir de combien ça commence à souffrir, et qu'est-ce qui souffre en premier.

### Deux marchés
- **France** : presque aucun commerce n'a de tablette en caisse, le scan se fait sur le téléphone perso du commerçant. D'où le besoin d'intégrations (borne, caisse).
- **Dubaï** : les commerces de service (secteur visé) ont smartphone ou tablette. **Le scan manuel y reste le cœur du produit**, ce n'est pas un provisoire.

### Chantiers à venir (projection)
**Objectifs réels**, à confronter au code :
- **API d'intégration**, dans cet ordre : **bornes** (le client présente son QR code au lecteur de la borne, les points tombent sans humain), **caisses** (crédit à l'encaissement, sans geste de scan), puis **e-commerce**. Les intégrations auront leurs propres clés et leur propre révocation, jamais un jeton marchand.
- **Landing enrichie** : anniversaire, produit favori, email, consentement.
- **Notifs programmées** depuis le dashboard, **relance configurable** par le marchand (message et fréquence).
- **Segmentation clients** et **push par boutique**.
- **Dashboard mono-site** au niveau du dashboard réseau.
- **Géolocalisation** (notif proche de la boutique, avec le produit favori).
- **Cartes saisonnières** (Noël, Ramadan) : deux modes à évaluer, la bascule **au fil des scans** (mode voulu par Yass) et la bascule **en masse**. Hypothèse à vérifier : côté Google, le design vit dans une classe commune au marchand, la bascule progressive ne vaudrait peut-être que pour Apple.
- **Structure UAE** et second compte Stripe.

**Idées lointaines** : mailing/SMS, assistant IA. Ne conçois rien pour elles. Signale seulement les **portes fermées** : les choix actuels qui les rendraient impossibles ou très coûteuses plus tard.

## 4. Gravité et priorité

**La gravité mesure l'impact d'un défaut, pas la zone où il se trouve.** Un défaut mineur dans le code de l'argent, qui ne met rien en danger ni aujourd'hui ni demain, est une amélioration, pas un défaut grave.

1. **L'argent des clients** : points perdus, doublés, solde faux.
2. **Le trafic machine** (projection) : crédits envoyés par une borne ou une caisse, sans humain pour vérifier. Les machines renvoient automatiquement une demande restée sans réponse.
3. **Le scan au comptoir** : scanner inutilisable ou lent pendant le service.
4. **Les données et les accès** : accès non autorisé, fuite.
5. **Les notifications** : notif qui ne part pas, ou qui part à tort.
6. **La carte dans le téléphone** : carte qui ne s'installe pas ou ne se met plus à jour.
7. **Les statistiques** : chiffres faux.
8. **L'apparence**.

**La priorité est l'ordre dans la roadmap.** Elle suit d'abord les **dépendances** (ce qui doit exister avant autre chose), ensuite la gravité. Un défaut peu grave qui empêche de traiter un défaut grave passe devant, sans changer d'étiquette de gravité. Jamais d'ordre dicté par la facilité ou l'urgence ressentie.

## 5. Règles d'arbitrage

- **Les fonctions sont intouchables, leurs réglages sont négociables.**
  Intouchables : les smart notifs, les push depuis le dashboard, le scan, la carte dans le Wallet sans application, le dashboard réseau.
  Négociables : fréquences, rapidité, quantité de données produites ou affichées.
  Les autres fonctions (annulation du dernier scan, code de secours, thèmes de strip, parrainage…) peuvent être questionnées : signale-le clairement, Yass tranche.
- **Un sacrifice local vaut mieux qu'un plafond global.** Une seconde de plus au scan ou une relance plafonnée valent mieux qu'une plateforme qui cesse de tenir à 50 000 porteurs.
- **Exception absolue** : cette règle ne s'applique **jamais** aux gravités 1, 2 et 3 (argent, trafic machine, scan au comptoir). Là, aucun sacrifice n'est admis.
- **« Est-ce nécessaire ? » avant « comment le réduire ? »** Une suppression se propose **sur preuve** (mesure, usage nul), jamais sur intuition.
- **Les garde-fous sont présumés nécessaires** (verrous, contrôles de doublon, vérifications). Ils peuvent être modifiés, jamais retirés sans une protection équivalente.
- **Tu proposes, Yass décide.** Chaque proposition dit ce qu'elle retire concrètement (au commerçant, au client), ce qu'elle protège, son coût et ses limites.

## 6. Structure de l'audit

**Étape préalable : prouver la photo.** Rien ne suit les migrations en base (47 fichiers appliqués à la main). Avant tout, établir que le schéma de production correspond au dépôt : tables, colonnes, contraintes, fonctions (avec leurs signatures), index, droits. Établir aussi la région du serveur Railway et celle de Supabase (Paris), et ce que ça implique pour la latence, en France et à Dubaï.

**Segment 0 : la cartographie des liens.** Pas seulement la liste des composants : ce qui est **partagé** entre eux, parce que c'est là que ça casse. Un secret, une table, un process, un certificat, une limite externe, une identité. Exemples déjà identifiés : le même secret signe les jetons marchands et le jeton d'authentification des cartes Apple ; un seul Pass Type ID pour tous les marchands ; les tâches automatiques tournent dans le process de l'API.
Le segment 0 produit aussi des **inventaires mécaniques** des familles de défauts connues, pour ne pas compter sur leur redécouverte : par exemple, toutes les lectures Supabase exposées au plafond de 1 000 lignes (sans `range()`, sans `count`), tous les `.catch()` sur un appel Supabase. Chaque endroit reçoit la gravité de ce qu'il fausserait.
Tout élément du code qui n'entre dans aucun segment est signalé : c'est ce qu'on avait oublié.

**Segments**
1. **Notifications** : fait, voir `docs/audit/01-notifications.md`. À compléter seulement si les segments suivants l'éclairent.
2. **Scan et crédit** : du scanner jusqu'à l'écriture du solde, annulation comprise.
3. **Accès et données** : qui peut se connecter, voir, modifier, exporter quoi.
4. **Cartes** : parcours d'inscription, génération des cartes Apple et Google, mises à jour.
5. **Statistiques** : dashboards marchand et réseau, justesse des chiffres.
6. **Infrastructure et exploitation** : serveur, base, tâches automatiques, migrations, sauvegardes, surveillance, déploiement. Livrable spécifique : un **calendrier daté des échéances** (certificat Pass Type ID, clé APNs, service account Google, domaine, compte Apple Developer), avec ce qui casse à chaque échéance.

**Synthèse** : confronte tous les segments à la destination et produit la roadmap technique ordonnée (§8).

## 7. Les angles de lecture, dans chaque segment

**Trois angles :**
1. **Santé** : est-ce que ça fonctionne correctement aujourd'hui ?
2. **Comportement** : ce que la plateforme fait **d'elle-même**, combien de fois, à quel coût (requêtes, écritures, appels Apple et Google, calcul), et ce que devient ce coût à la cible. D'abord : **ce comportement est-il nécessaire ?** Ensuite seulement : comment le réduire intelligemment. Cherche en particulier le travail invisible qui ne sert à rien et grossit avec le volume (modèle : la relance sans fin, §9).
3. **Projection** : qu'est-ce qui cassera ou bloquera là où on va (§3) ?

**Questions transversales, à poser dans chaque segment :**
- **Et avec deux serveurs, et au redémarrage ?** Le code suppose aujourd'hui une seule instance qui ne s'arrête jamais (cron dans le process API, caches en mémoire, minuteurs). Qu'est-ce qui casse ou se duplique le jour où il y en a deux ? Qu'est-ce qui se perd ou s'interrompt, en silence, à chaque déploiement (état en mémoire, envoi coupé en plein milieu) ?
- **Le serveur sait faire, l'interface le demande-t-elle ?** Pour chaque capacité serveur, vérifier son pendant côté dashboard, scanner, admin ou landing (cas connu : `remember_device`, jamais câblé sur le dashboard jusqu'au 21/09).
- **Les changements de masse** (design, configuration, envoi à tout un réseau) : combien de temps ça prend, et qu'est-ce qui souffre pendant ce temps, notamment le scan.
- **Le code en trop** : applique la méthode Ponytail (§10) au périmètre du segment.

## 8. Les livrables

**Chaque rapport de segment**, sur le modèle de `docs/audit/01-notifications.md` :
- constats avec statut et preuve ;
- seuils de rupture (unité activité ou stock) ;
- comportements coûteux et leur nécessité ;
- projection ;
- propositions éventuelles, chacune avec ce qu'elle retire, ce qu'elle protège, son coût et ses limites ;
- hypothèses et angles morts : ce que tu n'as pas pu vérifier.

**La synthèse** :
- l'état de santé global, en une page lisible par Yass ;
- la **roadmap technique ordonnée** : dépendances d'abord, gravité ensuite, chaque étape avec son pourquoi ;
- un **filet de tests de non-régression**, limité à l'argent et au scan (scénarios rejouables d'une commande sur une base jetable, dans le conteneur, résultat affiché en une ligne « N/N OK »), placé dans la roadmap juste avant la première correction qui touche l'argent ou le scan ;
- la liste des sacrifices proposés, pour décision de Yass.

Un dev humain relira la synthèse après l'audit.

## 9. Acquis : ne pas les redécouvrir, les intégrer

Point de départ, pas périmètre.
- `docs/audit/01-notifications.md`, `docs/audit/A-scalabilite-anterieure.md` (rapport transverse écrit avant ce cadrage, à répartir dans les segments concernés) et `PASSATION_TECHNIQUE.md` (§5 et §14 zones dangereuses, §15 bis à sexies, §16 dette, §17 décisions hors pilotage).
- **Relance sans fin** : un client inactif est relancé tous les 8 jours à vie ; iOS n'affiche qu'une fois un texte identique, la plateforme travaille donc dans le vide. Piste retenue : plafond par épisode d'inactivité.
- **63 % des envois Google** visent des cartes installées sur iPhone (mesuré le 26/09).
- **Limite Google** : 3 notifications par carte et par 24 h, confirmée par la documentation officielle Google Wallet (messages TEXT_AND_NOTIFY et notifications de mise à jour, QuotaExceededException au-delà). Non observée en production.
- **Aucune idempotence serveur** sur `POST /scan` ; **code de secours non unique**.
- **La caisse mono-site** porte un jeton marchand complet (écarté, en parking).
- **Cache marchand** mono-instance, invalidé localement.
- **Aucun test automatisé** dans le dépôt.

## 10. Ponytail

Méthode de réduction du code sur-construit : https://github.com/dietrichgebert/ponytail
**Ne l'installe pas comme plugin** (conteneur recréé, scripts automatiques). Clone le dépôt, lis les instructions de sa commande d'audit et applique-les toi-même au périmètre du segment. Sa sortie est une **liste de candidats**, pas un feu vert : chaque suppression future deviendra un chantier testé.

## 11. Hors périmètre

- La facturation des marchands et Stripe (gérés hors plateforme).
- Le travail de configuration des marchands par Yass.
- Le RGPD (noté à part, non grave, repris plus tard).
- La conception des idées lointaines (mailing/SMS, assistant IA) : seulement les portes fermées.
