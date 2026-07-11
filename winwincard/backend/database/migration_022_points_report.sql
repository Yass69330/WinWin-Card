-- Migration 022 : report du surplus en mode points (reward + reset)
--
-- SOURCE DE VÉRITÉ ACTUELLE de increment_stored_value. Voir la note de
-- dépréciation en tête de migration_012_atomic_increment.sql.
--
-- ── Pourquoi une nouvelle surcharge, pas un remplacement ──────────────────
-- CREATE OR REPLACE ne remplace une fonction que si la liste des TYPES de
-- paramètres est identique. increment_stored_value existe déjà en base sous
-- deux signatures : (uuid, integer) [migration_012 d'origine] et
-- (uuid, integer, integer) [p_amount, ajouté en Phase 1 du chantier points].
-- Ce fichier AJOUTE une troisième surcharge (uuid, integer, integer, text) —
-- il ne touche ni ne droppe les deux précédentes. Tant que scan.js continue
-- d'appeler avec 3 arguments nommés (p_client_id, p_max_value, p_amount),
-- rien ne change : Postgres résout vers la surcharge exacte à 3 arguments
-- (celle qui exige le moins de valeurs par défaut à combler). La bascule
-- vers cette nouvelle surcharge ne se produit que lorsque scan.js commence à
-- envoyer p_type_programme — un nom de paramètre qu'aucune des deux anciennes
-- fonctions ne porte, donc résolution non ambiguë par construction.
--
-- ── Ce qui change, uniquement en mode points ──────────────────────────────
-- Avant (mode tampons ET points confondus) : quand le solde était déjà au
-- seuil ou au-delà avant ce scan, la carte repartait à 0 (v_apres := 0).
-- Le reset reste TOUJOURS différé d'un scan après le scan gagnant (ne
-- JAMAIS le faire sur le scan gagnant lui-même — c'est ce qui permet au
-- fond doré Apple de s'afficher au prochain rafraîchissement asynchrone du
-- pass, cf. audit reward/reset).
--
-- En mode points, ce même scan (celui qui arrive quand le solde était déjà
-- au seuil) ne remet plus à 0 : il reporte le surplus. Formule :
--   v_apres := v_avant - p_max_value + p_amount
-- Exemple : solde 530 (seuil 500) + achat de 100 points → 530-500+100 = 130.
-- is_reset reste TRUE sur ce scan (sémantique inchangée : "ce scan a purgé
-- le seuil précédent, ne pas déclencher un second reward") — seule la
-- valeur numérique change, plus jamais 0 en mode points.
--
-- Le mode tampons garde v_apres := 0 mot pour mot. p_type_programme absent
-- ou différent de 'points' → comportement historique intact.
--
-- Cas limite accepté (documenté, non traité ici) : si le report lui-même
-- dépasse à nouveau le seuil d'un coup (achat > seuil), ce nouveau
-- franchissement n'est pas détecté comme un reward sur CE scan (is_reset
-- reste true) ; il ne sera traité comme un reward normal qu'au moment où un
-- scan ultérieur repart d'un solde repassé sous le seuil. Rare, accepté V1.

CREATE OR REPLACE FUNCTION increment_stored_value(
  p_client_id uuid,
  p_max_value integer,
  p_amount integer DEFAULT 1,
  p_type_programme text DEFAULT 'stamps'
)
RETURNS TABLE(stored_value_avant integer, stored_value_apres integer, is_reset boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_avant integer;
  v_apres integer;
  v_reset boolean := false;
BEGIN
  -- Verrou ligne : sérialise les scans concurrents sur le même client
  SELECT stored_value INTO v_avant
  FROM clients
  WHERE id = p_client_id
  FOR UPDATE;

  IF v_avant IS NULL THEN
    RAISE EXCEPTION 'client introuvable: %', p_client_id;
  END IF;

  IF v_avant >= p_max_value THEN
    -- Scan de "redemption" : le seuil était déjà atteint/dépassé avant ce
    -- scan (le scan gagnant précédent l'a laissé volontairement au-dessus,
    -- cf. commentaire de tête). Tampons : reset strict à 0, inchangé.
    -- Points : report du surplus, jamais 0.
    IF p_type_programme = 'points' THEN
      v_apres := v_avant - p_max_value + p_amount;
    ELSE
      v_apres := 0;
    END IF;
    v_reset := true;
  ELSIF v_avant + p_amount >= p_max_value THEN
    -- Scan gagnant : franchit ou atteint le seuil pile sur ce scan. Jamais
    -- de reset ici, quel que soit le mode — le solde reste au-dessus du
    -- seuil jusqu'au scan suivant (fond doré Apple).
    v_apres := v_avant + p_amount;
    v_reset := false;
  ELSE
    v_apres := v_avant + p_amount;
  END IF;

  UPDATE clients SET stored_value = v_apres WHERE id = p_client_id;

  RETURN QUERY SELECT v_avant, v_apres, v_reset;
END;
$$;
