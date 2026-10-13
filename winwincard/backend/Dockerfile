# Image du serveur WinWin (étape 8 de la synthèse). Remplace Nixpacks, déprécié,
# que Railway cesse de prendre en compte le 01/12/2026 avec railway.toml.
# Railway l'utilise d'office : Dockerfile à la racine du dossier source
# (winwincard/backend), journal « Using detected Dockerfile! ».
#
# Node 24.21.0 EXACT (étape 20a, 13/10/2026 ; avant : 24.10.0), image officielle
# épinglée par empreinte : rien ne change sans commit, ni Node ni le système.
# Mettre à jour = changer cette ligne, `engines` de package.json et .nvmrc (le
# filet refuse de tourner sous une autre version, tests/lancer.js), puis vérifier
# une carte iPhone ajoutée et mise à jour (openssl de l'image signe les cartes).
#
# Image COMPLÈTE (Debian 13), pas « slim » : elle contient openssl (3.5.7), qui
# signe les cartes Apple (services/apple-pass.js, execFile('openssl')). La version
# « slim » ne l'a pas ; sans lui, plus aucune carte iPhone ne se génère, et le
# healthcheck /health/db ne le verrait pas. Plus lourde, mais rien n'est
# téléchargé à la construction en dehors des paquets npm.
FROM node:24.21.0-trixie@sha256:1278a37eb510ec1606fba0e80f554bcc941ae0b44f35ae373c4822ae7717c64d

# Posé par Nixpacks sans être écrit nulle part : NODE_ENV=production choisit le
# serveur de notifications Apple de production (services/apns.js). Sans lui, les
# notifications iPhone partiraient vers le bac à sable d'Apple.
ENV NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .

# Railway fournit PORT. `node` DIRECTEMENT, et non `npm start` (même programme,
# package.json) : npm ne transmet pas le SIGTERM du redéploiement (mesuré le
# 03/10), et l'arrêt propre (étape 14a, src/services/arret.js) ne se déclencherait
# jamais. Ne rien mettre dans « Custom Start Command » de Railway : ce champ
# prime sur cette ligne.
CMD ["node", "src/index.js"]
