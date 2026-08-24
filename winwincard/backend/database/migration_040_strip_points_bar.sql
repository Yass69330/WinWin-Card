-- Migration 040 : strip généré pour les marchands en mode POINTS (barre de progression)
--
-- CONTEXTE
-- La génération de strip est aujourd'hui bypassée pour tout marchand en
-- type_programme='points' (apple-pass.js, google-pass.js — 3 points d'appel).
-- Raison d'origine, toujours valable : dessiner 500 pastilles n'a aucun sens.
-- Conséquence : un marchand en points n'a que deux choix — fournir sa propre
-- image (image_strip_url / images_tiers), ou afficher un bandeau uni vide.
--
-- CETTE MIGRATION ouvre une troisième voie : strip_mode = 'points_bar', un strip
-- généré affichant une BARRE DE PROGRESSION (aucun chiffre dessiné — le solde
-- exact figure déjà dans les champs du pass, Apple comme Google).
--
-- POURQUOI UNE VALEUR NEUVE PLUTÔT QUE DÉBLOQUER 'static' POUR LES POINTS
-- 'static' existe déjà (018) mais reste inaccessible aux marchands points, à
-- cause d'un garde-fou volontairement large. Le débloquer coûterait 3 lignes de
-- JS, MAIS changerait l'apparence des pass d'un marchand points ayant déjà
-- strip_mode='static' en base — sans qu'on l'ait décidé, sur un client payant.
-- Une valeur NEUVE est opt-in par construction : elle n'existe pour personne
-- tant qu'elle n'est pas choisie dans l'admin. Zéro régression possible.
--
-- POURQUOI PAS LE NOMBRE EXACT DESSINÉ DANS L'IMAGE
-- La clé de cache (strip-cache.js) inclut la valeur du solde. En tampons, un
-- seuil de 10 donne 11 images par marchand. En points, un seuil de 500 donnerait
-- 500+ images, une génération neuve à chaque montant inédit, et du Storage qui
-- gonfle sans fin. Le code JS quantifie donc l'avancement par paliers de 5 %
-- (21 images par marchand — même ordre de grandeur que les tampons).
--
-- CE QU'ELLE FAIT, EXACTEMENT
-- Élargit la contrainte CHECK de marchands.strip_mode pour accepter une
-- troisième valeur. Aucune colonne créée, aucune donnée modifiée, aucun marchand
-- ne change de comportement : elle autorise une valeur que personne n'utilise
-- encore. Exécutable sans risque même si le chantier s'arrêtait là.
--
-- POURQUOI ELLE N'EXIGE AUCUNE VÉRIFICATION PRÉALABLE (§3.10)
-- La règle §3.10 interdit de SUPPOSER l'état de la base. Plutôt que de déléguer
-- une introspection au fondateur, cette migration s'adapte à ce qu'elle trouve :
--   • la contrainte de 018 est posée EN LIGNE (ADD COLUMN ... CHECK ...), donc
--     auto-nommée par Postgres : le bloc DO cherche les contraintes RÉELLEMENT
--     présentes sur strip_mode, quel que soit leur nom, et les retire ;
--   • si une valeur inattendue traînait en base, le garde-fou lève une erreur
--     EXPLICITE avant toute modification ;
--   • le tout est encadré par BEGIN/COMMIT : à la moindre erreur, TOUT est
--     annulé — impossible de se retrouver sans contrainte du tout ;
--   • la dernière requête affiche l'état final : la « photo » est le RÉSULTAT
--     de la migration, pas une étape manuelle en amont.
-- Rejouable sans risque.
--
-- À exécuter dans l'éditeur SQL Supabase.

BEGIN;

-- Garde-fou : aucune valeur hors de la liste cible ne doit exister, sinon la
-- nouvelle contrainte serait refusée. On échoue AVANT de toucher à quoi que ce
-- soit, avec un message qui nomme les valeurs fautives.
DO $$
DECLARE
  v_invalides text;
BEGIN
  SELECT string_agg(DISTINCT quote_literal(strip_mode), ', ')
    INTO v_invalides
  FROM public.marchands
  WHERE strip_mode IS NOT NULL
    AND strip_mode NOT IN ('static', 'stamps', 'points_bar');

  IF v_invalides IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 040 interrompue : valeur(s) strip_mode inattendue(s) en base : %. Rien n''a été modifié.',
      v_invalides;
  END IF;
END $$;

-- Retrait de la (ou des) contrainte(s) CHECK portant sur strip_mode, quel que
-- soit leur nom auto-généré. Boucle : gère aussi le cas d'un doublon.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.marchands'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%strip_mode%'
  LOOP
    EXECUTE format('ALTER TABLE public.marchands DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'Contrainte retirée : %', r.conname;
  END LOOP;
END $$;

-- Nouvelle contrainte, nommée explicitement cette fois (fin des noms auto).
ALTER TABLE public.marchands
  ADD CONSTRAINT marchands_strip_mode_check
  CHECK (strip_mode IN ('static', 'stamps', 'points_bar'));

COMMIT;

-- ── Contrôle final — c'est la « photo » d'après ────────────────────────────
-- Doit renvoyer exactement 1 ligne, dont la définition contient 'points_bar'.
SELECT conname AS contrainte,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.marchands'::regclass
  AND contype  = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%strip_mode%';

-- État des marchands par mode (informatif — aucune écriture).
SELECT COALESCE(strip_mode, '(NULL — génération désactivée)') AS strip_mode,
       type_programme,
       count(*) AS nb_marchands
FROM public.marchands
GROUP BY 1, 2
ORDER BY 1, 2;
