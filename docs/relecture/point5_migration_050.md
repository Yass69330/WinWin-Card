# Relecture — migration 050 : exécution des fonctions réservée au serveur

> **Statut (01/10) : mis en attente par décision du fondateur.** Remplacé pour l'instant par la suppression des clés publiques Supabase inutilisées (aucune n'est utilisée par le code ni les pages). La migration reste prête ; le numéro 050 est réservé.

**Temps de relecture estimé : 45 min** (30 min de lecture, 15 min pour rejouer le banc ou répondre aux questions).
Base : commit `4319459`, branche `claude/keen-goldberg-MXslu`. Rien n'est poussé ni exécuté en production.
Pièce jointe : `point5_migration_050.patch` (fichier complet de la migration + requête de contrôle régénérée).

## Contexte

1. WinWin Card (cartes de fidélité Apple et Google Wallet) : serveur Node/Express sur Railway, base Supabase (PostgreSQL), appelée **uniquement** avec la clé `service_role`. Aucune clé Supabase dans les pages web.
2. En production, les 8 fonctions du schéma `public` sont exécutables par `anon` et `authenticated` (privilèges par défaut de Supabase, `exec=111` relevé le 29/09). `effacer_client(uuid, uuid)`, en `SECURITY DEFINER`, efface un client avec la seule clé publique : reproduit au banc.
3. La migration retire `EXECUTE` à `PUBLIC`, `anon` et `authenticated`, l'accorde explicitement à `service_role`, et applique la même règle aux fonctions futures. Aucun code applicatif ne change.

## Diff (l'essentiel ; vérification et retour arrière complets dans le fichier)

```sql
BEGIN;
SET lock_timeout = '3s';
DO $$ DECLARE f record; nb int := 0;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
              AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
                                AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC, anon, authenticated', f.signature);
    EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO service_role', f.signature);
    nb := nb + 1;
  END LOOP;
  IF nb = 0 THEN RAISE EXCEPTION 'aucune fonction de public n''appartient à %', current_user; END IF;
END $$;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;                        -- global
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
```
Requête d'écarts prod ↔ dépôt régénérée : seules les 8 lignes `exec=111` deviennent `exec=001`.

## Tests passés

Banc : PostgreSQL 16, base rejouée depuis le dépôt (51 fichiers), privilèges par défaut de Supabase simulés, PostgREST 12.2, vrai serveur.
- **32/32**, stable sur 3 passages :
  - **Avant 050 :** faille reproduite (`anon` efface un client).
  - **Après 050 :** les 8 fonctions passent en `exec=001`.
  - **Rôles refusés :** `anon` et `authenticated` reçoivent `42501` sur les 6 RPC.
  - **Vraies routes du serveur :** scan, annulation, effacement RGPD, statistiques réseau, liste admin, parrainage.
  - **Déclencheurs :** `set_updated_at` et `ensure_rls` intacts.
  - **Fonction créée après 050 :** refusée à `anon`, accordée à `service_role`.
  - **Rejeu, retour arrière, rôle :** migration rejouable ; retour arrière exact (`exec=111`) ; échec explicite si exécutée par un autre rôle.
  - **Vérification du fichier :** 4 × `true`.
- **Non-régression :** 107 vérifications existantes, dont le navigateur (admin, dashboard, landing), identiques ligne à ligne avec et sans 050.

## Trois questions

1. `ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` est **global** : il vaut pour tous les schémas, pour les fonctions créées par `postgres`. Le faire par schéma est impossible, puisque le défaut `PUBLIC` est lui-même global. Sur Supabase, cela peut-il gêner une fonction que le tableau de bord crée dans un autre schéma (Database Functions, webhooks, Storage) ?
2. Un composant Supabase (politiques Storage, Realtime, hooks Auth) appelle-t-il des fonctions de `public` avec `anon` ou `authenticated` ? Côté code WinWin, la réponse est non : six appels RPC, tous avec `service_role`.
3. `rls_auto_enable()` (`SECURITY DEFINER`, propriété de `postgres`) alimente le déclencheur d'événement `ensure_rls`. Après le retrait d'`EXECUTE` à `PUBLIC`, se déclenche-t-il encore pour un DDL lancé par un **autre** rôle, comme `supabase_admin` ou les migrations de la plateforme ? Le banc ne l'a testé que pour `postgres`.

## Procédure prévue en production (après votre retour)

1. Lancer la requête d'écarts actuelle : elle doit répondre `IDENTIQUE`.
2. Exécuter 050 dans le SQL Editor : la notice doit annoncer 8 fonctions.
3. Lancer la vérification : 4 × `true`.
4. Lancer la requête d'écarts régénérée : `IDENTIQUE`.
5. Faire un scan cobaye puis son annulation, et ouvrir la liste admin.

Retour arrière : bloc en fin de fichier, sans code à revenir.
