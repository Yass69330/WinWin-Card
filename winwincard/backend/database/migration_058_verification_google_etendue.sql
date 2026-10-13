-- Migration 058 : vérification Google étendue aux clients masqués (prérequis du
-- chantier « campagnes par segment », décision du 13/10).
--
-- POURQUOI. Le marchand ne verra bientôt que ses vrais clients : au moins un scan
-- non annulé, OU un jeton Apple, OU le signal Google (passes.google_ouvert_le).
-- Un client Google inscrit avant le 13/10 n'a ni jeton ni clic noté : s'il n'est
-- jamais venu, il serait masqué alors qu'il a la carte. La vérification unique
-- (bouton admin, étape 23) demande à Google si la carte a un utilisateur et pose
-- le même signal que le clic.
--
-- CE QUE FAIT LA MIGRATION. `cartes_google_a_verifier` (même signature) rend
-- désormais les cartes qui SERAIENT MASQUÉES : lien Google, pas de signal, aucun
-- jeton Apple, client non effacé et jamais scanné (scan non annulé). Les cartes
-- iPhone de l'étape 23 ont déjà été vérifiées une fois (13/10 : 1 645, 0 erreur) :
-- elles ne sont pas redemandées (décision « une seule fois »).
--
-- COÛT. Aucune requête régulière. Une lecture par page de 100 pendant la
-- vérification, lancée à la main. Sondes par idx_device_tokens_serial et
-- idx_scans_client.
--
-- Aucun code à déployer : le serveur appelle déjà cette fonction. Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.cartes_google_a_verifier(p_apres uuid, p_limite integer)
RETURNS TABLE (id uuid, serial_number text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.id, p.serial_number
    FROM passes p
    JOIN clients c ON c.id = p.client_id
   WHERE p.google_pass_url IS NOT NULL
     AND p.google_ouvert_le IS NULL
     AND (p_apres IS NULL OR p.id > p_apres)
     AND c.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM device_tokens d WHERE d.serial_number = p.serial_number)
     AND NOT EXISTS (SELECT 1 FROM scans s WHERE s.client_id = c.id AND s.annule_le IS NULL)
   ORDER BY p.id
   LIMIT LEAST(GREATEST(p_limite, 1), 1000);
$$;

REVOKE ALL ON FUNCTION public.cartes_google_a_verifier(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cartes_google_a_verifier(uuid, integer) TO service_role;

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Les deux colonnes doivent valoir true.
--
-- SELECT
--   pg_get_functiondef('public.cartes_google_a_verifier(uuid,integer)'::regprocedure) LIKE '%annule_le IS NULL%' AS fonction_ok,
--   has_function_privilege('service_role', 'public.cartes_google_a_verifier(uuid,integer)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.cartes_google_a_verifier(uuid,integer)', 'EXECUTE')      AS droits_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- Rejouer la fonction cartes_google_a_verifier de migration_057_google_d2.sql.
