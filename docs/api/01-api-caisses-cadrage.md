# API caisses — cadrage (19/10/2026, rien codé)

Premier client visé : **Black Tulip**, 35 points de vente (fleuristes, Dubaï), caisse développée
en interne. Ce document est un **brouillon de contrat** côté WinWin, à valider par le pilotage
puis à confronter aux réponses de leur technicien (partie B). Aucun code tant que les deux ne sont
pas validés.

Sources : le code de production (`src/routes/scan.js`, `crediter_scan` migration 051,
`annuler_scan` migration 052, clé d'idempotence t43), l'audit (`docs/audit/02-scan-credit.md`
§4.3 « le modèle à suivre pour une API machine », `99-synthese.md` §B « Les machines »).
Les fiches de cartes t33 et f02 à f05 ne sont pas dans le dépôt : elles sont reprises ici
d'après leur intitulé (message du pilotage du 19/10).

---

## A. Brouillon du contrat d'API

### A.1 Principe

Une vente encaissée par leur caisse, avec la carte WinWin du client scannée sur leur lecteur,
devient **un crédit** sur cette carte, par **le même chemin que le scan au comptoir** :
`crediter_scan` (report, remise, seuil, verrou de carte), puis mise à jour de la carte (Apple,
Google) et registre des envois. Rien n'est réécrit : la caisse est un « scanner de plus », qui
parle par une route à lui.

### A.2 Authentification : une clé propre au marchand

- **Jamais le jeton marchand** (règle du Socle). Une **clé d'API** par marchand, créée en
  admin, montrée **une seule fois**, stockée **hachée** en base (comme un mot de passe),
  révocable, avec sa date de dernière utilisation.
- En-tête : `Authorization: Bearer wwk_live_…`.
- Portée de la clé : **créditer et annuler les ventes de ce marchand, rien d'autre** (pas de
  lecture des clients, pas de campagnes, pas de statistiques).
- Limiteur **par clé** (pas par adresse : leur serveur central enverrait tout depuis une
  seule adresse, et le limiteur global de 300 / 15 min couperait les ventes). Seuil à fixer
  sur leur volume (question B4).
- **Nécessite une migration** (table des clés). Aucun code avant validation.

### A.3 Routes

**1. Créditer une vente**

`POST /api/v1/ventes`

```json
{
  "reference": "BT-DXB-014-000123",     // n° de commande / ticket, UNIQUE chez eux
  "boutique": "DXB-014",                // leur code de magasin (35 codes, rapprochés des boutiques WinWin)
  "carte": "6f1c…-…",                   // contenu du QR WinWin lu par leur lecteur (ou code de secours 6 car.)
  "montant": 25000,                     // en plus petite unité (fils) : 250,00 AED
  "devise": "AED",
  "date_vente": "2026-10-19T08:12:30Z"  // facultatif, pour la trace
}
```

Réponses :

| Cas | Code | Corps |
|---|---|---|
| crédité | 200 | `{ "ok": true, "points_credites": 25, "solde": 140, "seuil": 500, "recompense": false, "deja_enregistre": false }` |
| même vente renvoyée | 200 | même corps, `"deja_enregistre": true` (rien recrédité) |
| carte inconnue pour ce marchand | 404 | `{ "error": "carte_inconnue" }` |
| boutique inconnue / coupée | 422 / 403 | `{ "error": "boutique_inconnue" }` / `{ "error": "boutique_coupee" }` |
| même référence, autre carte ou autre montant | 409 | `{ "error": "reference_deja_utilisee" }` |
| corps invalide | 400 | `{ "error": "…" }` |
| clé absente, fausse, révoquée | 401 | `{ "error": "cle_invalide" }` |
| trop de requêtes | 429 | `Retry-After` |
| base indisponible | 503 | `Retry-After` — **renvoyer la même requête** : jamais de double crédit |

Pas de prénom, pas de téléphone, pas d'e-mail dans la réponse (données minimales).

**2. Annuler une vente (remboursement)**

`POST /api/v1/ventes/{reference}/annulation`

Réponses : 200 `{ "ok": true, "solde": 115 }` ; 404 vente inconnue ; 409 `deja_annulee` ;
409 `pas_la_derniere` (voir A.5, point dur).

**3. (facultatif, si demandé — question B6) Lire le solde d'une carte**

`GET /api/v1/cartes/{carte}` → `{ "solde": 140, "seuil": 500, "recompense": false }`.
À n'ouvrir que si leur caisse doit afficher le solde **avant** la vente.

### A.4 Idempotence : une vente renvoyée ne crédite qu'une fois

- On **réutilise la clé d'idempotence en place** (t43, `scans.cle_idempotence`, index unique
  par marchand) : la clé est **dérivée de la référence** (UUID v5 de `marchand + référence`).
  La même vente renvoyée, même mille fois, tombe sur la même clé : `crediter_scan` rend le
  premier résultat, marqué `deja_enregistre`.
- Une même référence avec une autre carte ou un autre montant : refusée (409), rien d'écrit.
- C'est aussi ce qui permet **l'annulation par référence** : la clé dérivée retrouve le scan
  sans rien stocker de plus. Pour l'afficher dans le dashboard (« vente BT-…-123 ») et pour le
  support, une colonne `reference_externe` serait utile (**migration**, à décider).

### A.5 Points durs à trancher avant le code

1. **Conversion montant → points (audit 99 §B2).** Le serveur reçoit un montant en fils et le
   convertit avec **une règle propre au marchand** (par exemple 1 point par AED, arrondi vers
   le bas), plus **un plafond par vente**. Sans règle, un montant en fils créditerait cent fois
   trop. Proposition : la règle vit chez WinWin (réglée en admin), la caisse n'envoie que le
   montant. **Migration** (réglage par marchand). Décision du pilotage.
2. **Remboursement tardif.** `annuler_scan` n'annule que **le dernier mouvement du client**
   (garde-fou de l'annulation au comptoir). Une vente remboursée deux jours plus tard, après
   un autre passage, serait **refusée** (`pas_la_derniere`). Pour une caisse, il faudrait plutôt
   un **mouvement inverse tracé** (débit du nombre de points de la vente, sans passer sous 0),
   sur le modèle des ajustements (052). C'est un garde-fou d'argent qui change : **décision du
   pilotage**, hors de ce brouillon.
3. **Récompense atteinte en caisse (99 §B1).** Un humain est présent à la caisse : la réponse
   dit `recompense: true`, et leur caisse affiche « récompense à remettre ». Reste à définir
   ce que fait leur caissier (remise immédiate ou au prochain passage), comme au comptoir.
4. **Solde négatif.** Aucune contrainte en base n'interdit un solde négatif (audit 02 §6) :
   garde-fou à poser **avant** d'ouvrir un second écrivain (`CHECK`, **migration**).
5. **Canal du crédit (99 §B, statistiques).** Distinguer comptoir et caisse dans les
   statistiques : une colonne `canal` sur les scans, à poser **avec** l'API (**migration**).

### A.6 Briques couvertes

| Brique | Couverte ? | Comment |
|---|---|---|
| **f02** logique de crédit partagée | **oui** | la route appelle `crediter_scan`, comme le scan |
| **f03** idempotence serveur | **oui** | clé t43 dérivée de la référence |
| **f04** liaison compte client ↔ carte | **non, pas nécessaire en variante 1** | la carte est scannée à chaque vente ; f04 ne sert que si leur caisse veut créditer sans scan (client reconnu par leur fiche) |
| **f05** annulation par n° de commande | **en partie** | route d'annulation par référence ; **limitée au dernier mouvement** tant que le point A.5-2 n'est pas tranché |

### A.7 Ce qui ne change pas

La caisse WinWin, le scan au comptoir, l'onglet Scanner, les cartes : rien. La route API est
un nouvel appelant de `crediter_scan`, à côté du scan.

---

## B. Questions pour leur technicien (fermées)

1. **Envoi à chaque vente.** Votre caisse peut-elle appeler une adresse HTTPS (webhook /
   requête POST JSON) **à chaque vente encaissée** ? Oui / non.
2. **D'où part l'appel.** L'appel part-il **de chaque caisse** (35 points de vente) ou **d'un
   serveur central** ? Chaque caisse / serveur central.
3. **Synchrone ou après coup.** Le caissier doit-il voir la réponse (points crédités,
   récompense) **pendant** la vente, ou l'envoi peut-il partir **après** (file, quelques
   secondes ou minutes plus tard) ? Pendant / après.
4. **Identification du client.** Votre lecteur peut-il **scanner le QR code** de la carte
   WinWin (Apple / Google Wallet) et transmettre son contenu tel quel dans l'appel ? Oui / non.
   Sinon, le caissier peut-il **taper un code de 6 caractères** ? Oui / non.
5. **Référence unique.** Chaque vente a-t-elle un **numéro unique** (ticket, commande), stable
   en cas de renvoi ? Oui / non. Format (exemple) ?
6. **Code magasin.** Chaque vente porte-t-elle un **code de point de vente** stable ? Oui / non.
   Liste des 35 codes ?
7. **Montant.** Le montant envoyé est-il **TTC**, en **AED**, en **fils** (centimes) ? Remises
   déduites ? Oui / non pour chacun.
8. **Fidélité.** Points (proportionnels au montant) ou tampons (un par passage) ? Si points :
   combien de points par AED, et seuil de récompense ?
9. **Remboursements.** Votre caisse envoie-t-elle un événement **à chaque remboursement /
   annulation** de vente, avec la même référence ? Oui / non. Délai typique entre vente et
   remboursement ?
10. **Retour d'information.** Avez-vous besoin que WinWin **réponde avec le solde et la
    récompense** pour l'afficher en caisse ? Oui / non. Ou d'une **lecture du solde avant la
    vente** ? Oui / non.
11. **Volume.** Combien de ventes par jour (tous magasins) ? Pic par minute (Saint-Valentin,
    fête des mères) ?
12. **Renvois.** En cas d'erreur réseau ou de réponse 503, votre caisse **renvoie-t-elle la
    même requête** automatiquement ? Oui / non. Combien de fois, avec quel délai ?
13. **Environnement de test.** Pouvez-vous appeler un **environnement de test** WinWin avant
    la production ? Oui / non.
14. **Sécurité.** Pouvez-vous stocker une **clé secrète** côté serveur (jamais dans
    l'application du caissier) et l'envoyer en en-tête `Authorization` ? Oui / non.

---

## C. Prérequis avant d'ouvrir une API (diagnostic, rien codé)

### C.1 Reste de t17

- **Désinscription Apple sans contrôle du jeton** (`src/routes/apple-wallet.js`,
  `DELETE /v1/devices/:deviceId/registrations/:passTypeId/:serialNumber`) : l'inscription
  vérifie le jeton de la carte (`verifyAppleToken`), la désinscription **non**. Qui connaît un
  identifiant d'appareil et un numéro de série peut couper les mises à jour d'une carte. Apple
  envoie le même en-tête `Authorization: ApplePass …` à la désinscription : le correctif est
  le même contrôle qu'à l'inscription (401 sinon). Petit, sans migration, testable au filet.
  Hypothèse à vérifier au test : aucun iPhone n'envoie de désinscription sans en-tête
  (documentation Apple : l'en-tête est envoyé).
- **Quota manuel de notifications non validé** (`src/routes/admin.js`, champ
  `notification_quota_override`) : l'admin peut y écrire une valeur hors bornes (négative,
  texte). Route admin seulement ; correctif : entier entre 0 et un plafond, sinon 400. Petit.
- Rappel (passation §15) : le logo Google doit sortir du dépôt avant de le rendre privé.

### C.2 t23 — protection des sauvegardes (audit 06 §6, P4 et P5)

- **Aujourd'hui** : sauvegardes Supabase quotidiennes, **7 jours**, **dans le même compte**
  que la base : la perte du projet ou du compte les emporte ; perte maximale d'une journée ;
  aucune copie ailleurs, aucun script d'export dans le dépôt.
- **Pourquoi maintenant** : avec l'API, un second écrivain crédite des points (de l'argent
  pour le client) ; une erreur de masse (mauvaise conversion, boucle de renvois) doit pouvoir
  se réparer après coup.
- **Options** (décisions de dépense, à Yass) :
  - **P4, copie hors du compte** : un export régulier (`pg_dump`, chiffré) vers un stockage
    externe, déclenché hors du serveur de l'API. Coût faible ; demande un accès en lecture à la
    base et un stockage protégé comme la base (données personnelles).
  - **P5, Point in Time** : perte ramenée à 2 minutes, ≈ 100 $ / mois plus le passage à une
    instance Small (arrêt < 2 min). Même compte que la base : ne remplace pas P4.
- Proposition : **P4 avant l'ouverture de l'API**, P5 à décider sur le volume réel.
