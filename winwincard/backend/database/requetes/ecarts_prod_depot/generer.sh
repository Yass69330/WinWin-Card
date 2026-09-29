#!/usr/bin/env bash
# ============================================================================
# Régénère ecarts_prod_depot.sql : la requête qui compare une base réelle (la
# production) à ce que le dépôt reconstruit. À relancer après CHAQUE migration.
#
#   1. rejoue le dépôt dans une base jetable : prélude Supabase minimal, puis
#      schema.sql, migrations dans l'ordre, rgpd_effacement.sql ;
#   2. photographie cette base (etat_base.sql) et fige le résultat dans la
#      requête (VALUES « depot ») ;
#   3. contrôle : la requête lancée sur la base jetable doit y rendre 0 écart ;
#   4. supprime la base jetable.
#
# Exige un PostgreSQL local (16 ou plus) et un rôle superutilisateur : le rejeu
# crée des rôles et un déclencheur d'événement. PSQL = commande psql à utiliser.
#   Poste de dev  :  bash generer.sh
#   Conteneur     :  PSQL='runuser -u postgres -- psql' bash generer.sh
# Les fichiers sont lus par ce script et passés à psql par l'entrée standard :
# le rôle système de PostgreSQL n'a pas besoin d'accéder au dépôt.
# ============================================================================
set -euo pipefail

ICI=$(cd "$(dirname "$0")" && pwd)
DB_DIR=$(cd "$ICI/../.." && pwd)
PSQL=${PSQL:-psql}
BASE=ecarts_rejeu_$$
SORTIE=$ICI/ecarts_prod_depot.sql

sql() { PGOPTIONS='-c client_min_messages=warning' $PSQL -X -q -v ON_ERROR_STOP=1 "$@"; }

MIGRATIONS=$(cd "$DB_DIR" && ls migration_*.sql | sort)
DERNIERE=$(echo "$MIGRATIONS" | tail -1)
NB_FICHIERS=$(( $(echo "$MIGRATIONS" | wc -l) + 2 ))

sql -d postgres -c "CREATE DATABASE $BASE" > /dev/null
trap 'sql -d postgres -c "DROP DATABASE IF EXISTS $BASE" > /dev/null' EXIT
sql -d postgres -c "ALTER DATABASE $BASE SET search_path = \"\$user\", public, extensions" > /dev/null

# Prélude : le strict nécessaire de Supabase (méthode 00a, annexe B).
sql -d "$BASE" <<'EOF'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA extensions;
CREATE EXTENSION "uuid-ossp" SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;
EOF

for f in schema.sql $MIGRATIONS rgpd_effacement.sql; do
  sql -d "$BASE" < "$DB_DIR/$f" > /dev/null || { echo "ÉCHEC du rejeu : $f" >&2; exit 1; }
done

DEPOT=$( { echo "SELECT string_agg(format('  (%L, %L, %L)', categorie, objet, valeur), E',\n' ORDER BY categorie, objet) FROM ("; cat "$ICI/etat_base.sql"; echo ") v;"; } \
  | sql -d "$BASE" -A -t )

{
cat <<EOF
-- ============================================================================
-- Écarts entre une base réelle et le dépôt — généré par generer.sh, NE PAS
-- MODIFIER À LA MAIN (relancer generer.sh après chaque migration).
-- ============================================================================
-- LECTURE SEULE. N'écrit, ne crée, ne modifie rien. À coller en entier dans le
-- SQL Editor de Supabase, puis « Run ». Moins de 40 lignes rendues.
--
-- État du dépôt figé ci-dessous (VALUES « depot ») : base rejouée depuis le
-- dépôt, $NB_FICHIERS fichiers (schema.sql, migrations jusqu'à
-- $DERNIERE, rgpd_effacement.sql), PostgreSQL local.
-- La requête photographie la base où elle tourne et ne rend que les ÉCARTS :
--   plateforme : TRUNCATE / REFERENCES / TRIGGER hérités des privilèges par
--                défaut de Supabase — non consignés, décision du 2026-09-29 ;
--   ECART      : tout le reste → la base diffère du dépôt, à examiner.
-- Verdict attendu en production : IDENTIQUE, avec 3 lignes « plateforme ».
-- Code des fonctions comparé sans commentaires ni espaces (audit 00a §4.2).
-- ============================================================================
WITH depot(categorie, objet, valeur) AS (VALUES
$DEPOT
),
vivant AS (
EOF
cat "$ICI/etat_base.sql"
cat <<'EOF'
),
ecarts AS (
  SELECT coalesce(v.categorie, d.categorie) AS categorie,
         coalesce(v.objet, d.objet)         AS objet,
         coalesce(v.valeur, CASE WHEN coalesce(v.categorie, d.categorie) LIKE 'droits%' THEN '(aucun droit)' ELSE '(absent)' END) AS production,
         coalesce(d.valeur, CASE WHEN coalesce(v.categorie, d.categorie) LIKE 'droits%' THEN '(aucun droit)' ELSE '(absent)' END) AS depot
    FROM vivant v
    FULL JOIN depot d ON d.categorie = v.categorie AND d.objet = v.objet
   WHERE v.valeur IS DISTINCT FROM d.valeur
),
classes AS (
  SELECT e.*,
         CASE WHEN e.categorie = 'droits_structure' AND e.depot = '(aucun droit)' AND e.production ~ '^D?x?t?$'
              THEN 'plateforme' ELSE 'ECART' END AS classe
    FROM ecarts e
),
compares AS (
  SELECT categorie, count(*) AS n FROM (SELECT categorie, objet FROM vivant UNION SELECT categorie, objet FROM depot) u GROUP BY 1
)
SELECT 0 AS ordre, 'VERDICT' AS categorie,
       CASE WHEN (SELECT count(*) FROM classes WHERE classe = 'ECART') = 0
            THEN 'IDENTIQUE au dépôt (hors plateforme)' ELSE 'ÉCART — à examiner' END AS objet,
       (SELECT count(*) FROM classes WHERE classe = 'ECART') || ' écart(s) · '
       || (SELECT count(*) FROM classes WHERE classe = 'plateforme') || ' plateforme' AS production,
EOF
echo "       'dépôt jusqu''à $DERNIERE' AS depot, NULL AS lecture"
cat <<'EOF'
UNION ALL
SELECT 1, c.categorie, c.n || ' objets comparés',
       coalesce((SELECT count(*) FROM classes k WHERE k.categorie = c.categorie), 0) || ' écart(s)', NULL, NULL
  FROM compares c
UNION ALL
SELECT 2, categorie, objet, production, depot, 'la base diffère du dépôt → à examiner'
  FROM classes WHERE classe = 'ECART'
UNION ALL
SELECT 3, 'droits_structure', split_part(objet, ' → ', 2) || ' : ' || string_agg(DISTINCT production, ',') || ' sur '
       || count(*) || ' objets', 'hérité', '(aucun droit)',
       'privilèges par défaut Supabase → non consigné (décision du 2026-09-29)'
  FROM classes WHERE classe = 'plateforme' GROUP BY split_part(objet, ' → ', 2)
ORDER BY 1, 2, 3;
EOF
} > "$SORTIE"

# Contrôle : sur la base rejouée elle-même, la requête doit dire IDENTIQUE.
VERDICT=$(sql -d "$BASE" -A -t -F'|' < "$SORTIE" | head -1)
case "$VERDICT" in
  *"IDENTIQUE au dépôt"*"0 écart(s) · 0 plateforme"*) ;;
  *) echo "CONTRÔLE ÉCHOUÉ sur la base rejouée : $VERDICT" >&2; exit 1 ;;
esac

echo "OK — $NB_FICHIERS fichiers rejoués, requête écrite : $SORTIE ($(wc -l < "$SORTIE") lignes)"
