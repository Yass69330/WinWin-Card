-- ════════════════════════════════════════════════════════════════════════════
-- MARCHAND TÉMOIN DE LA CAMPAGNE (étape 15) — BASE DE TEST UNIQUEMENT.
-- Identifiant fixe, absent de la production : le fichier de campagne refuse de
-- démarrer sans lui, le générateur refuse d'écrire sans lui. Joué avant
-- donnees.sql, ou seul pour le premier geste du temps 2 (test d'adresse).
-- Rejouable.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO marchands (id, nom, slug, forfait, type_programme, max_value, display_max_value, langue)
VALUES ('c0ffee15-0000-4000-8000-000000000015', 'Témoin campagne 15', 'temoin-campagne-15', 'basic', 'stamps', 10, 10, 'fr')
ON CONFLICT (id) DO NOTHING;
