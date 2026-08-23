-- Migration 023 : suppression des surcharges héritées de increment_stored_value
--
-- SOURCE DE VÉRITÉ FINALE de increment_stored_value. Après cette migration,
-- il n'existe qu'UNE SEULE fonction de ce nom en base — plus aucune surcharge.
--
-- ── Pourquoi ce fichier existe (incident du chantier points) ──────────────
-- increment_stored_value avait accumulé TROIS surcharges au fil du chantier :
--   1. (uuid, integer)                       — migration_012, d'origine
--   2. (uuid, integer, integer)              — Phase 1, ajout de p_amount
--   3. (uuid, integer, integer, text)        — migration_022, ajout de
--                                              p_type_programme (report du surplus)
-- La #3 a son dernier paramètre en DEFAULT ('stamps'). Résultat : un appel à
-- 3 arguments (celui du scan.js alors déployé : p_client_id, p_max_value,
-- p_amount) devenait AMBIGU — il matchait à la fois la #2 (exacte) et la #3
-- (4ᵉ param comblé par défaut). Postgres a refusé :
--     ERROR 42725: function increment_stored_value(...) is not unique
--     HINT: Could not choose a best candidate function.
-- Contrairement à ce qu'on avait supposé, Postgres NE préfère PAS le candidat
-- "exigeant le moins de défauts" : il déclare l'ambiguïté et échoue. Comme le
-- code déployé faisait déjà cet appel 3-arg, tout scan de prod risquait la 500
-- dès la migration_022 exécutée — indépendamment de tout déploiement de code.
--
-- ── LEÇON (à ne jamais réoublier) ─────────────────────────────────────────
-- Ne JAMAIS laisser cohabiter une surcharge à paramètre(s) DEFAULT avec une
-- signature plus courte qu'elle "recouvre" par ces défauts. Une fonction à N
-- paramètres dont les derniers ont un DEFAULT est candidate pour tout appel de
-- N-k arguments — elle entre alors en collision avec toute surcharge à N-k
-- paramètres. Règle : une seule signature par nom de fonction ; on l'étend via
-- CREATE OR REPLACE de la MÊME liste de types (défauts inclus), jamais via une
-- nouvelle surcharge de longueur différente. L'ajout d'un paramètre à défaut
-- est un remplacement, pas une addition.
--
-- ── Ce que fait cette migration ───────────────────────────────────────────
-- Droppe les deux anciennes surcharges (2-arg, 3-arg) puis (re)pose la 4-arg
-- canonique, idempotente. État final garanti : une seule fonction. Toutes les
-- formes d'appel résolvent alors sans ambiguïté vers elle, ses deux derniers
-- paramètres étant à DEFAULT :
--   • appel 3-arg (ancien scan.js déployé)  → p_type_programme = 'stamps'
--     → comportement tampons identique à avant migration_022, zéro régression
--   • appel 4-arg (nouveau scan.js)         → mode réel du marchand
--
-- Rejouable sans risque (DROP IF EXISTS + CREATE OR REPLACE). Sur une base
-- neuve : droppe ce qui n'existe pas (no-op) et crée l'unique fonction.
--
-- Le corps de la fonction est IDENTIQUE à migration_022_points_report.sql
-- (report du surplus en mode points, reset strict à 0 en tampons). Voir les
-- commentaires détaillés de la logique dans ce fichier.

BEGIN;

DROP FUNCTION IF EXISTS increment_stored_value(uuid, integer);
DROP FUNCTION IF EXISTS increment_stored_value(uuid, integer, integer);

CREATE OR REPLACE FUNCTION increment_stored_value(
  p_client_id uuid,
  p_max_value integer,
  p_amount integer DEFAULT 1,
  p_type_programme text DEFAULT 'stamps'
)
RETURNS TABLE(stored_value_avant integer, stored_value_apres integer, is_reset boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_avant integer;
  v_apres integer;
  v_reset boolean := false;
BEGIN
  -- Verrou ligne : sérialise les scans concurrents sur le même client
  SELECT stored_value INTO v_avant
  FROM clients
  WHERE id = p_client_id
  FOR UPDATE;

  IF v_avant IS NULL THEN
    RAISE EXCEPTION 'client introuvable: %', p_client_id;
  END IF;

  IF v_avant >= p_max_value THEN
    -- Scan de "redemption" : le seuil était déjà atteint/dépassé avant ce
    -- scan. Tampons : reset strict à 0, inchangé. Points : report du surplus.
    IF p_type_programme = 'points' THEN
      v_apres := v_avant - p_max_value + p_amount;
    ELSE
      v_apres := 0;
    END IF;
    v_reset := true;
  ELSIF v_avant + p_amount >= p_max_value THEN
    -- Scan gagnant : atteint/franchit le seuil pile sur ce scan. Jamais de
    -- reset ici (le solde reste au-dessus jusqu'au scan suivant → fond doré
    -- Apple au prochain rafraîchissement du pass).
    v_apres := v_avant + p_amount;
    v_reset := false;
  ELSE
    v_apres := v_avant + p_amount;
  END IF;

  UPDATE clients SET stored_value = v_apres WHERE id = p_client_id;

  RETURN QUERY SELECT v_avant, v_apres, v_reset;
END;
$$;

COMMIT;
