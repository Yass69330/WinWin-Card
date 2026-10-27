-- Migration 070 : f10 « À proximité » — nouvelle règle d'affichage (feu vert du pilotage, 27/10)
--
-- POURQUOI. Test terrain de Yass (22/10) : iOS montre la carte dès qu'on est près
-- de l'adresse (juste après le « Bienvenue », la carte étant créée en boutique)
-- et la garde ~1 h sur l'écran verrouillé ; les créneaux (relevantDates) n'y
-- changent rien sur une carte de fidélité (storeCard). Notre seul levier :
-- l'adresse est dans la carte, ou pas.
--
-- NOUVELLE RÈGLE (services/geo.js, champsPass) : la carte porte l'adresse
-- seulement si son dernier passage non annulé date de 7 à 30 jours (jamais
-- scannée : depuis sa création), sans aucune date. Au plus 2 mises à jour par
-- carte (ajout à J+7, retrait à J+30), silencieuses ; un scan avant J+30 retire
-- déjà l'adresse (la carte est régénérée après chaque scan).
--
-- CE QUE FAIT LA MIGRATION.
--   - marchands.geo_lieux : retire la clé « horaires » de chaque lieu (les
--     créneaux disparaissent de l'admin et de la carte) ;
--   - geo_cartes_a_rafraichir : la sélection du cron quotidien (02:00 UTC) — les
--     seules cartes iPhone des marchands f10 dont la date de référence franchit
--     J+7 ou J+30 dans les 24 h qui précèdent. Un seul aller vers la base ; aucun
--     traitement des autres cartes.
--
-- COÛT. Quelques lignes de marchands mises à jour ; une fonction. Ni clients ni
-- scans ne sont touchés. La sélection lit les scans des seuls marchands f10, par
-- l'index scans(client_id, date_scan) (migration 064).
-- COMPATIBILITÉ. L'ancien code ignore la fonction ; sans « horaires », il ne met
-- plus de créneaux et retire l'adresse (champsPass rendait null) : à exécuter
-- juste AVANT le déploiement du code. Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE public.marchands
   SET geo_lieux = (SELECT jsonb_agg(l - 'horaires') FROM jsonb_array_elements(geo_lieux) l)
 WHERE jsonb_typeof(geo_lieux) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(geo_lieux) l WHERE l ? 'horaires');

-- Cartes iPhone qui franchissent un seuil entre (maintenant − 24 h − N jours) et
-- (maintenant − N jours), N = 7 ou 30. Date de référence : dernier passage non
-- annulé, sinon création de la carte.
CREATE OR REPLACE FUNCTION public.geo_cartes_a_rafraichir(p_maintenant timestamptz DEFAULT now())
RETURNS TABLE (marchand_id uuid, serial_number text, push_token text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH cartes AS (
    SELECT c.marchand_id, c.pass_serial_number AS serial,
           coalesce((SELECT max(s.date_scan) FROM public.scans s
                      WHERE s.client_id = c.id AND s.annule_le IS NULL), c.created_at) AS reference
      FROM public.clients c
      JOIN public.marchands m ON m.id = c.marchand_id
     WHERE m.geo_actif AND m.actif AND c.deleted_at IS NULL
       AND jsonb_typeof(m.geo_lieux) = 'array' AND jsonb_array_length(m.geo_lieux) > 0
  )
  SELECT ca.marchand_id, ca.serial, d.push_token
    FROM cartes ca
    JOIN public.device_tokens d ON d.serial_number = ca.serial AND d.marchand_id = ca.marchand_id
   WHERE (ca.reference >  p_maintenant - interval '8 days'  AND ca.reference <= p_maintenant - interval '7 days')
      OR (ca.reference >  p_maintenant - interval '31 days' AND ca.reference <= p_maintenant - interval '30 days')
$$;
REVOKE ALL ON FUNCTION public.geo_cartes_a_rafraichir(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.geo_cartes_a_rafraichir(timestamptz) TO service_role;

COMMIT;

-- Contrôle après exécution (une ligne, attendu : t | 0) :
-- SELECT
--   (SELECT count(*) = 1 FROM pg_proc WHERE proname = 'geo_cartes_a_rafraichir') AS fonction_ok,
--   (SELECT count(*) FROM marchands, jsonb_array_elements(CASE WHEN jsonb_typeof(geo_lieux) = 'array' THEN geo_lieux ELSE '[]' END) l
--     WHERE l ? 'horaires')                                                        AS lieux_avec_horaires;
