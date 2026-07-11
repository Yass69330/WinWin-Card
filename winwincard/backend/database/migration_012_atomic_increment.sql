-- ⚠️⚠️⚠️ OBSOLÈTE — NE JAMAIS REJOUER CE FICHIER SEUL ⚠️⚠️⚠️
--
-- Ce fichier ne reflète PLUS la fonction increment_stored_value telle qu'elle
-- existe réellement en base de production. Elle a été étendue depuis :
--   - migration (Phase 1, non fichée à l'époque) : ajout de p_amount integer
--     DEFAULT 1, en surcharge (uuid, integer, integer) — coexiste avec la
--     signature 2-arg ci-dessous, ne l'a jamais remplacée.
--   - migration_022_points_report.sql : ajout de p_type_programme text
--     DEFAULT 'stamps', en surcharge (uuid, integer, integer, text) — source
--     de vérité actuelle, seule fonction que scan.js appelle depuis lors.
--
-- Rejouer CE fichier tel quel recréerait uniquement la surcharge 2-arg
-- (uuid, integer) — déjà présente et jamais appelée par le code applicatif,
-- donc sans effet destructeur direct MAIS source de confusion : si quelqu'un
-- s'imagine que ce fichier est la référence et se met à modifier CETTE
-- fonction pour "corriger" un bug, il modifiera une fonction morte pendant
-- que la prod continue d'utiliser migration_022. Référence à jour :
-- migration_022_points_report.sql.
--
-- ── Contenu original (historique, pour mémoire) ──────────────────────────
-- Migration 012 : incrément atomique des points de fidélité
--
-- Remplace le pattern read-then-write (lecture de stored_value puis écriture)
-- qui pouvait perdre des points en cas de scans simultanés (deux caisses qui
-- scannent le même pass au même instant lisent 4, écrivent 5 → un point perdu).
--
-- SELECT ... FOR UPDATE pose un verrou ligne : le second scan attend la fin du
-- premier et lit la valeur à jour. La logique de reset (atteinte du seuil → 0)
-- est exécutée dans la même transaction, donc atomiquement.

CREATE OR REPLACE FUNCTION increment_stored_value(p_client_id uuid, p_max_value integer)
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
    v_apres := 0;
    v_reset := true;
  ELSE
    v_apres := v_avant + 1;
  END IF;

  UPDATE clients SET stored_value = v_apres WHERE id = p_client_id;

  RETURN QUERY SELECT v_avant, v_apres, v_reset;
END;
$$;
