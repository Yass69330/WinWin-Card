-- Migration 065 : campagnes « inactifs », 60 jours seulement (décision de Yass, 18/10)
--
-- POURQUOI. Sous 60 jours, les relances automatiques (smart notifications)
-- s'occupent déjà des inactifs : 15 et 30 jours faisaient doublon et semaient la
-- confusion. 60 jours couvre aussi tout ce qui est au-delà.
--
-- CE QUE FAIT LA MIGRATION. segment_valide n'accepte plus que 60 jours pour le
-- type « inactifs ». Rien d'autre ne change : client_dans_segment évalue toujours
-- n'importe quelle durée, donc une campagne 15 ou 30 j lancée avant reste
-- évaluable jusqu'à sa fin (ses lots relisent le segment enregistré sans le
-- revalider), et l'historique l'affiche toujours.
--
-- COMPATIBILITÉ. À exécuter APRÈS le push du dashboard qui ne propose plus que
-- 60 jours : exécutée avant, l'écran encore en place proposerait 15 et 30 jours,
-- refusés (400) pendant quelques minutes. Rejouable.
-- À exécuter dans Supabase.

CREATE OR REPLACE FUNCTION public.segment_valide(p_marchand_id uuid, p_segment jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE p_segment ->> 'type'
    WHEN 'inactifs' THEN CASE WHEN p_segment ->> 'jours' = '60'
                              THEN jsonb_build_object('type', 'inactifs', 'jours', 60) END
    WHEN 'fideles'  THEN jsonb_build_object('type', 'fideles')
    WHEN 'boutique' THEN (SELECT jsonb_build_object('type', 'boutique', 'boutique', pdv.id, 'nom', pdv.nom)
                            FROM points_de_vente pdv
                           WHERE pdv.marchand_id = p_marchand_id AND pdv.deleted_at IS NULL
                             AND pdv.id::text = p_segment ->> 'boutique')
  END;
$$;
REVOKE ALL ON FUNCTION public.segment_valide(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.segment_valide(uuid, jsonb) TO service_role;

-- ── VÉRIFICATION (à coller juste après) : trois colonnes à true ────────────
-- SELECT segment_valide(gen_random_uuid(), '{"type":"inactifs","jours":60}') IS NOT NULL AS soixante_ok,
--        segment_valide(gen_random_uuid(), '{"type":"inactifs","jours":30}') IS NULL     AS trente_refuse,
--        segment_valide(gen_random_uuid(), '{"type":"inactifs","jours":15}') IS NULL     AS quinze_refuse;
--
-- ── RETOUR ARRIÈRE ───────────────────────────────────────────────────────
-- Rejouer segment_valide de la migration 059 (accepte '15', '30', '60').
