# Relecture — secret des cartes Apple séparé de `JWT_SECRET`

> **Statut (01/10) : mis en attente par décision du fondateur, risque accepté sur `JWT_SECRET`.** Si `JWT_SECRET` doit un jour changer, poser d'abord ce correctif avec l'ANCIENNE valeur.

**Temps de relecture estimé : 30 min** (le diff fait 32 lignes ; le reste sert à la procédure et aux questions).
Base : commit `4319459`, branche `claude/keen-goldberg-MXslu`. Rien n'est poussé.
Pièce jointe : `point10_secret_cartes.patch`.

## Contexte

1. Chaque carte Apple installée porte un jeton : `authenticationToken`, égal au HMAC-SHA256 du numéro de série tronqué à 32 caractères. Apple le renvoie à chaque appel du webservice. Ce jeton est calculé avec `JWT_SECRET`, le secret qui signe aussi les jetons admin, marchand et caisse.
2. Conséquence : changer `JWT_SECRET` (après une fuite, par exemple) figerait les ~1 100 cartes iPhone, qui répondraient 401 et ne se mettraient plus jamais à jour.
3. Le correctif introduit `APPLE_PASS_SECRET`, avec repli sur `JWT_SECRET`. Une fois cette variable posée comme copie exacte, `JWT_SECRET` pourra changer sans toucher aux cartes. Déployé sans la variable, le code ne change rien.

## Diff

```diff
 // services/apple-pass.js
+function secretCartes() {
+  return process.env.APPLE_PASS_SECRET || process.env.JWT_SECRET;
+}
 function computeAuthToken(serialNumber) {
   return crypto
-    .createHmac('sha256', process.env.JWT_SECRET)
+    .createHmac('sha256', secretCartes())
     .update(serialNumber).digest('hex').slice(0, 32);
 }

 // index.js, juste après le contrôle des variables obligatoires
+if (process.env.APPLE_PASS_SECRET) {
+  const identique = process.env.APPLE_PASS_SECRET === process.env.JWT_SECRET;
+  if (!identique && process.env.APPLE_PASS_SECRET.trim() === process.env.JWT_SECRET.trim()) {
+    console.error('[boot] APPLE_PASS_SECRET ne diffère de JWT_SECRET que par des espaces : copie fautive, démarrage refusé');
+    process.exit(1);   // healthcheck en échec → Railway garde l'ancienne version
+  }
+  console.log(`[boot] Cartes Apple signées avec APPLE_PASS_SECRET (identique à JWT_SECRET : ${identique ? 'oui' : 'non'})`);
+} else {
+  console.log('[boot] Cartes Apple signées avec JWT_SECRET (APPLE_PASS_SECRET absent)');
+}
```
`computeAuthToken` reste l'unique source du jeton : il sert à la fois dans `pass.json` (`apple-pass.js:340` après correctif) et dans la vérification du webservice (`apple-wallet.js:13`).

## Tests passés (32/32)

- **Jetons, ancien code contre nouveau, 503 numéros de série :**
  - identiques sans la variable, avec une variable vide, et avec une copie exacte ;
  - après rotation (`JWT_SECRET` changé, `APPLE_PASS_SECRET` = ancienne valeur), identiques ;
  - rotation **sans** secret dédié, ou copie fausse d'**un** caractère : 0 jeton valable sur 503.
- **Démarrage :**
  - le journal indique quelle variable signe les cartes, et jamais la valeur d'un secret ;
  - une copie avec un espace final ou un saut de ligne initial est refusée (code de sortie 1).
- **Vraies routes du webservice,** avec une carte émise sous l'ancien secret :
  - l'inscription d'un appareil et la demande de la dernière version de la carte sont acceptées par l'ancien code, par le nouveau sans variable, avec copie et après rotation (pour la dernière version, seule l'authentification est testée : le banc n'a pas les certificats Apple) ;
  - elles sont refusées après une rotation faite sans secret dédié ;
  - un jeton faux reçoit toujours 401.
- **Effet de la rotation sur les jetons marchand :** un jeton signé avec l'ancien secret reçoit 401, un jeton signé avec le nouveau reçoit 200.

## Trois questions

1. Pour créer `APPLE_PASS_SECRET`, vaut-il mieux une **copie littérale** ou une **variable de référence Railway** `${{JWT_SECRET}}` ? La référence évite la faute de frappe, mais suit `JWT_SECRET` : avant toute rotation, il faudrait la convertir en valeur littérale, sinon les cartes se figent.
2. Le contrôle au démarrage ne détecte qu'une différence d'espaces. Faut-il aussi une **empreinte** (HMAC d'une valeur fixe, notée en base au premier démarrage) pour détecter n'importe quelle différence ? Ou bien le journal « identique : oui » vérifié après le déploiement suffit-il ?
3. **Découvert pendant ce travail :** `DELETE /v1/devices/:deviceId/registrations/:passTypeId/:serial` ne vérifie pas le jeton Apple (`apple-wallet.js:65-77`). N'importe qui peut donc désinscrire un appareil d'une carte, qui ne recevra plus de mise à jour. La spécification PassKit prévoit l'en-tête `Authorization` sur cette requête. Faut-il le vérifier dans ce même lot ?

## Procédure prévue (après votre retour)

**Préalable :** une copie de `JWT_SECRET` conservée hors de Railway. Pas encore confirmé par le fondateur.

1. **Pousser le code.** Le journal doit afficher « signées avec JWT_SECRET ». Aucun changement de comportement.
2. **Créer `APPLE_PASS_SECRET`** comme copie exacte de `JWT_SECRET`. Railway redéploie, et le journal doit afficher « identique à JWT_SECRET : oui ».
3. **Faire un scan cobaye** sur une carte iPhone : la carte doit se mettre à jour.

**La rotation de `JWT_SECRET` reste une opération distincte, plus tard.** Elle déconnecte tous les dashboards et toutes les caisses.

**Retour arrière :** supprimer `APPLE_PASS_SECRET` (repli sur `JWT_SECRET`, tant qu'il n'a pas changé), ou annuler le commit.
