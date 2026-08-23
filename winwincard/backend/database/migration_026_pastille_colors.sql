-- Migration 026 : couleurs manuelles des pastilles du strip généré
--
-- Trois couleurs optionnelles par marchand, pour le générateur de strip
-- (theme icon_metier / logo_stamp) :
--   • couleur_pastille_fond    → fond du cercle des pastilles REMPLIES
--   • couleur_pastille_contour → contour des pastilles VIDES *et* REMPLIES
--   • couleur_pastille_icone   → couleur de l'icône des pastilles REMPLIES
--
-- Chaque champ est OPTIONNEL. NULL (défaut) → le calcul WCAG automatique
-- actuel s'applique EXACTEMENT comme avant : zéro régression pour tous les
-- marchands existants (colonnes NULL → repli sur la base dans stampColors).
-- Un champ rempli écrase la valeur calculée pour cette sortie précise.
--
-- Type text, nullable, SANS défaut, SANS contrainte CHECK : le champ « fond »
-- doit pouvoir valoir 'transparent' ou un rgba(), pas seulement un hex — un
-- CHECK serait trop restrictif.
--
-- N'affecte QUE l'affichage du strip généré (Apple strip + hero Google). Sans
-- effet en mode points (générateur bypassé) ni en état reward (décision produit :
-- le doré garde son calcul WCAG depuis couleur_fond_reward).
--
-- ADD COLUMN ne bump pas strip_config_version et n'invalide aucun cache : les
-- strips déjà générés restent servis à l'identique. Le bump se fait via l'admin
-- (VISUAL_FIELDS) quand une de ces couleurs change réellement.
--
-- Rejouable sans risque (IF NOT EXISTS).

ALTER TABLE marchands
  ADD COLUMN IF NOT EXISTS couleur_pastille_fond    text,
  ADD COLUMN IF NOT EXISTS couleur_pastille_contour text,
  ADD COLUMN IF NOT EXISTS couleur_pastille_icone   text;
