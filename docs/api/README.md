# Zone « intégration » — architecture (à lire avant d'y toucher)

Cette zone relie WinWin à ce qui se passe **hors du comptoir WinWin** : l'API des caisses des
commerçants (premier intégrateur : Black Tulip), l'identité du client (numéro de téléphone
rattaché à sa carte) et la récupération d'une carte sur un nouveau téléphone ; plus tard, une
borne. Ce fichier dit où ranger chaque chose et comment, pour qu'un développeur reprenne la
zone sans deviner.

**État au 20/10/2026** : rien n'est en production. Le contrat est **validé**
(`03-contrat-api-v1.md`, v1.0) ; **invariant : WinWin est additif, jamais bloquant** (une vente
n'attend ni ne dépend jamais de WinWin) ; un socle déjà codé et testé (téléphone, récupération) attend sur la
branche `briques/f04-telephone` (passation §0.5 bis).

| Document | Contenu |
|---|---|
| `01-api-caisses-cadrage.md` | cadrage, points durs tranchés, questions au technicien |
| `02-f04-comptoir-plan.md` | premier plan f04 (au comptoir WinWin), **recadré** dans l'API |
| `03-contrat-api-v1.md` | **le contrat de l'API v1** (partie I pour le technicien, II pour le développeur, III décisions ouvertes) |

---

## 1. Où vit le code (cible)

```
winwincard/backend/
  src/integration/
    index.js              monte la zone ; UNE ligne dans src/index.js
    api-v1/               /api/v1/*  API machine des caisses (clé par commerçant)
      index.js            routeur : vérification de la clé, limiteur par clé, erreurs JSON
      cle.js              clé d'API (empreinte sha256, cache 60 s, révocation)
      ventes.js           POST /ventes, POST /ventes/:reference/annulation
      cartes.js           GET /cartes/:carte
      migrations.js       POST /migrations (points d'avant, une fois par carte)
      recuperations.js    POST /recuperations
    recuperation.js       /r/:jeton (page publique) et /api/recuperation/:jeton
  src/services/credit.js  crédit partagé par le comptoir et l'API (résolution de carte, effets d'après)
  public/recuperation.html               page du client qui ouvre le lien de récupération
  database/migration_0NN_*.sql           tables et fonctions SQL de la zone
  tests/scenarios.js                     sections « API v1 » et « f04 »
```

**Frontière** : la zone appelle le reste (Supabase, le crédit partagé, `qrcode`) ; le comptoir,
la fabrication des cartes et le dashboard **n'appellent jamais la zone**. Une panne de l'API ne
doit jamais toucher une caisse WinWin.

**Remisé** (branche `briques/f04-telephone`, ne pas réintroduire sans décision) : les écrans
« + Numéro » / « Retrouver une carte » de la caisse WinWin et `src/integration/comptoir.js`.

---

## 2. Conventions

- **Noms en français**, comme le reste du dépôt ; routes au nom des choses (`ventes`,
  `cartes`, `recuperations`). Le contrat publié pour un intégrateur étranger est traduit,
  le code ne l'est pas.
- **Préfixes** : `/api/v1` (une machine, clé d'API du commerçant) ; `/r` (lien court public,
  ouvert par un client). Les routes humaines du comptoir restent dans `src/routes/`.
- **Une règle d'argent ou d'identité = une fonction SQL**, appelée en un seul aller
  (`crediter_scan`, `annuler_scan`, `attacher_telephone`…) : vérification et écriture
  atomiques, verrou si besoin. La route Node reste mince : lire, appeler, traduire en statut.
- **Erreurs** : `{ "error": "code_en_snake_case" }` (+ `champ` si utile), jamais une phrase ;
  le texte affiché est choisi par l'écran ou la caisse. Base lente ou en panne : 503 +
  `Retry-After`.
- **Données personnelles** : aucune dans les réponses de l'API ; le téléphone n'entre que dans
  un sens ; jamais dans les journaux.
- **Secrets** : une clé ou un jeton public n'existe en clair qu'une fois (à sa création) ; la
  base n'en garde que l'empreinte sha256.
- **Règle n°1 : la caisse ne ralentit jamais.** Le comptoir WinWin ne gagne aucune requête ;
  l'API a son propre limiteur, hors du limiteur global.
- **Envois** : toute nouvelle surface d'envoi (APNs, Google) écrit dans `notification_envois`
  (CLAUDE.md). Une vente API met la carte à jour par le même chemin que le scan (déjà tracé).
- **Migrations** : numérotées, rejouables, `lock_timeout`, exécutées dans Supabase **avant**
  le push ; chaque table neuve active la RLS et donne ses droits à `service_role` (la base ne
  les donne pas d'elle-même, audit 00b §8) ; une donnée personnelle neuve est effacée par
  `effacer_client` (`database/rgpd_effacement.sql`, même texte que la dernière migration qui
  la redéfinit) ; requête de taille avant toute réécriture de grosse table.
- **Tests** : chaque ligne du contrat est un contrôle du filet (`npm test`) avant le push, plus
  la contre-épreuve sur le commit en production.

---

## 3. Patron d'un attribut client

Le téléphone est le premier ; l'e-mail, l'anniversaire ou un produit favori suivront **le
même chemin**, sans réécriture. **Rien n'est codé pour eux** tant qu'ils ne sont pas demandés.

**Attribut d'identité** (sert à retrouver une carte) — modèle : le téléphone, migration 066
(branche `briques/f04-telephone`).

| Étape | Où | Téléphone |
|---|---|---|
| valeur reçue | `clients.<attr>` | `telephone` |
| règle de format, une seule fois | fonction SQL `IMMUTABLE` `normaliser_<attr>` | `normaliser_telephone` (Émirats par défaut) |
| forme comparable | colonne **générée** `clients.<attr>_normalise` | `telephone_normalise` |
| une valeur = une carte par commerçant | index unique partiel (clients non effacés) | `clients_telephone_unique` |
| d'où, quand | `clients.<attr>_source` (liste fermée), `<attr>_lie_le` | `inscription`, `comptoir`, `caisse`, `import` |
| preuve d'accord | une ligne `consentements` par rattachement (`type`, `source`) | `type = 'telephone'` |
| rattachement | fonction SQL `attacher_<attr>(…, p_ecrire)` : aperçu possible, puis écriture | `attacher_telephone` |
| effacement | `effacer_client` met la valeur brute à `null` (la normalisée suit) | fait |

**Attribut simple** (anniversaire, produit favori) : valeur, source et date, consentement,
effacement ; ni forme normalisée ni unicité.

Règles qui valent pour tous :
- **Jamais d'écrasement** d'un attribut d'identité déjà posé, ni par l'API ni par une caisse
  (sinon l'ancre de récupération d'un client peut être détournée) ; le changement passe par
  WinWin (admin, puis dashboard).
- Quand un humain **tape** la valeur, **confirmation avant écriture** (valeur normalisée et
  carte affichées, second geste pour écrire) : la fonction SQL a un mode aperçu pour ça.
- Changer une règle de format = une migration qui recalcule la colonne générée.

---

## 4. Ce qui reste à construire (ordre prévu, sur validation)

1. API v1 selon `03-contrat-api-v1.md` (migration clés + réglages + canal + origine ; 066
   ajustée ; crédit partagé ; routes ventes, annulation, cartes, migrations, récupérations ;
   admin des clés).
2. Changement de numéro depuis WinWin (admin, puis fiche client du dashboard).
3. Récupération en self-service par SMS (f11).
