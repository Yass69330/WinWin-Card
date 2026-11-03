-- Migration 071 : gabarits de thèmes réutilisables (f17, morceau 3, décisions du pilotage du 03/11)
--
-- POURQUOI. Jusqu'ici, chaque thème était saisi à la main dans la fiche admin de
-- chaque marchand. Un gabarit = fond + couleurs + texte de la case + message
-- d'ouverture, en français et en anglais, partagé par tous les marchands. Le
-- bouton admin « Appliquer un gabarit » le COPIE dans les thèmes du marchand
-- (themes_marchand) : {nom} y est remplacé par le nom affiché sur la carte
-- (pass_display_name, sinon nom), la langue suit celle du marchand. La copie se
-- modifie ensuite comme tout thème (et le logo s'ajoute à la main) ; le gabarit
-- ne change pas.
--
-- CE QUE FAIT LA MIGRATION.
--   - table themes_gabarits (RLS sans politique, droits au seul service_role) ;
--   - les trois préconçus : Ramadan, Noël, Fête Nationale (générique, sans
--     drapeau : sert les Émirats le 2/12 et la France le 14/07).
--
-- COÛT. Une table de quelques lignes ; rien d'autre n'est touché. Aucune lecture
-- de plus ailleurs que dans l'admin.
-- COMPATIBILITÉ. L'ancien code ignore la table. À exécuter AVANT le code.
-- Rejouable (les préconçus ne sont insérés que s'ils manquent : un gabarit modifié
-- dans Supabase n'est jamais écrasé).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.themes_gabarits (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom            text        NOT NULL UNIQUE CHECK (length(btrim(nom)) BETWEEN 1 AND 40),
  couleur_fond   text        NOT NULL CHECK (couleur_fond ~ '^#[0-9a-fA-F]{6}$'),
  couleur_texte  text        CHECK (couleur_texte IS NULL OR couleur_texte ~ '^#[0-9a-fA-F]{6}$'),
  couleur_label  text        CHECK (couleur_label IS NULL OR couleur_label ~ '^#[0-9a-fA-F]{6}$'),
  texte_case_fr  text        CHECK (texte_case_fr IS NULL OR length(texte_case_fr) <= 40),
  texte_case_en  text        CHECK (texte_case_en IS NULL OR length(texte_case_en) <= 40),
  message_fr     text        NOT NULL CHECK (length(btrim(message_fr)) BETWEEN 1 AND 150),
  message_en     text        NOT NULL CHECK (length(btrim(message_en)) BETWEEN 1 AND 150),
  cree_le        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.themes_gabarits ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.themes_gabarits TO service_role;
COMMENT ON TABLE public.themes_gabarits IS
  'Gabarits de thèmes partagés, copiés dans themes_marchand par l''admin ({nom} remplacé, langue du marchand) (f17, migration 071).';

INSERT INTO public.themes_gabarits (nom, couleur_fond, couleur_texte, couleur_label, texte_case_fr, texte_case_en, message_fr, message_en) VALUES
  ('Ramadan', '#F3E9D2', '#1C5D4E', '#1C5D4E', 'Ramadan Mubarak 🌙', 'Ramadan Mubarak 🌙',
   '{nom} vous souhaite un bon mois de Ramadan 🌙', '{nom} wishes you a blessed Ramadan 🌙'),
  ('Noël', '#8E1420', '#FFFFFF', '#E7C35B', 'Joyeuses fêtes 🎄', 'Happy Holidays 🎄',
   '{nom} vous souhaite de joyeuses fêtes 🎄', '{nom} wishes you happy holidays 🎄'),
  ('Fête Nationale', '#00703C', '#FFFFFF', '#FFFFFF', 'Fête Nationale 🎉', 'National Day 🎉',
   '{nom} vous souhaite une bonne fête nationale', '{nom} wishes you a happy National Day')
ON CONFLICT (nom) DO NOTHING;

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Une ligne, attendu : true | true | 3 | true
--
-- SELECT
--   has_table_privilege('service_role', 'public.themes_gabarits', 'INSERT')
--     AND NOT has_table_privilege('anon', 'public.themes_gabarits', 'SELECT') AS droits_ok,
--   (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.themes_gabarits'::regclass) AS rls_ok,
--   (SELECT count(*) FROM public.themes_gabarits WHERE nom IN ('Ramadan', 'Noël', 'Fête Nationale')) AS preconcus,
--   (SELECT texte_case_fr FROM public.themes_gabarits WHERE nom = 'Ramadan') = 'Ramadan Mubarak 🌙' AS emoji_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- L'ancien code ignore la table : elle peut rester. Pour l'enlever (après le
-- retour arrière du code) : DROP TABLE public.themes_gabarits;
-- Les thèmes déjà copiés chez les marchands (themes_marchand) ne dépendent pas
-- du gabarit et restent.
