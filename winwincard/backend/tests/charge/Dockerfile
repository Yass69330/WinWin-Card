# ════════════════════════════════════════════════════════════════════════════
# IMAGE DE LA CAMPAGNE DE CHARGE (étape 15, temps 2) — PROJET RAILWAY DE TEST
# UNIQUEMENT. Jamais la production : son image est le Dockerfile de la racine,
# dont le .dockerignore exclut tests/charge.
#
# Une seule image pour les trois services du projet de test ; la variable
# CAMPAGNE_PROGRAMME choisit le programme (« Custom Start Command » reste VIDE,
# comme en production) :
#   serveur    (variable absente)               le vrai serveur, src/index.js,
#              chargé du fichier de campagne par NODE_OPTIONS ;
#   imitateur  tests/charge/imitateur.js        faux Apple, faux Google, iPhones ;
#   pilote     tests/charge/pilote.js           prépare la base, joue les scénarios.
#
# Railway prend ce fichier par la variable RAILWAY_DOCKERFILE_PATH
# (tests/charge/Dockerfile) et, à côté, Dockerfile.dockerignore, qui GARDE
# tests/charge (HYPOTHÈSE : Railway construit avec BuildKit, qui lit ce fichier
# à la place du .dockerignore de la racine). Si ce n'était pas le cas, l'échec
# serait bruyant : le serveur ne démarre pas (« Cannot find module
# …/campagne.js »), le pilote non plus.
# ════════════════════════════════════════════════════════════════════════════

# Même Node, même système que la production (Dockerfile de la racine).
FROM node:24.10.0-trixie@sha256:79784277ecfbc2ea2b45a323c51145334a1228494cf27ed51496e733391ba142

# Comme la production : APNs « de production » (redirigé vers l'imitateur par le
# fichier de campagne), journaux « combined ».
ENV NODE_ENV=production

# psql, pour le pilote seulement (rejeu du dépôt dans la base de test,
# tests/charge/preparer.js). Client PostgreSQL 17 de Debian 13, comme Supabase.
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .

# `exec` : node remplace le shell et reçoit lui-même le SIGTERM de Railway
# (arrêt propre du serveur, étape 14a).
CMD ["sh", "-c", "exec node \"${CAMPAGNE_PROGRAMME:-src/index.js}\""]
