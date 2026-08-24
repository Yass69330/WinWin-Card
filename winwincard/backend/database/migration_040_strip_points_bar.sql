-- Migration 040 : strip généré pour les marchands en mode POINTS (barre de progression)
--
-- CONTEXTE
-- Aujourd'hui, la génération de strip est bypassée pour tout marchand en
-- type_programme='points' (apple-pass.js, google-pass.js — 3 points d'appel).
-- Raison d'origine, toujours valable : dessiner 500 pastilles n'a aucun sens.
-- Conséquence : un marchand en points n'a QUE deux choix — fournir sa propre
-- image (image_strip_url / images_tiers), ou afficher un bandeau uni sans rien.
--
-- CETTE MIGRATION ouvre une troisième voie : strip_mode = 'points_bar', un strip
-- généré affichant une BARRE DE PROGRESSION (aucun chiffre dessiné — le solde
-- exact est déjà dans les champs du pass, Apple comme Google).
--
-- POURQUOI UNE NOUVELLE VALEUR PLUTÔT QUE DÉBLOQUER 'static' POUR LES POINTS
-- 'static' existe déjà (018) mais est inaccessible aux marchands points, à cause
-- d'un garde-fou volontairement large. Le débloquer coûterait 3 lignes de JS,
-- MAIS changerait l'apparence des pass d'un marchand points existant qui aurait
-- déjà strip_mode='static' en base — sans qu'on l'ait décidé, et sur un client
-- payant. Une valeur NEUVE est opt-in par construction : elle n'existe pour
-- personne tant qu'elle n'est pas choisie dans l'admin. Zéro régression possible.
--
-- POURQUOI PAS LE NOMBRE EXACT DESSINÉ DANS L'IMAGE
-- La clé de cache (strip-cache.js) inclut la valeur du solde. En tampons, un
-- seuil de 10 donne 11 images par marchand. En points, un seuil de 500 donnerait
-- 500+ images, une génération neuve à chaque montant jamais vu, et du Storage qui
-- gonfle sans fin. Le code JS quantifie donc l'avancement par paliers de 5 %
-- (21 images par marchand — même ordre de grandeur que les tampons).
--
-- CE QUE CETTE MIGRATION FAIT, EXACTEMENT
-- Elle élargit la contrainte CHECK de marchands.strip_mode pour accepter une
-- troisième valeur. Elle NE crée aucune colonne, NE modifie aucune donnée, et
-- NE change le comportement d'aucun marchand : elle autorise une valeur que
-- personne n'utilise encore. Exécutable sans risque même si le chantier
-- s'arrêtait là.
--
-- POURQUOI UN BLOC DO PLUTÔT QU'UN DROP CONSTRAINT NOMMÉ
-- La 018 pose la contrainte EN LIGNE (ADD COLUMN ... CHECK ...), donc Postgres
-- l'a auto-nommée. Le nom généré est probablement marchands_strip_mode_check,
-- mais §3.10 interdit de le supposer : on cherche la (ou les) contrainte(s)
-- réellement présentes portant sur strip_mode, on les supprime, puis on repose
-- la nouvelle avec un nom EXPLICITE. Rejouable sans risque (le second passage
-- retrouve et remplace celle qu'on vient de poser).
--
-- À exécuter dans Supabase APRÈS la requête de photographie (lecture seule).

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
    RAISE NOTICE 'Contrainte supprimée : %', r.conname;
  END LOOP;
END $$;

ALTER TABLE public.marchands
  ADD CONSTRAINT marchands_strip_mode_check
  CHECK (strip_mode IN ('static', 'stamps', 'points_bar'));

-- Contrôle : doit renvoyer exactement 1 ligne, incluant 'points_bar'.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.marchands'::regclass
  AND contype  = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%strip_mode%';
