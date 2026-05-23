-- ============================================================
-- WinWin Card — Données de test (seed)
-- ============================================================
-- À exécuter dans Supabase SQL Editor après schema.sql
-- ============================================================

-- Marchand de test 1
insert into marchands (
  id, nom, slug, couleur_fond, couleur_texte, couleur_label,
  texte_landing, max_value, forfait, email_contact
) values (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Café Le Central',
  'cafe-le-central',
  '#1a1a2e',
  '#ffffff',
  '#a0a0b0',
  'Collectez vos points à chaque visite et obtenez un café offert !',
  10,
  'pro',
  'contact@lecentralcafe.fr'
);

-- Marchand de test 2
insert into marchands (
  id, nom, slug, couleur_fond, couleur_texte, couleur_label,
  texte_landing, max_value, forfait, email_contact
) values (
  'aaaaaaaa-0000-0000-0000-000000000002',
  'Boulangerie Dupont',
  'boulangerie-dupont',
  '#f5e6d3',
  '#3d2b1f',
  '#8b6f5e',
  '10 pains achetés = 1 offert. Simple et savoureux !',
  10,
  'pro',
  'contact@boulangerie-dupont.fr'
);

-- Clients de test pour Café Le Central
insert into clients (
  id, marchand_id, prenom, pass_serial_number, stored_value
) values
(
  'bbbbbbbb-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Marie',
  'serial-marie-central-001',
  7
),
(
  'bbbbbbbb-0000-0000-0000-000000000002',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Thomas',
  'serial-thomas-central-002',
  3
),
(
  'bbbbbbbb-0000-0000-0000-000000000003',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Sophie',
  'serial-sophie-central-003',
  0
);

-- Passes de test
insert into passes (
  client_id, marchand_id, serial_number
) values
(
  'bbbbbbbb-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'serial-marie-central-001'
),
(
  'bbbbbbbb-0000-0000-0000-000000000002',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'serial-thomas-central-002'
),
(
  'bbbbbbbb-0000-0000-0000-000000000003',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'serial-sophie-central-003'
);

-- Quelques scans de test pour Marie
insert into scans (
  client_id, marchand_id, stored_value_avant, stored_value_apres
) values
('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 0, 1),
('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 1, 2),
('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 2, 3),
('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 3, 4),
('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 4, 5),
('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 5, 6),
('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 6, 7);
