-- Migration 015 : RPC credit_referral — crédite le parrain de façon atomique
-- Cap à max_value, pas de reset (contrairement à increment_stored_value).
-- Appelé depuis scan.js quand stored_value_apres === 1 pour le filleul.

CREATE OR REPLACE FUNCTION credit_referral(
  p_parrain_client_id uuid,
  p_bonus_points      integer DEFAULT 1
)
RETURNS TABLE (
  stored_value_avant integer,
  stored_value_apres integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_avant integer;
  v_apres integer;
  v_max   integer;
BEGIN
  -- Verrouillage du client pour éviter les crédits concurrents
  SELECT c.stored_value, m.max_value
  INTO   v_avant, v_max
  FROM   clients   c
  JOIN   marchands m ON m.id = c.marchand_id
  WHERE  c.id = p_parrain_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parrain introuvable : %', p_parrain_client_id;
  END IF;

  -- Cap à max_value — le parrain ne dépasse jamais le seuil, ne reset jamais
  v_apres := LEAST(v_avant + p_bonus_points, v_max);

  UPDATE clients
     SET stored_value = v_apres
   WHERE id = p_parrain_client_id;

  RETURN QUERY SELECT v_avant, v_apres;
END;
$$;
