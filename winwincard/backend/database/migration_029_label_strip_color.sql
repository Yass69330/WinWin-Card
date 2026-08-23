-- Migration 029 : couleur manuelle du label « LOYALTY CARD » du strip généré
--
-- Colonne optionnelle : couleur du texte du label en haut du strip (labelSvg).
-- NULL (défaut) → calcul WCAG automatique actuel INCHANGÉ (blanc atténué sur
-- fond sombre / foncé dérivé sur fond clair). Une valeur écrase le calcul et
-- s'affiche en opacité pleine (choix explicite = couleur nette).
--
-- N'affecte QUE l'affichage du strip généré (Apple strip + hero Google). Sans
-- effet en mode points (générateur bypassé) ni en état reward (le doré garde
-- son calcul WCAG pour rester lisible au moment de la récompense).
--
-- Type text, nullable, sans défaut, sans CHECK (accepte hex/rgba). ADD COLUMN
-- ne bump pas strip_config_version ; le bump se fait via l'admin (VISUAL_FIELDS)
-- au changement réel. Rejouable sans risque.

ALTER TABLE marchands
  ADD COLUMN IF NOT EXISTS couleur_label_strip text;
