-- Migration 024 : index unique sur referral_credits.filleul_client_id
--
-- Règle métier (validée par le fondateur) : le parrain est crédité UNE FOIS,
-- au premier tampon/point du filleul, jamais plus, quel que soit le mode.
-- Cet index la rend physiquement inviolable : la base refuse toute deuxième
-- ligne d'audit pour un même filleul. Corrige l'item [1] de l'audit #3
-- (parrain re-crédité à chaque cycle de carte en mode tampons — scan.js
-- déclenche sur `avantScan === 0`, condition qui se reproduit à chaque tour).
--
-- Le garde-fou côté code (scan.js : consulter referral_credits avant de
-- créditer, écrire le ticket AVANT le crédit en vérifiant l'erreur) est
-- déployé séparément, APRÈS confirmation de cette migration.
--
-- Prérequis vérifié le 2026-07-13 : la table est vide (aucun doublon).
-- Justification de l'unicité : clients.referred_by_client_id est immuable
-- (écrit une seule fois à l'inscription, jamais réécrit — vérifié sur tout
-- le code). Un filleul n'a qu'un parrain, à vie.
-- Rejouable sans risque (IF NOT EXISTS).

CREATE UNIQUE INDEX IF NOT EXISTS referral_credits_filleul_unique
  ON referral_credits (filleul_client_id);
