# Image du serveur WinWin (étape 8 de la synthèse). Remplace Nixpacks, déprécié,
# que Railway cesse de prendre en compte le 01/12/2026 avec railway.toml.
# Railway l'utilise d'office : Dockerfile à la racine du dossier source
# (winwincard/backend), journal « Using detected Dockerfile! ».
#
# Node 24.10.0 EXACT (même version que sous Nixpacks), image officielle épinglée
# par empreinte : rien ne change sans commit, ni Node ni le système. Mettre à jour
# = changer cette ligne, puis vérifier une carte iPhone (étape 20).
#
# Image COMPLÈTE (Debian 13), pas « slim » : elle contient openssl (3.5.1), qui
# signe les cartes Apple (services/apple-pass.js, execFile('openssl')). La version
# « slim » ne l'a pas ; sans lui, plus aucune carte iPhone ne se génère, et le
# healthcheck /health/db ne le verrait pas. Plus lourde, mais rien n'est
# téléchargé à la construction en dehors des paquets npm.
FROM node:24.10.0-trixie@sha256:79784277ecfbc2ea2b45a323c51145334a1228494cf27ed51496e733391ba142

# Posé par Nixpacks sans être écrit nulle part : NODE_ENV=production choisit le
# serveur de notifications Apple de production (services/apns.js). Sans lui, les
# notifications iPhone partiraient vers le bac à sable d'Apple.
ENV NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .

# Railway fournit PORT. Même commande de démarrage que l'ancien railway.toml.
CMD ["npm", "start"]
