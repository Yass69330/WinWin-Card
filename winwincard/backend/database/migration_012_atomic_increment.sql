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
