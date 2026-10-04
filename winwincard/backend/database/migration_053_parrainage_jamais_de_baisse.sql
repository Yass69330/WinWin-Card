-- Migration 053 : credit_referral ne baisse jamais un solde, ne verrouille que
-- le parrain, et crédite le bonus EN ENTIER en mode points (étape 14b de la
-- synthèse, audit 02 P4, écart B ; décisions de Yass du 03/10 et du 04/10)
--
-- Avant (migration 015) : LEAST(avant + bonus, seuil) dans les deux modes, et
-- FOR UPDATE sur la jointure clients ⋈ marchands :
--   - en points, un parrain AU-DESSUS du seuil était RAMENÉ au seuil (530 → 500 :
--     il perdait 30) ; juste sous le seuil, il ne recevait qu'une partie du bonus ;
--   - la ligne du MARCHAND était verrouillée aussi : chaque crédit attendait les
--     scans en cours de tout le marchand.
--
-- Après :
--   - tampons : plafond au seuil CONSERVÉ (règle du 27/09 : à 10/10, le tampon
--     est perdu) ;
--   - points : bonus crédité en entier, sans plafond (comme les ajustements
--     depuis 13b) ; la récompense se remet au passage suivant ;
--   - jamais de baisse, quel que soit le mode : un parrain au-dessus du seuil
--     (seuil baissé par l'admin) garde son solde ; un bonus nul ou négatif ne
--     change rien ;
--   - seule la ligne du parrain est verrouillée (FOR UPDATE OF c) ; celle du
--     marchand n'est que lue.
--
-- Le parrainage reste permis en mode points (décision 1 de l'étape 14 refusée).
-- Même signature, même retour : le serveur (scan.js) n'a rien à changer, et le
-- code en place marche avec. Droits inchangés (CREATE OR REPLACE les garde).
-- À exécuter dans Supabase AVANT le push. Rejouable.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.credit_referral(
  p_parrain_client_id uuid,
  p_bonus_points      integer DEFAULT 1
)
RETURNS TABLE (
  stored_value_avant integer,
  stored_value_apres integer
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_avant integer;
  v_apres integer;
  v_max   integer;
  v_type  text;
BEGIN
  -- Verrou du PARRAIN seul (OF c) : crédits concurrents sérialisés, la ligne du
  -- marchand n'est que lue.
  SELECT c.stored_value, m.max_value, m.type_programme
  INTO   v_avant, v_max, v_type
  FROM   clients   c
  JOIN   marchands m ON m.id = c.marchand_id
  WHERE  c.id = p_parrain_client_id
  FOR UPDATE OF c;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parrain introuvable : %', p_parrain_client_id;
  END IF;

  IF v_type = 'points' THEN
    v_apres := v_avant + p_bonus_points;                 -- bonus entier, sans plafond
  ELSE
    v_apres := LEAST(v_avant + p_bonus_points, v_max);   -- tampons : plafond au seuil
  END IF;
  v_apres := GREATEST(v_apres, v_avant);                 -- jamais de baisse

  UPDATE clients
     SET stored_value = v_apres
   WHERE id = p_parrain_client_id;

  RETURN QUERY SELECT v_avant, v_apres;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── CONTRÔLE (à coller juste après) ──────────────────────────────────────────
-- Les quatre colonnes doivent valoir true.
--
-- SELECT
--   to_regprocedure('public.credit_referral(uuid,integer)') IS NOT NULL                     AS fonction_ok,
--   position('FOR UPDATE OF c' IN pg_get_functiondef('public.credit_referral(uuid,integer)'::regprocedure)) > 0 AS verrou_parrain_ok,
--   position('GREATEST(v_apres, v_avant)' IN pg_get_functiondef('public.credit_referral(uuid,integer)'::regprocedure)) > 0 AS jamais_baisse_ok,
--   has_function_privilege('service_role', 'public.credit_referral(uuid,integer)', 'EXECUTE') AS droits_ok;

-- ── RETOUR ARRIÈRE ───────────────────────────────────────────────────────────
-- Rejouer la définition de la migration 015 (CREATE OR REPLACE, même signature).
-- Elle remet le plafond au seuil dans les deux modes et le verrou du marchand.
