# Zone « intégration » — architecture (à lire avant d'y toucher)

Cette zone relie WinWin à ce qui se passe **hors du comptoir classique** : l'identité du
client (numéro de téléphone attaché à sa carte), la récupération d'une carte sur un nouveau
téléphone, et demain l'API des caisses des commerçants (Black Tulip) et une borne. Elle est
née le 20/10/2026 (f04 côté comptoir) ; ce fichier dit où ranger chaque chose et comment.

Documents voisins : `01-api-caisses-cadrage.md` (contrat de l'API des caisses, questions au
technicien), `02-f04-comptoir-plan.md` (plan validé du premier lot).

---

## 1. Où vit le code

```
winwincard/backend/
  src/integration/
    index.js           monte la zone ; UNE ligne dans src/index.js : app.use(require('./integration'))
    comptoir.js        /api/comptoir/*            gestes du caissier (jeton boutique ou marchand)
    recuperation.js    /r/:jeton                  page publique du QR de récupération
                       /api/recuperation/:jeton   ce que cette page lit
    api-ventes/        (à créer avec le lot API)  /api/v1/* : API machine des caisses
  public/recuperation.html                        page du client qui scanne le QR
  public/scanner/index.html                       écrans du caissier (« + numéro », « Retrouver une carte »)
  database/migration_0NN_*.sql                    tables et fonctions SQL de la zone
  tests/scenarios.js                              section « f04 » (routes et SQL)
  tests/navigateur/comptoir_telephone.js          écrans du caissier et page du client
```

**Frontière** : la zone appelle le reste (Supabase, `authScanner`, `qrcode`) ; le scan, la
fabrication des cartes et le dashboard **n'appellent jamais la zone**. Une panne ici ne doit
jamais toucher une caisse. Le seul point de contact avec le scan : sa réponse porte
`serial_number` (déjà en main, zéro requête), pour que la caisse sache à quelle carte
attacher un numéro.

---

## 2. Conventions

- **Noms en français**, comme le reste du dépôt ; routes au nom des choses (`cartes`,
  `recherche`, `recuperations`).
- **Préfixes** : `/api/comptoir` (un humain en caisse, jeton boutique ou marchand,
  `authScanner`) ; `/api/v1` (une machine, clé d'API propre au marchand — lot API) ; `/r`
  (lien court public, ouvert par un client).
- **Une règle d'argent ou d'identité = une fonction SQL**, appelée en un seul aller
  (`attacher_telephone`, `creer_recuperation`, sur le modèle de `crediter_scan` et
  `annuler_scan`) : vérification et écriture atomiques, verrou si besoin. La route Node
  reste mince : lire la requête, appeler la fonction, traduire la réponse en statut HTTP.
- **Réponses** : succès en JSON simple ; erreur `{ "error": "code_en_snake_case" }` (+ les
  champs utiles à l'écran, jamais une phrase) ; l'écran choisit le texte FR / EN. Base
  lente ou en panne : 503 + `Retry-After`, comme le scan.
- **Règle n°1 : la caisse ne ralentit jamais.** Rien dans la zone n'ajoute une requête au
  scan ; tout ce qui est facultatif part au tap du caissier, dans une requête à part.
- **Secrets** : un jeton public (QR) n'existe en clair qu'une fois, dans la réponse ; la base
  n'en garde que l'empreinte sha256. Pareil pour les futures clés d'API.
- **Envois** : toute nouvelle surface d'envoi (APNs, Google) écrit dans `notification_envois`
  (CLAUDE.md). Le lot f04 n'en ajoute aucune.
- **Migrations** : numérotées, rejouables, `lock_timeout`, exécutées dans Supabase **avant**
  le push ; chaque table neuve active la RLS et donne ses droits à `service_role` (la base ne
  les donne pas d'elle-même, audit 00b §8). Une donnée personnelle neuve est effacée par
  `effacer_client` (`database/rgpd_effacement.sql`, même texte que la dernière migration qui
  la redéfinit).
- **Tests** : chaque route a ses cas au filet (`npm test`) avant le push, et une
  contre-épreuve sur le commit en production (les nouveaux tests y échouent).

---

## 3. Patron d'un attribut client

Le téléphone est le premier ; l'e-mail, l'anniversaire ou un produit favori suivront **le
même chemin**, sans réécriture. Rien n'est codé pour eux tant qu'ils ne sont pas demandés.

**Attribut d'identité** (sert à retrouver une carte) — modèle : le téléphone, migration 066.

| Étape | Où | Téléphone |
|---|---|---|
| valeur saisie | `clients.<attr>` | `telephone` |
| règle de format, une seule fois | fonction SQL `IMMUTABLE` `normaliser_<attr>` | `normaliser_telephone` (Émirats par défaut) |
| forme comparable | colonne **générée** `clients.<attr>_normalise` | `telephone_normalise` |
| une valeur = une carte par marchand | index unique partiel (clients non effacés) | `clients_telephone_unique` |
| d'où, quand | `clients.<attr>_source` (liste fermée), `<attr>_lie_le` | `inscription`, `comptoir`, `caisse`, `import` |
| preuve d'accord | une ligne `consentements` par attache (`type`, `source`) | `type = 'telephone'` |
| attache | fonction SQL `attacher_<attr>(…, p_ecrire)` : aperçu puis écriture | `attacher_telephone` |
| effacement | `effacer_client` met la valeur brute à `null` (la normalisée suit) | fait |

**Attribut simple** (anniversaire, produit favori) : valeur, source et date, consentement,
effacement. Pas de forme normalisée ni d'unicité.

Règles qui valent pour tous :
- **Pas d'écrasement depuis la caisse** d'un attribut d'identité déjà posé (un caissier ne
  doit pas pouvoir détourner l'ancre de récupération d'un client) ; le changement passe par
  le dashboard (à construire).
- **Confirmation avant écriture** : la caisse montre la valeur normalisée et le prénom
  (« Attacher le +971 50 … à la carte de Sarah ? ») ; seul le second appui écrit.
- Changer une règle de format = une migration qui recalcule la colonne générée.

---

## 4. Ce qui reste à construire ici (dans l'ordre prévu)

1. Lot API des caisses (`api-ventes/`) : clé par marchand, `POST /api/v1/ventes`, attache du
   téléphone joint à la vente (`source = 'caisse'`) — attend les réponses du technicien.
2. Changement de numéro depuis la fiche client du dashboard.
3. « Retrouver une carte » dans l'onglet Scanner du dashboard (avec son découpage, t42).
4. Amélioration notée, pas un barrage : code SMS / e-mail à la récupération.
