-- Migration 072 : f17, morceau 4 — deux garde-fous avant d'ouvrir les thèmes à
-- d'autres marchands (décisions du pilotage du 03/11)
--
-- 1. VERROU EN BASE SUR LA BASCULE. Jusqu'ici, « qui fait avancer la bascule »
--    n'était su qu'en mémoire : pendant un redéploiement, l'ancien serveur la
--    finissait pendant que le nouveau la reprenait (double envoi possible).
--    Désormais la bascule (marchands.theme_bascule) porte son propriétaire
--    (`instance`) et sa dernière écriture (`maj_le`). prendre_bascule_theme la
--    prend de façon atomique : libre, déjà à soi, ou sans avancement depuis
--    p_inactif (serveur arrêté). Comme reprendre_campagnes (migration 054).
--
-- 2. 24 H ENTRE DEUX OUVERTURES. marchands.theme_ouvert_le : dernière ouverture
--    d'un thème (celle qui envoie le message à toutes les cartes).
--    ouvrir_theme ouvre seulement si le thème est toujours le thème programmé
--    ET si la dernière ouverture date de plus de p_delai. L'arrêt reste libre
--    (silencieux, rien à limiter).
--
-- COÛT. Une colonne ; deux fonctions ; aucune lecture de plus au scan ni au
-- retour d'un iPhone (elles ne servent qu'à la bascule et au choix d'un thème).
-- COMPATIBILITÉ. L'ancien code ignore colonne et fonctions (les clés ajoutées
-- à theme_bascule sont ignorées aussi). À exécuter AVANT le code. Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS theme_ouvert_le timestamptz;
COMMENT ON COLUMN public.marchands.theme_ouvert_le IS
  'Dernière ouverture d''un thème (message à toutes les cartes) : 24 h au moins entre deux (f17, migration 072).';

-- Prend la bascule d'un marchand pour p_instance. Rend la bascule prise, ou
-- rien (pas de bascule, ou tenue par un autre serveur qui avance encore).
CREATE OR REPLACE FUNCTION public.prendre_bascule_theme(p_marchand_id uuid, p_instance text, p_inactif interval)
RETURNS jsonb
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE marchands
     SET theme_bascule = theme_bascule || jsonb_build_object('instance', p_instance, 'maj_le', now())
   WHERE id = p_marchand_id
     AND theme_bascule IS NOT NULL
     AND (theme_bascule->>'instance' IS NULL
          OR theme_bascule->>'instance' = p_instance
          OR theme_bascule->>'maj_le' IS NULL
          OR (theme_bascule->>'maj_le')::timestamptz < now() - p_inactif)
  RETURNING theme_bascule;
$$;
REVOKE ALL ON FUNCTION public.prendre_bascule_theme(uuid, text, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prendre_bascule_theme(uuid, text, interval) TO service_role;

-- Ouvre le thème programmé p_theme_id : 'ok', 'trop_tot' (dernière ouverture il
-- y a moins de p_delai), ou 'change' (le thème programmé n'est plus celui-là).
CREATE OR REPLACE FUNCTION public.ouvrir_theme(p_marchand_id uuid, p_theme_id text, p_theme jsonb, p_bascule jsonb, p_delai interval)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ouvert timestamptz;
  v_theme jsonb;
BEGIN
  SELECT theme_ouvert_le, theme_actif INTO v_ouvert, v_theme FROM marchands WHERE id = p_marchand_id FOR UPDATE;
  IF NOT FOUND OR v_theme IS NULL OR v_theme->>'id' IS DISTINCT FROM p_theme_id OR v_theme->>'etat' <> 'programme' THEN
    RETURN 'change';
  END IF;
  IF v_ouvert IS NOT NULL AND v_ouvert > now() - p_delai THEN
    RETURN 'trop_tot';
  END IF;
  UPDATE marchands SET theme_actif = p_theme, theme_bascule = p_bascule, theme_ouvert_le = now()
   WHERE id = p_marchand_id;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.ouvrir_theme(uuid, text, jsonb, jsonb, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ouvrir_theme(uuid, text, jsonb, jsonb, interval) TO service_role;

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Une ligne, attendu : true | true | true
--
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
--            AND table_name = 'marchands' AND column_name = 'theme_ouvert_le') AS colonne_ok,
--   has_function_privilege('service_role', 'public.prendre_bascule_theme(uuid,text,interval)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.prendre_bascule_theme(uuid,text,interval)', 'EXECUTE') AS verrou_ok,
--   has_function_privilege('service_role', 'public.ouvrir_theme(uuid,text,jsonb,jsonb,interval)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.ouvrir_theme(uuid,text,jsonb,jsonb,interval)', 'EXECUTE') AS ouverture_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- L'ancien code ignore colonne et fonctions : elles peuvent rester.
