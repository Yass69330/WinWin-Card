-- Migration 063 : cartes à thème (f17, décisions du pilotage du 14/10)
--
-- POURQUOI. Un marchand Pro+ choisit, dans l'onglet « Ma carte » du dashboard,
-- un des thèmes que nous avons préparés pour lui (couleurs, logo préfabriqué,
-- texte court sous le prénom), fixe des dates de début et de fin, et l'active.
-- À l'ouverture, toutes ses cartes (iPhone et Google) prennent le thème, avec une
-- notification ; à la fin, retour silencieux à la carte standard. Progression et
-- solde ne changent jamais. Un seul thème à la fois.
--
-- CE QUE FAIT LA MIGRATION.
--   - marchands.themes_actifs : interrupteur de l'admin (faux partout : dormant) ;
--   - themes_marchand : les thèmes préparés par WinWin, par marchand (l'admin
--     les crée ; le marchand ne fait que choisir). RLS sans politique : seul le
--     serveur (service_role) y accède.
--   - marchands.theme_actif : copie du thème choisi + dates + état
--     ('programme' | 'en_cours'). C'est la SEULE chose que lit la fabrication
--     d'une carte (une colonne de plus dans les lectures existantes : aucune
--     requête de plus au scan ni au retour d'un iPhone).
--   - marchands.theme_bascule : avancement de la mise à jour des cartes
--     (ouverture ou fin), pour la reprendre au passage du cron si le serveur
--     redémarre en cours de route.
--   - theme_lot_google : cartes Google réelles (règle D2) d'un marchand, par
--     lots, avec le prénom et le solde (la carte est redessinée).
--   - notification_envois.source += 'theme' (CLAUDE.md : toute surface d'envoi
--     est tracée).
--
-- ÉVOLUTION. Quelques lignes de thèmes par marchand ; deux colonnes jsonb
-- d'environ 1 Ko. Le registre reçoit une ligne par carte à chaque ouverture ou
-- fin de thème.
-- COMPATIBILITÉ. L'ancien code ignore table et colonnes. À exécuter AVANT le code.
-- Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.themes_marchand (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  marchand_id       uuid        NOT NULL REFERENCES public.marchands(id) ON DELETE CASCADE,
  nom               text        NOT NULL CHECK (length(btrim(nom)) BETWEEN 1 AND 40),
  couleur_fond      text        NOT NULL CHECK (couleur_fond ~ '^#[0-9a-fA-F]{6}$'),
  couleur_texte     text        CHECK (couleur_texte IS NULL OR couleur_texte ~ '^#[0-9a-fA-F]{6}$'),
  couleur_label     text        CHECK (couleur_label IS NULL OR couleur_label ~ '^#[0-9a-fA-F]{6}$'),
  logo_url          text,
  google_logo_url   text,
  texte_case        text        CHECK (texte_case IS NULL OR length(texte_case) <= 40),
  message_ouverture text        NOT NULL CHECK (length(btrim(message_ouverture)) BETWEEN 1 AND 150),
  cree_le           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (marchand_id, nom)
);
ALTER TABLE public.themes_marchand ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.themes_marchand TO service_role;

-- Interrupteur par marchand, réglé par l'admin (comme landing_premium) : faux
-- partout à l'arrivée, la fonction est donc dormante tant que l'admin ne l'ouvre pas.
ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS themes_actifs boolean NOT NULL DEFAULT false;
ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS theme_actif jsonb;
ALTER TABLE public.marchands ADD COLUMN IF NOT EXISTS theme_bascule jsonb;
ALTER TABLE public.marchands DROP CONSTRAINT IF EXISTS marchands_theme_actif_check;
ALTER TABLE public.marchands ADD CONSTRAINT marchands_theme_actif_check
  CHECK (theme_actif IS NULL OR (jsonb_typeof(theme_actif) = 'object'
         AND theme_actif->>'etat' IN ('programme', 'en_cours')));

COMMENT ON TABLE public.themes_marchand IS
  'Thèmes de carte préparés par WinWin pour un marchand (f17, migration 063).';
COMMENT ON COLUMN public.marchands.themes_actifs IS
  'Cartes à thème ouvertes à ce marchand par l''admin (Pro+ en plus) (migration 063).';
COMMENT ON COLUMN public.marchands.theme_actif IS
  'Thème choisi par le marchand : copie du thème + debut, fin (dates UTC) + etat programme|en_cours (migration 063).';
COMMENT ON COLUMN public.marchands.theme_bascule IS
  'Mise à jour des cartes en cours (ouverture ou fin de thème), reprise par le cron (migration 063).';

-- Cartes Google réelles d'un marchand (règle D2, étape 23 ; même définition que
-- campagne_lot_google, sans segment), par id croissant.
CREATE OR REPLACE FUNCTION public.theme_lot_google(p_marchand_id uuid, p_apres uuid, p_limite integer)
RETURNS TABLE (id uuid, serial_number text, prenom text, stored_value integer)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.id, p.serial_number, c.prenom, c.stored_value
    FROM passes p
    JOIN clients c ON c.pass_serial_number = p.serial_number AND c.visible AND c.deleted_at IS NULL
   WHERE p.marchand_id = p_marchand_id
     AND p.google_pass_url IS NOT NULL
     AND (p_apres IS NULL OR p.id > p_apres)
     AND (p.google_ouvert_le IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM device_tokens d WHERE d.serial_number = p.serial_number))
   ORDER BY p.id
   LIMIT LEAST(GREATEST(p_limite, 1), 1000);
$$;
REVOKE ALL ON FUNCTION public.theme_lot_google(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.theme_lot_google(uuid, uuid, integer) TO service_role;

-- Registre des envois : nouvelle source 'theme' (même méthode que la migration 047).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT con.conname FROM pg_constraint con
            WHERE con.conrelid = 'public.notification_envois'::regclass
              AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE '%source%' LOOP
    EXECUTE format('ALTER TABLE public.notification_envois DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.notification_envois
  ADD CONSTRAINT notification_envois_source_check
  CHECK (source IN ('inactive','near_reward','birthday','manuel',
                    'scan','welcome','ajustement','annulation','avis','geo','theme'));

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Les six colonnes doivent valoir true.
--
-- SELECT
--   to_regclass('public.themes_marchand') IS NOT NULL
--     AND has_table_privilege('service_role', 'public.themes_marchand', 'INSERT')
--     AND NOT has_table_privilege('anon', 'public.themes_marchand', 'SELECT') AS table_ok,
--   (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'marchands'
--     AND column_name IN ('themes_actifs', 'theme_actif', 'theme_bascule')) = 3 AS colonnes_ok,
--   NOT EXISTS (SELECT 1 FROM marchands WHERE themes_actifs) AS dormant_ok,
--   EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marchands_theme_actif_check') AS garde_fou_ok,
--   has_function_privilege('service_role', 'public.theme_lot_google(uuid,uuid,integer)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.theme_lot_google(uuid,uuid,integer)', 'EXECUTE') AS fonction_ok,
--   pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'notification_envois_source_check')) LIKE '%theme%' AS registre_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- Après avoir remis le code en arrière (l'ancien code ignore table et colonnes) :
--   table, colonnes, fonction et source 'theme' peuvent rester. Un thème en cours
--   resterait sur les cartes déjà mises à jour jusqu'à leur prochaine mise à jour
--   (scan) : avant le retour arrière, arrêter les thèmes en cours depuis
--   l'onglet « Ma carte » (retour silencieux à la carte standard).
