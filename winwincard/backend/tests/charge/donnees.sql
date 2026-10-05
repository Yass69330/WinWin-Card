-- ════════════════════════════════════════════════════════════════════════════
-- DONNÉES FACTICES DE LA CAMPAGNE (étape 15) — BASE DE TEST UNIQUEMENT.
--
-- Jouées juste après la reconstruction de la base (schema.sql, migrations,
-- rgpd_effacement.sql). Graine fixe : mêmes données à chaque fois. Aucune donnée
-- réelle, aucune adresse de la production (les images viennent du stockage de
-- test, ou des icônes embarquées).
--
-- Paramètres psql (\set avant ce fichier) :
--   plafond          porteurs du marchand « plafond » (paliers 5000, 20000, 50000) ;
--   echelle_registre part du registre des envois à l'équilibre (1 = ≈ 800 000 lignes).
--
-- Répartition (décision de pilotage du 05/10), 100 000 porteurs au total :
--   - un gros réseau = UN marchand, 15 boutiques, 20 000 porteurs, en points ;
--   - le marchand plafond, mono-site, en tampons, :plafond porteurs ;
--   - 84 petits commerces pour le reste (moitié points, moitié tampons).
-- Ratios mesurés en production : 64 % de cartes sur iPhone, 1,27 appareil par
-- carte, 3,4 vérifications par scan (audit 04 n° 3 et §4.2), soit ≈ 2,7 cartes
-- par appareil ; ≈ 2,7 scans par porteur sur 90 jours (synthèse §5.1), 14 % dans
-- l'heure de pointe (08:00 UTC, midi à Dubaï).
-- Le marchand TÉMOIN (temoin.sql, joué avant ce fichier) prouve au fichier de
-- campagne et au générateur qu'ils parlent à une base de campagne : la
-- production ne l'a pas.
-- ════════════════════════════════════════════════════════════════════════════

SELECT setseed(0.15);

-- ── Marchands ───────────────────────────────────────────────────────────────
CREATE TEMP TABLE m_campagne (k int, id uuid, nom text, slug text, forfait text, type_programme text,
  seuil int, porteurs int, reseau boolean, relances boolean, strip_mode text);
INSERT INTO m_campagne VALUES
  (1, md5('m-1')::uuid, 'Réseau campagne',  'campagne-reseau',  'pro_plus', 'points', 500, 20000,     true,  true, 'points_bar'),
  (2, md5('m-2')::uuid, 'Plafond campagne', 'campagne-plafond', 'pro_plus', 'stamps', 10,  :plafond, false, true, 'stamps');
INSERT INTO m_campagne
SELECT 2 + k, md5('m-' || (2 + k))::uuid, 'Petit commerce ' || k, 'campagne-petit-' || k,
       (ARRAY['basic', 'pro', 'pro_plus'])[1 + k % 3],
       CASE WHEN k % 2 = 0 THEN 'points' ELSE 'stamps' END,
       CASE WHEN k % 2 = 0 THEN 500 ELSE 10 END,
       (100000 - 20000 - :plafond) / 84,
       false, k % 3 <> 0,
       CASE WHEN k % 2 = 0 THEN 'points_bar' ELSE 'stamps' END
  FROM generate_series(1, 84) k;

INSERT INTO marchands (id, nom, slug, forfait, type_programme, max_value, display_max_value, langue,
                       strip_mode, workflow_inactive_enabled, workflow_near_reward_enabled)
SELECT id, nom, slug, forfait, type_programme, seuil, seuil, 'fr', strip_mode, relances, relances
  FROM m_campagne;

INSERT INTO points_de_vente (id, marchand_id, nom, scanner_login)
SELECT md5('b-' || b)::uuid, md5('m-1')::uuid, 'Boutique ' || b, 'campagne-b' || b
  FROM generate_series(1, 15) b;

-- ── Porteurs et cartes ──────────────────────────────────────────────────────
INSERT INTO clients (id, marchand_id, prenom, stored_value, pass_serial_number, created_at)
SELECT md5('c-' || m.k || '-' || c)::uuid, m.id, 'Porteur' || c,
       floor(random() * m.seuil)::int, md5('s-' || m.k || '-' || c)::uuid::text,
       now() - (random() * 180) * interval '1 day'
  FROM m_campagne m, generate_series(1, m.porteurs) c;

-- 36 % de cartes Android (lien Google), 64 % sur iPhone.
INSERT INTO passes (client_id, marchand_id, serial_number, google_pass_url, updated_at)
SELECT id, marchand_id, pass_serial_number,
       CASE WHEN abs(hashtext('os-' || pass_serial_number)::bigint) % 100 >= 64
            THEN 'https://pay.google.com/gp/v/save/campagne' END,
       created_at
  FROM clients WHERE marchand_id IN (SELECT id FROM m_campagne);

-- Appareils : 1,27 inscription par carte iPhone, ≈ 2,7 cartes par appareil.
-- Jeton de push = numéro de l'appareil en hexadécimal (l'imitateur le relit).
CREATE TEMP TABLE iphones AS
SELECT p.id AS pass_id, p.client_id, p.marchand_id, p.serial_number
  FROM passes p WHERE p.google_pass_url IS NULL AND p.marchand_id IN (SELECT id FROM m_campagne);
SELECT ceil(count(*) * 1.27 / 2.68)::int AS nb_appareils FROM iphones \gset
INSERT INTO device_tokens (pass_id, client_id, marchand_id, serial_number, device_id, push_token)
SELECT pass_id, client_id, marchand_id, serial_number, 'appareil-' || n, lpad(to_hex(n), 64, '0')
  FROM (SELECT i.*, abs(hashtext('d1-' || serial_number)::bigint) % :nb_appareils AS n FROM iphones i
        UNION ALL
        SELECT i.*, (abs(hashtext('d1-' || serial_number)::bigint) + 1
                     + abs(hashtext('d2-' || serial_number)::bigint) % (:nb_appareils - 1)) % :nb_appareils
          FROM iphones i WHERE abs(hashtext('d3-' || serial_number)::bigint) % 100 < 27) t;

-- ── 90 jours de scans ───────────────────────────────────────────────────────
INSERT INTO scans (client_id, marchand_id, stored_value_avant, stored_value_apres, montant_credite,
                   point_de_vente_id, date_scan)
SELECT md5('c-' || m.k || '-' || (1 + floor(random() * m.porteurs)::int))::uuid, m.id, x.v, x.v + x.a, x.a,
       CASE WHEN m.reseau THEN md5('b-' || (1 + floor(random() * 15)::int))::uuid END,
       least(now() - interval '1 minute',
             date_trunc('day', now()) - floor(random() * 90) * interval '1 day'
             + (CASE WHEN random() < 0.14 THEN 8 ELSE 6 + floor(random() * 14) END) * interval '1 hour'
             + floor(random() * 3600) * interval '1 second')
  FROM m_campagne m, generate_series(1, round(270000.0 * m.porteurs / 100000)::int) s,
       LATERAL (SELECT floor(random() * m.seuil)::int AS v,
                       CASE WHEN m.type_programme = 'points' THEN 5 + floor(random() * 40)::int ELSE 1 END AS a
                 WHERE s > 0) x;

-- ── Relances du cron à l'équilibre : un porteur inactif est relancé tous les
-- 8 jours (déduplication de 7 jours), sur les 90 jours gardés (purge).
INSERT INTO workflow_executions (workflow_type, client_id, marchand_id, executed_at)
SELECT 'inactive', c.id, c.marchand_id,
       now() - ((abs(hashtext('w-' || c.id)::bigint) % 8) + 8 * j) * interval '1 day'
  FROM clients c
  JOIN m_campagne m ON m.id = c.marchand_id AND m.relances
  CROSS JOIN generate_series(0, 10) j
 WHERE NOT EXISTS (SELECT 1 FROM scans s WHERE s.client_id = c.id AND s.date_scan > now() - interval '30 days')
   AND (abs(hashtext('w-' || c.id)::bigint) % 8) + 8 * j < 90;

-- Relances « proches de la récompense » à l'équilibre : même déduplication de
-- 7 jours, un porteur proche est relancé au plus une fois tous les 8 jours.
INSERT INTO workflow_executions (workflow_type, client_id, marchand_id, executed_at)
SELECT 'near_reward', c.id, c.marchand_id,
       now() - (abs(hashtext('n-' || c.id)::bigint) % 8) * interval '1 day' - interval '1 hour'
  FROM clients c
  JOIN m_campagne m ON m.id = c.marchand_id AND m.relances
 WHERE c.stored_value >= m.seuil - 2 AND c.stored_value < m.seuil
   AND abs(hashtext('n-' || c.id)::bigint) % 8 < 7;

-- ── Registre des envois sur 90 jours (≈ 800 000 lignes à l'échelle 1) ───────
INSERT INTO notification_envois (envoye_le, source, marchand_id, plateforme, statut, ok, token_hash, serial_number)
SELECT now() - random() * interval '90 days',
       (ARRAY['scan', 'scan', 'scan', 'scan', 'scan', 'inactive', 'inactive', 'inactive', 'near_reward', 'manuel'])[1 + floor(random() * 10)::int],
       md5('m-' || (1 + g % 86))::uuid,
       CASE WHEN random() < 0.6 THEN 'apple' ELSE 'google' END,
       CASE WHEN random() < 0.97 THEN 200 ELSE 410 END, true,
       md5('jeton-' || g), md5('serial-' || g)
  FROM generate_series(1, round(800000 * :echelle_registre)::int) g;
UPDATE notification_envois SET ok = (statut = 200) WHERE statut <> 200;

ANALYZE;
