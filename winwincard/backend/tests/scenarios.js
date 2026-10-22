'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SCÉNARIOS DU FILET ARGENT ET SCAN — liste validée par Yass le 02/10/2026
// (audit 02 §10, synthèse §4.3, décisions de pilotage). Lancés par lancer.js.
//
// Règle : chaque scénario décrit ce que fait le code AUJOURD'HUI. Un défaut
// connu est écrit comme tel, avec l'étape qui l'inversera (« ÉTAT ACTUEL »).
// « TRANSITION » : comportement toléré pendant un passage de version, retiré
// à une étape nommée.
// Deux niveaux : les fonctions SQL qui écrivent le solde, appelées directement
// en base, et les routes, appelées à travers le vrai serveur.
// Chaque scénario crée ses propres clients : aucun ne dépend d'un autre.
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const M = {
  tampons:      '10000000-0000-4000-8000-000000000001', // tampons, seuil 10, parrainage (1)
  points:       '20000000-0000-4000-8000-000000000002', // points, seuil 500, sans parrainage
  pointsParr:   '30000000-0000-4000-8000-000000000003', // points, seuil 500, parrainage (5) — écart B
  reseau:       '40000000-0000-4000-8000-000000000004', // tampons, réseau de boutiques
  suspendu:     '50000000-0000-4000-8000-000000000005', // tampons, servira à la suspension
};
const B = {
  b1:       '41000000-0000-4000-8000-000000000001', // active
  b2:       '42000000-0000-4000-8000-000000000002', // active
  coupee:   '43000000-0000-4000-8000-000000000003', // actif = false
  archivee: '44000000-0000-4000-8000-000000000004', // deleted_at posé
};

const FIXTURES = `
INSERT INTO marchands (id, nom, slug, forfait, type_programme, max_value, display_max_value, langue, referral_enabled, referral_bonus_points) VALUES
 ('${M.tampons}',    'Filet Tampons',      'filet-tampons',      'pro', 'stamps', 10,  10,  'fr', true,  1),
 ('${M.points}',     'Filet Points',       'filet-points',       'pro', 'points', 500, 500, 'fr', false, 1),
 ('${M.pointsParr}', 'Filet Points Parr.', 'filet-points-parr',  'pro', 'points', 500, 500, 'fr', true,  5),
 ('${M.reseau}',     'Filet Réseau',       'filet-reseau',       'pro', 'stamps', 10,  10,  'fr', false, 1),
 ('${M.suspendu}',   'Filet Suspendu',     'filet-suspendu',     'pro', 'stamps', 10,  10,  'fr', false, 1);
INSERT INTO points_de_vente (id, marchand_id, nom, actif, deleted_at, scanner_login) VALUES
 ('${B.b1}',       '${M.reseau}', 'Boutique 1', true,  NULL,  'filet-b1'),
 ('${B.b2}',       '${M.reseau}', 'Boutique 2', true,  NULL,  'filet-b2'),
 ('${B.coupee}',   '${M.reseau}', 'Coupée',     false, NULL,  'filet-coupee'),
 ('${B.archivee}', '${M.reseau}', 'Archivée',   true,  now(), 'filet-archivee');
`;

async function jouer({ sql, sqlEnFond, verifier, api, secretJwt, demarrerServeur, demarrerPostgrest, urlSupabase, cleService, urlServeur, journalServeur }) {
  // ── Outils ────────────────────────────────────────────────────────────────
  const jeton = (marchandId, pointDeVenteId) => jwt.sign(pointDeVenteId
    ? { role: 'scanner', marchand_id: marchandId, point_de_vente_id: pointDeVenteId, tv: 1 }
    : { role: 'marchand', marchand_id: marchandId, tv: 1 }, secretJwt, { expiresIn: '1h' });
  const jetonAdmin = jwt.sign({ role: 'admin' }, secretJwt, { expiresIn: '1h' });

  function client(marchandId, { solde = 0, serial = crypto.randomUUID(), parrain = null } = {}) {
    const id = crypto.randomUUID();
    sql(`INSERT INTO clients (id, marchand_id, prenom, stored_value, pass_serial_number, referred_by_client_id)
         VALUES ('${id}', '${marchandId}', 'Filet', ${solde}, '${serial}', ${parrain ? `'${parrain}'` : 'NULL'});
         INSERT INTO passes (client_id, marchand_id, serial_number) VALUES ('${id}', '${marchandId}', '${serial}');`);
    return { id, serial };
  }
  const solde = id => Number(sql(`SELECT stored_value FROM clients WHERE id = '${id}'`));
  const lignes = id => Number(sql(`SELECT count(*) FROM scans WHERE client_id = '${id}'`));
  const derniereLigne = id => sql(`SELECT id FROM scans WHERE client_id = '${id}' AND annule_le IS NULL ORDER BY date_scan DESC, id DESC LIMIT 1`);
  // Clé neuve à chaque appel : la clé est obligatoire depuis t43.
  const scan = (jt, serial, points) => scanCle(jt, serial, crypto.randomUUID(), points);
  const scanCle = (jt, serial, cle, points) => api('POST', '/api/scan', jt,
    points === undefined ? { serial_number: serial, cle_idempotence: cle } : { serial_number: serial, points, cle_idempotence: cle });
  const annuler = (jt, scanId) => api('POST', `/api/scan/${scanId}/annuler`, jt);
  const messageCarte = serial => sql(`SELECT notification_message FROM passes WHERE serial_number = '${serial}'`);
  const refuseParLaBase = requete => { try { sql(requete); return false; } catch { return true; } };
  const attendre = async (fn, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)); }
    return false;
  };
  const titre = t => console.log(`\n— ${t}`);
  // Clients créés directement en base pour des tests qui ne portent pas sur le
  // masquage : ils représentent des porteurs réels (migration 059). Sans effet
  // avant 059 (colonne absente : contre-épreuve).
  const rendreVisibles = condition => { try { sql(`UPDATE clients SET visible = true WHERE NOT visible AND (${condition})`); } catch { /* avant 059 */ } };

  const tT = jeton(M.tampons), tP = jeton(M.points), tPP = jeton(M.pointsParr);
  const tR = jeton(M.reseau), tB1 = jeton(M.reseau, B.b1), tB2 = jeton(M.reseau, B.b2);

  // ── 0. Préalable ──────────────────────────────────────────────────────────
  titre('0. Préalable : la base rejouée porte ses droits (étape 9)');
  verifier('service_role lit, crée, modifie, supprime sur les 7 tables centrales', sql(`
    SELECT bool_and(has_table_privilege('service_role', 'public.' || t, 'SELECT')
                AND has_table_privilege('service_role', 'public.' || t, 'INSERT')
                AND has_table_privilege('service_role', 'public.' || t, 'UPDATE')
                AND has_table_privilege('service_role', 'public.' || t, 'DELETE'))
    FROM unnest(ARRAY['marchands','clients','passes','scans','device_tokens','consentements','workflows']) t`), 't');
  verifier('le serveur lit la base avec sa clé (/health/db)', (await api('GET', '/health/db')).statut, 200);
  verifier('crediter_scan : exécutable par le serveur, fermée à la clé publique (anon, authenticated)', sql(`
    SELECT has_function_privilege('service_role', p, 'EXECUTE') || '|' || has_function_privilege('anon', p, 'EXECUTE')
           || '|' || has_function_privilege('authenticated', p, 'EXECUTE')
      FROM (SELECT 'public.crediter_scan(uuid,uuid,uuid,integer,integer,text,uuid,text,text,text)'::regprocedure AS p) f`), 'true|false|false');

  // ── 1. Tampons ────────────────────────────────────────────────────────────
  titre('1. Tampons (seuil 10)');
  {
    const c = client(M.tampons);
    const r = await scan(tT, c.serial);
    verifier('scan normal : 0 → 1, ni récompense ni remise', [r.statut, r.corps.stored_value_avant, r.corps.stored_value_apres, r.corps.recompense, r.corps.is_reset], [200, 0, 1, false, false]);
    verifier('ligne de journal : +1 crédité, pas de récompense remise', sql(`SELECT montant_credite || '|' || recompense_distribuee FROM scans WHERE client_id = '${c.id}'`), '1|false');
    verifier('la carte reçoit le message du scan, écrit avec le crédit', [messageCarte(c.serial), r.corps.message], [r.corps.message, '+1 — Filet : 1/10 pts']);
    const r2 = await scan(tT, c.serial, 50);
    verifier('en tampons, un montant envoyé est ignoré : toujours +1', [r2.corps.stored_value_avant, r2.corps.stored_value_apres], [1, 2]);
    sql(`UPDATE clients SET stored_value = 9 WHERE id = '${c.id}'`);
    const r3 = await scan(tT, c.serial);
    verifier('scan gagnant : 9 → 10, récompense acquise, PAS encore remise', [r3.corps.stored_value_apres, r3.corps.recompense, r3.corps.is_reset], [10, true, false]);
    const r4 = await scan(tT, c.serial);
    verifier('passage suivant : remise, retour à 0', [r4.corps.stored_value_avant, r4.corps.stored_value_apres, r4.corps.is_reset, r4.corps.recompense], [10, 0, true, false]);
    verifier('message de la carte : seuil franchi, puis remise', [r3.corps.message, messageCarte(c.serial)], ['Merci pour ta fidélité Filet — Récompense au prochain passage', 'Carte remise à zéro — Filet : 0/10 pts']);
    verifier('ligne de la remise : 0 crédité, récompense remise', sql(`SELECT montant_credite || '|' || recompense_distribuee FROM scans WHERE client_id = '${c.id}' ORDER BY date_scan DESC, id DESC LIMIT 1`), '0|true');
  }

  // ── 2. Points ─────────────────────────────────────────────────────────────
  titre('2. Points (seuil 500)');
  {
    const c = client(M.points);
    const r = await scan(tP, c.serial, 50);
    verifier('scan normal : 0 + 50 = 50', [r.statut, r.corps.stored_value_apres, r.corps.is_reset], [200, 50, false]);
    sql(`UPDATE clients SET stored_value = 480 WHERE id = '${c.id}'`);
    const r2 = await scan(tP, c.serial, 50);
    verifier('seuil franchi d\'un coup : 480 + 50 = 530, récompense acquise', [r2.corps.stored_value_apres, r2.corps.recompense, r2.corps.is_reset], [530, true, false]);
    const r3 = await scan(tP, c.serial, 50);
    verifier('remise avec report : 530 → 80 (530 − 500 + 50)', [r3.corps.stored_value_avant, r3.corps.stored_value_apres, r3.corps.is_reset], [530, 80, true]);
    verifier('message de la carte en points : solde reporté écrit par la base', [messageCarte(c.serial), r3.corps.message], ['+50 — Filet : 80/500 pts', '+50 — Filet : 80/500 pts']);
    verifier('ligne de la remise en points : 50 crédités, récompense remise', sql(`SELECT montant_credite || '|' || recompense_distribuee FROM scans WHERE client_id = '${c.id}' ORDER BY date_scan DESC, id DESC LIMIT 1`), '50|true');

    const k = client(M.points, { solde: 530 });
    const r4 = await scan(tP, k.serial, 600);
    verifier('report en cascade : 530, achat de 600 → remise, 630 (encore au-dessus du seuil)', [r4.corps.stored_value_apres, r4.corps.is_reset], [630, true]);
    const r5 = await scan(tP, k.serial, 10);
    verifier('… et le passage suivant remet encore : 630 → 140', [r5.corps.stored_value_apres, r5.corps.is_reset], [140, true]);

    const m = client(M.points, { solde: 10 });
    const refus = [];
    for (const v of [0, -5, 12.5, 'abc', 100001]) refus.push((await scan(tP, m.serial, v)).statut);
    verifier('montants refusés (0, négatif, non entier, texte, 100 001) : 400', refus, [400, 400, 400, 400, 400]);
    verifier('… sans rien écrire (solde 10, aucune ligne)', [solde(m.id), lignes(m.id)], [10, 0]);
    verifier('montant 100 000 accepté (borne haute)', (await scan(tP, m.serial, 100000)).corps.stored_value_apres, 100010);

    const f = client(M.points, { solde: 520 });
    verifier('fonction SQL increment_stored_value appelée seule : même règle de report',
      sql(`SELECT stored_value_avant || '→' || stored_value_apres || '|' || is_reset FROM increment_stored_value('${f.id}', 500, 30, 'points')`), '520→50|true');
  }

  // ── 3. Simultanés et renvoi ───────────────────────────────────────────────
  titre('3. Scans simultanés et renvoi');
  {
    const c = client(M.points);
    const rs = await Promise.all(Array.from({ length: 10 }, () => scan(tP, c.serial, 7)));
    verifier('10 scans simultanés de 7 points : tous acceptés', rs.every(r => r.statut === 200), true);
    verifier('… aucun point perdu : 70 (verrou sur la carte)', solde(c.id), 70);
    verifier('… 10 lignes de journal, chaîne 0 → 70 complète', sql(`SELECT string_agg(stored_value_avant::text, ',' ORDER BY stored_value_avant) FROM scans WHERE client_id = '${c.id}'`), '0,7,14,21,28,35,42,49,56,63');
    // Étape 11 : avant, cassée 4 fois sur 5 (lignes écrites après le crédit, hors verrou).
    verifier('… et dans l\'ordre des DATES (journal jamais dans le désordre)', sql(`SELECT string_agg(stored_value_avant::text, ',' ORDER BY date_scan, id) FROM scans WHERE client_id = '${c.id}'`), '0,7,14,21,28,35,42,49,56,63');

    // Renvoi d'une même demande (même clé) : étape 11, inversé.
    const d = client(M.tampons);
    const k1 = crypto.randomUUID();
    const p1 = await scanCle(tT, d.serial, k1), p2 = await scanCle(tT, d.serial, k1);
    verifier('même demande envoyée deux fois (même clé) : UN crédit, une ligne', [solde(d.id), lignes(d.id)], [1, 1]);
    const { deja_enregistre: de1, ...corps1 } = p1.corps, { deja_enregistre: de2, ...corps2 } = p2.corps;
    verifier('… le renvoi reçoit la même réponse, marquée « déjà enregistrée »', [p2.statut, de1, de2, corps2], [200, false, true, corps1]);

    const e = client(M.points);
    const k2 = crypto.randomUUID();
    const rafale = await Promise.all(Array.from({ length: 10 }, () => scanCle(tP, e.serial, k2, 40)));
    verifier('10 envois simultanés de la même clé : un seul crédit, une ligne', [solde(e.id), lignes(e.id)], [40, 1]);
    verifier('… tous répondent 200, un seul « premier passage »', [rafale.every(r => r.statut === 200), rafale.filter(r => r.corps.deja_enregistre === false).length], [true, 1]);

    // t43 : la clé est obligatoire. Avant, un scan sans clé passait (et un
    // renvoi recréditait) ; maintenant 400, rien d'écrit, une ligne d'alerte.
    const f = client(M.tampons);
    const alertes = () => (journalServeur().match(/\[scan\] ALERTE cle_idempotence manquante/g) || []).length;
    const avant = alertes();
    const sansCle = await api('POST', '/api/scan', tT, { serial_number: f.serial });
    const cleVide = await api('POST', '/api/scan', tT, { serial_number: f.serial, cle_idempotence: '' });
    verifier('sans clé (ou clé vide) : 400 cle_idempotence required, rien crédité, aucune ligne',
      [sansCle.statut, sansCle.corps.error, cleVide.statut, solde(f.id), lignes(f.id)], [400, 'cle_idempotence required', 400, 0, 0]);
    verifier('… une ligne d\'alerte au journal du serveur par refus', await attendre(() => alertes() === avant + 2), true);

    const g = client(M.tampons), h = client(M.tampons);
    const k3 = crypto.randomUUID();
    await scanCle(tT, g.serial, k3);
    const autreCarte = await scanCle(tT, h.serial, k3);
    verifier('même clé pour une AUTRE carte : 409, rien écrit', [autreCarte.statut, autreCarte.corps.error, solde(h.id), lignes(h.id)], [409, 'idempotency_conflict', 0, 0]);
    const n = client(M.points);
    const k4 = crypto.randomUUID();
    await scanCle(tP, n.serial, k4, 30);
    const autreMontant = await scanCle(tP, n.serial, k4, 31);
    verifier('même clé, AUTRE montant (points) : 409, rien de plus', [autreMontant.statut, solde(n.id), lignes(n.id)], [409, 30, 1]);
    const o = client(M.points);
    const ailleurs = await scanCle(tP, o.serial, k3, 20);
    verifier('même clé chez un AUTRE marchand : indépendante, créditée', [ailleurs.statut, ailleurs.corps.deja_enregistre, solde(o.id)], [200, false, 20]);
    // Même clé, deux cartes, en même temps : la base tranche (index unique,
    // erreur 23505 ou refus « autre scan » selon l'arrivée), une seule carte créditée.
    const u = client(M.tampons), v = client(M.tampons);
    const k7 = crypto.randomUUID();
    const croises = await Promise.all(Array.from({ length: 6 }, (_, i) => scanCle(tT, (i % 2 ? u : v).serial, k7)));
    verifier('même clé envoyée en même temps pour DEUX cartes : un seul crédit, l\'autre carte refusée (409)',
      [solde(u.id) + solde(v.id), lignes(u.id) + lignes(v.id), croises.map(r => r.statut).sort().join(','),
       croises.filter(r => r.statut === 409).every(r => r.corps.error === 'idempotency_conflict')],
      [1, 1, '200,200,200,409,409,409', true]);
    // Course provoquée, ordre garanti : une transaction tient la clé (carte w)
    // sans valider ; le scan de la carte x avec la même clé attend sur l'index
    // unique, puis la base refuse (23505) quand la première valide.
    const w = client(M.tampons), x = client(M.tampons);
    const k8 = crypto.randomUUID();
    const tenue = sqlEnFond(`BEGIN;
      INSERT INTO scans (client_id, marchand_id, stored_value_avant, stored_value_apres, cle_idempotence)
        VALUES ('${w.id}', '${M.tampons}', 0, 0, '${k8}');
      SELECT pg_sleep(1.5); COMMIT;`);
    await new Promise(r => setTimeout(r, 400));
    const course = await scanCle(tT, x.serial, k8);
    await tenue;
    verifier('clé prise au même instant pour une autre carte (refus 23505 de la base) : 409, rien écrit',
      [course.statut, course.corps.error, solde(x.id), lignes(x.id)], [409, 'idempotency_conflict', 0, 0]);
    const q = client(M.tampons);
    const malFormee = await scanCle(tT, q.serial, 'pas-une-cle');
    verifier('clé mal formée : 400, rien écrit', [malFormee.statut, solde(q.id), lignes(q.id)], [400, 0, 0]);

    const r = client(M.tampons, { solde: 10 });
    const k5 = crypto.randomUUID();
    const remise1 = await scanCle(tT, r.serial, k5), remise2 = await scanCle(tT, r.serial, k5);
    verifier('renvoi d\'une remise : même réponse (remettez la récompense), pas de seconde remise', [remise2.corps.is_reset, remise2.corps.stored_value_avant, remise2.corps.stored_value_apres, solde(r.id), lignes(r.id)], [true, 10, 0, 0, 1]);
    verifier('… la première réponse était bien la remise', [remise1.corps.is_reset, remise1.corps.deja_enregistre], [true, false]);

    const t = client(M.tampons);
    const k6 = crypto.randomUUID();
    await scanCle(tT, t.serial, k6);
    await annuler(tT, derniereLigne(t.id));
    const apresAnnulation = await scanCle(tT, t.serial, k6);
    verifier('renvoi d\'un scan annulé depuis : 409, jamais recrédité', [apresAnnulation.statut, apresAnnulation.corps.error, solde(t.id)], [409, 'scan_cancelled', 0]);
  }

  // ── 4. Annulation du dernier scan (scanner ET dashboard) ─────────────────
  titre('4. Annulation du dernier scan');
  {
    // Dashboard = jeton marchand (le bouton arrive à l'étape 13 ; la route existe).
    const c = client(M.tampons);
    await scan(tT, c.serial); await scan(tT, c.serial); await scan(tT, c.serial);
    const s3 = derniereLigne(c.id);
    const a = await annuler(tT, s3);
    verifier('jeton marchand (dashboard) : dernier scan annulé, 3 → 2', [a.statut, a.corps.ok, solde(c.id)], [200, true, 2]);
    verifier('… la ligne est marquée annulée, pas supprimée', sql(`SELECT (annule_le IS NOT NULL)::text FROM scans WHERE id = '${s3}'`), 'true');
    const a2 = await annuler(tT, s3);
    verifier('annuler deux fois le même scan : refusé, rien ne bouge', [a2.statut, a2.corps.reason, solde(c.id)], [409, 'deja_annule', 2]);
    const s1 = sql(`SELECT id FROM scans WHERE client_id = '${c.id}' AND stored_value_apres = 1`);
    const a3 = await annuler(tT, s1);
    verifier('scan plus ancien que le dernier actif : refusé', [a3.statut, a3.corps.reason, solde(c.id)], [409, 'pas_le_dernier', 2]);
    const a4 = await annuler(tT, derniereLigne(c.id));
    verifier('répétable : le précédent devient le dernier, annulé à son tour (2 → 1)', [a4.statut, solde(c.id)], [200, 1]);

    const j = client(M.tampons);
    await scan(tT, j.serial); await scan(tT, j.serial);
    await api('PATCH', `/api/clients/${j.id}`, tT, { stored_value: 7 });
    const a5 = await annuler(tT, derniereLigne(j.id));
    // Étape 13b : l'ajustement est un mouvement tracé, plus récent que le scan.
    verifier('après un ajustement : refusé (ce n\'est plus le dernier mouvement), rien ne bouge', [a5.statut, a5.corps.reason, solde(j.id)], [409, 'pas_le_dernier', 7]);

    const k = client(M.tampons);
    await scan(tT, k.serial); await scan(tT, k.serial);
    const sk = derniereLigne(k.id);
    const deux = await Promise.all([annuler(tT, sk), annuler(tT, sk)]);
    verifier('deux annulations simultanées du même scan : une acceptée, une refusée', deux.map(r => r.statut).sort(), [200, 409]);
    verifier('… le solde n\'est restauré qu\'une fois (2 → 1)', solde(k.id), 1);

    // Boutiques d'un réseau (jeton boutique = scanner).
    const r = client(M.reseau);
    await scan(tB1, r.serial);
    const sr = derniereLigne(r.id);
    verifier('jeton boutique : scan d\'une AUTRE boutique refusé', [(await annuler(tB2, sr)).statut, solde(r.id)], [403, 1]);
    verifier('jeton boutique : son propre dernier scan annulé', [(await annuler(tB1, sr)).statut, solde(r.id)], [200, 0]);
    await scan(tB1, r.serial);
    // Voulu depuis l'étape 13a (décision du 29/09) : le gérant annule depuis la
    // fiche client du dashboard le passage de n'importe quelle boutique.
    verifier('jeton marchand sur un réseau (dashboard du gérant) : annule le scan d\'une boutique', [(await annuler(tR, derniereLigne(r.id))).statut, solde(r.id)], [200, 0]);

    // Dernier scan d'un client plus ancien que les 100 derniers scans de la boutique.
    const v = client(M.reseau);
    await scan(tB1, v.serial);
    const sv = derniereLigne(v.id);
    sql(`UPDATE scans SET date_scan = now() - interval '1 hour' WHERE id = '${sv}'`);
    const autre = client(M.reseau);
    sql(`INSERT INTO scans (client_id, marchand_id, stored_value_avant, stored_value_apres, point_de_vente_id)
         SELECT '${autre.id}', '${M.reseau}', 0, 1, '${B.b1}' FROM generate_series(1, 101)`);
    verifier('ÉTAT ACTUEL — dernier scan du client hors des 100 derniers de la boutique : accepté par le serveur',
      [(await annuler(tB1, sv)).statut, solde(v.id)], [200, 0]);

    verifier('fonction SQL annuler_scan, scan inconnu : refus « introuvable »',
      sql(`SELECT annuler_scan('${crypto.randomUUID()}', '${M.tampons}')->>'reason'`), 'introuvable');
  }

  // ── 5. Ajustement (dashboard) ─────────────────────────────────────────────
  titre('5. Ajustement du solde depuis le dashboard');
  const journal = id => sql(`SELECT coalesce(string_agg(stored_value_avant || '→' || stored_value_apres || (CASE WHEN annule_le IS NULL THEN '' ELSE '(annulé)' END), ',' ORDER BY date_ajustement), '')
                             FROM ajustements WHERE client_id = '${id}'`);
  const ajuster = (jt, id, valeur, attendu) => api('PATCH', `/api/clients/${id}`, jt,
    attendu === undefined ? { stored_value: valeur } : { stored_value: valeur, stored_value_attendu: attendu });
  {
    const c = client(M.tampons, { solde: 3 });
    const r = await ajuster(tT, c.id, 7, 3);
    verifier('ajustement vérifié 3 → 7 : accepté', [r.statut, solde(c.id)], [200, 7]);
    verifier('… tracé au journal des ajustements (pas parmi les scans : ce n\'est pas une visite)', [journal(c.id), lignes(c.id)], ['3→7', 0]);
    const p = client(M.points, { solde: 100 });
    verifier('en points, ajustement au-dessus du seuil (900 > 500) : accepté et tracé',
      [(await ajuster(tP, p.id, 900, 100)).statut, solde(p.id), journal(p.id)], [200, 900, '100→900']);
    verifier('valeurs refusées (−1, 1 000 001) : 400',
      [(await ajuster(tP, p.id, -1, 900)).statut, (await ajuster(tP, p.id, 1000001, 900)).statut], [400, 400]);
    const m = client(M.tampons, { solde: 4 });
    verifier('même valeur : rien d\'écrit au journal', [(await ajuster(tT, m.id, 4, 4)).statut, journal(m.id)], [200, '']);

    // Un scan passe entre l'ouverture de la fiche (solde lu : 2) et la validation.
    const s = client(M.tampons, { solde: 2 });
    await scan(tT, s.serial);
    const refus = await ajuster(tT, s.id, 5, 2);
    verifier('un scan vient de passer : ajustement REFUSÉ (409), solde actuel rendu, le scan n\'est pas effacé',
      [refus.statut, refus.corps.error, refus.corps.stored_value, solde(s.id), journal(s.id)], [409, 'solde_change', 3, 3, '']);
    const t = client(M.tampons, { solde: 2 });
    const [ra] = await Promise.all([ajuster(tT, t.id, 5, 2), scan(tT, t.serial)]);
    verifier('ajustement et scan au même instant : jamais de scan effacé (ajusté puis +1 = 6, ou refusé et 3)',
      (ra.statut === 200 && solde(t.id) === 6 && journal(t.id) === '2→5') || (ra.statut === 409 && solde(t.id) === 3 && journal(t.id) === ''), true);
    const u = client(M.tampons, { solde: 2 });
    verifier('TRANSITION — écran d\'avant 13b (sans solde attendu) : ajusté sans vérification, mais tracé',
      [(await ajuster(tT, u.id, 8)).statut, solde(u.id), journal(u.id)], [200, 8, '2→8']);
  }

  // ── 5 bis. Annulation dans l'ordre inverse (étape 13b) ────────────────────
  titre('5 bis. Ajustements et scans : annulation dans l\'ordre inverse');
  {
    const annulerAjustement = (jt, ajId) => api('POST', `/api/clients/ajustements/${ajId}/annuler`, jt);
    const dernierAjustement = id => sql(`SELECT id FROM ajustements WHERE client_id = '${id}' ORDER BY date_ajustement DESC LIMIT 1`);
    // Le cas de Hamza Salon : scan 1→2, ajustement 2→10, remise 10→0.
    const c = client(M.tampons, { solde: 1 });
    await scan(tT, c.serial);
    await ajuster(tT, c.id, 10, 2);
    await scan(tT, c.serial);
    const scanAvant = sql(`SELECT id FROM scans WHERE client_id = '${c.id}' ORDER BY date_scan LIMIT 1`);
    const aj = dernierAjustement(c.id);
    verifier('scan d\'avant l\'ajustement, tant que l\'ajustement est actif : refusé (pas le dernier)',
      [(await annuler(tT, scanAvant)).corps.reason, solde(c.id)], ['pas_le_dernier', 0]);
    verifier('ajustement suivi d\'une remise : refusé tant que la remise est active',
      [(await annulerAjustement(tT, aj)).corps.reason, solde(c.id)], ['pas_le_dernier', 0]);
    verifier('1. annuler la remise : 0 → 10', [(await annuler(tT, derniereLigne(c.id))).statut, solde(c.id)], [200, 10]);
    const ra = await annulerAjustement(tT, aj);
    verifier('2. annuler l\'ajustement : 10 → 2, marqué annulé au journal', [ra.statut, ra.corps.stored_value, solde(c.id), journal(c.id)], [200, 2, 2, '2→10(annulé)']);
    verifier('3. annuler le scan d\'avant : 2 → 1 (la chaîne est de nouveau juste)', [(await annuler(tT, scanAvant)).statut, solde(c.id)], [200, 1]);
    verifier('ajustement déjà annulé : refusé', (await annulerAjustement(tT, aj)).corps.reason, 'deja_annule');

    // Deux ajustements qui reviennent au solde du scan : seul l'ordre inverse
    // protège ici (le contrôle du solde, lui, passerait).
    const f = client(M.tampons, { solde: 4 });
    await scan(tT, f.serial);                              // 4 → 5
    await ajuster(tT, f.id, 8, 5); await ajuster(tT, f.id, 5, 8);
    verifier('scan suivi de deux ajustements revenus au même solde : le scan reste refusé tant qu\'ils sont actifs',
      [(await annuler(tT, derniereLigne(f.id))).corps.reason, solde(f.id), journal(f.id)], ['pas_le_dernier', 5, '5→8,8→5']);

    const d = client(M.tampons, { solde: 4 });
    await ajuster(tT, d.id, 6, 4);
    sql(`UPDATE clients SET stored_value = 9 WHERE id = '${d.id}'`);   // modification hors journal
    verifier('solde modifié hors journal depuis l\'ajustement : refusé (solde incohérent), rien ne bouge',
      [(await annulerAjustement(tT, dernierAjustement(d.id))).corps.reason, solde(d.id)], ['solde_incoherent', 9]);
    const e = client(M.tampons, { solde: 4 });
    await ajuster(tT, e.id, 6, 4);
    verifier('ajustement d\'un AUTRE marchand : introuvable, rien ne bouge',
      [(await annulerAjustement(tP, dernierAjustement(e.id))).corps.reason, solde(e.id)], ['introuvable', 6]);
    verifier('droits : ajuster_solde et annuler_ajustement exécutables par le serveur seul ; table lisible par le serveur', sql(`
      SELECT has_function_privilege('service_role', 'public.ajuster_solde(uuid,uuid,integer,integer)', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.ajuster_solde(uuid,uuid,integer,integer)', 'EXECUTE')
             AND has_function_privilege('service_role', 'public.annuler_ajustement(uuid,uuid)', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.annuler_ajustement(uuid,uuid)', 'EXECUTE')
             AND has_table_privilege('service_role', 'public.ajustements', 'INSERT')`), 't');
  }

  // ── 6. Code de secours (6 derniers caractères du numéro de carte) ────────
  titre('6. Code de secours');
  {
    const u = client(M.tampons, { serial: crypto.randomUUID().slice(0, 30) + '123456' });
    const r = await scan(tT, u.serial.slice(-6));
    verifier('code de secours d\'un seul client : crédité', [r.statut, solde(u.id)], [200, 1]);
    const d1 = client(M.tampons, { serial: crypto.randomUUID().slice(0, 30) + 'abcdef' });
    const d2 = client(M.tampons, { serial: crypto.randomUUID().slice(0, 30) + 'abcdef' });
    const rd = await scan(tT, 'ABCDEF');
    verifier('code partagé par deux clients (majuscules) : 409, deux candidats', [rd.statut, rd.corps.error, (rd.corps.candidates || []).length], [409, 'ambiguous', 2]);
    verifier('… aucun crédit pour l\'un ni l\'autre', [solde(d1.id), solde(d2.id), lignes(d1.id) + lignes(d2.id)], [0, 0, 0]);
    verifier('code inconnu : 404', (await scan(tT, 'fedcba')).statut, 404);
    verifier('format invalide (5 caractères) : 400', (await scan(tT, '12345')).statut, 400);
  }

  // ── 7. Refus avant toute écriture ─────────────────────────────────────────
  titre('7. Refus avant toute écriture');
  {
    const c = client(M.reseau);
    const avant = Number(sql(`SELECT count(*) FROM scans WHERE marchand_id = '${M.reseau}'`));
    const coupee = await scan(jeton(M.reseau, B.coupee), c.serial);
    verifier('boutique coupée : 403 access_disabled', [coupee.statut, coupee.corps.error], [403, 'access_disabled']);
    verifier('boutique archivée : 403', (await scan(jeton(M.reseau, B.archivee), c.serial)).statut, 403);
    const mar = await scan(tR, c.serial);
    verifier('jeton marchand sur un réseau : 403 use_boutique_login', [mar.statut, mar.corps.error], [403, 'use_boutique_login']);
    verifier('… aucun solde ni journal touché', [solde(c.id), Number(sql(`SELECT count(*) FROM scans WHERE marchand_id = '${M.reseau}'`))], [0, avant]);
    const ailleurs = client(M.points);
    verifier('carte d\'un autre marchand : 404, rien écrit', [(await scan(tT, ailleurs.serial)).statut, solde(ailleurs.id)], [404, 0]);
    const s = client(M.suspendu);
    await scan(jeton(M.suspendu), s.serial);
    await api('PATCH', `/api/admin/marchands/${M.suspendu}/suspension`, jetonAdmin, { actif: false });
    const rs = await scan(jeton(M.suspendu), s.serial);
    verifier('marchand suspendu (par l\'admin) : 403, solde inchangé', [rs.statut, rs.corps.error, solde(s.id)], [403, 'account_suspended', 1]);
    await api('PATCH', `/api/admin/marchands/${M.suspendu}/suspension`, jetonAdmin, { actif: true });
    verifier('… réactivé : le scan repasse', (await scan(jeton(M.suspendu), s.serial)).statut, 200);
  }

  // ── 8. Parrainage ─────────────────────────────────────────────────────────
  titre('8. Parrainage');
  {
    // Inscription réelle par la landing (POST /api/clients avec ref = carte du parrain).
    const parrain = client(M.tampons, { solde: 3 });
    const ins = await api('POST', '/api/clients', null, { prenom: 'Filleul', marchand_slug: 'filet-tampons', ref: parrain.serial });
    verifier('inscription du filleul avec le lien du parrain : 201', ins.statut, 201);
    const lie = await attendre(() => sql(`SELECT referred_by_client_id FROM clients WHERE id = '${ins.corps.client_id}'`) === parrain.id);
    verifier('… filleul rattaché au parrain', lie, true);
    await scan(tT, ins.corps.serial_number);
    verifier('premier tampon du filleul : parrain crédité de 1 (3 → 4)', await attendre(() => solde(parrain.id) === 4), true);
    sql(`UPDATE clients SET stored_value = 0 WHERE id = '${ins.corps.client_id}'`);
    await scan(tT, ins.corps.serial_number);
    await new Promise(r => setTimeout(r, 800));
    verifier('filleul revenu à 0 puis rescanné : parrain PAS recrédité (crédit unique à vie)', solde(parrain.id), 4);

    // Crédit du parrain après le premier passage du filleul (route réelle) :
    // le ticket écrit, puis le solde du parrain tel que credit_referral le rend.
    const parrainApres = async (marchand, jt, soldeParrain, points) => {
      const p = client(marchand, { solde: soldeParrain });
      const f = client(marchand, { parrain: p.id });
      await scan(jt, f.serial, points);
      await attendre(() => Number(sql(`SELECT count(*) FROM referral_credits WHERE filleul_client_id = '${f.id}'`)) === 1);
      await new Promise(r => setTimeout(r, 300));
      return solde(p.id);
    };
    // Tampons : plafond au seuil conservé (règle du 27/09).
    verifier('tampons, parrain à 9/10 : crédité jusqu\'au seuil (9 → 10)', await parrainApres(M.tampons, tT, 9), 10);
    verifier('règle du 27/09, inchangée — parrain déjà à 10/10 : reste à 10, le tampon est perdu', await parrainApres(M.tampons, tT, 10), 10);
    verifier('tampons, parrain AU-DESSUS du seuil (12, seuil baissé) : garde 12, jamais ramené à 10 (étape 14b)',
      await parrainApres(M.tampons, tT, 12), 12);
    // Points : parrainage permis (décision 1 de l'étape 14 refusée), bonus entier.
    verifier('mode points avec parrainage : parrain crédité de 5 (100 → 105)', await parrainApres(M.pointsParr, tPP, 100, 20), 105);
    verifier('mode points, parrain juste sous le seuil (498) : bonus ENTIER, 503 (étape 14b)', await parrainApres(M.pointsParr, tPP, 498, 20), 503);
    verifier('mode points, parrain à 530 (au-dessus du seuil) : bonus entier, 535 — plus jamais ramené à 500 (étape 14b)',
      await parrainApres(M.pointsParr, tPP, 530, 20), 535);

    // credit_referral en direct : jamais de baisse, verrou du parrain seul.
    const pn = client(M.pointsParr, { solde: 40 });
    verifier('credit_referral, bonus négatif (−3) : solde inchangé, jamais de baisse',
      [sql(`SELECT stored_value_avant || '→' || stored_value_apres FROM credit_referral('${pn.id}', -3)`), solde(pn.id)], ['40→40', 40]);
    const pv = client(M.tampons, { solde: 2 });
    const verrou = sqlEnFond(`BEGIN; SELECT 1 FROM marchands WHERE id = '${M.tampons}' FOR UPDATE; SELECT pg_sleep(2); COMMIT;`);
    await attendre(() => Number(sql(`SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(2)%'`)) === 1);
    const passe = !refuseParLaBase(`SET lock_timeout = '300ms'; SELECT * FROM credit_referral('${pv.id}', 1);`);
    await verrou;
    verifier('credit_referral ne verrouille que le parrain : passe pendant qu\'une autre session tient la ligne du marchand (2 → 3)',
      [passe, solde(pv.id)], [true, 3]);
  }

  // ── 9. Coupures et journal ────────────────────────────────────────────────
  titre('9. Coupures : tout ou rien');
  {
    // Panne simulée au milieu de la transaction, APRÈS le crédit : un
    // déclencheur fait échouer l'écriture de la ligne (puis de la carte).
    const c = client(M.tampons);
    sql(`CREATE FUNCTION filet_panne() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'panne simulée'; END $$;
         CREATE TRIGGER filet_panne_ligne BEFORE INSERT ON scans FOR EACH ROW
           WHEN (NEW.client_id = '${c.id}') EXECUTE FUNCTION filet_panne();`);
    const panne = await scan(tT, c.serial);
    verifier('panne à l\'écriture de la ligne : erreur, solde INCHANGÉ, aucune ligne (étape 11 : tout ou rien)', [panne.statut, solde(c.id), lignes(c.id)], [503, 0, 0]);   // 503 depuis t37 (erreur de base), 500 avant
    sql(`DROP TRIGGER filet_panne_ligne ON scans;
         CREATE TRIGGER filet_panne_carte BEFORE UPDATE ON passes FOR EACH ROW
           WHEN (NEW.serial_number = '${c.serial}') EXECUTE FUNCTION filet_panne();`);
    const panne2 = await scan(tT, c.serial);
    verifier('panne à l\'écriture de la carte : erreur, solde INCHANGÉ, aucune ligne', [panne2.statut, solde(c.id), lignes(c.id)], [503, 0, 0]);
    sql(`DROP TRIGGER filet_panne_carte ON passes; DROP FUNCTION filet_panne();`);
    const reprise = await scan(tT, c.serial);
    verifier('… le scan suivant est juste : 0 → 1, une ligne', [reprise.statut, solde(c.id), lignes(c.id)], [200, 1, 1]);
    const a = await annuler(tT, derniereLigne(c.id));
    verifier('… et son dernier scan reste annulable', [a.statut, solde(c.id)], [200, 0]);

    // Historique ANCIEN (écrit avant l'étape 11) : deux lignes dont l'ordre des
    // dates contredit la chaîne des soldes. L'annulation refuse, sans rien toucher.
    const d = client(M.tampons, { solde: 2 });
    const l1 = crypto.randomUUID(), l2 = crypto.randomUUID();
    sql(`INSERT INTO scans (id, client_id, marchand_id, stored_value_avant, stored_value_apres, date_scan) VALUES
         ('${l1}', '${d.id}', '${M.tampons}', 0, 1, now()),
         ('${l2}', '${d.id}', '${M.tampons}', 1, 2, now() - interval '1 second')`);
    const r1 = await annuler(tT, l1), r2 = await annuler(tT, l2);
    verifier('historique ancien dans le désordre : aucune des deux lignes ne s\'annule, rien ne bouge', [r1.corps.reason, r2.corps.reason, solde(d.id)], ['solde_incoherent', 'pas_le_dernier', 2]);
  }

  // ── 10. Garde-fous en base (étape 11) ─────────────────────────────────────
  titre('10. Garde-fous en base');
  {
    const c = client(M.tampons, { solde: 3 });
    verifier('un solde négatif est refusé par la base', [refuseParLaBase(`UPDATE clients SET stored_value = -1 WHERE id = '${c.id}'`), solde(c.id)], [true, 3]);
    verifier('un seuil à 0 est refusé par la base', [refuseParLaBase(`UPDATE marchands SET max_value = 0 WHERE id = '${M.tampons}'`), Number(sql(`SELECT max_value FROM marchands WHERE id = '${M.tampons}'`))], [true, 10]);
    const adm = await api('PATCH', `/api/admin/marchands/${M.tampons}`, jetonAdmin, { max_value: -5 });
    verifier('seuil négatif saisi dans l\'admin : refusé, seuil inchangé', [adm.statut >= 400, Number(sql(`SELECT max_value FROM marchands WHERE id = '${M.tampons}'`))], [true, 10]);
    // t17 (19/10) : quota manuel de notifications, entier de 0 à 1 000, null = forfait.
    const quota = async v => (await api('PATCH', `/api/admin/marchands/${M.tampons}`, jetonAdmin, { notification_quota_override: v })).statut;
    const quotaBase = () => sql(`SELECT coalesce(notification_quota_override::text, 'null') FROM marchands WHERE id = '${M.tampons}'`);
    const acceptes = [];
    for (const v of [7, 0, 1000, null]) acceptes.push([await quota(v), quotaBase()]);
    verifier('quota manuel : 7, 0, 1 000 et null (forfait) acceptés et écrits',
      acceptes, [[200, '7'], [200, '0'], [200, '1000'], [200, 'null']]);
    await quota(12);
    const refuses = [];
    for (const v of [-1, 1001, 2.5, 'abc', '5', true]) refuses.push(await quota(v));
    verifier('quota manuel : -1, 1 001, 2,5, « abc », « 5 », true → 400, valeur en base inchangée',
      [refuses, quotaBase()], [[400, 400, 400, 400, 400, 400], '12']);
    await quota(null);
    verifier('fonction crediter_scan, carte d\'un autre marchand : refus « client_introuvable », rien écrit',
      [sql(`SELECT crediter_scan('${c.id}', '${M.points}', NULL, 500, 10, 'points', NULL, 'r', 'g', 'p') ->> 'reason'`), solde(c.id), lignes(c.id)], ['client_introuvable', 3, 0]);
  }

  // ── 11. Renouvellement de session (étape 12a) ─────────────────────────────
  titre('11. Renouvellement silencieux de la session');
  {
    const maintenant = Math.floor(Date.now() / 1000);
    const longue = (claims, resteJours) => jwt.sign({ ...claims, iat: maintenant - (365 - resteJours) * 86400,
      exp: maintenant + resteJours * 86400 }, secretJwt);
    const boutique = { role: 'scanner', marchand_id: M.reseau, point_de_vente_id: B.b1, nom: 'Boutique 1', tv: 1 };
    const r = await api('POST', '/api/scanner/renouveler', longue(boutique, 30));
    const neuf = r.corps && r.corps.token ? jwt.verify(r.corps.token, secretJwt) : {};
    const { iat: _i, exp: _e, ...champs } = neuf;
    verifier('session longue à 30 jours de l\'échéance : renouvelée pour un an, mêmes champs',
      [r.statut, champs, Math.round((neuf.exp - maintenant) / 86400)], [200, boutique, 365]);
    verifier('… le jeton neuf scanne', (await scan(r.corps.token, client(M.reseau).serial)).statut, 200);
    const marchand = { role: 'marchand', marchand_id: M.tampons, nom: 'Filet Tampons', tv: 1 };
    const rm = await api('POST', '/api/scanner/renouveler', longue(marchand, 10));
    verifier('session marchand (dashboard) : renouvelée aussi', [rm.statut, jwt.decode(rm.corps.token || '')?.role], [200, 'marchand']);
    const courte = jwt.sign(marchand, secretJwt, { expiresIn: '7d' });
    verifier('session courte (7 jours, « ne pas se souvenir ») : jamais prolongée',
      [(await api('POST', '/api/scanner/renouveler', courte)).corps.error], ['session_courte']);
    verifier('session révoquée par l\'admin : refusée (403)',
      (await api('POST', '/api/scanner/renouveler', longue({ ...marchand, tv: 0 }, 30))).statut, 403);
    const expiree = jwt.sign({ ...marchand, iat: maintenant - 366 * 86400, exp: maintenant - 60 }, secretJwt);
    verifier('session déjà expirée : refusée (401), il faut se reconnecter',
      (await api('POST', '/api/scanner/renouveler', expiree)).statut, 401);
  }

  // ── 12. Arrêt propre au redéploiement (étape 14a) ─────────────────────────
  titre('12. Arrêt propre au redéploiement (étape 14a)');
  {
    // Un SECOND serveur, coupé par SIGTERM (le signal de Railway) pendant qu'il
    // travaille. D'autres sessions tiennent la carte de `c` 1,5 s (son scan
    // attend dans crediter_scan) et la table des tickets de parrainage 4 s (le
    // crédit du parrain, lancé APRÈS la réponse au scan du filleul, attend avant
    // son ticket) : une fois le scan de `c` fini, seul ce crédit retient le
    // serveur. Avant 14a, le serveur mourait net : réponse perdue, ticket écrit
    // et crédit jamais fait.
    const s = await demarrerServeur('serveur-arret');
    const appel = (jt, corps) => fetch(s.url + '/api/scan', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jt}` }, body: JSON.stringify({ cle_idempotence: crypto.randomUUID(), ...corps }) })
      .then(async r => ({ statut: r.status, corps: await r.json().catch(() => null) }),
            e => ({ statut: `coupé (${(e.cause && e.cause.code) || e.message})`, corps: null }));
    const nouvelleConnexion = () => new Promise(r => {
      const k = require('net').connect(Number(new URL(s.url).port), '127.0.0.1');
      k.on('connect', () => { k.destroy(); r('acceptée'); });
      k.on('error', e => r(e.code));
    });
    const c = client(M.tampons, { solde: 2 });
    const parrain = client(M.tampons, { solde: 3 });
    const filleul = client(M.tampons, { parrain: parrain.id });
    const verrous = Promise.all([
      sqlEnFond(`BEGIN; SELECT 1 FROM clients WHERE id = '${c.id}' FOR UPDATE; SELECT pg_sleep(1.5); COMMIT;`),
      sqlEnFond('BEGIN; LOCK TABLE referral_credits IN SHARE MODE; SELECT pg_sleep(4); COMMIT;'),
    ]);
    await attendre(() => Number(sql(`SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(%'`)) === 2);
    const rf = await appel(tT, { serial_number: filleul.serial });
    const enCours = appel(tT, { serial_number: c.serial });
    // Le signal part quand les DEUX attendent en base : le ticket du parrain et
    // le scan de c (pas de délai à l'aveugle).
    await attendre(() => Number(sql(`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'`)) === 2);
    const t0 = Date.now();
    s.processus.kill('SIGTERM');
    await attendre(() => s.journal().includes('[arret] SIGTERM reçu'), 2000);
    const nouvelle = await nouvelleConnexion();
    const r = await enCours;
    const fin = await s.sortie;
    const duree = Date.now() - t0;
    await verrous.catch(() => {});
    const j = s.journal();
    verifier('scan du filleul avant le signal : 200 (le crédit de son parrain part après la réponse)', rf.statut, 200);
    verifier('SIGTERM pendant un scan : le scan aboutit (200, 2 → 3, une ligne)',
      [r.statut, r.corps && r.corps.stored_value_apres, solde(c.id), lignes(c.id)], [200, 3, 3, 1]);
    verifier('… le crédit du parrain, lancé après la réponse, aboutit (3 → 4)', solde(parrain.id), 4);
    verifier('… pendant l\'arrêt, une nouvelle connexion est refusée', nouvelle, 'ECONNREFUSED');
    verifier('… puis le serveur s\'arrête seul, code 0, avant la limite de 20 s', [fin.code, fin.signal, duree < 20000], [0, null, true]);
    verifier('… journal : signal reçu, cron arrêté sans erreur, bilan avec les demandes d\'avis perdues',
      [j.includes('[arret] SIGTERM reçu'), j.includes('[arret] avant fermeture'),
       /\[arret\] fini en \d+ ms : \d+ tâche\(s\) attendue\(s\), demande\(s\) d'avis perdue\(s\) : 0/.test(j)], [true, false, true]);

    // Le module seul, avec un faux serveur : ordre, limite, second signal.
    const neuf = () => { delete require.cache[require.resolve('../src/services/arret')]; return require('../src/services/arret'); };
    const fauxServeur = () => ({ close(cb) { setTimeout(cb, 30); }, closeIdleConnections() {} });
    const fauxJournal = () => { const lignes = []; return { lignes, log: m => lignes.push(m), error: m => lignes.push(m) }; };
    {
      const a = neuf(), jf = fauxJournal();
      let cron = 0, code = null;
      const t1 = Date.now();
      a.suivre(new Promise(ok => setTimeout(ok, 300)));
      const arret = a.arreter(fauxServeur(), 'SIGTERM', { avantFermeture: () => cron++, bilan: () => ({ avis: 2 }),
        journal: jf, sortir: x => { code = x; } });
      await a.arreter(fauxServeur(), 'SIGTERM', { avantFermeture: () => cron++, journal: jf, sortir: () => { code = 'second'; } });
      a.suivre(new Promise(ok => setTimeout(ok, 600)));   // lancé PENDANT l'arrêt : attendu aussi
      await arret;
      verifier('module d\'arrêt : cron arrêté une fois, deux envois attendus (dont un lancé pendant l\'arrêt), sortie 0, second signal sans effet',
        [cron, code, Date.now() - t1 >= 600, jf.lignes.some(l => /^\[arret\] fini en \d+ ms : 2 tâche\(s\) attendue\(s\), avis : 2$/.test(l))],
        [1, 0, true, true]);
    }
    {
      const a = neuf(), jf = fauxJournal();
      let code = null;
      const t1 = Date.now();
      a.suivre(new Promise(() => {}));   // ne finit jamais
      await a.arreter(fauxServeur(), 'SIGTERM', { limiteMs: 300, journal: jf, sortir: x => { code = x; } });
      verifier('module d\'arrêt : un envoi qui ne finit jamais ne retient pas le serveur au-delà de la limite',
        [code, Date.now() - t1 < 1500, jf.lignes.includes('[arret] limite de 0.3 s atteinte : 1 tâche(s) non terminée(s) sur 1')], [0, true, true]);
    }
    {
      const a = neuf(), jf = fauxJournal();
      let code = null;
      await a.arreter(fauxServeur(), 'SIGTERM', { avantFermeture: () => { throw new Error('cron absent'); },
        journal: jf, sortir: x => { code = x; } });
      verifier('module d\'arrêt : un échec à l\'arrêt du cron n\'empêche pas l\'arrêt', [code, jf.lignes.some(l => l.startsWith('[arret] fini'))], [0, true]);
    }
    delete require.cache[require.resolve('../src/services/arret')];
  }

  // ── 13. Adresse du client : trust proxy 2 et sa garde (étape 17a) ─────────
  titre('13. Adresse du client : trust proxy 2 et sa garde (étape 17a)');
  {
    // La garde seule : horloge simulée, journal simulé.
    const { gardeAdresse } = require('../src/middleware/gardeAdresse');
    const lignes = []; let t = 1000000;
    const g = gardeAdresse({ journal: { warn: m => lignes.push(m) }, maintenant: () => t });
    const passer = (xff, chemin = '/api/x') => { let suite = 0; g({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, method: 'GET', path: chemin }, {}, () => { suite++; }); return suite; };
    verifier('garde : 2 adresses → aucune alerte, la requête passe (synchrone)', [passer('1.1.1.1, 2.2.2.2'), lignes.length], [1, 0]);
    verifier('garde : le contrôle de santé de Railway (/health/db, sans en-tête) → aucune alerte', [passer(undefined, '/health/db'), lignes.length], [1, 0]);
    let passees = 0;
    for (let i = 0; i < 1000; i++) passees += passer(i % 2 ? '1.1.1.1' : '1.1.1.1, 2.2.2.2, 3.3.3.3');
    verifier('garde : 1 000 requêtes à 1 ou 3 adresses → UNE alerte, aucune requête bloquée', [lignes.length, passees], [1, 1000]);
    verifier('garde : l\'alerte ne contient aucune adresse', /\d+\.\d+\.\d+\.\d+/.test(lignes[0]), false);
    t += 59 * 60 * 1000; passer('1.1.1.1');
    verifier('garde : 59 min plus tard, toujours une seule alerte', lignes.length, 1);
    t += 2 * 60 * 1000; passer('1.1.1.1');
    verifier('garde : plus d\'une heure après, une deuxième alerte', lignes.length, 2);
    verifier('garde : le module n\'appelle ni la base ni le réseau (aucun require, aucun await)',
      /require\(|await |fetch\(|supabase/.test(require('fs').readFileSync(require.resolve('../src/middleware/gardeAdresse'), 'utf8').replace(/\/\/.*$/gm, '')), false);

    // Le vrai serveur : ici le test joue l'entrée de Railway (« client, relais »).
    const s13 = await demarrerServeur('adresse');
    const post = (chemin, h) => fetch(s13.url + chemin, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ email: 'x@example.com', password: 'faux' }) }).then(r => r.status);
    const alertes = () => (s13.journal().match(/\[adresse\] ALERTE/g) || []).length;
    const RELAIS = '198.51.100.1';
    await fetch(s13.url + '/health/db');
    verifier('serveur : /health/db sans en-tête → aucune alerte', alertes(), 0);
    const A = { 'X-Forwarded-For': `203.0.113.5, ${RELAIS}` }, B = { 'X-Forwarded-For': `203.0.113.6, ${RELAIS}` };
    const rA = []; for (let i = 0; i < 11; i++) rA.push(await post('/api/merchants/login', A));
    verifier('serveur : le compteur est celui du CLIENT (10 par heure : la 11e est refusée, 429)', [rA.slice(0, 10).includes(429), rA[10]], [false, 429]);
    verifier('… un AUTRE client derrière le MÊME relais n\'est pas refusé (avec trust proxy 1, il l\'aurait été)', await post('/api/merchants/login', B) === 429, false);
    // Forgé : X-Real-IP et Forwarded ne sont jamais lus ; en changer ne donne pas un nouveau compteur.
    const rF = []; for (let i = 0; i < 11; i++) rF.push(await post('/api/admin/login', { 'X-Forwarded-For': `203.0.113.20, ${RELAIS}`,
      'X-Real-IP': `192.0.2.${100 + i}`, Forwarded: `for=192.0.2.${150 + i}` }));
    verifier('serveur : X-Real-IP et Forwarded forgés, différents à chaque requête → ignorés (la 11e est refusée)', [rF.slice(0, 10).includes(429), rF[10]], [false, 429]);
    verifier('serveur : 22 requêtes à 2 adresses → toujours aucune alerte', alertes(), 0);
    // Chaîne à 1 ou 3 adresses : alerte, une seule, et la requête passe.
    const r1 = await post('/api/scanner/login', { 'X-Forwarded-For': '192.0.2.77' });
    const r3 = await post('/api/scanner/login', { 'X-Forwarded-For': `192.0.2.77, 203.0.113.9, ${RELAIS}` });
    const r0 = await post('/api/scanner/login', {});
    verifier('serveur : chaînes à 1, 3 et 0 adresse → requêtes servies, UNE alerte (au plus 1 par heure)', [[r1, r3, r0].includes(429), alertes()], [false, 1]);
    verifier('serveur : l\'alerte du journal ne contient aucune adresse', /ALERTE[^\n]*\d+\.\d+\.\d+\.\d+/.test(s13.journal()), false);
    // Inscriptions : 60 par heure et par adresse (20 avant, décision du 07/10). Un corps vide est
    // refusé (400) par la route, mais compté par le limiteur, qui passe avant elle.
    const ins = h => post('/api/clients', h);
    const C = { 'X-Forwarded-For': `203.0.113.30, ${RELAIS}` }, D = { 'X-Forwarded-For': `203.0.113.31, ${RELAIS}` };
    const rI = []; for (let i = 0; i < 61; i++) rI.push(await ins(C));
    verifier('serveur : inscriptions, 60 par heure et par adresse (la 21e passe, la 61e est refusée, 429)',
      [rI[20] === 429, rI.slice(0, 60).includes(429), rI[60]], [false, false, 429]);
    verifier('… un autre client derrière le même relais s\'inscrit encore', await ins(D) === 429, false);
    s13.processus.kill();
  }

  // ── 14. Base lente : délai par appel (étape 16) ───────────────────────────
  titre('14. Base lente : délai par appel (étape 16)');
  {
    // Un relais devant PostgREST, réglé par le test : retient ou casse les
    // requêtes dont le chemin correspond, et les compte. Un second serveur
    // passe par lui ; les autres scénarios n'en voient rien.
    const http = require('http');
    const amont = new URL(urlSupabase);
    const regle = { motif: null, delaiMs: 0, panne: false, vues: 0 };
    const relais = http.createServer((req, res) => {
      const vise = regle.motif && regle.motif.test(req.url);
      if (vise) regle.vues++;
      if (vise && regle.panne) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"message":"panne simulée"}'); }
      const envoyer = () => {
        if (req.destroyed || res.destroyed || res.writableEnded) return;   // l'appelant a coupé : rien ne part
        const p = http.request({ host: amont.hostname, port: amont.port, path: req.url, method: req.method,
          headers: { ...req.headers, host: amont.host } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
        p.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } });
        req.pipe(p);
      };
      if (vise && regle.delaiMs > 0) { req.pause(); setTimeout(() => { req.resume(); envoyer(); }, regle.delaiMs); } else envoyer();
    });
    await new Promise(r => relais.listen(0, '127.0.0.1', r));
    const s14 = await demarrerServeur('base-lente', `http://127.0.0.1:${relais.address().port}`);
    const appel = async (methode, chemin, jt, corps) => {
      const t0 = Date.now();
      const r = await fetch(s14.url + chemin, { method: methode,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jt}` }, body: corps && JSON.stringify(corps) });
      const t = await r.text(); let c; try { c = JSON.parse(t); } catch { c = t; }
      return { statut: r.status, corps: c, ms: Date.now() - t0 };
    };
    const regler = (motif, delaiMs, panne = false) => Object.assign(regle, { motif, delaiMs, panne, vues: 0 });
    const scan14 = (jt, serial, corps = {}) => appel('POST', '/api/scan', jt, { serial_number: serial, cle_idempotence: crypto.randomUUID(), ...corps });
    const dans = (ms, min, max) => ms >= min && ms <= max;

    // Préchauffe : le cache marchand (auth) est rempli, la lecture lente vise le scan seul.
    const c = client(M.reseau);
    verifier('relais sans délai : le scan boutique passe (200)', (await scan14(tB1, c.serial)).statut, 200);

    regler(/^\/rest\/v1\/points_de_vente/, 8000);
    const lent = await scan14(tB1, c.serial);
    verifier('lecture de la boutique bloquée 8 s : 503 database_unavailable vers 5 s (avant : 403 access_disabled, ou 4 essais et 11 s et plus)',
      [lent.statut, lent.corps.error, dans(lent.ms, 4800, 6500)], [503, 'database_unavailable', true]);
    verifier('… UNE seule requête partie vers la base (aucun nouvel essai de postgrest-js)', regle.vues, 1);
    verifier('… rien de crédité', solde(c.id), 1);

    regler(/^\/rest\/v1\/points_de_vente/, 0, true);
    const m = await scan14(tT, client(M.tampons).serial);
    verifier('base en panne au contrôle du réseau (jeton marchand) : 503 (avant : traité comme mono-site, scan ouvert)',
      [m.statut, m.corps.error], [503, 'database_unavailable']);

    const t = client(M.tampons);
    regler(/^\/rest\/v1\/clients/, 0, true);
    const u = await scan14(tT, t.serial);
    const sec = await scan14(tT, t.serial.slice(-6));
    verifier('base en panne à la lecture du client : 503 par UUID et par code de secours (avant : 404 « carte inconnue »)',
      [u.statut, u.corps.error, sec.statut, sec.corps.error], [503, 'database_unavailable', 503, 'database_unavailable']);
    regler(null, 0);
    let absent;
    do { absent = crypto.randomBytes(3).toString('hex'); }
    while (Number(sql(`SELECT count(*) FROM clients WHERE marchand_id = '${M.tampons}' AND pass_serial_number LIKE '%${absent}'`)));
    verifier('base saine, carte inconnue : toujours 404 (UUID et code de secours)',
      [(await scan14(tT, crypto.randomUUID())).statut, (await scan14(tT, absent)).statut], [404, 404]);
    const j = s14.journal();
    verifier('journal : chaque lecture impossible est écrite (boutique, réseau, client, code de secours)',
      ['boutique', 'réseau', 'client', 'code de secours'].map(e => j.includes(`[scan] lecture ${e} impossible`)), [true, true, true, true]);

    // Authentification de la caisse, cache marchand vide (M.points, M.pointsParr :
    // jamais vus par ce serveur) : lecture du marchand coupée ou en panne.
    regler(/^\/rest\/v1\/marchands/, 8000);
    const pc = client(M.points);
    const auLent = await scan14(tP, pc.serial, { points: 10 });
    verifier('auth caisse, lecture du marchand bloquée 8 s : 503 database_unavailable vers 5 s, une requête, rien crédité (avant : laissait passer)',
      [auLent.statut, auLent.corps.error, dans(auLent.ms, 4800, 6500), regle.vues, solde(pc.id)], [503, 'database_unavailable', true, 1, 0]);
    regler(/^\/rest\/v1\/marchands/, 0, true);
    const ppc = client(M.pointsParr);
    const auPanne = await scan14(tPP, ppc.serial, { points: 10 });
    verifier('auth caisse, lecture du marchand en panne : 503 database_unavailable, rien crédité',
      [auPanne.statut, auPanne.corps.error, solde(ppc.id)], [503, 'database_unavailable', 0]);
    regler(null, 0);
    verifier('… base revenue : le scan repasse (200)', (await scan14(tPP, ppc.serial, { points: 10 })).statut, 200);

    regler(/^\/rest\/v1\/rpc\/crediter_scan/, 8000);
    const k = client(M.tampons);
    const ecr = await scan14(tT, k.serial);
    verifier('écriture (crediter_scan) bloquée 8 s : coupée vers 5 s, une requête, réponse 5xx, rien crédité',
      [ecr.statut >= 500, dans(ecr.ms, 4800, 6500), regle.vues, solde(k.id)], [true, true, 1, 0]);

    // Client long (30 s) : une statistique admin de 6 s aboutit.
    regler(/^\/rest\/v1\/rpc\/admin_marchands_stats/, 6000);
    const adm = await appel('GET', '/api/admin/marchands', jetonAdmin);
    verifier('client long : admin_marchands_stats retenue 6 s → 200, compteurs présents (le client de 5 s l\'aurait coupée)',
      [adm.statut, adm.ms >= 6000, Array.isArray(adm.corps) && adm.corps.length > 0 && adm.corps.every(x => x.total_clients !== null)],
      [200, true, true]);

    // Connexion caisse sur base coupée (étape 17) : 503, jamais 401, et un 5xx
    // n'use pas le compteur des échecs (20 par heure et par adresse).
    let t1;
    const { hashPassword } = require('../src/services/auth-utils');
    sql(`UPDATE points_de_vente SET scanner_password_hash = '${hashPassword('filet-mdp-b2')}' WHERE id = '${B.b2}'`);
    const connexion = (ident, password, xff) => fetch(s14.url + '/api/scanner/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `${xff}, 198.51.100.1` },
      body: JSON.stringify({ identifiant: ident, password }) })
      .then(async r => ({ statut: r.status, corps: await r.json().catch(() => null) }));
    regler(/^\/rest\/v1\/points_de_vente/, 8000);
    t1 = Date.now();
    const cLente = await connexion('filet-b2', 'filet-mdp-b2', '203.0.113.60');
    verifier('connexion caisse, lecture de la boutique bloquée 8 s : 503 database_unavailable vers 5 s (avant : 401 « Invalid credentials »)',
      [cLente.statut, cLente.corps && cLente.corps.error, dans(Date.now() - t1, 4800, 6500)], [503, 'database_unavailable', true]);
    regler(/^\/rest\/v1\/points_de_vente/, 0, true);
    const enPanne = [];
    for (let i = 0; i < 25; i++) enPanne.push((await connexion('filet-b2', 'filet-mdp-b2', '203.0.113.60')).statut);
    verifier('… base en panne, 25 connexions de la même adresse : toutes 503, aucune 429 (un 5xx n\'est pas un échec)',
      [enPanne.every(x => x === 503), enPanne.includes(429)], [true, false]);
    regler(/^\/rest\/v1\/marchands/, 0, true);
    const cMarchand = await connexion('filet-tampons', 'peu-importe', '203.0.113.61');
    verifier('connexion caisse mono-site, lecture du marchand en panne : 503 (avant : 401)', [cMarchand.statut, cMarchand.corps && cMarchand.corps.error], [503, 'database_unavailable']);
    regler(null, 0);
    const cRetour = await connexion('filet-b2', 'filet-mdp-b2', '203.0.113.60');
    verifier('… base revenue : la bonne connexion passe depuis la même adresse (200, jeton rendu)', [cRetour.statut, typeof (cRetour.corps && cRetour.corps.token)], [200, 'string']);
    // Connexion marchand (dashboard) sur base coupée : 503, non comptée ; les
    // réussites et les 4xx restent comptées (10 par heure).
    sql(`UPDATE marchands SET password_hash = '${hashPassword('filet-mdp-marchand')}' WHERE id = '${M.tampons}'`);
    const cxM = (password, xff = '203.0.113.62', slug = 'filet-tampons') => fetch(s14.url + '/api/merchants/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `${xff}, 198.51.100.1` },
      body: JSON.stringify({ slug, password }) })
      .then(async r => ({ statut: r.status, corps: await r.json().catch(() => null) }));
    regler(/^\/rest\/v1\/marchands/, 8000);
    t1 = Date.now();
    const mLente = await cxM('filet-mdp-marchand');
    verifier('connexion marchand, lecture bloquée 8 s : 503 database_unavailable vers 5 s (avant : 401 « Invalid credentials »)',
      [mLente.statut, mLente.corps && mLente.corps.error, dans(Date.now() - t1, 4800, 6500)], [503, 'database_unavailable', true]);
    regler(/^\/rest\/v1\/marchands/, 0, true);
    const mPanne = [];
    for (let i = 0; i < 12; i++) mPanne.push((await cxM('filet-mdp-marchand')).statut);
    verifier('… base en panne, 12 connexions de la même adresse : toutes 503, aucune 429 (un 5xx n\'est pas compté)',
      [mPanne.every(x => x === 503), mPanne.includes(429)], [true, false]);
    regler(null, 0);
    const mRetour = await cxM('filet-mdp-marchand');
    verifier('… base revenue : la bonne connexion passe depuis la même adresse (200, jeton rendu)', [mRetour.statut, typeof (mRetour.corps && mRetour.corps.token)], [200, 'string']);
    const mFaux = [];
    for (let i = 0; i < 9; i++) mFaux.push((await cxM('faux')).statut);
    verifier('… réussites et 4xx toujours comptées : 1 réussite + 9 échecs (401) passent, la 11e tentative reçoit 429',
      [mFaux.every(x => x === 401), (await cxM('filet-mdp-marchand')).statut], [true, 429]);
    verifier('base saine, marchand inconnu : toujours 401 (pas 503)', (await cxM('x', '203.0.113.63', 'filet-inconnu')).statut, 401);
    verifier('journal : lecture impossible de la connexion marchand écrite', s14.journal().includes('[merchants] connexion, lecture impossible'), true);
    verifier('journal : lectures impossibles de la connexion écrites (boutique, marchand)',
      ['boutique', 'marchand'].map(e => s14.journal().includes(`[scanner-auth] lecture ${e} impossible`)), [true, true]);

    // Registre des envois : un lot du cron ou d'une campagne passe par le client
    // long ; un push unique (scan) garde 5 s. Modules chargés ici, dans le
    // processus du test, branchés sur le relais.
    const env = { url: process.env.SUPABASE_URL, cle: process.env.SUPABASE_SERVICE_KEY };
    const modules = ['../src/services/supabase', '../src/services/notif-registre'].map(x => require.resolve(x));
    modules.forEach(x => delete require.cache[x]);
    process.env.SUPABASE_URL = `http://127.0.0.1:${relais.address().port}`;
    process.env.SUPABASE_SERVICE_KEY = cleService;
    const registre = require('../src/services/notif-registre');
    const ecrits = lot => Number(sql(`SELECT count(*) FROM notification_envois WHERE lot = '${lot.id}'`));
    const remplir = lot => { for (let i = 0; i < 3; i++) lot.ajouter({ plateforme: 'apple', pushToken: `jeton-${i}` }); return lot; };
    regler(/^\/rest\/v1\/notification_envois/, 6000);
    const erreurs = []; const consoleError = console.error; console.error = (...a) => erreurs.push(a.join(' '));
    const lotLong = remplir(registre.creerLot('manuel', M.tampons, { long: true }));
    const lotCourt = remplir(registre.creerLot('scan', M.tampons));
    t1 = Date.now(); await lotLong.ecrire(); const msLong = Date.now() - t1;
    t1 = Date.now(); await lotCourt.ecrire(); const msCourt = Date.now() - t1;
    console.error = consoleError;
    verifier('registre, lot de campagne ou du cron ({ long: true }) retenu 6 s : écrit (3 lignes), client long',
      [ecrits(lotLong), msLong >= 6000], [3, true]);
    verifier('registre, lot d\'un scan retenu 6 s : coupé vers 5 s, rien écrit, erreur journalisée, sans rejet',
      [ecrits(lotCourt), dans(msCourt, 4800, 6500), erreurs.some(e => e.startsWith('[notif-registre] insert'))], [0, true, true]);
    verifier('registre : le cron (lots par marchand) et la campagne manuelle demandent le client long',
      [(require('fs').readFileSync(require.resolve('../src/workers/cron.js'), 'utf8').match(/creerLot\([^)]*\{ long: true \}\)/g) || []).length > 0,
       /creerLot\('manuel', c\.marchand_id, \{ long: true \}\)/.test((() => { try { return require('fs').readFileSync(require.resolve('../src/services/campagnes.js'), 'utf8'); } catch { return ''; } })())],
      [true, true]);
    modules.forEach(x => delete require.cache[x]);
    process.env.SUPABASE_URL = env.url; process.env.SUPABASE_SERVICE_KEY = env.cle;
    if (env.url === undefined) delete process.env.SUPABASE_URL;
    if (env.cle === undefined) delete process.env.SUPABASE_SERVICE_KEY;

    regler(null, 0);
    s14.processus.kill();
    relais.close();
  }

  // ── 15. Coupure pendant que la base écrit encore (étape 16) ────────────────
  titre('15. Coupure pendant que la base écrit encore (étape 16)');
  {
    // La carte est tenue 7 s par une autre session : crediter_scan attend le
    // verrou, le serveur coupe à 5 s. Que fait PostgREST de la transaction ?
    const c = client(M.tampons, { solde: 2 });
    const cle = crypto.randomUUID();
    const verrou = sqlEnFond(`BEGIN; SELECT 1 FROM clients WHERE id = '${c.id}' FOR UPDATE; SELECT pg_sleep(7); COMMIT;`);
    await attendre(() => Number(sql(`SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(%'`)) === 1);
    const t0 = Date.now();
    const r = await scanCle(tT, c.serial, cle);
    const ms = Date.now() - t0;
    await verrou;
    await new Promise(ok => setTimeout(ok, 500));
    verifier('verrou de 7 s : le serveur coupe vers 5 s et répond 5xx', [r.statut >= 500, ms >= 4800 && ms <= 6500], [true, true]);
    const apres = [solde(c.id), lignes(c.id)];
    console.log(`    (mesure : après la coupure, solde ${apres[0]}, ${apres[1]} ligne(s) : PostgREST ${apres[1] ? 'a fini' : 'a annulé'} la transaction)`);
    const renvoi = await scanCle(tT, c.serial, cle);
    verifier('renvoi même clé après la coupure : 200, crédité UNE fois en tout (2 → 3, une ligne)',
      [renvoi.statut, solde(c.id), lignes(c.id)], [200, 3, 1]);
  }
  // ── 16. Limiteurs (étape 17) ──────────────────────────────────────────────
  titre('16. Limiteurs (étape 17)');
  {
    // Serveur neuf : compteurs à zéro. Le test joue l'entrée de Railway (« client, relais »).
    const s16 = await demarrerServeur('limiteurs');
    const RELAIS = '198.51.100.1';
    const h = ip => ({ 'X-Forwarded-For': `${ip}, ${RELAIS}` });
    const req16 = (methode, chemin, ip, corps) => fetch(s16.url + chemin, { method: methode,
      headers: { 'Content-Type': 'application/json', ...h(ip) }, body: corps && JSON.stringify(corps) })
      .then(async r => ({ statut: r.status, corps: await r.text() }));

    // /v1/* : un compteur propre, 1 000 par 15 min et par adresse, /v1/log compris.
    const A = '203.0.113.70';
    const v1 = [];
    for (let i = 0; i < 1000; i++) {
      v1.push(i % 10 === 0
        ? (await req16('GET', '/v1/devices/filet-appareil/registrations/pass.com.winwincard.loyalty', A)).statut
        : (await req16('POST', '/v1/log', A, { logs: ['filet'] })).statut);
    }
    const v1001 = await req16('POST', '/v1/log', A, { logs: ['filet'] });
    verifier('/v1/* : 1 000 requêtes (/v1/log et /v1/devices mêlées, un seul compteur) passent, la 1 001e reçoit 429 en JSON',
      [v1.includes(429), v1001.statut, v1001.corps], [false, 429, '{"error":"rate_limited"}']);
    verifier('… une autre adresse n\'est pas bloquée sur /v1', (await req16('POST', '/v1/log', '203.0.113.71', { logs: ['filet'] })).statut, 200);
    // Le global (300 / 15 min) n'a rien compté de ces 1 000 requêtes /v1.
    const hs = [];
    for (let i = 0; i < 300; i++) hs.push((await req16('GET', '/health', A)).statut);
    const h301 = await req16('GET', '/health', A);
    verifier('global : après 1 000 requêtes /v1, la même adresse fait encore 300 requêtes ailleurs ; la 301e reçoit 429 (global toujours actif hors /v1)',
      [hs.every(x => x === 200), h301.statut], [true, 429]);

    // Connexion caisse : 20 ÉCHECS par heure et par adresse, réussites jamais comptées.
    const cx = (ip, password) => req16('POST', '/api/scanner/login', ip, { identifiant: 'filet-b2', password }).then(r => r.statut);
    const C = '203.0.113.72', D = '203.0.113.73';
    const bons = [];
    for (let i = 0; i < 30; i++) bons.push(await cx(C, 'filet-mdp-b2'));
    verifier('connexion caisse : 30 connexions correctes de suite, toutes 200, aucune 429', [bons.every(x => x === 200), bons.includes(429)], [true, false]);
    const fauxD = [];
    for (let i = 0; i < 19; i++) fauxD.push(await cx(D, 'faux'));
    const apres19 = await cx(D, 'filet-mdp-b2');
    verifier('connexion caisse : 19 échecs (401) puis la bonne connexion → 200', [fauxD.every(x => x === 401), apres19], [true, 200]);
    const vingtieme = await cx(D, 'faux');
    const bloque = await cx(D, 'filet-mdp-b2');
    verifier('… le 20e échec passe encore (401), puis la 21e tentative reçoit 429 même avec le bon mot de passe', [vingtieme, bloque], [401, 429]);
    verifier('… une autre adresse se connecte (200)', await cx('203.0.113.74', 'filet-mdp-b2'), 200);

    // Diagnostic : 30 par heure, inchangé (marchand, admin et inscriptions : §13).
    const dg = [];
    for (let i = 0; i < 31; i++) dg.push((await req16('POST', '/api/diag/camera', '203.0.113.75', {})).statut);
    verifier('diagnostic : inchangé, 30 par heure (la 31e reçoit 429)', [dg.slice(0, 30).includes(429), dg[30]], [false, 429]);
    s16.processus.kill();
  }
  // ── 17. Campagnes par lots, débit partagé, file des iPhone (étape t37) ─────
  titre('17. Campagnes par lots, débit partagé, file des iPhone (étape t37)');
  {
    const http = require('http');
    const fs = require('fs');
    const attendreMs = ms => new Promise(ok => setTimeout(ok, ms));
    const charger = chemin => { try { return require(chemin); } catch { return null; } };
    // Sur toute fenêtre de W ms, au plus rafale + W × taux envois (+ 1 d'arrondi).
    const respecteDebit = (temps, rafale, taux, W) => {
      const t = [...temps].sort((a, b) => a - b);
      let j = 0;
      for (let i = 0; i < t.length; i++) {
        while (t[i] - t[j] > W) j++;
        if (i - j + 1 > rafale + W * taux + 1) return false;
      }
      return true;
    };

    // ── d2 : le débit partagé, seul (horloge réelle, débit accéléré) ──
    const debitMod = charger('../src/services/debit');
    if (!debitMod) {
      verifier('débit partagé : module présent (services/debit.js)', false, true);
    } else {
      const d = debitMod.creerDebit({ parLot: 10, lotMs: 200, rafale: 2 });   // 50 / s
      const temps = { cron: [], campagne: [] };
      const consommer = (qui, n) => (async () => { for (let i = 0; i < n; i++) { await d.prendre(); temps[qui].push(Date.now()); } })();
      const t0 = Date.now();
      await Promise.all([consommer('cron', 30), consommer('campagne', 30)]);
      const duree = Date.now() - t0;
      const tous = [...temps.cron, ...temps.campagne];
      const premierFiniCron = Math.max(...temps.cron), premierFiniCamp = Math.max(...temps.campagne);
      verifier('débit partagé : cron et campagne avancent ENSEMBLE (aucun n\'attend la fin de l\'autre)',
        [temps.cron.filter(x => x < premierFiniCamp).length > 20, temps.campagne.filter(x => x < premierFiniCron).length > 20], [true, true]);
      verifier('… à eux deux, jamais plus que le débit (60 jetons à 50 / s : ≥ 1,1 s, toute fenêtre respectée)',
        [duree >= 1100, respecteDebit(tous, 2, 10 / 200, 200), respecteDebit(tous, 2, 10 / 200, 500)], [true, true, true]);
    }
    const cronSrc = fs.readFileSync(require.resolve('../src/workers/cron.js'), 'utf8');
    verifier('débit partagé : le cron prend un jeton avant chaque push Apple',
      /await debit\.prendre\(\);\s*\n\s*await (sendPushUpdate\(push_token\)|envoyeurs\.apple\(jeton\))/.test(cronSrc), true);

    // ── a : campagne par lots, dans ce processus, envois imités ──
    const MC = 'c0c0c0c0-0000-4000-8000-000000000037';
    sql(`INSERT INTO marchands (id, nom, slug, forfait, type_programme, max_value, display_max_value, langue)
           VALUES ('${MC}', 'Filet Campagne', 'filet-campagne', 'pro', 'stamps', 10, 10, 'fr');
         WITH c AS (INSERT INTO clients (marchand_id, prenom) SELECT '${MC}', 'C' || g FROM generate_series(1, 1200) g
                    RETURNING id, pass_serial_number),
              p AS (INSERT INTO passes (client_id, marchand_id, serial_number, google_pass_url)
                    SELECT id, '${MC}', pass_serial_number, 'https://pay.google.com/filet' FROM c RETURNING id, client_id, serial_number)
         INSERT INTO device_tokens (pass_id, client_id, marchand_id, serial_number, device_id, push_token)
         SELECT id, client_id, '${MC}', serial_number, 'app-' || serial_number, 'jeton-' || serial_number FROM p;`);
    // Chaque client a ses deux cartes : depuis l'étape 23 (règle D2), la carte
    // Google porte le signal qui la distingue d'un iPhone seul.
    sql(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'passes' AND column_name = 'google_ouvert_le')
         THEN EXECUTE 'UPDATE passes SET google_ouvert_le = now() WHERE marchand_id = ''${MC}'''; END IF; END $$;`);
    const lancerSql = msg => JSON.parse(sql(`SELECT lancer_campagne('${MC}', '${msg}', 5, date_trunc('month', now()))`));
    const envois = { apple: [], google: [] };
    const env = { ...process.env };
    Object.assign(process.env, { SUPABASE_URL: urlSupabase, SUPABASE_SERVICE_KEY: cleService,
      CAMPAGNE_IPHONE_PAR_LOT: '100', CAMPAGNE_LOT_MS: '500', DEBIT_RAFALE: '10', CAMPAGNE_GOOGLE_PAR_LOT: '200' });
    const modules = ['supabase', 'notif-registre', 'debit', 'campagnes'].map(m => require('path').resolve(__dirname, `../src/services/${m}.js`));
    const neuf = () => { modules.forEach(m => delete require.cache[m]); return charger('../src/services/campagnes'); };
    const imiter = camp => camp && camp._pourTests({ envoyeurs: {
      appleActif: () => true, googleActif: () => true,
      apple: async jeton => { envois.apple.push({ jeton, t: Date.now() }); await attendreMs(5); },
      google: async serial => { envois.google.push(serial); await attendreMs(5); },
    }, config: { inactifMs: 0 } });
    let camp = neuf();
    imiter(camp);
    if (!camp) {
      verifier('campagne par lots : module présent (services/campagnes.js)', false, true);
    } else {
      const c1 = lancerSql('message un');
      const t0 = Date.now();
      await camp.demarrer({ id: c1.campagne_id, marchand_id: MC, message: 'message un',
        curseur_apple: null, curseur_google: null, apple_fini: false, google_fini: false });
      const duree = Date.now() - t0;
      const unique = l => new Set(l).size;
      verifier('campagne de 1 200 appareils (plus de plafond de 1 000) : chaque iPhone reçoit UN push, chaque carte Google UN message',
        [envois.apple.length, unique(envois.apple.map(e => e.jeton)), envois.google.length, unique(envois.google)], [1200, 1200, 1200, 1200]);
      verifier('… au débit réglé (100 / 500 ms) : toute fenêtre respectée, durée ≥ 5,9 s',
        [respecteDebit(envois.apple.map(e => e.t), 10, 100 / 500, 500), respecteDebit(envois.apple.map(e => e.t), 10, 100 / 500, 2000), duree >= 5900],
        [true, true, true]);
      verifier('… campagne terminée ; historique : 1 200 / 1 200 Apple et Google ; message posé sur les 1 200 cartes',
        sql(`SELECT c.statut || '|' || l.envoyes_apple || '/' || l.total_apple || '|' || l.envoyes_google || '/' || l.total_google
               || '|' || (SELECT count(*) FROM passes WHERE marchand_id = '${MC}' AND notification_message = 'message un')
             FROM campagnes c JOIN notification_logs l ON l.id = c.notification_log_id WHERE c.id = '${c1.campagne_id}'`),
        'terminee|1200/1200|1200/1200|1200');
      verifier('… registre des envois : 2 400 lignes « manuel » (CLAUDE.md)',
        sql(`SELECT count(*) FROM notification_envois WHERE marchand_id = '${MC}' AND source = 'manuel'`), '2400');

      // Verrou : une seule campagne en cours par marchand, quota compté au clic.
      const c2 = lancerSql('message deux');
      const c3 = lancerSql('message trois');
      verifier('verrou : une seconde campagne pendant qu\'une autre est en cours est refusée, sans compter le quota',
        [c2.ok, c3.ok, c3.reason, sql(`SELECT count(*) FROM notification_logs WHERE marchand_id = '${MC}'`)], [true, false, 'en_cours', '2']);

      // Arrêt propre au milieu, puis reprise au curseur.
      envois.apple.length = 0; envois.google.length = 0;
      const enCours = camp.demarrer({ id: c2.campagne_id, marchand_id: MC, message: 'message deux',
        curseur_apple: null, curseur_google: null, apple_fini: false, google_fini: false });
      await attendre(() => envois.apple.length >= 350, 30000);
      camp.arreter();
      await enCours;
      const a1 = envois.apple.length, g1 = envois.google.length;
      verifier('arrêt propre : le lot en cours finit, la campagne reste « en cours » avec son avancement',
        [a1 % 100, sql(`SELECT statut || '|' || (curseur_apple IS NOT NULL) FROM campagnes WHERE id = '${c2.campagne_id}'`)], [0, 'en_cours|true']);
      // Arrêt BRUTAL imité : un lot Apple envoyé sans que son curseur soit écrit,
      // et un lot Google dont le curseur est écrit sans qu'il soit envoyé.
      sql(`UPDATE campagnes SET
             curseur_apple  = (SELECT id FROM device_tokens WHERE marchand_id = '${MC}' ORDER BY id OFFSET ${a1 - 101} LIMIT 1),
             curseur_google = (SELECT id FROM passes WHERE marchand_id = '${MC}' AND google_pass_url IS NOT NULL ORDER BY id OFFSET ${g1 + 199} LIMIT 1)
           WHERE id = '${c2.campagne_id}'`);
      camp = neuf();
      const reg = imiter(camp);
      const repris = await camp.reprendre();
      await Promise.race([Promise.all([...reg.actives.values()]), attendreMs(30000)]);
      const jetons = envois.apple.map(e => e.jeton);
      verifier('reprise : la campagne repart du curseur et se termine',
        [repris.length, sql(`SELECT statut FROM campagnes WHERE id = '${c2.campagne_id}'`)], [1, 'terminee']);
      verifier('… Apple : aucun iPhone oublié, au plus UN lot en double (100 pushes silencieux)',
        [unique(jetons), jetons.length - unique(jetons)], [1200, 100]);
      verifier('… Google : zéro message en double ; au pire un lot perdu (200)',
        [envois.google.length - unique(envois.google), 1200 - unique(envois.google)], [0, 200]);

      // Panne de base pendant l'envoi : la campagne s'interrompt, puis reprend SEULE.
      const amontI = new URL(urlSupabase);
      const panne = { motif: null, vues: 0 };
      const relaisI = http.createServer((req, res) => {
        panne.vues++;
        if (panne.motif && panne.motif.test(req.url)) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"message":"panne simulée"}'); }
        const p = http.request({ host: amontI.hostname, port: amontI.port, path: req.url, method: req.method,
          headers: { ...req.headers, host: amontI.host } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
        p.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } });
        req.pipe(p);
      });
      await new Promise(r => relaisI.listen(0, '127.0.0.1', r));
      process.env.SUPABASE_URL = `http://127.0.0.1:${relaisI.address().port}`;
      envois.apple.length = 0; envois.google.length = 0;
      camp = neuf();
      const regI = imiter(camp);
      camp._pourTests({ config: { essais: 3, relancesMs: [400] } });
      const journal = [];
      const consoleError = console.error;
      console.error = (...x) => { journal.push(x.join(' ')); };
      const c4 = lancerSql('message quatre');
      camp.demarrer({ id: c4.campagne_id, marchand_id: MC, message: 'message quatre',
        curseur_apple: null, curseur_google: null, apple_fini: false, google_fini: false });
      await attendre(() => envois.apple.length >= 300, 30000);
      panne.motif = /^\/rest\/v1\/(device_tokens|rpc\/campagne_lot_apple)/;   // lecture Apple (migration 059 : par la base)
      await attendre(() => sql(`SELECT statut FROM campagnes WHERE id = '${c4.campagne_id}'`) === 'interrompue', 10000);
      const pendantPanne = sql(`SELECT statut FROM campagnes WHERE id = '${c4.campagne_id}'`);
      const c5 = lancerSql('message cinq');
      await attendreMs(1500);    // plusieurs tentatives, toujours en panne
      const alertes = journal.filter(l => l.includes('INTERROMPUE')).length;
      panne.motif = null;
      const repartie = await attendre(() => sql(`SELECT statut FROM campagnes WHERE id = '${c4.campagne_id}'`) === 'terminee', 20000);
      console.error = consoleError;
      verifier('panne de base pendant l\'envoi : campagne « interrompue », alerte « [campagne] INTERROMPUE » au journal, verrou gardé (nouveau clic refusé)',
        [pendantPanne, alertes >= 2, c5.ok, c5.reason], ['interrompue', true, false, 'en_cours']);
      verifier('… la base revient : la campagne reprend SEULE et se termine',
        [repartie, sql(`SELECT statut FROM campagnes WHERE id = '${c4.campagne_id}'`)], [true, 'terminee']);
      verifier('… aucun iPhone ni aucune carte oubliés, aucun doublon',
        [unique(envois.apple.map(e => e.jeton)), envois.apple.length, unique(envois.google), envois.google.length], [1200, 1200, 1200, 1200]);
      const vuesAvant = panne.vues;
      await attendreMs(1500);
      verifier('… finie, plus aucune tentative ni requête (aucune minuterie quand il n\'y a rien à reprendre)',
        [regI.relances ? regI.relances.size : 'absent', panne.vues - vuesAvant], [0, 0]);

      // Date limite : 24 h après le clic (ici 4 s), la campagne interrompue est abandonnée.
      // La voie Google finit son lot en cours avant l'arrêt (≈ 1 s au débit du filet,
      // plus sur une machine chargée) : avec 1,5 s, la date limite tombait parfois
      // avant la première interruption.
      camp._pourTests({ config: { limiteMs: 4000, relancesMs: [300], essais: 2 } });
      const journalA = [];
      console.error = (...x) => { journalA.push(x.join(' ')); };
      panne.motif = /^\/rest\/v1\/(device_tokens|rpc\/campagne_lot_apple)/;
      const c6 = lancerSql('message six');
      const logsAvant = Number(sql(`SELECT count(*) FROM notification_logs WHERE marchand_id = '${MC}'`));
      camp.demarrer({ id: c6.campagne_id, marchand_id: MC, message: 'message six',
        cree_le: sql(`SELECT cree_le FROM campagnes WHERE id = '${c6.campagne_id}'`),
        curseur_apple: null, curseur_google: null, apple_fini: false, google_fini: false });
      const abandonnee = await attendre(() => sql(`SELECT statut FROM campagnes WHERE id = '${c6.campagne_id}'`) === 'abandonnee', 8000);
      const vuesA = panne.vues;
      await attendreMs(1500);
      console.error = consoleError;
      panne.motif = null;
      const c7 = lancerSql('message sept');
      verifier('date limite dépassée : campagne « abandonnee » (fin posée), UNE ligne « ABANDONNÉE après … », après des tentatives',
        [abandonnee, sql(`SELECT fin_le IS NOT NULL FROM campagnes WHERE id = '${c6.campagne_id}'`),
         journalA.filter(l => /\] [0-9a-f-]+ ABANDONNÉE après/.test(l)).length, journalA.some(l => l.includes('INTERROMPUE'))],
        [true, 't', 1, true]);
      verifier('… ensuite plus de tentative, plus d\'alerte, plus aucune requête ; verrou levé (nouvelle campagne acceptée) ; quota toujours compté',
        [regI.relances.size, panne.vues - vuesA, journalA.filter(l => l.includes('ABANDONNÉE')).length, c7.ok,
         Number(sql(`SELECT count(*) FROM notification_logs WHERE marchand_id = '${MC}'`)) - logsAvant],
        [0, 0, 1, true, 1]);
      if (c7.ok) sql(`UPDATE campagnes SET statut = 'terminee' WHERE id = '${c7.campagne_id}'`);

      // Au démarrage : une campagne interrompue de plus de 24 h est abandonnée, une plus récente reprend.
      sql(`INSERT INTO campagnes (marchand_id, message, statut, cree_le, maj_le)
             VALUES ('${MC}', 'vieille', 'interrompue', now() - interval '25 hours', now() - interval '1 hour'),
                    ('${M.pointsParr}', 'récente', 'interrompue', now() - interval '1 hour', now() - interval '1 hour')`);
      camp = neuf();
      const regB = imiter(camp);
      const journalB = [];
      console.error = (...x) => { journalB.push(x.join(' ')); };
      const reprises = await camp.reprendre();
      await Promise.race([Promise.all([...regB.actives.values()]), attendreMs(30000)]);
      console.error = consoleError;
      verifier('démarrage : la campagne de plus de 24 h est abandonnée (ligne « ABANDONNÉE après 24 h »), la récente reprend et se termine',
        [reprises.length,
         sql(`SELECT statut FROM campagnes WHERE message = 'vieille'`), sql(`SELECT statut FROM campagnes WHERE message = 'récente'`),
         journalB.filter(l => l.includes('ABANDONNÉE après 24 h')).length],
        [2, 'abandonnee', 'terminee', 1]);
      relaisI.close();
    }
    modules.forEach(m => delete require.cache[m]);
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);

    // ── Le clic du marchand, la file et la carte, à travers un vrai serveur ──
    const amont = new URL(urlSupabase);
    const regle = { motif: null, delaiMs: 0, enVol: 0, maxEnVol: 0, vues: 0, panne: null };
    const relais = http.createServer((req, res) => {
      const vise = regle.motif && regle.motif.test(req.url);
      if (/^\/rest\/v1\//.test(req.url)) regle.vues++;
      if (regle.panne && regle.panne.test(req.url)) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"message":"panne simulée"}'); }
      if (vise) { regle.enVol++; regle.maxEnVol = Math.max(regle.maxEnVol, regle.enVol); }
      let compte = vise;
      const finir = () => { if (compte) { compte = false; regle.enVol--; } };
      res.on('finish', finir); res.on('close', finir);
      const envoyer = () => {
        const p = http.request({ host: amont.hostname, port: amont.port, path: req.url, method: req.method,
          headers: { ...req.headers, host: amont.host } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
        p.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } });
        req.pipe(p);
      };
      if (vise && regle.delaiMs > 0) { req.pause(); setTimeout(() => { req.resume(); envoyer(); }, regle.delaiMs); } else envoyer();
    });
    await new Promise(r => relais.listen(0, '127.0.0.1', r));
    const s17 = await demarrerServeur('t37', `http://127.0.0.1:${relais.address().port}`,
      { FILE_V1_EN_VOL: '5', FILE_V1_ATTENTE_MS: '2500', CAMPAGNE_REPRISE_DELAI_MS: '600000' });
    const appel = async (methode, chemin, jt, corps, enTetes = {}) => {
      const t0 = Date.now();
      const r = await fetch(s17.url + chemin, { method: methode, headers: { 'Content-Type': 'application/json',
        ...(jt ? { Authorization: jt } : {}), ...enTetes }, body: corps && JSON.stringify(corps) });
      const t = await r.text(); let c; try { c = JSON.parse(t); } catch { c = t; }
      return { statut: r.status, corps: c, ms: Date.now() - t0, retry: r.headers.get('retry-after') };
    };
    const logs = m => Number(sql(`SELECT count(*) FROM notification_logs WHERE marchand_id = '${m}'`));

    // Clic : réponse immédiate, quota compté au clic.
    const avantT = logs(M.tampons);
    const clic = await appel('POST', '/api/notifications', `Bearer ${tT}`, { message: 'Campagne filet' });
    verifier('clic du marchand : 202 « en cours » tout de suite (< 1 s), quota compté au clic',
      [clic.statut, clic.corps && clic.corps.statut, clic.ms < 1000, logs(M.tampons) - avantT], [202, 'en_cours', true, 1]);
    const fini = await attendre(() => sql(`SELECT statut FROM campagnes WHERE marchand_id = '${M.tampons}' ORDER BY cree_le DESC LIMIT 1`) === 'terminee', 5000);
    verifier('… la campagne se termine en arrière-plan (ici sans Apple ni Google configurés)', fini, true);
    sql(`INSERT INTO campagnes (marchand_id, message) VALUES ('${M.points}', 'en cours')`);
    const avantP = logs(M.points);
    const second = await appel('POST', '/api/notifications', `Bearer ${tP}`, { message: 'Doublon' });
    verifier('double clic : une campagne déjà en cours → 409, quota non compté', [second.statut, logs(M.points) - avantP], [409, 0]);
    sql(`UPDATE campagnes SET statut = 'terminee' WHERE marchand_id = '${M.points}'`);
    // Historique : l'état, sans chiffre (en cours d'envoi / envoyée), lu dans la même requête.
    sql(`WITH l AS (INSERT INTO notification_logs (marchand_id, message) VALUES ('${M.points}', 'Campagne longue') RETURNING id)
         INSERT INTO campagnes (marchand_id, notification_log_id, message) SELECT '${M.points}', id, 'Campagne longue' FROM l`);
    regle.vues = 0;
    const histP = await appel('GET', '/api/notifications', `Bearer ${tP}`);
    const histT = await appel('GET', '/api/notifications', `Bearer ${tT}`);
    verifier('historique : « en cours d\'envoi » tant que la campagne n\'est pas finie, « envoyée » ensuite, sans requête de plus (3 lectures comme avant)',
      [histP.corps.logs.find(l => l.message === 'Campagne longue').etat, histT.corps.logs.find(l => l.message === 'Campagne filet').etat, regle.vues], ['en_cours', 'envoyee', 6]);
    sql(`UPDATE campagnes SET statut = 'terminee' WHERE marchand_id = '${M.points}'`);
    sql(`INSERT INTO notification_logs (marchand_id, message) SELECT '${M.pointsParr}', 'q' || g FROM generate_series(1, 5) g`);
    verifier('quota du mois atteint : toujours 429', (await appel('POST', '/api/notifications', `Bearer ${tPP}`, { message: 'Hors quota' })).statut, 429);

    // b1 : une carte servie en UNE requête base.
    const carte = client(M.tampons);
    const authApple = 'ApplePass ' + crypto.createHmac('sha256', secretJwt).update(carte.serial).digest('hex').slice(0, 32);
    const cheminCarte = `/v1/passes/pass.com.winwincard.loyalty/${carte.serial}`;
    regle.vues = 0;
    const c200 = await appel('GET', cheminCarte, authApple);
    const vues200 = regle.vues;
    regle.vues = 0;
    const c304 = await appel('GET', cheminCarte, authApple, undefined, { 'If-Modified-Since': new Date(Date.now() + 3600e3).toUTCString() });
    // Sans certificats Apple, le filet ne signe pas la carte : 500 après lecture. Une
    // lecture jointe ratée rendrait 404 (client ou marchand absent).
    verifier('carte téléchargée : UNE requête base au lieu de trois (304 : une aussi), client et marchand bien lus',
      [vues200, c200.statut !== 404, c304.statut, regle.vues], [1, true, 304, 1]);

    // Routes Apple et écriture du scan sur base coupée ou en panne : 503, jamais 404, 204 ni 500.
    const appareil = 'filet-appareil-t37';
    const cheminInscr = `/v1/devices/${appareil}/registrations/pass.com.winwincard.loyalty/${carte.serial}`;
    const cheminListe = `/v1/devices/${appareil}/registrations/pass.com.winwincard.loyalty`;
    verifier('base saine : inscription d\'un iPhone 201, liste 200, carte inconnue 404',
      [(await appel('POST', cheminInscr, authApple, { pushToken: 'jeton-t37' })).statut, (await appel('GET', cheminListe)).statut,
       (await appel('GET', '/v1/passes/pass.com.winwincard.loyalty/' + crypto.randomUUID().replace(/^/, ''), 'ApplePass x')).statut === 401], [201, 200, true]);
    const inconnu = crypto.randomUUID();
    const authInconnu = 'ApplePass ' + crypto.createHmac('sha256', secretJwt).update(inconnu).digest('hex').slice(0, 32);
    verifier('… carte inconnue, base saine : toujours 404', (await appel('GET', `/v1/passes/pass.com.winwincard.loyalty/${inconnu}`, authInconnu)).statut, 404);
    // t17 (19/10) : la désinscription vérifie le jeton de la carte, comme l'inscription.
    const inscrit = async () => (await appel('GET', cheminListe)).statut;   // 200 inscrit, 204 plus rien
    const sansJeton = await appel('DELETE', cheminInscr);
    const autreJeton = await appel('DELETE', cheminInscr, authInconnu);
    verifier('désinscription sans jeton ou avec le jeton d\'une autre carte : 401, l\'iPhone reste inscrit',
      [sansJeton.statut, autreJeton.statut, await inscrit()], [401, 401, 200]);
    const bonJeton = await appel('DELETE', cheminInscr, authApple);
    verifier('désinscription avec le jeton de la carte : 200, l\'iPhone n\'est plus inscrit',
      [bonJeton.statut, await inscrit()], [200, 204]);
    await appel('POST', cheminInscr, authApple, { pushToken: 'jeton-t37' });
    Object.assign(regle, { motif: /^\/rest\/v1\/device_tokens/, delaiMs: 8000 });
    const listeLente = await appel('GET', cheminListe);
    Object.assign(regle, { motif: null, delaiMs: 0 });
    verifier('liste des cartes, base coupée à 5 s : 503 + Retry-After vers 5 s (avant : 204 « rien de modifié »)',
      [listeLente.statut, listeLente.retry, listeLente.ms >= 4800 && listeLente.ms <= 6500], [503, '30', true]);
    regle.panne = /^\/rest\/v1\/passes/;
    const cartePanne = await appel('GET', cheminCarte, authApple);
    const inscrPanne = await appel('POST', cheminInscr, authApple, { pushToken: 'jeton-t37' });
    regle.panne = /^\/rest\/v1\/device_tokens/;
    const inscrPanne2 = await appel('POST', cheminInscr, authApple, { pushToken: 'jeton-t37' });
    const listePanne = await appel('GET', cheminListe);
    const desinscrPanne = await appel('DELETE', cheminInscr, authApple);
    regle.panne = /^\/rest\/v1\/rpc\/crediter_scan/;
    const scanPanne = await appel('POST', '/api/scan', `Bearer ${tT}`, { serial_number: client(M.tampons).serial, cle_idempotence: crypto.randomUUID() });
    regle.panne = null;
    verifier('base en panne : carte 503 (avant 404), inscription 503 (avant 404 puis 500), liste 503 (avant 204), désinscription 503 (avant 500), toutes avec Retry-After',
      [cartePanne.statut, inscrPanne.statut, inscrPanne2.statut, listePanne.statut, desinscrPanne.statut,
       [cartePanne, inscrPanne, inscrPanne2, listePanne, desinscrPanne].every(r => r.retry === '30')],
      [503, 503, 503, 503, 503, true]);
    verifier('scan, écriture (crediter_scan) en panne : 503 database_unavailable (avant : 500)',
      [scanPanne.statut, scanPanne.corps && scanPanne.corps.error], [503, 'database_unavailable']);

    // c : file des iPhone, la caisse passe devant.
    Object.assign(regle, { motif: /^\/rest\/v1\/passes/, delaiMs: 1000, enVol: 0, maxEnVol: 0 });
    const iphones = Array.from({ length: 30 }, () => appel('GET', cheminCarte, authApple));
    await attendreMs(300);
    const scanPendant = await appel('POST', '/api/scan', `Bearer ${tT}`, { serial_number: client(M.tampons).serial, cle_idempotence: crypto.randomUUID() });
    const retours = await Promise.all(iphones);
    Object.assign(regle, { motif: null, delaiMs: 0 });
    verifier('file des iPhone : 30 retours en même temps, au plus 5 requêtes de carte à la fois vers la base',
      regle.maxEnVol <= 5 && regle.maxEnVol > 0, true);
    verifier('… la caisse passe devant : scan en 200, en moins de 1,5 s, pendant que les cartes attendent',
      [scanPendant.statut, scanPendant.ms < 1500], [200, true]);
    verifier('… au-delà de 2,5 s d\'attente, l\'iPhone reçoit 503 avec Retry-After (il réessaiera)',
      [retours.some(r => r.statut === 503 && r.retry === '30'), retours.every(r => [200, 304, 500, 503].includes(r.statut))], [true, true]);
    s17.processus.kill();
    relais.close();
  }

  titre('18. Relances automatiques : sélection en base, une par absence, plafond (étape 22)');
  {
    const path = require('path');
    const env = { ...process.env };
    Object.assign(process.env, { SUPABASE_URL: urlSupabase, SUPABASE_SERVICE_KEY: cleService,
      CAMPAGNE_IPHONE_PAR_LOT: '1000', CAMPAGNE_LOT_MS: '100', DEBIT_RAFALE: '1000' });
    const modules = ['services/supabase', 'services/notif-registre', 'services/debit', 'services/cron-passages', 'workers/cron']
      .map(m => path.resolve(__dirname, `../src/${m}.js`));
    modules.forEach(m => delete require.cache[m]);
    const cronMod = require('../src/workers/cron');
    cronMod.arreterPlanification();
    const debitMod = require('../src/services/debit');
    const envois = { apple: [], google: [] };
    let jetonsPris = 0;
    const prendreOrigine = debitMod.prendre;
    debitMod.prendre = () => { jetonsPris++; return prendreOrigine(); };
    if (cronMod._pourTests) cronMod._pourTests({ envoyeurs: {
      appleActif: () => true, googleActif: () => true,
      apple: async jeton => { envois.apple.push(jeton); },
      google: async (serial, message) => { envois.google.push({ serial, message }); },
    } });
    const sqlOuNull = requete => { try { return sql(requete); } catch { return null; } };
    const nombre = requete => Number(sql(requete));

    const marchand = (id, nom, extra = {}) => sql(`INSERT INTO marchands (id, nom, slug, forfait, type_programme, max_value, display_max_value, langue, landing_premium)
      VALUES ('${id}', '${nom}', '${nom.toLowerCase().replace(/\W+/g, '-')}', 'pro', 'stamps', 10, 10, 'fr', ${extra.premium ? 'true' : 'false'})`);
    // n clients « prenom1 … prenomN » : carte Apple (jeton) et/ou Google, un scan il y a `scanIl`
    // jours (annulé ou non), solde, anniversaire, fiche modifiée il y a `majIl` jours.
    function peupler(m, prenom, n, { apple = true, google = false, scanIl = null, annule = false, solde = 0, anniv = 'NULL', majIl = 0 } = {}) {
      sql(`WITH c AS (INSERT INTO clients (marchand_id, prenom, stored_value, date_anniversaire, updated_at)
                      SELECT '${m}', '${prenom}' || g, ${solde}, ${anniv}, now() - interval '${majIl} days' FROM generate_series(1, ${n}) g
                      RETURNING id, pass_serial_number),
                p AS (INSERT INTO passes (client_id, marchand_id, serial_number, google_pass_url)
                      SELECT id, '${m}', pass_serial_number, ${google ? `'https://pay.google.com/filet'` : 'NULL'} FROM c
                      RETURNING id, client_id, serial_number),
                d AS (INSERT INTO device_tokens (pass_id, client_id, marchand_id, serial_number, device_id, push_token)
                      SELECT id, client_id, '${m}', serial_number, 'app-' || serial_number, 'jeton-' || serial_number FROM p WHERE ${apple})
           INSERT INTO scans (client_id, marchand_id, stored_value_avant, stored_value_apres, date_scan, annule_le)
           SELECT client_id, '${m}', 0, 1, now() - interval '${scanIl ?? 0} days', ${annule ? 'now()' : 'NULL'} FROM p WHERE ${scanIl !== null}`);
      rendreVisibles(`marchand_id = '${m}'`);
    }
    const relances = (m, type) => nombre(`SELECT count(*) FROM workflow_executions WHERE marchand_id = '${m}'${type ? ` AND workflow_type = '${type}'` : ''}`);
    const relancesDe = (m, prefixe) => nombre(`SELECT count(*) FROM workflow_executions w JOIN clients c ON c.id = w.client_id
                                              WHERE w.marchand_id = '${m}' AND c.prenom LIKE '${prefixe}%'`);
    const decaler = (m, jours) => sql(`UPDATE workflow_executions SET executed_at = executed_at - interval '${jours} days' WHERE marchand_id = '${m}'`);
    const pushesVers = (m) => envois.apple.filter(j => jetonsDe[m] && jetonsDe[m].has(j)).length;
    const jetonsDe = {};
    const noterJetons = m => { jetonsDe[m] = new Set(sql(`SELECT push_token FROM device_tokens WHERE marchand_id = '${m}'`).split('\n').filter(Boolean)); };
    const inactifs = async (m) => { try { return await cronMod.runInactiveWorkflow({ marchandId: m, force: true }); } catch (e) { return [{ erreur: e.message }]; } };

    // ── A : inactifs, plus de 1 000 scans récents, annulations, jamais venus, canaux ──
    const MA = 'e2200000-0000-4000-8000-00000000000a';
    marchand(MA, 'Filet Relance A');
    peupler(MA, 'Actif', 1100, { scanIl: 2 });                 // actifs : plus de 1 000 scans récents
    peupler(MA, 'Absent', 40, { scanIl: 40 });                 // absents depuis 40 j
    peupler(MA, 'Annule', 5, { scanIl: 40 });                  // absents ; leur scan récent est annulé
    sql(`INSERT INTO scans (client_id, marchand_id, stored_value_avant, stored_value_apres, date_scan, annule_le)
         SELECT id, '${MA}', 1, 2, now() - interval '2 days', now() - interval '2 days' FROM clients WHERE marchand_id = '${MA}' AND prenom LIKE 'Annule%'`);
    peupler(MA, 'Jamais', 5);                                  // jamais scanné
    peupler(MA, 'SansCanal', 5, { apple: false, scanIl: 40 }); // ni iPhone ni Google
    peupler(MA, 'Google', 5, { apple: false, google: true, scanIl: 40 });
    noterJetons(MA);
    const rA = await inactifs(MA);
    verifier('inactifs : plus de 1 000 scans récents, AUCUN actif relancé ; les 40 absents, les 5 au scan récent annulé et les 5 sur Google le sont',
      [relancesDe(MA, 'Actif'), relancesDe(MA, 'Absent'), relancesDe(MA, 'Annule'), relancesDe(MA, 'Google'), relances(MA)], [0, 40, 5, 5, 50]);
    verifier('inactifs : jamais scanné et sans aucun canal → pas relancés', [relancesDe(MA, 'Jamais'), relancesDe(MA, 'SansCanal')], [0, 0]);
    verifier('envois : 45 pushes Apple (un par jeton), 5 messages Google aux seules cartes Google, texte personnalisé posé sur la carte',
      [pushesVers(MA), envois.google.length, envois.google.every(g => /^Salut Google\d+ ! Tu nous manques chez Filet Relance A/.test(g.message)),
       messageCarte(sql(`SELECT pass_serial_number FROM clients WHERE marchand_id = '${MA}' AND prenom = 'Absent1'`))],
      [45, 5, true, 'Salut Absent1 ! Tu nous manques chez Filet Relance A. Reviens vite ! 🎯']);
    verifier('débit partagé : un jeton pris avant chaque push Apple', jetonsPris, 45);
    verifier('registre : 50 lignes « inactive », et chaque relance porte le lot de ses lignes du registre',
      [nombre(`SELECT count(*) FROM notification_envois WHERE marchand_id = '${MA}' AND source = 'inactive'`),
       sqlOuNull(`SELECT count(*) FROM workflow_executions w WHERE w.marchand_id = '${MA}'
                    AND EXISTS (SELECT 1 FROM notification_envois n WHERE n.lot = w.lot)`)], [50, '50']);
    verifier('bilan rendu par marchand : 50 éligibles, 50 relancés, 0 reporté',
      [rA[0] && rA[0].eligibles, rA[0] && rA[0].relances, rA[0] && rA[0].reportes], [50, 50, 0]);

    // ── B : une relance par absence ──
    await inactifs(MA);
    const memeJour = relances(MA);
    decaler(MA, 2);
    await inactifs(MA);
    const absenceSuivante = relances(MA);
    // Absent1 et Absent2 : relancés il y a 50 j, revenus il y a 40 j, absents depuis.
    sql(`UPDATE workflow_executions SET executed_at = now() - interval '50 days'
          WHERE client_id IN (SELECT id FROM clients WHERE marchand_id = '${MA}' AND prenom IN ('Absent1', 'Absent2'))`);
    await inactifs(MA);
    verifier('une relance par absence : rien de plus le même jour, ni les jours suivants ; de nouveau après un scan puis une nouvelle absence (2)',
      [memeJour, absenceSuivante, relances(MA) - absenceSuivante], [50, 50, 2]);

    // ── C : plafond de 1 000 par passage, plus de 1 000 lignes de dédoublonnage ──
    const MB = 'e2200000-0000-4000-8000-00000000000b';
    marchand(MB, 'Filet Relance B');
    peupler(MB, 'Absent', 1200, { scanIl: 40 });
    noterJetons(MB);
    const rB1 = await inactifs(MB);
    const apresB1 = relances(MB);
    const rB2 = await inactifs(MB);
    const apresB2 = relances(MB);
    decaler(MB, 2);
    await inactifs(MB);
    verifier('plafond : 1 000 relancés sur 1 200 éligibles, 200 reportés ; le passage suivant envoie les 200',
      [apresB1, rB1[0] && rB1[0].eligibles, rB1[0] && rB1[0].reportes, apresB2 - apresB1, rB2[0] && rB2[0].reportes], [1000, 1200, 200, 200, 0]);
    verifier('plus de 1 000 relances déjà faites : aucun doublon (1 200 clients, 1 200 relances, 1 200 pushes distincts)',
      [relances(MB), nombre(`SELECT count(DISTINCT client_id) FROM workflow_executions WHERE marchand_id = '${MB}'`),
       pushesVers(MB), new Set(envois.apple.filter(j => jetonsDe[MB].has(j))).size], [1200, 1200, 1200, 1200]);

    // ── D : proches de la récompense, une par palier ──
    const MC2 = 'e2200000-0000-4000-8000-00000000000c';
    marchand(MC2, 'Filet Relance C');
    peupler(MC2, 'Neuf', 3, { solde: 9, majIl: 10 });
    peupler(MC2, 'Huit', 3, { solde: 8, majIl: 10 });
    peupler(MC2, 'Loin', 3, { solde: 5, majIl: 10 });
    const proches = async () => { try { await cronMod.runNearRewardWorkflow({ marchandId: MC2, force: true }); } catch { /* compté plus bas */ } };
    await proches();
    const carteDe = p => messageCarte(sql(`SELECT pass_serial_number FROM clients WHERE marchand_id = '${MC2}' AND prenom = '${p}'`));
    verifier('proches de la récompense : les 6 dans la zone, textes au singulier et au pluriel',
      [relances(MC2), relancesDe(MC2, 'Loin'), carteDe('Neuf1'), carteDe('Huit1')],
      // Programme en tampons : « tampon(s) » depuis f18 (avant : « point(s) » même en tampons).
      [6, 0, 'Salut Neuf1 ! Plus que 1 tampon pour débloquer ta récompense chez Filet Relance C. Passe nous voir ! 🎁',
       'Salut Huit1 ! Plus que 2 tampons pour débloquer ta récompense chez Filet Relance C. Passe nous voir ! 🎁']);
    decaler(MC2, 2);
    await proches();
    const sansMouvement = relances(MC2);
    sql(`UPDATE clients SET stored_value = 9 WHERE marchand_id = '${MC2}' AND prenom = 'Huit1'`);
    await proches();
    verifier('une relance par palier : rien tant que le solde ne bouge pas ; le solde bouge → une nouvelle relance',
      [sansMouvement, relances(MC2) - sansMouvement], [6, 1]);

    // ── E : passage complet : anniversaires au-delà de 1 000 dates, une relance par jour ──
    const MD = 'e2200000-0000-4000-8000-00000000000d';
    marchand(MD, 'Filet Relance D', { premium: true });
    sql(`UPDATE marchands SET workflow_inactive_enabled = true, workflow_near_reward_enabled = true, workflow_birthday_enabled = true WHERE id = '${MD}'`);
    const autreJour = `(now() AT TIME ZONE 'UTC' + interval '40 days')::date`;
    const aujourdhui = `(now() AT TIME ZONE 'UTC')::date - interval '30 years'`;
    peupler(MD, 'Autre', 1070, { anniv: autreJour });          // 1 070 dates connues, pas aujourd'hui
    peupler(MD, 'Fete', 30, { anniv: aujourdhui });            // insérés après : au-delà des 1 000 premières lignes
    peupler(MD, 'Triple', 3, { anniv: aujourdhui, solde: 9, scanIl: 40, majIl: 10 });  // anniversaire + proche + inactif
    const passagesAvant = nombre(`SELECT count(*) FROM cron_passages`);
    await cronMod.passageQuotidien();
    const dernier = sql(`SELECT statut || '|' || (details -> 'par_marchand' -> 'birthday' -> '${MD}' ->> 'relances') FROM cron_passages ORDER BY debut DESC LIMIT 1`);
    verifier('anniversaires : les 30 du jour trouvés au-delà de 1 000 dates connues (plus les 3 « Triple »)',
      [relancesDe(MD, 'Fete'), relances(MD, 'birthday')], [30, 33]);
    verifier('une relance par client et par jour : anniversaire + proche + inactif → l\'anniversaire seul',
      [relancesDe(MD, 'Triple'), relances(MD, 'near_reward'), relances(MD, 'inactive')], [3, 0, 0]);
    verifier('passage : « ok », bilan par marchand gardé dans cron_passages (33 anniversaires chez D)',
      [nombre(`SELECT count(*) FROM cron_passages`) - passagesAvant, dernier], [1, 'ok|33']);

    // ── F : cron de 08:00 et bouton admin en même temps ──
    const ME = 'e2200000-0000-4000-8000-00000000000e';
    marchand(ME, 'Filet Relance E');
    peupler(ME, 'Absent', 300, { scanIl: 40 });
    noterJetons(ME);
    await Promise.all([inactifs(ME), inactifs(ME)]);
    verifier('deux déclenchements simultanés : 300 relances, 300 pushes, aucun doublon',
      [relances(ME), nombre(`SELECT count(DISTINCT client_id) FROM workflow_executions WHERE marchand_id = '${ME}'`), pushesVers(ME)], [300, 300, 300]);

    // ── G : coupure entre réservation et envoi ──
    const MF = 'e2200000-0000-4000-8000-00000000000f';
    marchand(MF, 'Filet Relance F');
    peupler(MF, 'Absent', 10, { scanIl: 40 });
    noterJetons(MF);
    const reserves = sqlOuNull(`SELECT jsonb_array_length(reserver_relances('${MF}', 'inactive', gen_random_uuid(), '{"*": "x"}', 4, 30) -> 'clients')`);
    decaler(MF, 1);
    await inactifs(MF);
    verifier('coupure après la réservation (4 réservés, rien envoyé) : le passage suivant envoie les 6 autres, aucun doublon',
      [reserves, relances(MF), pushesVers(MF)], ['4', 10, 6]);

    // ── H : lecture des marchands impossible ──
    sql(`REVOKE SELECT ON public.marchands FROM service_role`);
    const consoleError = console.error; console.error = () => {};
    await cronMod.passageQuotidien();
    console.error = consoleError;
    sql(`GRANT SELECT ON public.marchands TO service_role`);
    // f17 : l'étape « themes » lit aussi les marchands, elle est donc en erreur aussi.
    const avecThemes = require('fs').existsSync(require('path').resolve(__dirname, '../src/services/themes.js'));
    verifier('lecture des marchands impossible : passage « erreurs » (avant : « ok » avec 0 envoi), les trois relances en erreur (et les thèmes, f17)',
      sql(`SELECT statut || '|' || (details -> 'erreurs')::text FROM cron_passages ORDER BY debut DESC LIMIT 1`),
      `erreurs|["birthday", "near_reward", "inactive"${avecThemes ? ', "themes"' : ''}]`);

    // ── I : purge à 90 jours, la dernière relance de chaque (client, type) gardée ──
    const MG = 'e2200000-0000-4000-8000-000000000010';
    marchand(MG, 'Filet Relance G');
    peupler(MG, 'Vieux', 2, { scanIl: 300 });
    sql(`INSERT INTO workflow_executions (workflow_type, client_id, marchand_id, executed_at)
         SELECT t.type, c.id, '${MG}', now() - (t.j || ' days')::interval
           FROM clients c, (VALUES ('inactive', 200), ('inactive', 100), ('near_reward', 150)) t(type, j)
          WHERE c.marchand_id = '${MG}'`);
    sql(`UPDATE clients SET deleted_at = now() WHERE marchand_id = '${MG}' AND prenom = 'Vieux2'`);
    if (cronMod.purgeOldExecutions) await cronMod.purgeOldExecutions();   // absente de l'ancien code : le contrôle échoue, sans interrompre
    verifier('purge : au-delà de 90 j, la dernière relance de chaque type est gardée (sinon « une par absence » serait oubliée) ; un client effacé n\'en garde aucune',
      sql(`SELECT string_agg(c.prenom || ':' || w.workflow_type || ':' || round(extract(epoch FROM now() - w.executed_at) / 86400), ',' ORDER BY c.prenom, w.workflow_type)
             FROM workflow_executions w JOIN clients c ON c.id = w.client_id WHERE w.marchand_id = '${MG}'`),
      'Vieux1:inactive:100,Vieux1:near_reward:150');

    // ── J : sélection lente (≈ 5 à 7 s estimés sur Supabase) : client long de 30 s ──
    {
      const http = require('http');
      const amont = new URL(urlSupabase);
      const relais = http.createServer((req, res) => {
        const envoyer = () => {
          const p = http.request({ host: amont.hostname, port: amont.port, path: req.url, method: req.method,
            headers: { ...req.headers, host: amont.host } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
          p.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } });
          req.pipe(p);
        };
        if (/^\/rest\/v1\/rpc\/reserver_relances/.test(req.url)) { req.pause(); setTimeout(() => { req.resume(); envoyer(); }, 6500); } else envoyer();
      });
      await new Promise(r => relais.listen(0, '127.0.0.1', r));
      modules.forEach(m => delete require.cache[m]);
      process.env.SUPABASE_URL = `http://127.0.0.1:${relais.address().port}`;
      const cronLent = require('../src/workers/cron');
      cronLent.arreterPlanification();
      if (cronLent._pourTests) cronLent._pourTests({ envoyeurs: {
        appleActif: () => true, googleActif: () => false, apple: async jeton => { envois.apple.push(jeton); } } });
      const MH = 'e2200000-0000-4000-8000-000000000011';
      marchand(MH, 'Filet Relance H');
      peupler(MH, 'Absent', 3, { scanIl: 40 });
      const t0 = Date.now();
      const rH = await cronLent.runInactiveWorkflow({ marchandId: MH, force: true }).catch(e => [{ erreur: e.message }]);
      const ms = Date.now() - t0;
      relais.close();
      verifier('sélection en base retenue 6,5 s (au-delà des 5 s du client court) : aboutit par le client long, 3 relances, aucune erreur',
        [rH[0] && rH[0].erreur, rH[0] && rH[0].relances, relances(MH), ms >= 6500], [undefined, 3, 3, true]);
      process.env.SUPABASE_URL = urlSupabase;
    }

    debitMod.prendre = prendreOrigine;
    modules.forEach(m => delete require.cache[m]);
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
  }

  titre('19. Aperçu calculé en base, mêmes jours du mois précédent, panne lisible (étape 26)');
  {
    const sqlOuNull = requete => { try { return sql(requete); } catch { return null; } };
    const apercu = (m, quand) => { const r = sqlOuNull(`SELECT apercu_stats('${m}', '${quand}')`); return r ? JSON.parse(r) : {}; };
    const marchand = (id, nom) => sql(`INSERT INTO marchands (id, nom, slug, forfait, type_programme, max_value, display_max_value, langue)
      VALUES ('${id}', '${nom}', '${nom.toLowerCase().replace(/\W+/g, '-')}', 'pro', 'stamps', 10, 10, 'fr')`);
    const clientNe = (m, prenom, cree) => {
      const id = sql(`INSERT INTO clients (marchand_id, prenom, created_at) VALUES ('${m}', '${prenom}', '${cree}') RETURNING id`);
      rendreVisibles(`id = '${id}'`);
      return id;
    };
    const scanLe = (m, c, quand, annule = false) => sql(`INSERT INTO scans (client_id, marchand_id, stored_value_avant, stored_value_apres, date_scan, annule_le)
      VALUES ('${c}', '${m}', 0, 1, '${quand}', ${annule ? `'${quand}'` : 'NULL'})`);

    // ── Horloge figée au 31/03/2026 12:00 UTC (février a 28 jours) ──
    const MS = 'e2600000-0000-4000-8000-000000000001';
    marchand(MS, 'Filet Apercu');
    const A1 = clientNe(MS, 'A1', '2026-01-10'), A2 = clientNe(MS, 'A2', '2026-01-10');
    const A3 = clientNe(MS, 'A3', '2026-01-10'), A4 = clientNe(MS, 'A4', '2026-01-10');
    const R1 = clientNe(MS, 'R1', '2026-03-20'); clientNe(MS, 'R2', '2026-03-20');
    clientNe(MS, 'F1', '2026-02-05'); clientNe(MS, 'F2', '2026-02-27'); clientNe(MS, 'F3', '2026-02-28 23:00');
    scanLe(MS, A1, '2026-03-20'); scanLe(MS, A1, '2026-03-31 08:00');
    scanLe(MS, A2, '2026-02-15'); scanLe(MS, A2, '2026-03-20');
    scanLe(MS, A3, '2026-03-10'); scanLe(MS, A3, '2026-03-15'); scanLe(MS, A3, '2026-03-16', true);
    scanLe(MS, A4, '2026-02-01');
    scanLe(MS, R1, '2026-03-21'); scanLe(MS, R1, '2026-03-22');
    const a = apercu(MS, '2026-03-31 12:00+00');
    verifier('aperçu en base : porteurs, scans du jour, actifs 30 j, visites moyennes (scan annulé exclu)',
      [a.porteurs, a.scans_aujourdhui, a.actifs_30j, a.visites_moyennes], [9, 1, 4, 1.8]);
    verifier('rétention (b) : revenus parmi les inscrits depuis 30 j ou plus (2 sur 7), un récent revenu ne compte pas',
      a.retention, 29);
    verifier('taux de retour inchangé : 1 des 4 actifs du mois était venu le mois précédent (complet)', a.taux_retour, 25);
    verifier('nouveaux ce mois et mêmes jours du mois précédent : le 31/03, tout février (borné à la fin du mois)',
      [a.nouveaux_ce_mois, a.nouveaux_mois_prec_memes_jours], [2, 3]);
    verifier('mêmes jours du mois précédent : le 10/03 à midi, seulement du 01/02 au 10/02 à midi (1 sur 3)',
      apercu(MS, '2026-03-10 12:00+00').nouveaux_mois_prec_memes_jours, 1);
    const d5 = apercu(MS, '2026-03-05 12:00+00').distribution || {};
    verifier('répartition des passages sur 30 JOURS GLISSANTS : le 05/03, le passage du 15/02 compte (1 porteur, tranche basse)',
      [d5.bas, d5.milieu, d5.haut, d5.seuil_bas, d5.seuil_haut], [1, 0, 0, 5, 10]);
    const MJ = 'e2600000-0000-4000-8000-000000000002';
    marchand(MJ, 'Filet Apercu Jeune');
    const J1 = clientNe(MJ, 'J1', '2026-03-25');
    scanLe(MJ, J1, '2026-03-26'); scanLe(MJ, J1, '2026-03-27');
    verifier('rétention : rien (null) tant qu\'aucun client n\'a 30 jours', apercu(MJ, '2026-03-31 12:00+00').retention, null);
    // Un passage = un jour avec scan (décision du 13/10) : D1 scanné 2 fois le même jour,
    // D2 deux jours différents.
    const MD = 'e2600000-0000-4000-8000-000000000005';
    marchand(MD, 'Filet Apercu Jours');
    const D1 = clientNe(MD, 'D1', '2026-01-10'), D2 = clientNe(MD, 'D2', '2026-01-10');
    scanLe(MD, D1, '2026-03-20 10:00'); scanLe(MD, D1, '2026-03-20 15:00');
    scanLe(MD, D2, '2026-03-20 10:00'); scanLe(MD, D2, '2026-03-21 10:00');
    const aD = apercu(MD, '2026-03-31 12:00+00');
    verifier('un client scanné 2 fois le même jour = 1 passage : visites moyennes 1,5 (et non 2), il n\'est pas « revenu » (rétention 50 %), tranche basse pour les deux',
      [aD.actifs_30j, aD.visites_moyennes, aD.retention, (aD.distribution || {}).bas], [2, 1.5, 50, 2]);

    // ── Par l'API, horloge réelle : plus de 1 000 scans en 30 jours ──
    const MG = 'e2600000-0000-4000-8000-000000000003';
    marchand(MG, 'Filet Apercu Gros');
    sql(`WITH c AS (INSERT INTO clients (marchand_id, prenom, created_at)
                    SELECT '${MG}', 'G' || g, now() - interval '90 days' FROM generate_series(1, 1200) g RETURNING id)
         INSERT INTO scans (client_id, marchand_id, stored_value_avant, stored_value_apres, date_scan)
         SELECT id, '${MG}'::uuid, 0, 1, now() - interval '2 days' FROM c UNION ALL
         SELECT id, '${MG}'::uuid, 0, 1, now() - interval '3 days' FROM c`);
    const tG = jwt.sign({ role: 'marchand', marchand_id: MG, tv: 1 }, secretJwt, { expiresIn: '1h' });
    const sG = await api('GET', '/api/merchants/me/stats', tG);
    verifier('Aperçu par l\'API, 2 400 scans en 30 j (avant : liste coupée à 1 000) : 1 200 actifs, 2,0 visites, rétention 100 %',
      [sG.statut, sG.corps.actifs_30j, sG.corps.visites_moyennes, sG.corps.retention], [200, 1200, 2, 100]);

    // ── Réseau : mêmes chiffres que l'Aperçu, « vs mois préc. » aux mêmes jours ──
    const MN = 'e2600000-0000-4000-8000-000000000004', BN = 'e2610000-0000-4000-8000-000000000004';
    marchand(MN, 'Filet Apercu Reseau');
    sql(`INSERT INTO points_de_vente (id, marchand_id, nom, actif, scanner_login) VALUES ('${BN}', '${MN}', 'Boutique stable', true, 'filet-apercu-b')`);
    const N1 = clientNe(MN, 'N1', '2025-01-01');
    // Boutique parfaitement stable : un scan par jour, à la même heure, ce mois-ci et
    // le mois précédent, sur les jours qui existent dans les deux mois.
    sql(`INSERT INTO scans (client_id, marchand_id, point_de_vente_id, stored_value_avant, stored_value_apres, date_scan)
         SELECT '${N1}', '${MN}', '${BN}', 0, 1, x.j
           FROM (SELECT date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS mois) b0,
                LATERAL (SELECT b0.mois, b0.mois - interval '1 month' AS prec) b,
                generate_series(0, 30) k,
                LATERAL (VALUES (b.mois + k * interval '1 day' + interval '1 second'),
                                (b.prec + k * interval '1 day' + interval '1 second')) x(j)
          WHERE b.prec + k * interval '1 day' < b.mois
            AND b.mois + k * interval '1 day' + interval '1 second' <= now()`);
    // … et le reste du mois précédent (jours pas encore arrivés ce mois-ci) : compté par
    // l'ancien calcul (mois précédent complet), écarté par les mêmes jours.
    sql(`INSERT INTO scans (client_id, marchand_id, point_de_vente_id, stored_value_avant, stored_value_apres, date_scan)
         SELECT '${N1}', '${MN}', '${BN}', 0, 1, b.prec + k * interval '1 day' + interval '1 second'
           FROM (SELECT date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS mois) b0,
                LATERAL (SELECT b0.mois, b0.mois - interval '1 month' AS prec) b,
                generate_series(0, 30) k
          WHERE b.prec + k * interval '1 day' < b.mois
            AND b.mois + k * interval '1 day' + interval '1 second' > now()`);
    const tN = jwt.sign({ role: 'marchand', marchand_id: MN, tv: 1 }, secretJwt, { expiresIn: '1h' });
    const sN = await api('GET', '/api/merchants/me/stats', tN);
    const gN = await api('GET', '/api/merchants/me/group-stats', tN);
    const boutique = (gN.corps.boutiques || [])[0] || {};
    verifier('Réseau : son bloc commun EST l\'Aperçu (mêmes chiffres par construction), cartes réseau tirées du même bloc',
      [JSON.stringify(gN.corps.apercu) === JSON.stringify(sN.corps), gN.corps.reseau && gN.corps.reseau.porteurs === sN.corps.porteurs,
       JSON.stringify(gN.corps.distribution) === JSON.stringify(sN.corps.distribution)], [true, true, true]);
    verifier('« vs mois préc. » : une boutique stable donne 0 % (mêmes jours du mois précédent ; avant : en baisse)',
      [boutique.scans > 0, boutique.scans === boutique.scans_prec, boutique.evolution_pct], [true, true, 0]);
    verifier('mono-boutique : l\'Aperçu ne contient rien par boutique', ['boutiques', 'mobilite', 'scans_non_attribues'].some(k => k in sN.corps), false);

    // ── Panne : 503 + Retry-After, jamais des zéros ──
    sqlOuNull(`REVOKE EXECUTE ON FUNCTION public.apercu_stats(uuid, timestamptz) FROM service_role`);
    const consoleError = console.error; console.error = () => {};
    const pS = await api('GET', '/api/merchants/me/stats', tN);
    sqlOuNull(`REVOKE EXECUTE ON FUNCTION public.group_stats(uuid) FROM service_role`);
    const pG = await api('GET', '/api/merchants/me/group-stats', tN);
    console.error = consoleError;
    sqlOuNull(`GRANT EXECUTE ON FUNCTION public.apercu_stats(uuid, timestamptz) TO service_role`);
    sql(`GRANT EXECUTE ON FUNCTION public.group_stats(uuid) TO service_role`);
    verifier('statistiques en panne : Aperçu et Réseau répondent 503 database_unavailable avec Retry-After (avant : zéros, réseau vide, 500)',
      [pS.statut, pS.corps.error, pS.retry, pG.statut, pG.corps.error, pG.retry], [503, 'database_unavailable', '30', 503, 'database_unavailable', '30']);
    verifier('droits : apercu_stats et group_stats fermées à la clé publique, ouvertes au serveur',
      sqlOuNull(`SELECT has_function_privilege('anon', 'public.apercu_stats(uuid,timestamptz)', 'EXECUTE') || '|'
                     || has_function_privilege('anon', 'public.group_stats(uuid)', 'EXECUTE') || '|'
                     || has_function_privilege('service_role', 'public.apercu_stats(uuid,timestamptz)', 'EXECUTE')`), 'false|false|true');
  }

  titre('20. Bandeaux (sharp), envoi d\'images (multer), routes touchées par Express 5 (étape 20b)');
  {
    const http = require('http');
    const sharp = require('sharp');
    const strip = require('../src/services/strip-generator');
    const dims = async b => { const m = await sharp(b).metadata(); return `${m.format} ${m.width}x${m.height}`; };

    // ── Bandeaux : rendu des 3 tailles, logo détouré par sharp, image statique ──
    const logo = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="60" fill="#e63946"/></svg>') }])
      .png().toBuffer();
    const fond = await sharp({ create: { width: 900, height: 400, channels: 3, background: { r: 20, g: 120, b: 200 } } }).jpeg().toBuffer();
    const avecLogo = await strip.render({ marchand: { strip_mode: 'stamps', strip_theme: 'logo_stamp', max_value: 10 }, filledCount: 4, logoBuffer: logo });
    const sansLogo = await strip.render({ marchand: { strip_mode: 'stamps', strip_theme: 'logo_stamp', max_value: 10 }, filledCount: 4, logoBuffer: null });
    const statique = await strip.render({ marchand: {}, filledCount: 0, staticImageBuffer: fond });
    verifier('bandeau, thème logo : 3 PNG aux bonnes tailles (750x246, 1125x369, 1032x336)',
      [await dims(avecLogo.strip2x), await dims(avecLogo.strip3x), await dims(avecLogo.hero)],
      ['png 750x246', 'png 1125x369', 'png 1032x336']);
    verifier('… le logo est bien dessiné (rendu différent sans logo)', avecLogo.strip2x.equals(sansLogo.strip2x), false);
    verifier('bandeau, image statique (JPEG envoyé) : recadrée en 3 PNG aux bonnes tailles',
      [await dims(statique.strip2x), await dims(statique.strip3x), await dims(statique.hero)],
      ['png 750x246', 'png 1125x369', 'png 1032x336']);
    const norm = Buffer.from(await strip.normalizeLogoForStamp(logo, 25), 'base64');
    const mNorm = await sharp(norm).metadata();
    verifier('logo des tampons : détouré et recadré en carré de 60 px, transparence gardée',
      [mNorm.format, mNorm.width, mNorm.height, mNorm.hasAlpha], ['png', 60, 60, true]);
    // Mêmes appels que le contrôle de transparence de l'admin (admin.js, logo-check) ;
    // la route elle-même télécharge le logo et refuse les adresses internes.
    const opaque = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const mL = await sharp(logo).metadata(), mO = await sharp(opaque).metadata();
    const { data: px, info } = await sharp(logo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparents = 0;
    for (let i = 3; i < px.length; i += info.channels) if (px[i] < 200) transparents++;
    verifier('contrôle de transparence (appels sharp de logo-check) : canal alpha lu, 72 % de pixels transparents, JPEG sans alpha',
      [mL.hasAlpha, mO.hasAlpha, info.channels, Math.round(100 * transparents / (info.width * info.height))], [true, false, 4, 72]);

    // ── Envoi d'images par l'admin : serveur derrière un relais qui imite le stockage ──
    const amont = new URL(urlSupabase);
    const stockes = [];
    const relais = http.createServer((req, res) => {
      if (req.url.startsWith('/storage/v1')) {
        const morceaux = [];
        req.on('data', d => morceaux.push(d));
        req.on('end', () => {
          if (req.url.startsWith('/storage/v1/object/')) stockes.push({ chemin: req.url, corps: Buffer.concat(morceaux) });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ Key: req.url, name: 'passes' }));
        });
        return;
      }
      const p = http.request({ host: amont.hostname, port: amont.port, path: req.url, method: req.method,
        headers: { ...req.headers, host: amont.host } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      p.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } });
      req.pipe(p);
    });
    await new Promise(r => relais.listen(0, '127.0.0.1', r));
    const s20 = await demarrerServeur('envois', `http://127.0.0.1:${relais.address().port}`);
    const envoyer = async (chemin, champs, enTetes = {}, corpsBrut) => {
      let body = corpsBrut;
      if (!body) { body = new FormData(); for (const [k, v] of Object.entries(champs)) { if (v.blob) body.append(k, v.blob, v.nom); else body.append(k, v); } }
      const r = await fetch(s20.url + chemin, { method: 'POST', headers: { Authorization: `Bearer ${jetonAdmin}`, ...enTetes }, body });
      const t = await r.text(); let c; try { c = JSON.parse(t); } catch { c = t; }
      return { statut: r.status, corps: c };
    };
    const png = await sharp({ create: { width: 750, height: 246, channels: 3, background: '#336699' } }).png().toBuffer();
    const chemin = `/api/admin/marchands/${M.tampons}/assets`;
    const ok = await envoyer(chemin, { tier: '2', image: { blob: new Blob([png], { type: 'image/png' }), nom: 'palier.png' } });
    verifier('envoi d\'une image de palier : 200, fichier stocké à l\'identique, palier enregistré',
      [ok.statut, /strip_tier_2\.png$/.test(ok.corps.url || ''), stockes.length === 1 && stockes[0].corps.equals(png),
       (ok.corps.images_tiers || []).some(t => t.min === 2 && t.max === 2)], [200, true, true, true]);
    const texte = await envoyer(chemin, { tier: '3', image: { blob: new Blob(['pas une image'], { type: 'text/plain' }), nom: 'note.txt' } });
    const gros = await envoyer(chemin, { tier: '3', image: { blob: new Blob([Buffer.alloc(5 * 1024 * 1024 + 10)], { type: 'image/png' }), nom: 'gros.png' } });
    const sansFichier = await envoyer(chemin, { tier: '3' });
    verifier('envoi refusé en 400 : fichier qui n\'est pas une image, image de plus de 5 Mo, aucun fichier',
      [texte.statut, gros.statut, sansFichier.statut, sansFichier.corps.error], [400, 400, 400, 'image requise']);
    const casse = await envoyer(chemin, null, { 'Content-Type': 'multipart/form-data; boundary=XYZ' },
      '--XYZ\r\nContent-Disposition: form-data; name="image"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n\x89PNG tronqué');
    const vivant = await fetch(s20.url + '/health').then(r => r.status).catch(() => 0);
    verifier('corps multipart mal formé : 400, et le serveur répond toujours', [casse.statut, vivant], [400, 200]);
    const stat = await envoyer(`/api/admin/marchands/${M.tampons}/strip-static`, { image: { blob: new Blob([png], { type: 'image/png' }), nom: 'fond.png' } });
    verifier('envoi de l\'image statique du bandeau : 200, stockée', [stat.statut, /strip_static\.png$/.test(stat.corps.url || '')], [200, true]);
    s20.processus.kill();
    relais.close();

    // ── Routes que la montée d'Express change (comportement à garder) ──
    const html = async chemin => (await api('GET', chemin)).statut;
    verifier('écrans : /scanner/…, /dashboard/…, /admin/… servent la page (200)',
      [await html('/scanner/une/page'), await html('/dashboard/une/page'), await html('/admin/une/page')], [200, 200, 200]);
    const tT20 = jwt.sign({ role: 'marchand', marchand_id: M.tampons, tv: 1 }, secretJwt, { expiresIn: '1h' });
    verifier('fiche client avec un identifiant malformé : 404 (lecture, modification, annulation d\'ajustement)',
      [(await api('GET', '/api/clients/pas-un-uuid', tT20)).statut, (await api('PATCH', '/api/clients/pas-un-uuid', tT20, {})).statut,
       (await api('POST', '/api/clients/ajustements/pas-un-uuid/annuler', tT20)).statut], [404, 404, 404]);
    const sansCorps = async (chemin, jt) => (await fetch(urlServeur + chemin, { method: 'POST', headers: jt ? { Authorization: `Bearer ${jt}` } : {} })).status;
    verifier('appel sans corps JSON : 400, jamais 500 (scan, connexion marchand, connexion scanner)',
      [await sansCorps('/api/scan', tT20), await sansCorps('/api/merchants/login'), await sansCorps('/api/scanner/login')], [400, 400, 400]);
  }

  titre('21. Liste des clients par pages, recherche en base, export complet, JSON mal formé (étape 21)');
  {
    const http = require('http');
    const ML = 'e2100000-0000-4000-8000-000000000001';
    sql(`INSERT INTO marchands (id, nom, slug, forfait, type_programme, max_value, display_max_value, langue)
         VALUES ('${ML}', 'Filet Liste, Export', 'filet-liste', 'pro_plus', 'stamps', 10, 10, 'fr')`);
    // 2 500 clients : soldes de 0 à 9, inscriptions étalées ; « Zoé » est au solde 0,
    // donc au-delà des 1 000 premiers dans l'ordre de la liste.
    sql(`INSERT INTO clients (marchand_id, prenom, stored_value, email, created_at)
         SELECT '${ML}', 'Client ' || g, g % 9 + 1, 'c' || g || '@filet.test', now() - g * interval '1 hour'
           FROM generate_series(1, 2496) g;
         INSERT INTO clients (marchand_id, prenom, stored_value, created_at) VALUES
           ('${ML}', 'Zoé', 0, now() - interval '200 days'),
           ('${ML}', 'Pour%cent', 0, now() - interval '201 days'),
           ('${ML}', '=CMD', 0, now() - interval '202 days'),
           ('${ML}', 'Dupont, Jean', 0, now() - interval '203 days');`);
    rendreVisibles(`marchand_id = '${ML}'`);
    const tL = jwt.sign({ role: 'marchand', marchand_id: ML, tv: 1 }, secretJwt, { expiresIn: '1h' });
    // Liste et export contre un PostgREST plafonné à 1 000 lignes par lecture, comme
    // Supabase en production : c'est ce plafond qui coupait la liste et l'export.
    const urlPlafond = await demarrerPostgrest({ maxLignes: 1000 });
    const sPlafond = await demarrerServeur('plafond', urlPlafond);
    const liste = async (params = '') => {
      const r = await fetch(`${sPlafond.url}/api/clients${params}`, { headers: { Authorization: `Bearer ${tL}` } });
      return { statut: r.status, total: r.headers.get('x-total-count'), corps: await r.json().catch(() => null) };
    };

    const p0 = await liste('?debut=0&limite=100');
    verifier('liste : une page de 100, total 2 500 dans l\'en-tête (avant : tout d\'un coup, coupé à 1 000)',
      [p0.statut, Array.isArray(p0.corps) && p0.corps.length, p0.total], [200, 100, '2500']);
    const vus = new Set(); let ordreOk = true, precedent = Infinity;
    for (let debut = 0; debut < 2500; debut += 200) {
      const p = await liste(`?debut=${debut}&limite=200`);
      for (const c of p.corps || []) { vus.add(c.id); if (c.stored_value > precedent) ordreOk = false; precedent = c.stored_value; }
    }
    verifier('liste : les 13 pages de 200 couvrent les 2 500 clients, sans doublon, points décroissants',
      [vus.size, ordreOk], [2500, true]);
    const zoe = await liste('?q=zo');
    const pct = await liste('?q=' + encodeURIComponent('%'));
    verifier('recherche dans la base : « zo » trouve Zoé (au-delà des 1 000 premiers), « % » est cherché tel quel',
      [zoe.total, (zoe.corps || []).map(c => c.prenom).join(), pct.total, (pct.corps || []).map(c => c.prenom).join()],
      ['1', 'Zoé', '1', 'Pour%cent']);
    verifier('liste : jamais de coordonnées (email) dans la liste', Object.keys((p0.corps || [])[0] || {}).includes('email'), false);

    // ── Export complet ──
    const exp = await fetch(`${sPlafond.url}/api/clients/export`, { headers: { Authorization: `Bearer ${tL}` } });
    const octets = Buffer.from(await exp.arrayBuffer());
    const csv = octets.toString('utf8');
    const lignesCsv = csv.replace(/^﻿/, '').split('\r\n');
    verifier('export : 2 500 clients + l\'en-tête (avant : 1 000, les plus anciens manquaient), le plus récent en premier, le plus ancien en dernier',
      [exp.status, lignesCsv.length, lignesCsv[0], lignesCsv[1].startsWith('Client 1,'), lignesCsv[lignesCsv.length - 1].startsWith('"Dupont, Jean"')],
      [200, 2501, 'Prénom,Points,Email,Téléphone,Date anniversaire,Inscrit le', true, true]);
    verifier('export : formule neutralisée, virgule entre guillemets, BOM pour Excel, aucun client en double',
      [lignesCsv.some(l => l.startsWith("'=CMD,")), octets.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])), new Set(lignesCsv.slice(1).map(l => l.split(',')[2])).size >= 2496],
      [true, true, true]);

    sPlafond.processus.kill();

    // ── Pannes : serveur derrière un relais qui coupe une lecture précise ──
    const amont = new URL(urlPlafond);
    const regle = { panne: null, vues: 0 };
    const relais = http.createServer((req, res) => {
      if (regle.panne && regle.panne(req)) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"message":"panne simulée"}'); }
      const p = http.request({ host: amont.hostname, port: amont.port, path: req.url, method: req.method,
        headers: { ...req.headers, host: amont.host } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      p.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } });
      req.pipe(p);
    });
    await new Promise(r => relais.listen(0, '127.0.0.1', r));
    const s21 = await demarrerServeur('liste', `http://127.0.0.1:${relais.address().port}`);
    const consoleError = console.error; console.error = () => {};
    regle.panne = req => /^\/rest\/v1\/clients\?/.test(req.url) && req.method === 'GET';
    const lP = await fetch(`${s21.url}/api/clients`, { headers: { Authorization: `Bearer ${tL}` } });
    const eP = await fetch(`${s21.url}/api/clients/export`, { headers: { Authorization: `Bearer ${tL}` } });
    // Deuxième page de l'export en panne : la première est déjà partie.
    let lectures = 0;
    regle.panne = req => /^\/rest\/v1\/clients\?/.test(req.url) && ++lectures === 2;
    let exportCoupe;
    try {
      const r = await fetch(`${s21.url}/api/clients/export`, { headers: { Authorization: `Bearer ${tL}` } });
      await r.text();
      exportCoupe = 'fichier reçu';
    } catch { exportCoupe = 'téléchargement en échec'; }
    regle.panne = null;
    console.error = consoleError;
    verifier('panne de base : liste 503, export 503 avant la première ligne (avant : 500 avec le message brut)',
      [lP.status, lP.headers.get('retry-after'), eP.status], [503, '30', 503]);
    verifier('panne pendant l\'export : la connexion est coupée, jamais un fichier tronqué qui aurait l\'air complet',
      exportCoupe, 'téléchargement en échec');
    s21.processus.kill();
    relais.close();

    // ── JSON mal formé ──
    const mal = await fetch(`${urlServeur}/api/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tL}` }, body: '{"serial_number": ' });
    verifier('JSON mal formé : 400 invalid_json (avant : 500 « Internal server error »)',
      [mal.status, (await mal.json().catch(() => ({}))).error], [400, 'invalid_json']);
  }

  titre('22. Google seulement pour les vraies cartes Google (étape 23, règle D2)');
  {
    const attendreMs = ms => new Promise(ok => setTimeout(ok, ms));
    const http = require('http');
    const path = require('path');
    const sqlOuNull = requete => { try { return sql(requete); } catch { return null; } };
    const MG = 'e2300000-0000-4000-8000-000000000001';
    const LIEN = 'https://pay.google.com/gp/v/save/filet';
    sql(`INSERT INTO marchands (id, nom, slug, forfait, type_programme, max_value, display_max_value, langue)
         VALUES ('${MG}', 'Filet Google', 'filet-google', 'pro', 'stamps', 10, 10, 'fr')`);
    // carte(prenom, { apple, google, ouvert, scan, efface }) : jeton Apple ? lien Google ?
    // lien Google ouvert ? déjà scanné (il y a 40 jours) ? client effacé ?
    const carte = (prenom, { apple = false, google = true, ouvert = false, scan = true, efface = false } = {}) => {
      const id = crypto.randomUUID(), serial = crypto.randomUUID(), passId = crypto.randomUUID();
      sql(`INSERT INTO clients (id, marchand_id, prenom, stored_value, pass_serial_number) VALUES ('${id}', '${MG}', '${prenom}', 3, '${serial}');
           INSERT INTO passes (id, client_id, marchand_id, serial_number, google_pass_url${sqlOuNull(`SELECT 1 FROM information_schema.columns WHERE table_name = 'passes' AND column_name = 'google_ouvert_le'`) === '1' ? ', google_ouvert_le' : ''})
             VALUES ('${passId}', '${id}', '${MG}', '${serial}', ${google ? `'${LIEN}'` : 'NULL'}${sqlOuNull(`SELECT 1 FROM information_schema.columns WHERE table_name = 'passes' AND column_name = 'google_ouvert_le'`) === '1' ? (ouvert ? ', now()' : ', NULL') : ''});
           ${apple ? `INSERT INTO device_tokens (pass_id, client_id, marchand_id, serial_number, device_id, push_token) VALUES ('${passId}', '${id}', '${MG}', '${serial}', 'app-${serial}', 'jeton-${serial}');` : ''}
           ${scan ? `INSERT INTO scans (client_id, marchand_id, stored_value_avant, stored_value_apres, date_scan) VALUES ('${id}', '${MG}', 0, 1, now() - interval '40 days');` : ''}
           ${efface ? `UPDATE clients SET deleted_at = now() WHERE id = '${id}';` : ''}`);
      return { id, serial };
    };
    const IPH = carte('Iphone', { apple: true });                 // carte sur iPhone seulement
    const AND = carte('Android');                                // carte Google seulement
    const DEUX = carte('LesDeux', { apple: true, ouvert: true }); // a les deux cartes
    carte('Aucune', { google: false });                          // ni Apple ni lien Google

    // ── Cron (reserver_relances) et campagnes (cartes_google_campagne), dans la base ──
    const res = sqlOuNull(`SELECT reserver_relances('${MG}', 'inactive', gen_random_uuid(), '{"*": "x"}', 10, 30)`);
    const google = {};
    for (const c of (res ? JSON.parse(res).clients : [])) google[c.serial] = c.google;
    verifier('cron : Google pour la carte Google et pour le client qui a les deux, PAS pour la carte iPhone seule',
      [google[IPH.serial], google[AND.serial], google[DEUX.serial]], [false, true, true]);
    const camp = (sqlOuNull(`SELECT string_agg(serial_number, ',') FROM cartes_google_campagne('${MG}', NULL, 50)`) || '').split(',');
    verifier('campagne, voie Google : la carte Google et le client aux deux cartes, pas la carte iPhone seule ni la carte sans lien',
      [camp.includes(AND.serial), camp.includes(DEUX.serial), camp.includes(IPH.serial), camp.length], [true, true, false, 2]);
    // Vérification étendue (migration 058) : les cartes qui seraient masquées — lien
    // Google, sans signal, sans jeton Apple, jamais scannées. Les cartes iPhone de
    // l'étape 23 ont déjà été vérifiées une fois (13/10) : plus redemandées.
    const MASQ = carte('Masquee', { scan: false });
    const MASQ_ANNULE = carte('MasqueeAnnule', { scan: false });
    sql(`INSERT INTO scans (client_id, marchand_id, stored_value_avant, stored_value_apres, date_scan, annule_le)
         VALUES ('${MASQ_ANNULE.id}', '${MG}', 0, 1, now() - interval '2 days', now())`);
    const MASQ_CLIC = carte('MasqueeClic', { scan: false, ouvert: true });
    const MASQ_IPH = carte('MasqueeIphone', { scan: false, apple: true });
    const MASQ_SANS_LIEN = carte('MasqueeSansLien', { scan: false, google: false });
    const MASQ_EFFACE = carte('MasqueeEffacee', { scan: false, efface: true });
    const aVerifier = (sqlOuNull(`SELECT string_agg(serial_number, ',') FROM cartes_google_a_verifier(NULL, 1000)`) || '').split(',');
    verifier('vérification étendue : les cartes Google jamais scannées sans jeton ni signal (scan annulé compris) ; plus les cartes iPhone, ni les clients venus, ni les effacés',
      [aVerifier.includes(MASQ.serial), aVerifier.includes(MASQ_ANNULE.serial), aVerifier.includes(IPH.serial), aVerifier.includes(DEUX.serial),
       aVerifier.includes(AND.serial), aVerifier.includes(MASQ_CLIC.serial), aVerifier.includes(MASQ_IPH.serial),
       aVerifier.includes(MASQ_SANS_LIEN.serial), aVerifier.includes(MASQ_EFFACE.serial)],
      [true, true, false, false, false, false, false, false, false]);

    // ── Bouton Google de la landing : la route note le clic, puis renvoie vers Google ──
    const CLIC = carte('Clic', { apple: true });
    const ouvertLe = s => sqlOuNull(`SELECT coalesce(google_ouvert_le::text, '') FROM passes WHERE serial_number = '${s}'`);
    const clic = s => fetch(`${urlServeur}/api/passes/${s}/google`, { redirect: 'manual' });
    const r1 = await clic(CLIC.serial);
    const premier = ouvertLe(CLIC.serial);
    const r2 = await clic(CLIC.serial);
    verifier('bouton Google : 302 vers le même lien Google, clic noté une fois (le second clic ne le réécrit pas)',
      [r1.status, r1.headers.get('location'), premier !== '' && premier !== null, ouvertLe(CLIC.serial) === premier, r2.status],
      [302, LIEN, true, true, 302]);
    verifier('bouton Google : carte inconnue, identifiant malformé, carte sans lien Google → 404',
      [(await clic(crypto.randomUUID())).status, (await clic('pas-une-carte')).status,
       (await clic(sql(`SELECT pass_serial_number FROM clients WHERE marchand_id = '${MG}' AND prenom = 'Aucune'`))).status], [404, 404, 404]);
    sql(`REVOKE SELECT ON public.passes FROM service_role`);
    const consoleError = console.error; console.error = () => {};
    const enPanne = await clic(CLIC.serial);
    console.error = consoleError;
    sql(`GRANT SELECT ON public.passes TO service_role`);
    verifier('bouton Google, base en panne : 503 + Retry-After', [enPanne.status, enPanne.headers.get('retry-after')], [503, '30']);

    // ── Scan (et ajustement) : derrière un relais qui compte les lectures ──
    const amont = new URL(urlSupabase);
    const vues = [];
    const relais = http.createServer((req, res) => {
      vues.push(req.url);
      const p = http.request({ host: amont.hostname, port: amont.port, path: req.url, method: req.method,
        headers: { ...req.headers, host: amont.host } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      p.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } });
      req.pipe(p);
    });
    await new Promise(r => relais.listen(0, '127.0.0.1', r));
    const s22 = await demarrerServeur('google', `http://127.0.0.1:${relais.address().port}`);
    const tG = jwt.sign({ role: 'marchand', marchand_id: MG, tv: 1 }, secretJwt, { expiresIn: '1h' });
    const lignes = (s, plateforme, source) => Number(sql(`SELECT count(*) FROM notification_envois WHERE serial_number = '${s}' AND plateforme = '${plateforme}' AND source = '${source}'`));
    const scanner = async s => {
      vues.length = 0;
      const r = await fetch(`${s22.url}/api/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tG}` },
        body: JSON.stringify({ serial_number: s, cle_idempotence: crypto.randomUUID() }) });
      return r.status;
    };
    const statutIph = await scanner(IPH.serial);
    await attendre(() => lignes(IPH.serial, 'apple', 'scan') > 0, 8000);
    await attendreMs(500);
    const lecturesJetons = vues.filter(u => u.startsWith('/rest/v1/device_tokens')).length;
    verifier('scan d\'une carte iPhone seule : 200, push Apple, AUCUN appel Google (avant : mise à jour + message), une seule lecture des jetons',
      [statutIph, lignes(IPH.serial, 'apple', 'scan'), lignes(IPH.serial, 'google', 'scan'), lecturesJetons], [200, 1, 0, 1]);
    await scanner(AND.serial);
    await attendre(() => lignes(AND.serial, 'google', 'scan') >= 2, 8000);
    await scanner(DEUX.serial);
    await attendre(() => lignes(DEUX.serial, 'google', 'scan') >= 2, 8000);
    verifier('scan : carte Google → mise à jour + message Google ; deux cartes → Apple ET Google (rien de perdu)',
      [lignes(AND.serial, 'google', 'scan'), lignes(DEUX.serial, 'apple', 'scan'), lignes(DEUX.serial, 'google', 'scan')], [2, 1, 2]);
    s22.processus.kill();
    relais.close();

    // ── Campagne, dans ce processus : voie Google ──
    const env = { ...process.env };
    Object.assign(process.env, { SUPABASE_URL: urlSupabase, SUPABASE_SERVICE_KEY: cleService });
    const modules = ['supabase', 'notif-registre', 'debit', 'campagnes', 'verification-google'].map(m => path.resolve(__dirname, `../src/services/${m}.js`));
    modules.forEach(m => delete require.cache[m]);
    const dejaCharges = new Set(Object.keys(require.cache));
    const campagnes = require('../src/services/campagnes');
    const envois = { apple: [], google: [] };
    campagnes._pourTests({ envoyeurs: { appleActif: () => true, googleActif: () => true,
      apple: async j => { envois.apple.push(j); }, google: async s => { envois.google.push(s); } }, config: { lotMs: 10 } });
    const lanceC = JSON.parse(sql(`SELECT lancer_campagne('${MG}', 'Campagne Google', 5, date_trunc('month', now()))`));
    await campagnes.demarrer({ id: lanceC.campagne_id, marchand_id: MG, message: 'Campagne Google',
      curseur_apple: null, curseur_google: null, apple_fini: false, google_fini: false }).catch(() => {});
    verifier('campagne : voie Google = carte Google + deux cartes, pas la carte iPhone seule ; voie Apple = tous les iPhone (4)',
      [envois.google.includes(AND.serial), envois.google.includes(DEUX.serial), envois.google.includes(IPH.serial), envois.apple.length],
      [true, true, false, 4]);

    // ── Ajustement du solde, dans ce processus, Google imité (non configuré dans le filet) ──
    const cheminGoogle = path.resolve(__dirname, '../src/services/google-pass.js');
    const appelsGoogle = [];
    require.cache[cheminGoogle] = { id: cheminGoogle, filename: cheminGoogle, loaded: true, exports: { isConfigured: () => true,
      updateLoyaltyObjectPoints: async s => { appelsGoogle.push(s); }, addMessageToLoyaltyObject: async s => { appelsGoogle.push(s); } } };
    const { syncPassAfterAdjustment } = require('../src/routes/clients');
    await syncPassAfterAdjustment(IPH.serial, MG, 'Iph', 7);
    await syncPassAfterAdjustment(AND.serial, MG, 'And', 7);
    await syncPassAfterAdjustment(DEUX.serial, MG, 'Deux', 7);
    const appelsDe = c => appelsGoogle.filter(s => s === c.serial).length;
    verifier('ajustement du solde : rien vers Google pour la carte iPhone seule ; carte Google et deux cartes : mise à jour + message',
      [appelsDe(IPH), appelsDe(AND), appelsDe(DEUX)], [0, 2, 2]);
    delete require.cache[cheminGoogle];

    // ── Vérification unique, dans ce processus, Google imité ──
    let verif = null; try { verif = require('../src/services/verification-google'); } catch { /* absente avant l'étape 23 */ }
    if (!verif) {
      verifier('vérification unique : module présent (services/verification-google.js)', false, true);
    } else {
      const V = { avec: carte('VAvec', { scan: false }), sans: carte('VSans', { scan: false }),
                  plante: carte('VPlante', { scan: false }), refus: carte('VRefus', { scan: false }) };
      const vus = [];
      verif._pourTests({ config: { pauseMs: 1 }, maintenant: () => new Date('2026-10-13T12:00:00Z'), google: { isConfigured: () => true,
        lireObjet: async s => { vus.push(s);
          if (s === V.avec.serial) return { statut: 200, aDesUtilisateurs: true };
          if (s === V.sans.serial) return { statut: 200, aDesUtilisateurs: false };
          if (s === V.plante.serial) throw new Error('Google injoignable');
          if (s === V.refus.serial) return { statut: 500, aDesUtilisateurs: false };
          return { statut: 404, aDesUtilisateurs: false }; } } });
      const lance = verif.lancer();
      const deuxieme = verif.lancer();
      await verif._pourTests().promesse;
      const b = verif.lireEtat().bilan;
      verifier('vérification unique : carte Google trouvée → même signal que le clic ; sans carte, erreur Google, refus → rien posé',
        [lance.ok, deuxieme.raison, ouvertLe(V.avec.serial) !== '', ouvertLe(V.sans.serial), ouvertLe(V.plante.serial), ouvertLe(V.refus.serial)],
        [true, 'en_cours', true, '', '', '']);
      verifier('… bilan : une carte Google, deux erreurs, chaque carte à vérifier lue UNE fois, jamais la carte qui a déjà le signal',
        [b.avecCarteGoogle, b.erreurs, b.verifiees === vus.length, new Set(vus).size === vus.length, vus.includes(DEUX.serial), vus.includes(AND.serial)],
        [1, 2, true, true, false, false]);
      const encore = verif.lancer(); await verif._pourTests().promesse;
      verifier('… relancée : la carte trouvée n\'est plus redemandée à Google', [encore.ok, verif.lireEtat().bilan.avecCarteGoogle], [true, 0]);
      verif._pourTests({ maintenant: () => new Date('2026-10-14T08:00:00Z') });
      verifier('… refusée entre 07:30 et 09:00 UTC (passage du cron), bornes comprises',
        [verif.lancer().raison, verif.dansFenetreCron(new Date('2026-10-14T07:29:59Z')), verif.dansFenetreCron(new Date('2026-10-14T07:30:00Z')),
         verif.dansFenetreCron(new Date('2026-10-14T08:59:59Z')), verif.dansFenetreCron(new Date('2026-10-14T09:00:00Z'))],
        ['fenetre_cron', false, true, true, false]);
    }
    for (const m of Object.keys(require.cache)) if (!dejaCharges.has(m)) delete require.cache[m];
    modules.forEach(m => delete require.cache[m]);
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
    const viaAdmin = await api('POST', '/api/admin/google-wallet/verification', jetonAdmin);
    verifier('vérification par l\'admin, Google non configuré (filet) : refus clair 503', [viaAdmin.statut, viaAdmin.corps.error], [503, 'google_non_configure']);
  }

  titre('23. Vrais clients (masquage) et campagnes par segment (migration 059)');
  {
    const sqlOuNull = requete => { try { return sql(requete); } catch { return null; } };
    const a059 = sqlOuNull(`SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'visible'`) === '1';
    const MS = 'e2300000-0000-4000-8000-000000000059';
    const BS1 = 'e2300000-0000-4000-8000-0000000005b1', BS2 = 'e2300000-0000-4000-8000-0000000005b2';
    const BAUTRE = B.b1;   // boutique d'un AUTRE marchand
    sql(`INSERT INTO marchands (id, nom, slug, forfait, type_programme, max_value, display_max_value, langue, freq_seuil_bas, freq_seuil_haut)
         VALUES ('${MS}', 'Filet Segments', 'filet-segments', 'pro', 'stamps', 10, 10, 'fr', 1, 2);
         INSERT INTO points_de_vente (id, marchand_id, nom, actif, scanner_login) VALUES
           ('${BS1}', '${MS}', 'Rive gauche', true, 'filet-seg-1'), ('${BS2}', '${MS}', 'Rive droite', true, 'filet-seg-2');`);
    const tS = jeton(MS);
    // c(prenom, { apple, google, ouvert, scans: [[jours, boutique?, annulé?], …] })
    const c = (prenom, { apple = false, google = false, ouvert = false, scans = [] } = {}) => {
      const id = crypto.randomUUID(), serial = crypto.randomUUID(), passId = crypto.randomUUID();
      sql(`INSERT INTO clients (id, marchand_id, prenom, stored_value, pass_serial_number) VALUES ('${id}', '${MS}', '${prenom}', 0, '${serial}');
           INSERT INTO passes (id, client_id, marchand_id, serial_number, google_pass_url, google_ouvert_le)
             VALUES ('${passId}', '${id}', '${MS}', '${serial}', ${google ? `'https://pay.google.com/filet'` : 'NULL'}, ${ouvert ? 'now()' : 'NULL'});
           ${apple ? `INSERT INTO device_tokens (pass_id, client_id, marchand_id, serial_number, device_id, push_token) VALUES ('${passId}', '${id}', '${MS}', '${serial}', 'app-${serial}', 'jeton-${serial}');` : ''}
           ${scans.map(([j, b, annule]) => `INSERT INTO scans (client_id, marchand_id, point_de_vente_id, stored_value_avant, stored_value_apres, date_scan, annule_le)
             VALUES ('${id}', '${MS}', ${b ? `'${b}'` : 'NULL'}, 0, 1, now() - interval '${j} days', ${annule ? 'now()' : 'NULL'});`).join('\n')}`);
      return { id, serial, prenom };
    };
    const vis = x => sqlOuNull(`SELECT visible FROM clients WHERE id = '${x.id}'`);

    // ── Indicateur tenu par la base ──
    const fantome = c('Fantome', { google: true });           // inscrit, carte jamais ajoutée
    const v0 = vis(fantome);
    sql(`INSERT INTO scans (client_id, marchand_id, stored_value_avant, stored_value_apres) VALUES ('${fantome.id}', '${MS}', 0, 1)`);
    const v1 = vis(fantome);
    sql(`UPDATE scans SET annule_le = now() WHERE client_id = '${fantome.id}'`);
    const v2 = vis(fantome);
    sql(`INSERT INTO device_tokens (pass_id, client_id, marchand_id, serial_number, device_id, push_token)
         SELECT id, '${fantome.id}', '${MS}', '${fantome.serial}', 'app-f', 'jeton-f' FROM passes WHERE serial_number = '${fantome.serial}'`);
    const v3 = vis(fantome);
    sql(`DELETE FROM device_tokens WHERE serial_number = '${fantome.serial}'`);
    const v4 = vis(fantome);
    sql(`UPDATE passes SET google_ouvert_le = now() WHERE serial_number = '${fantome.serial}'`);
    const v5 = vis(fantome);
    sql(`UPDATE passes SET google_ouvert_le = NULL WHERE serial_number = '${fantome.serial}'`);
    if (a059) sql(`UPDATE clients SET visible = false WHERE id = '${fantome.id}'`);   // redevient un fantôme pour la suite
    verifier('rendre un client visible ne touche pas à updated_at (relance near_reward : « le solde a bougé ») ; une vraie modification, si',
      (() => {
        const t0 = sql(`UPDATE clients SET updated_at = now() - interval '10 days' WHERE id = '${fantome.id}' RETURNING updated_at`);
        if (a059) sql(`UPDATE clients SET visible = NOT visible WHERE id = '${fantome.id}'; UPDATE clients SET visible = NOT visible WHERE id = '${fantome.id}'`);
        const t1 = sql(`SELECT updated_at FROM clients WHERE id = '${fantome.id}'`);
        sql(`UPDATE clients SET prenom = 'Fantome' WHERE id = '${fantome.id}'`);
        const t2 = sql(`SELECT updated_at FROM clients WHERE id = '${fantome.id}'`);
        return [t1 === t0, t2 !== t0];
      })(), [true, true]);
    verifier('vrai client, tenu par la base : inscrit seul → masqué ; scan → visible ; scan annulé → masqué ; jeton Apple → visible ; jeton supprimé → masqué ; clic Google → visible',
      [v0, v1, v2, v3, v4, v5], ['f', 't', 'f', 't', 'f', 't']);

    // Clients du marchand MS (la suite s'appuie sur eux).
    const C = {
      iph:      c('Iphone',     { apple: true }),                              // carte iPhone, jamais venu
      andr:     c('Android',    { google: true, ouvert: true }),               // carte Google (clic), jamais venu
      inact40:  c('Inactif40',  { apple: true, scans: [[40, BS1]] }),
      inact20:  c('Inactif20',  { google: true, scans: [[20, BS2]] }),         // Google sans signal mais venu
      actif5:   c('Actif5',     { apple: true, scans: [[5, BS1], [70]] }),
      fidele:   c('Fidele',     { apple: true, scans: [[1, BS2], [2, BS2], [3, BS2]] }),
      fideleAnn:c('FideleAnn',  { apple: true, scans: [[1], [2], [3, null, true]] }),   // 2 jours non annulés : pas fidèle
      deuxFois: c('DeuxFois',   { apple: true, scans: [[1], [1]] }),           // 2 scans le même jour = 1 passage
      vieux:    c('Vieux',      { apple: true, scans: [[100, BS1]] }),         // Rive gauche il y a 100 jours
      relance:  c('Relance',    { apple: true, scans: [[45]] }),               // inactif, mais relancé aujourd'hui
      fantome,
    };
    sql(`INSERT INTO workflow_executions (workflow_type, client_id, marchand_id, executed_at) VALUES ('inactive', '${C.relance.id}', '${MS}', now())`);

    // ── Liste, recherche, export, Aperçu ──
    const liste = await api('GET', '/api/clients?limite=200', tS);
    const prenoms = (Array.isArray(liste.corps) ? liste.corps : []).map(x => x.prenom);
    const cherche = await api('GET', '/api/clients?q=fant', tS);
    sql(`UPDATE marchands SET forfait = 'pro_plus' WHERE id = '${MS}'`);
    const exp = await fetch(`${urlServeur}/api/clients/export`, { headers: { Authorization: `Bearer ${tS}` } });
    const csv = await exp.text();
    sql(`UPDATE marchands SET forfait = 'pro' WHERE id = '${MS}'`);
    const stats = await api('GET', '/api/merchants/me/stats', tS);
    verifier('liste, recherche, export, Aperçu : 10 vrais clients, le fantôme jamais (avant : 11 partout)',
      [prenoms.length, prenoms.includes('Fantome'), Array.isArray(cherche.corps) ? cherche.corps.length : 'erreur',
       csv.split('\r\n').length - 1, csv.includes('Fantome'), stats.corps && stats.corps.porteurs],
      [10, false, 0, 10, false, 10]);
    const scanFantome = await scan(jeton(MS, BS1), fantome.serial);   // réseau : scanner de boutique
    const listeApres = await api('GET', '/api/clients?q=fant', tS);
    verifier('le scanner n\'est pas filtré : le fantôme présente sa carte, il est scanné et devient visible',
      [scanFantome.statut, vis(fantome), Array.isArray(listeApres.corps) ? listeApres.corps.length : 'erreur'], [200, 't', 1]);
    sql(`UPDATE scans SET annule_le = now() WHERE client_id = '${fantome.id}'`);   // redevient un fantôme

    // ── Relances (cron) et ancienne voie Google : vrais clients seulement ──
    sql(`UPDATE clients SET date_anniversaire = (now() AT TIME ZONE 'UTC')::date - interval '30 years' WHERE id IN ('${fantome.id}', '${C.andr.id}')`);
    const anniv = JSON.parse(sqlOuNull(`SELECT reserver_relances('${MS}', 'birthday', gen_random_uuid(), '{"*": "x"}', 10)`) || '{"clients":[]}');
    const annivIds = anniv.clients.map(x => x.client_id);
    const ancienne = (sqlOuNull(`SELECT string_agg(serial_number, ',') FROM cartes_google_campagne('${MS}', NULL, 100)`) || '').split(',');
    verifier('relance anniversaire : le vrai client oui, le fantôme non (avant : message Google à une carte jamais ajoutée) ; ancienne voie Google : pas le fantôme',
      [annivIds.includes(C.andr.id), annivIds.includes(fantome.id), ancienne.includes(fantome.serial), ancienne.includes(C.andr.serial)],
      [true, false, false, true]);
    sql(`DELETE FROM workflow_executions WHERE client_id = '${C.andr.id}' AND workflow_type = 'birthday'`);

    // ── Segments : compteur ──
    const compter = async seg => {
      const r = await api('GET', '/api/notifications/destinataires' + (seg ? '?segment=' + encodeURIComponent(JSON.stringify(seg)) : ''), tS);
      return r.statut === 200 ? r.corps.destinataires : r.statut;
    };
    const comptes = [await compter(null), await compter({ type: 'inactifs', jours: 60 }), await compter({ type: 'fideles' }),
      await compter({ type: 'boutique', boutique: BS1 }), await compter({ type: 'boutique', boutique: BS2 })];
    // Tous : 10 joignables (le fantôme masqué). Inactifs 60 : Vieux (jamais venus exclus). Fidèles (> 2 jours
    // sur 30) : Fidele. Rive gauche (90 j) : Inactif40, Actif5 (pas Vieux, 100 j). Rive droite : Inactif20, Fidele.
    verifier('compteur de destinataires : tous 10 ; inactifs 60 j : 1 ; fidèles 1 ; boutiques 2 et 2',
      comptes, [10, 1, 1, 2, 2]);
    const refus = [await compter({ type: 'inactifs', jours: 15 }), await compter({ type: 'inactifs', jours: 30 }),
      await compter({ type: 'inactifs', jours: 20 }), await compter({ type: 'boutique', boutique: BAUTRE }),
      await compter({ type: 'nimporte' }), (await api('GET', '/api/notifications/destinataires?segment=%7Bpas-du-json', tS)).statut];
    verifier('segment refusé (400) : inactifs 15 et 30 j (retirés, migration 065), 20 jours, boutique d\'un autre marchand, type inconnu, JSON illisible',
      refus, [400, 400, 400, 400, 400, 400]);
    // Migration 064 : les deux index des segments, l'ancien index des scans retiré (même nombre d'index).
    verifier('index des segments (064) : scans (client, date) et relances (client, date) présents, idx_scans_client retiré',
      sql(`SELECT (to_regclass('idx_scans_client_date') IS NOT NULL) || ',' || (to_regclass('idx_wf_exec_client_date') IS NOT NULL) || ',' || (to_regclass('idx_scans_client') IS NULL)`),
      'true,true,true');

    // ── Segments : la campagne envoie exactement au segment ──
    const lotsDe = id => ({
      apple: (sqlOuNull(`SELECT string_agg(serial_number, ',') FROM campagne_lot_apple('${id}', NULL, 1000)`) || '').split(',').filter(Boolean),
      google: (sqlOuNull(`SELECT string_agg(serial_number, ',') FROM campagne_lot_google('${id}', NULL, 1000)`) || '').split(',').filter(Boolean),
    });
    const envoi = await api('POST', '/api/notifications', tS, { message: 'Revenez !', segment: { type: 'inactifs', jours: 60 } });
    const idC = envoi.corps && envoi.corps.campagne_id;
    const lotsC = idC ? lotsDe(idC) : { apple: [], google: [] };
    verifier('campagne « inactifs 60 j » : 202, voie Apple = Vieux, voie Google vide (même définition que le compteur)',
      [envoi.statut, lotsC.apple.sort().join(','), lotsC.google.join(',')],
      [202, C.vieux.serial, '']);
    if (idC) await attendre(() => sqlOuNull(`SELECT statut FROM campagnes WHERE id = '${idC}'`) === 'terminee', 15000);
    const hist = await api('GET', '/api/notifications', tS);
    const ligneHist = ((hist.corps && hist.corps.logs) || []).find(l => l.message === 'Revenez !');
    verifier('… historique : la campagne porte son segment ; elle compte dans le quota comme une autre',
      [ligneHist && JSON.stringify(ligneHist.segment), hist.corps.quota && hist.corps.quota.used], [JSON.stringify({ type: 'inactifs', jours: 60 }), 1]);
    const lB = JSON.parse(sqlOuNull(`SELECT lancer_campagne('${MS}', 'Boutique', 5, date_trunc('month', now()), '{"type":"boutique","boutique":"${BS2}"}')`) || '{}');
    const segB = lB.campagne_id ? sqlOuNull(`SELECT segment FROM campagnes WHERE id = '${lB.campagne_id}'`) : null;
    const lotsB = lB.campagne_id ? lotsDe(lB.campagne_id) : { apple: [], google: [] };
    sql(`UPDATE campagnes SET statut = 'terminee' WHERE marchand_id = '${MS}' AND statut IN ('en_cours', 'interrompue')`);
    const lT = JSON.parse(sqlOuNull(`SELECT lancer_campagne('${MS}', 'Tous', 5, date_trunc('month', now()))`) || '{}');   // 4 paramètres : l'ancien code
    const lotsT = lT.campagne_id ? lotsDe(lT.campagne_id) : { apple: [], google: [] };
    sql(`UPDATE campagnes SET statut = 'terminee' WHERE marchand_id = '${MS}' AND statut IN ('en_cours', 'interrompue')`);
    verifier('campagne « Rive droite » : segment gardé avec le nom de la boutique ; Apple = Fidele, Google = Inactif20',
      [segB && JSON.parse(segB).nom, lotsB.apple.join(','), lotsB.google.join(',')], ['Rive droite', C.fidele.serial, C.inact20.serial]);
    verifier('campagne « Tous » (4 paramètres, comme l\'ancien code) : tous les iPhone (relancé du jour compris), Google = vraies cartes Google, jamais le fantôme',
      [lotsT.apple.length, lotsT.apple.includes(C.relance.serial), lotsT.google.sort().join(','), lotsT.google.includes(fantome.serial)],
      [8, true, [C.andr.serial, C.inact20.serial].sort().join(','), false]);
    const usedAvant = Number(sql(`SELECT count(*) FROM notification_logs WHERE marchand_id = '${MS}'`));
    const mauvais = await api('POST', '/api/notifications', tS, { message: 'x', segment: { type: 'boutique', boutique: BAUTRE } });
    verifier('campagne avec un segment refusé : 400 invalid_segment, rien écrit, quota non compté',
      [mauvais.statut, mauvais.corps && mauvais.corps.error, Number(sql(`SELECT count(*) FROM notification_logs WHERE marchand_id = '${MS}'`))],
      [400, 'invalid_segment', usedAvant]);
    verifier('droits : fonctions de segment fermées à la clé publique, ouvertes au serveur',
      [sqlOuNull(`SELECT has_function_privilege('anon', 'public.compter_segment(uuid,jsonb)', 'EXECUTE') OR has_function_privilege('anon', 'public.campagne_lot_apple(uuid,uuid,integer)', 'EXECUTE') OR has_function_privilege('anon', 'public.client_dans_segment(uuid,uuid,jsonb,timestamptz)', 'EXECUTE')`),
       sqlOuNull(`SELECT has_function_privilege('service_role', 'public.compter_segment(uuid,jsonb)', 'EXECUTE') AND has_function_privilege('service_role', 'public.campagne_lot_google(uuid,uuid,integer)', 'EXECUTE')`)],
      ['f', 't']);
    if (!a059) console.log('(migration 059 absente : contre-épreuve)');
  }

  titre('24. Bloc « Mes smart notifications » ; le marchand règle ses relances (14/10, f15, migration 060)');
  {
    const sqlOuNull = requete => { try { return sql(requete); } catch { return null; } };
    // m(id, slug, nom, champs) : un marchand avec ses réglages de smart notifications.
    const m = (id, slug, nom, champs) => {
      const cols = Object.keys(champs), vals = Object.values(champs).map(v => typeof v === 'string' ? `'${v}'` : v);
      sql(`INSERT INTO marchands (id, nom, slug, langue, ${cols.join(', ')}) VALUES ('${id}', '${nom}', '${slug}', 'fr', ${vals.join(', ')})`);
      return id;
    };
    const tout = { workflow_inactive_enabled: true, workflow_near_reward_enabled: true, workflow_birthday_enabled: true };
    const AVIS = 'https://g.page/r/filet-avis/review';
    const SP = m('e2400000-0000-4000-8000-000000000001', 'filet-smart-premium', 'Filet Smart Premium',
      { ...tout, forfait: 'pro_plus', landing_premium: true, type_programme: 'points', max_value: 500, display_max_value: 500,
        workflow_inactive_days: 21, workflow_near_reward_threshold: 50, lien_avis_google: AVIS });
    const SN = m('e2400000-0000-4000-8000-000000000002', 'filet-smart-simple', 'Filet Smart Simple',
      { ...tout, forfait: 'pro', landing_premium: false, type_programme: 'points', max_value: 500, display_max_value: 500, workflow_inactive_days: 30, workflow_near_reward_threshold: 1 });
    const ST = m('e2400000-0000-4000-8000-000000000003', 'filet-smart-tampons', 'Filet Smart Tampons',
      { ...tout, workflow_inactive_enabled: false, forfait: 'pro', landing_premium: true, type_programme: 'stamps', max_value: 10, display_max_value: 10, workflow_near_reward_threshold: 2 });
    const SZ = m('e2400000-0000-4000-8000-000000000004', 'filet-smart-zero', 'Filet Smart Zero',
      { workflow_inactive_enabled: false, workflow_near_reward_enabled: true, workflow_birthday_enabled: false, forfait: 'pro', type_programme: 'stamps', max_value: 3, display_max_value: 3, workflow_near_reward_threshold: 5 });
    const SB = m('e2400000-0000-4000-8000-000000000005', 'filet-smart-basic', 'Filet Smart Basic',
      { ...tout, forfait: 'basic', landing_premium: true, type_programme: 'stamps', max_value: 10, display_max_value: 10 });
    // Relances de SP : 3 sur 7 jours glissants (aujourd'hui, 2 j, 6 j 23 h), 1 à 8 jours (hors fenêtre) ;
    // + 2 demandes d'avis (une carte sur deux appareils = 1, une autre = 1 ; une à 9 jours, hors fenêtre).
    const relance = (mid, il) => {
      const cid = sql(`INSERT INTO clients (marchand_id, prenom) VALUES ('${mid}', 'R') RETURNING id`);
      sql(`INSERT INTO workflow_executions (workflow_type, client_id, marchand_id, executed_at) VALUES ('inactive', '${cid}', '${mid}', now() - interval '${il}')`);
    };
    ['0 hours', '2 days', '6 days 23 hours', '8 days'].forEach(il => relance(SP, il));
    ['1 day', '3 days'].forEach(il => relance(SN, il));
    const avis = (serial, il, plateforme = 'apple') => sqlOuNull(`INSERT INTO notification_envois (source, marchand_id, plateforme, serial_number, envoye_le, ok)
      VALUES ('avis', '${SP}', '${plateforme}', '${serial}', now() - interval '${il}', true)`);
    avis('carte-a', '1 hour'); avis('carte-a', '1 hour', 'google'); avis('carte-b', '3 days'); avis('carte-c', '9 days');
    const lire = async id => (await api('GET', '/api/merchants/me/smart-notifications', jeton(id))).corps;
    const [p, n, t, z, b] = [await lire(SP), await lire(SN), await lire(ST), await lire(SZ), await lire(SB)];
    verifier('Pro+ avec landing premium (points) : relance après 21 jours, boost à 50 points, anniversaire, avis Google ; 5 smart notifications sur 7 jours (3 relances + 2 cartes avec demande d\'avis)',
      [p.inactivite && p.inactivite.jours, JSON.stringify(p.boost), p.anniversaire, p.avis, p.envoyees_7j, p.personnalise],
      [21, JSON.stringify({ seuil: 50, unite: 'points', max: 499, winwin: 50,
        message: 'Salut {prenom} ! Plus que {reste} pour débloquer ta récompense chez {nom}. Passe nous voir ! 🎁',
        message_winwin: 'Salut {prenom} ! Plus que {reste} pour débloquer ta récompense chez {nom}. Passe nous voir ! 🎁' }), true, true, 5, false]);
    verifier('… message par défaut montré au marchand : le texte standard, « {prenom} » laissé tel quel',
      p.inactivite && p.inactivite.message, 'Salut {prenom} ! Tu nous manques chez Filet Smart Premium. Reviens vite ! 🎯');
    verifier('Pro sans landing premium : pas d\'anniversaire (même activé), pas d\'avis (pas de lien), boost à 1 point ; ses seules relances (2)',
      [n.anniversaire, n.avis, n.boost && n.boost.seuil, n.envoyees_7j], [false, false, 1, 2]);
    verifier('tampons, relance d\'inactivité désactivée : absente ; boost en tampons ; anniversaire (premium)',
      [t.inactivite, t.boost && t.boost.unite, t.anniversaire, t.envoyees_7j], [null, 'tampons', true, 0]);
    verifier('seuil au moins égal à la récompense : le cron n\'envoie rien, le boost n\'est pas mentionné ; Basic : pas de bloc',
      [z.eligible, z.boost, z.inactivite, z.anniversaire, JSON.stringify(b)], [true, null, null, false, JSON.stringify({ eligible: false })]);
    verifier('sans jeton marchand : 401', (await api('GET', '/api/merchants/me/smart-notifications')).statut, 401);

    // ── f15 : le marchand règle ──
    const regler = (id, corps) => api('PATCH', '/api/merchants/me/smart-notifications', jeton(id), corps);
    const ok = await regler(SP, { inactivite_jours: 10, inactivite_message: 'Coucou {prenom}, ta pizza t\'attend !', boost_seuil: 20 });
    const colonnes = sqlOuNull(`SELECT marchand_inactive_days || '|' || marchand_inactive_message || '|' || marchand_near_reward_threshold || '|' || workflow_inactive_days || '|' || workflow_near_reward_threshold FROM marchands WHERE id = '${SP}'`);
    verifier('réglage du marchand : enregistré à part, le réglage admin intact ; le bloc montre ses valeurs',
      [ok.statut, colonnes, ok.corps.inactivite && ok.corps.inactivite.jours, ok.corps.boost && ok.corps.boost.seuil, ok.corps.personnalise,
       ok.corps.inactivite && ok.corps.inactivite.winwin.jours],
      [200, '10|Coucou {prenom}, ta pizza t\'attend !|20|21|50', 10, 20, true, 21]);
    const refus = [];
    for (const corps of [{ inactivite_jours: 6 }, { inactivite_jours: 91 }, { inactivite_jours: 7.5 }, { inactivite_message: '   ' },
      { inactivite_message: 'x'.repeat(151) }, { inactivite_message: 'Venez sur www.promo.fr' }, { inactivite_message: 'Voir https://x.y' },
      { inactivite_message: 'Notre site pizzamore.com' }, { boost_seuil: 0 }, { boost_seuil: 500 }, {}]) {
      const r = await regler(SP, corps); refus.push(`${r.statut}:${r.corps.error}`);
    }
    verifier('garde-fous : 7 à 90 jours, entier ; message non vide, 150 caractères, sans lien ; seuil 1 à récompense − 1 ; corps vide',
      refus, ['400:jours_hors_limites', '400:jours_hors_limites', '400:jours_hors_limites', '400:message_vide', '400:message_trop_long',
        '400:message_avec_lien', '400:message_avec_lien', '400:message_avec_lien', '400:seuil_hors_limites', '400:seuil_hors_limites', '400:aucun_reglage']);
    const bornes = [await regler(SP, { inactivite_jours: 7 }), await regler(SP, { inactivite_jours: 90 }), await regler(SP, { boost_seuil: 499 }),
      await regler(SP, { inactivite_message: 'y'.repeat(150) })].map(r => r.statut);
    verifier('… bornes acceptées : 7 et 90 jours, seuil 499 (récompense 500), 150 caractères', bornes, [200, 200, 200, 200]);
    const desactivees = [await regler(ST, { inactivite_jours: 20 }), await regler(ST, { inactivite_message: 'Bonjour' }),
      await regler(SZ, { boost_seuil: 1 }), await regler(SB, { boost_seuil: 2 })];
    verifier('le marchand ne règle pas une relance que l\'admin n\'a pas activée (ni un boost que le seuil admin rend inerte) ; Basic refusé',
      desactivees.map(r => `${r.statut}:${r.corps.error}`),
      ['400:relance_inactive_desactivee', '400:relance_inactive_desactivee', '400:boost_desactive', '403:plan_not_eligible']);
    const retour = await regler(SP, { winwin: true });
    verifier('« revenir au réglage WinWin » : les trois réglages du marchand effacés, le bloc reprend ceux de l\'admin',
      [retour.statut, sqlOuNull(`SELECT coalesce(marchand_inactive_days::text, 'null') || coalesce(marchand_inactive_message, 'null') || coalesce(marchand_near_reward_threshold::text, 'null') FROM marchands WHERE id = '${SP}'`),
       retour.corps.inactivite && retour.corps.inactivite.jours, retour.corps.boost && retour.corps.boost.seuil, retour.corps.personnalise],
      [200, 'nullnullnull', 21, 50, false]);
    verifier('droits : colonnes bornées en base (même hors du serveur), compteur fermé à la clé publique',
      [sqlOuNull(`SELECT 1 FROM pg_constraint WHERE conname = 'marchands_reglages_smart_check'`),
       (() => { try { sql(`UPDATE marchands SET marchand_inactive_days = 3 WHERE id = '${SP}'`); return 'accepté'; } catch { return 'refusé'; } })(),
       sqlOuNull(`SELECT has_function_privilege('anon', 'public.smart_notifications_7j(uuid)', 'EXECUTE')`)],
      ['1', 'refusé', 'f']);

    // ── Fiche admin : voir et effacer les réglages du marchand (décision du 14/10) ──
    await regler(SN, { inactivite_jours: 12, boost_seuil: 3, boost_message: 'Encore {reste} !' });
    const fiche = (await api('GET', `/api/admin/marchands/${SN}`, jetonAdmin)).corps;
    const sansAdmin = await api('POST', `/api/admin/workflows/${SN}/effacer-reglages-marchand`, jeton(SN));
    const efface = await api('POST', `/api/admin/workflows/${SN}/effacer-reglages-marchand`, jetonAdmin);
    const inconnu = await api('POST', `/api/admin/workflows/e2400000-0000-4000-8000-0000000000ff/effacer-reglages-marchand`, jetonAdmin);
    verifier('admin : la fiche porte les réglages du marchand ; « Effacer » (admin seulement) les remet à vide, le réglage WinWin intact ; marchand inconnu 404',
      [fiche.marchand_inactive_days, fiche.marchand_near_reward_threshold, sansAdmin.statut, efface.statut,
       sqlOuNull(`SELECT coalesce(marchand_inactive_days::text, 'null') || '|' || coalesce(marchand_near_reward_threshold::text, 'null') || '|' || coalesce(marchand_near_reward_message, 'null') || '|' || workflow_inactive_days FROM marchands WHERE id = '${SN}'`),
       inconnu.statut],
      [12, 3, 403, 200, 'null|null|null|30', 404]);

    // ── f18 : message du boost modifiable (marchand et admin), {reste} obligatoire ──
    const msgRefus = [];
    for (const boost_message of ['Plus que quelques points !', 'Voir www.promo.fr {reste}', '   ', 'z'.repeat(145) + ' {reste}']) {
      const r = await regler(SP, { boost_message }); msgRefus.push(`${r.statut}:${r.corps.error}`);
    }
    verifier('message du boost : {reste} obligatoire, sans lien, non vide, 150 caractères',
      msgRefus, ['400:message_sans_reste', '400:message_avec_lien', '400:message_vide', '400:message_trop_long']);
    const msgOk = await regler(SP, { boost_message: '{prenom}, encore {reste} et c\'est cadeau !' });
    const msgRetour = await regler(SP, { winwin: true });
    verifier('… accepté et montré ; « revenir au réglage WinWin » efface aussi le message du boost ; boost désactivé : refusé',
      [msgOk.statut, msgOk.corps.boost && msgOk.corps.boost.message, msgOk.corps.personnalise,
       sqlOuNull(`SELECT coalesce(marchand_near_reward_message, 'null') FROM marchands WHERE id = '${SP}'`), msgRetour.corps.personnalise,
       (await regler(SZ, { boost_message: 'Encore {reste}' })).corps.error],
      [200, '{prenom}, encore {reste} et c\'est cadeau !', true, 'null', false, 'boost_desactive']);
    const adminMsg = async message => (await api('PATCH', `/api/admin/marchands/${SN}`, jetonAdmin, { workflow_near_reward_message: message }));
    const adm = [await adminMsg('Sans le mot'), await adminMsg('Plus que {reste} chez {nom}'), await adminMsg('')];
    verifier('admin : message du boost WinWin contrôlé ({reste} obligatoire) ; vide = texte standard',
      [adm[0].statut, adm[1].statut, adm[2].statut, sqlOuNull(`SELECT coalesce(workflow_near_reward_message, 'null') FROM marchands WHERE id = '${SN}'`)],
      [400, 200, 200, 'null']);

    // ── Le cron applique le réglage du marchand ──
    const path = require('path');
    const env = { ...process.env };
    Object.assign(process.env, { SUPABASE_URL: urlSupabase, SUPABASE_SERVICE_KEY: cleService });
    const modules = ['services/supabase', 'services/notif-registre', 'services/debit', 'services/cron-passages', 'workers/cron']
      .map(x => path.resolve(__dirname, `../src/${x}.js`));
    modules.forEach(x => delete require.cache[x]);
    const cronMod = require('../src/workers/cron');
    cronMod.arreterPlanification();
    if (cronMod._pourTests) cronMod._pourTests({ envoyeurs: { appleActif: () => true, googleActif: () => true, apple: async () => {}, google: async () => {} } });
    const SC = m('e2400000-0000-4000-8000-000000000006', 'filet-smart-cron', 'Filet Smart Cron',
      { ...tout, forfait: 'pro', type_programme: 'stamps', max_value: 10, display_max_value: 10, workflow_inactive_days: 30, workflow_near_reward_threshold: 2, actif: true });
    const porteur = (prenom, solde, scanIl) => {
      const id = crypto.randomUUID(), serial = crypto.randomUUID(), passId = crypto.randomUUID();
      sql(`INSERT INTO clients (id, marchand_id, prenom, stored_value, pass_serial_number, updated_at) VALUES ('${id}', '${SC}', '${prenom}', ${solde}, '${serial}', now() - interval '20 days');
           INSERT INTO passes (id, client_id, marchand_id, serial_number) VALUES ('${passId}', '${id}', '${SC}', '${serial}');
           INSERT INTO device_tokens (pass_id, client_id, marchand_id, serial_number, device_id, push_token) VALUES ('${passId}', '${id}', '${SC}', '${serial}', 'app-${serial}', 'jeton-${serial}');
           INSERT INTO scans (client_id, marchand_id, stored_value_avant, stored_value_apres, date_scan) VALUES ('${id}', '${SC}', 0, 1, now() - interval '${scanIl} days');`);
      rendreVisibles(`id = '${id}'`);
      return { id, serial };
    };
    const absent = porteur('Absent', 1, 12);      // 12 jours sans visite : pas relancé à 30 j, relancé à 10 j
    const proche = porteur('Proche', 6, 1);       // 4 tampons manquants : hors zone à 2, dans la zone à 4
    const relances = type => Number(sql(`SELECT count(*) FROM workflow_executions WHERE marchand_id = '${SC}' AND workflow_type = '${type}'`));
    await cronMod.runInactiveWorkflow({ marchandId: SC }).catch(() => {});
    await cronMod.runNearRewardWorkflow({ marchandId: SC }).catch(() => {});
    const avantReglage = [relances('inactive'), relances('near_reward')];
    await regler(SC, { inactivite_jours: 10, inactivite_message: 'On t\'attend chez {nom}, {prenom} !', boost_seuil: 4,
      boost_message: '{prenom}, plus que {reste} chez {nom} !' });
    sql(`DELETE FROM workflow_executions WHERE marchand_id = '${SC}'`);   // un autre jour
    await cronMod.runInactiveWorkflow({ marchandId: SC }).catch(() => {});
    sql(`DELETE FROM workflow_executions WHERE marchand_id = '${SC}' AND workflow_type = 'inactive'`);   // « une par jour » : le boost un autre jour
    await cronMod.runNearRewardWorkflow({ marchandId: SC }).catch(() => {});
    verifier('cron : réglage admin (30 j, seuil 2) → rien ; réglage du marchand (10 j, seuil 4) → relance d\'inactivité avec SON message, boost à 4 tampons avec SON message ({reste} au pluriel)',
      [JSON.stringify(avantReglage), relances('near_reward'), messageCarte(absent.serial), messageCarte(proche.serial)],
      ['[0,0]', 1, 'On t\'attend chez Filet Smart Cron, Absent !', 'Proche, plus que 4 tampons chez Filet Smart Cron !']);
    modules.forEach(x => delete require.cache[x]);
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
  }

  titre('25. f10 : notification « À proximité » sur iPhone (migration 062)');
  {
    const sqlOuNull = requete => { try { return sql(requete); } catch { return null; } };
    const path = require('path');
    let geo = null;
    try { geo = require('../src/services/geo'); } catch { /* absent avant f10 */ }
    const lieu = (nom, lat, lng, horaires) => ({ nom, lat, lng, horaires });
    if (!geo) verifier('f10 : module services/geo.js présent', false, true);
    else {

    // ── Contrôle des lieux ──
    const erreurs = [
      geo.validerLieux('x').erreur, geo.validerLieux(Array(11).fill(lieu('a', 1, 1, {}))).erreur,
      geo.validerLieux([lieu('a', 91, 1, {})]).erreur, geo.validerLieux([lieu('a', 1, 'abc', {})]).erreur,
      geo.validerLieux([lieu('a', 1, 1, { 8: ['09:00-10:00'] })]).erreur, geo.validerLieux([lieu('a', 1, 1, { 1: ['9h-10h'] })]).erreur,
      geo.validerLieux([lieu('a', 1, 1, { 1: ['18:00-02:00'] })]).erreur,
    ].map(e => !!e);
    const bon = geo.validerLieux([{ nom: ' Centre ', lat: '25.086111', lng: '55.382388', horaires: { 1: [' 08:00-12:00 ', '14:00-24:00'], 2: [] } }]);
    verifier('lieux : liste, 10 au plus, latitude/longitude, jour 1 à 7, format HH:MM-HH:MM, fin après le début dans la journée UTC ; forme normalisée',
      [erreurs.every(Boolean), JSON.stringify(bon.lieux)],
      [true, JSON.stringify([{ nom: 'Centre', lat: 25.086111, lng: 55.382388, horaires: { 1: ['08:00-12:00', '14:00-24:00'] } }])]);

    // ── Créneaux : union des lieux, 60 jours, créneaux passés retirés ──
    const lundi = new Date('2026-10-19T10:00:00Z');   // un lundi, 10:00 UTC
    const deuxLieux = [lieu('A', 1, 1, { 1: ['08:00-12:00'], 3: ['09:00-10:00'] }), lieu('B', 2, 2, { 1: ['11:00-13:00', '18:00-24:00'] })];
    const c = geo.creneaux(deuxLieux, lundi);
    verifier('créneaux : lundi 08:00-12:00 + 11:00-13:00 réunis en 08:00-13:00, 18:00-24:00 → 23:59:59 ; mercredi 09:00-10:00 ; un créneau en cours est gardé',
      [JSON.stringify(c.slice(0, 3)), c.length],
      [JSON.stringify([{ startDate: '2026-10-19T08:00:00Z', endDate: '2026-10-19T13:00:00Z' },
                       { startDate: '2026-10-19T18:00:00Z', endDate: '2026-10-19T23:59:59Z' },
                       { startDate: '2026-10-21T09:00:00Z', endDate: '2026-10-21T10:00:00Z' }]),
       // 60 jours à partir du lundi 19/10 : 9 lundis (2 créneaux) + 9 mercredis (1) = 27
       27]);
    verifier('… un créneau déjà terminé ce jour-là n\'est pas écrit (lundi 14:00 UTC : 08:00-13:00 est passé)',
      geo.creneaux(deuxLieux, new Date('2026-10-19T14:00:00Z'))[0].startDate, '2026-10-19T18:00:00Z');

    // ── Ce que reçoit la carte ──
    const mq = { nom: 'Hamza Salon', langue: 'fr', max_value: 10, type_programme: 'stamps', geo_actif: true,
      geo_lieux: [lieu('Salon', 25.086111, 55.382388, { 1: ['10:00-18:00'] })] };
    const cl = { prenom: 'Test Docker', stored_value: 7 };
    const champs = geo.champsPass(mq, cl, lundi);
    verifier('carte : chaque lieu avec le texte de repli (prénom + solde) et les créneaux ; récompense atteinte : autre texte',
      [JSON.stringify(champs.locations), champs.relevantDates[0].startDate, geo.champsPass(mq, { prenom: 'A', stored_value: 10 }, lundi).locations[0].relevantText],
      [JSON.stringify([{ latitude: 25.086111, longitude: 55.382388, relevantText: 'Test Docker, plus que 3 tampons pour ta récompense chez Hamza Salon !' }]),
       '2026-10-19T10:00:00Z', 'A, ta récompense t\'attend chez Hamza Salon !']);
    verifier('rien sur la carte : f10 désactivé, aucun lieu, aucun horaire (plutôt qu\'une carte affichée à toute heure)',
      [geo.champsPass({ ...mq, geo_actif: false }, cl, lundi), geo.champsPass({ ...mq, geo_lieux: [] }, cl, lundi),
       geo.champsPass({ ...mq, geo_lieux: [lieu('X', 1, 1, {})] }, cl, lundi)], [null, null, null]);

    // ── Admin : enregistrement contrôlé ; bloc « Mes smart notifications » ──
    const ST = 'e2400000-0000-4000-8000-000000000003';   // « Filet Smart Tampons » (section 24)
    const mauvais = await api('PATCH', `/api/admin/marchands/${ST}`, jetonAdmin, { geo_actif: true, geo_lieux: [lieu('X', 200, 1, {})] });
    const ok = await api('PATCH', `/api/admin/marchands/${ST}`, jetonAdmin,
      { geo_actif: true, geo_lieux: [{ nom: 'Centre', lat: '25.086111', lng: '55.382388', horaires: { 1: ['08:00-20:00'] } }] });
    const bloc = (await api('GET', '/api/merchants/me/smart-notifications', jeton(ST))).corps;
    verifier('admin : lieu invalide refusé (400 lisible) ; lieu valide enregistré ; « À proximité » mentionné dans le bloc du marchand',
      [mauvais.statut, /latitude/.test(mauvais.corps.error || ''), ok.statut, ok.corps.geo_actif, ok.corps.geo_lieux && ok.corps.geo_lieux[0].lat, bloc.proximite],
      [400, true, 200, true, 25.086111, true]);

    // ── Mise à jour silencieuse des cartes d'un marchand ──
    const env = { ...process.env };
    Object.assign(process.env, { SUPABASE_URL: urlSupabase, SUPABASE_SERVICE_KEY: cleService, DEBIT_RAFALE: '1000' });
    const modules = ['services/supabase', 'services/notif-registre', 'services/debit', 'services/geo'].map(x => path.resolve(__dirname, `../src/${x}.js`));
    modules.forEach(x => delete require.cache[x]);
    const geoP = require('../src/services/geo');
    const pousses = [];
    geoP._pourTests({ actif: () => true, parLot: 2, envoyeur: async jeton => { pousses.push(jeton); if (jeton.endsWith('-panne')) throw new Error('APNs 410'); } });
    const MGEO = 'e2500000-0000-4000-8000-000000000001', MAUTRE = 'e2500000-0000-4000-8000-000000000002';
    sql(`INSERT INTO marchands (id, nom, slug, langue, forfait, type_programme, max_value, display_max_value, geo_actif)
         VALUES ('${MGEO}', 'Filet Geo', 'filet-geo', 'fr', 'pro', 'stamps', 10, 10, true), ('${MAUTRE}', 'Filet Geo Autre', 'filet-geo-autre', 'fr', 'pro', 'stamps', 10, 10, false)`);
    const carteGeo = (mid, jeton) => {
      const id = crypto.randomUUID(), serial = crypto.randomUUID(), passId = crypto.randomUUID();
      sql(`INSERT INTO clients (id, marchand_id, prenom, pass_serial_number) VALUES ('${id}', '${mid}', 'G', '${serial}');
           INSERT INTO passes (id, client_id, marchand_id, serial_number, updated_at) VALUES ('${passId}', '${id}', '${mid}', '${serial}', now() - interval '3 days');
           INSERT INTO device_tokens (pass_id, client_id, marchand_id, serial_number, device_id, push_token) VALUES ('${passId}', '${id}', '${mid}', '${serial}', 'app-${serial}', '${jeton}');`);
      return serial;
    };
    const s1 = carteGeo(MGEO, 'geo-1'), s2 = carteGeo(MGEO, 'geo-2'), s3 = carteGeo(MGEO, 'geo-3-panne'), autre = carteGeo(MAUTRE, 'autre-1');
    const bilan = await geoP.rafraichir(MGEO, 'test');
    const majRecente = s => sql(`SELECT updated_at > now() - interval '1 minute' FROM passes WHERE serial_number = '${s}'`);
    verifier('mise à jour silencieuse : un push par iPhone du marchand, par lots (3 iPhone, lots de 2), cartes marquées modifiées (sinon 304), jamais un autre marchand',
      [bilan.iphones, bilan.erreurs, pousses.slice().sort().join(','), [s1, s2, s3].map(majRecente).join(''), majRecente(autre)],
      [3, 1, 'geo-1,geo-2,geo-3-panne', 'ttt', 'f']);
    verifier('… chaque envoi tracé dans notification_envois (source « geo », CLAUDE.md), l\'échec compris',
      sql(`SELECT count(*) || '|' || count(*) FILTER (WHERE NOT ok) FROM notification_envois WHERE source = 'geo' AND marchand_id = '${MGEO}'`), '3|1');
    pousses.length = 0;
    await geoP.rafraichirTous();
    verifier('mise à jour mensuelle : tous les marchands qui ont f10, et eux seuls',
      [pousses.includes('autre-1'), pousses.filter(j => j.startsWith('geo-')).length >= 3], [false, true]);
    modules.forEach(x => delete require.cache[x]);
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
    }
  }

  titre('26. f17 : cartes à thème (migration 063)');
  {
    let themes = null;
    try { themes = require('../src/services/themes'); } catch { /* absent avant f17 */ }
    if (!themes) verifier('f17 : module services/themes.js présent', false, true);
    else {
    const path = require('path');
    const fs = require('fs');
    const os = require('os');
    const { execFileSync } = require('child_process');

    const theme = { id: 'e3600000-0000-4000-8000-0000000000aa', nom: 'Ramadan', couleur_fond: '#0b3d2e', couleur_texte: '#ffffff',
      couleur_label: '#d4af37', logo_url: 'https://logos.exemple/ramadan.png', google_logo_url: 'https://logos.exemple/ramadan-carre.png',
      texte_case: 'Ramadan Kareem', message_ouverture: 'Ramadan Kareem ! Votre carte se met aux couleurs du mois.' };
    const base = { id: 'x', nom: 'Filet Thème', slug: 'filet-theme', langue: 'fr', forfait: 'pro_plus', type_programme: 'stamps',
      max_value: 10, display_max_value: 10, couleur_fond: '#111111', couleur_texte: '#eeeeee', couleur_label: '#999999',
      couleur_fond_reward: '#aa0000', couleur_pastille_fond: '#222222', couleur_label_strip: '#333333', logo_url: 'https://logos.exemple/std.png' };
    const enCours = { ...base, theme_actif: { ...theme, etat: 'en_cours', debut: '2026-10-14', fin: '2026-10-20' } };
    const programme = { ...base, theme_actif: { ...theme, etat: 'programme', debut: '2026-10-20', fin: '2026-10-25' } };

    // ── La fonction unique ──
    const h = themes.appliquerTheme(enCours);
    verifier('appliquerTheme : hors thème ou thème seulement programmé → fiche intacte (même objet) ; en cours → couleurs, logos, texte du thème ; couleurs manuelles de bannière remises au calcul auto ; doré de la récompense intact ; idempotente',
      [themes.appliquerTheme(base) === base, themes.appliquerTheme(programme) === programme,
       h.couleur_fond, h.couleur_texte, h.couleur_label, h.logo_url, h.google_logo_url, h.couleur_pastille_fond, h.couleur_label_strip,
       h.couleur_fond_reward, h._theme.texte_case, themes.appliquerTheme(h) === h, base.couleur_fond],
      [true, true, '#0b3d2e', '#ffffff', '#d4af37', theme.logo_url, theme.google_logo_url, null, null, '#aa0000', 'Ramadan Kareem', true, '#111111']);

    // Les modules qui parlent à la base ou à Google sont rechargés avec la clé
    // locale (comme la section 25) ; Apple et Google sont imités.
    const env = { ...process.env };
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'filet-theme-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dossier, 'k.pem'),
      '-out', path.join(dossier, 'c.pem'), '-subj', '/CN=filet', '-days', '1'], { stdio: 'ignore' });
    const b64 = f => fs.readFileSync(path.join(dossier, f)).toString('base64');
    Object.assign(process.env, { SUPABASE_URL: urlSupabase, SUPABASE_SERVICE_KEY: cleService, DEBIT_RAFALE: '1000', JWT_SECRET: secretJwt,
      APPLE_WWDR_CERT_B64: b64('c.pem'), APPLE_SIGNER_CERT_B64: b64('c.pem'), APPLE_SIGNER_KEY_B64: b64('k.pem'),
      GOOGLE_WALLET_ISSUER_ID: '3388000000000000000',
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'filet@exemple.iam', private_key: fs.readFileSync(path.join(dossier, 'k.pem'), 'utf8') }) });
    const modules = ['services/supabase', 'services/notif-registre', 'services/debit', 'services/themes', 'services/strip-cache',
      'services/apple-pass', 'services/google-pass'].map(x => path.resolve(__dirname, `../src/${x}.js`));
    modules.forEach(x => delete require.cache[x]);
    const T = require('../src/services/themes');
    const applePass = require('../src/services/apple-pass');
    const googlePass = require('../src/services/google-pass');
    const stripCache = require('../src/services/strip-cache');
    const sharp = require('sharp');
    const fetchOrigine = globalThis.fetch;
    const appelsGoogle = [];
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.startsWith('https://oauth2.googleapis.com/')) return new Response(JSON.stringify({ access_token: 'filet' }));
      if (u.startsWith('https://walletobjects.googleapis.com/')) {
        appelsGoogle.push({ methode: opts.method, url: u, corps: opts.body ? JSON.parse(opts.body) : null });
        return new Response('{}', { status: 200 });
      }
      return fetchOrigine(url, opts);
    };
    try {
      // ── Point d'entrée 1 : la carte Apple (generateApplePass → buildPassJson) ──
      const fichiers = zip => {
        const f = {};
        for (let i = 0; zip.readUInt32LE(i) === 0x04034b50;) {
          const taille = zip.readUInt32LE(i + 18), lnom = zip.readUInt16LE(i + 26);
          f[zip.slice(i + 30, i + 30 + lnom).toString()] = zip.slice(i + 30 + lnom, i + 30 + lnom + taille);
          i += 30 + lnom + taille;
        }
        return f;
      };
      const pixel = async buf => { const { data } = await sharp(buf).extract({ left: 3, top: 3, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
        return '#' + [...data.slice(0, 3)].map(v => v.toString(16).padStart(2, '0')).join(''); };
      const sansLogo = m => ({ ...m, logo_url: null, theme_actif: m.theme_actif ? { ...m.theme_actif, logo_url: null } : null });
      const zip = await applePass.generateApplePass({ client: { prenom: 'Sarah', stored_value: 3 }, marchand: sansLogo({ ...enCours, strip_mode: 'stamps', strip_label: 'off' }), serialNumber: 'filet-theme-1' });
      const f = fichiers(zip);
      const pj = JSON.parse(f['pass.json']);
      const dore = applePass.buildPassJson({ client: { prenom: 'Sarah', stored_value: 10 }, marchand: enCours, serialNumber: 's' });
      const std = applePass.buildPassJson({ client: { prenom: 'Sarah', stored_value: 3 }, marchand: base, serialNumber: 's' });
      verifier('entrée 1 (carte Apple) : fond, textes, libellés du thème ; texte du thème dans la case sous le prénom ; bannière peinte sur le fond du thème ; icône à la couleur STANDARD ; prénom et solde inchangés',
        [pj.backgroundColor, pj.foregroundColor, pj.labelColor, JSON.stringify(pj.storeCard.auxiliaryFields), await pixel(f['strip@2x.png']),
         f['icon.png'].equals(applePass.createSolidPng(29, 29, 17, 17, 17)), pj.storeCard.secondaryFields.map(x => x.value).join('|')],
        ['rgb(11, 61, 46)', 'rgb(255, 255, 255)', 'rgb(212, 175, 55)', JSON.stringify([{ key: 'theme', label: '', value: 'Ramadan Kareem' }]), '#0b3d2e', true, 'Sarah|3 / 10']);
      verifier('… récompense atteinte pendant le thème : le doré (ici la couleur de récompense du marchand) garde la priorité ; hors thème : aucune case, couleurs standard',
        [dore.backgroundColor, std.backgroundColor, std.storeCard.auxiliaryFields.length], ['rgb(170, 0, 0)', 'rgb(17, 17, 17)', 0]);

      // ── Point d'entrée 2 : les bannières (cache) ──
      const cleStd = stripCache.storageKey({ ...base, strip_mode: 'stamps' }, 3, 'strip2x');
      const cleTheme = stripCache.storageKey(T.appliquerTheme({ ...enCours, strip_mode: 'stamps' }), 3, 'strip2x');
      const banniere = await stripCache.getOrGenerate({ marchand: sansLogo({ ...enCours, slug: 'filet-theme-b', strip_mode: 'stamps', strip_label: 'off' }), filledCount: 4, variant: 'strip2x' });
      verifier('entrée 2 (bannière) : peinte sur le fond du thème, rangée à part dans le dossier du thème (purgé à sa fin) ; hors thème, chemin inchangé',
        [await pixel(banniere), cleTheme.startsWith(`marchands/filet-theme/theme/${theme.id}/v1_`), cleStd],
        ['#0b3d2e', true, 'marchands/filet-theme/gen/v1/stamps_3_strip2x.png']);

      // ── Points d'entrée 3, 4, 5 : Google ──
      const classe = await googlePass.buildLoyaltyClass('c', enCours);
      const classeStd = await googlePass.buildLoyaltyClass('c', base);
      const objet = googlePass.buildLoyaltyObject('o', 'c', { prenom: 'Sarah', stored_value: 3 }, enCours, 's');
      const objetDore = googlePass.buildLoyaltyObject('o', 'c', { prenom: 'Sarah', stored_value: 10 }, enCours, 's');
      verifier('entrée 3 (classe Google) : fond, logo carré et texte du thème ; hors thème : classe standard, sans texte',
        [classe.hexBackgroundColor, classe.programLogo.sourceUri.uri, JSON.stringify(classe.textModulesData), classeStd.hexBackgroundColor, classeStd.textModulesData],
        ['#0b3d2e', theme.google_logo_url, JSON.stringify([{ id: 'theme', header: 'Ramadan', body: 'Ramadan Kareem' }]), '#111111', undefined]);
      verifier('entrée 4 (carte Google à l\'inscription) : fond du thème (le marchand a une couleur de récompense, l\'objet porte donc le fond) ; récompense : doré prioritaire',
        [objet.hexBackgroundColor, objetDore.hexBackgroundColor], ['#0b3d2e', '#aa0000']);
      appelsGoogle.length = 0;
      await googlePass.updateLoyaltyObjectPoints('s5', 'x', 3, 10, 10, null, 'Sarah', '#111111', '#aa0000', enCours);
      await googlePass.updateLoyaltyObjectPoints('s5', 'x', 10, 10, 10, null, 'Sarah', '#111111', '#aa0000', enCours);
      await googlePass.updateLoyaltyObjectPoints('s5', 'x', 3, 10, 10, null, 'Sarah', '#111111', '#aa0000', base);
      verifier('entrée 5 (mise à jour Google : scan, ajustement, bascule) : fond du thème même si l\'appelant passe la couleur standard ; doré prioritaire ; hors thème : couleur standard',
        appelsGoogle.filter(a => a.methode === 'PATCH').map(a => a.corps.hexBackgroundColor), ['#0b3d2e', '#aa0000', '#111111']);

      // ── Point d'entrée 6 : l'aperçu « Ma carte » ──
      const ap = await T.apercu(T.avecTheme(base, theme));
      const apStd = await T.apercu(base);
      verifier('entrée 6 (aperçu « Ma carte ») : couleurs, logo et texte du thème ; carte standard sans texte',
        [ap.couleur_fond, ap.logo_url, ap.texte_case, apStd.couleur_fond, apStd.texte_case],
        ['#0b3d2e', theme.logo_url, 'Ramadan Kareem', '#111111', null]);

      // ── Routes du marchand et de l'admin ──
      const MT = 'e3600000-0000-4000-8000-000000000001', MPRO = 'e3600000-0000-4000-8000-000000000002';
      // Marchand réaliste (tampons, bannière générée, logo) : l'aperçu montre la vraie carte.
      sql(`INSERT INTO marchands (id, nom, slug, langue, forfait, type_programme, max_value, display_max_value, couleur_fond, couleur_texte,
                                  couleur_label, strip_mode, stamp_icon, logo_url, themes_actifs)
           VALUES ('${MT}', 'Filet Thème', 'filet-theme', 'fr', 'pro_plus', 'stamps', 9, 9, '#4a1a2a', '#ffffff', '#e8b4a0', 'stamps', 'coffee', 'https://logos.exemple/standard.png', true),
                  ('${MPRO}', 'Filet Thème Pro', 'filet-theme-pro', 'fr', 'pro', 'stamps', 10, 10, '#111111', '#f5f5f5', '#a0a0b0', NULL, 'coffee', NULL, true)`);
      const tMT = jeton(MT);
      const mauvais = await api('POST', `/api/admin/marchands/${MT}/themes`, jetonAdmin, { ...theme, id: undefined, couleur_fond: 'vert' });
      const cree = await api('POST', `/api/admin/marchands/${MT}/themes`, jetonAdmin, { ...theme, id: undefined });
      const cree2 = await api('POST', `/api/admin/marchands/${MT}/themes`, jetonAdmin, { nom: 'Fête nationale', couleur_fond: '#00732f', message_ouverture: 'Bonne fête nationale !' });
      const doublon = await api('POST', `/api/admin/marchands/${MT}/themes`, jetonAdmin, { nom: 'Ramadan', couleur_fond: '#000000', message_ouverture: 'x' });
      verifier('admin : thème mal formé refusé (400 lisible) ; thèmes créés ; même nom refusé (409)',
        [mauvais.statut, /couleur_fond/.test(mauvais.corps.error || ''), cree.statut, cree2.statut, doublon.statut], [400, true, 201, 201, 409]);
      const idT = cree.corps.id, idT2 = cree2.corps.id;
      const pro = await api('GET', '/api/merchants/me/themes', jeton(MPRO));
      const proPost = await api('POST', '/api/merchants/me/theme', jeton(MPRO), { theme_id: idT, debut: T.aujourdhui(), fin: T.aujourdhui() });
      // « La caisse prime » : les aperçus se préparent en admin (ici, l'ouverture des
      // thèmes dans la fiche admin) ; le marchand ne fait que lire le cache.
      // Interrupteur de l'admin (comme la landing premium) : Pro+ fermé → rien.
      sql(`UPDATE marchands SET themes_actifs = false WHERE id = '${MT}'`);
      const ferme = await api('GET', '/api/merchants/me/themes', tMT);
      const fermePost = await api('POST', '/api/merchants/me/theme', tMT, { theme_id: idT, debut: T.aujourdhui(), fin: T.aujourdhui() });
      const meFerme = (await api('GET', '/api/merchants/me', tMT)).corps.themes_actifs;
      sql(`UPDATE marchands SET themes_actifs = true WHERE id = '${MT}'`);
      verifier('interrupteur admin : Pro+ non ouvert par l\'admin → onglet non éligible, choix refusé (403), /me le dit (le dashboard cache l\'onglet)',
        [ferme.corps.eligible, fermePost.statut, meFerme, (await api('GET', '/api/merchants/me', tMT)).corps.themes_actifs], [false, 403, false, true]);
      const adminListe = await api('GET', `/api/admin/marchands/${MT}/themes`, jetonAdmin);
      const liste = await api('GET', '/api/merchants/me/themes', tMT);
      verifier('« Ma carte » : réservé à Pro+ (Pro : non éligible, choix refusé 403) ; Pro+ : carte standard + chaque thème avec son aperçu',
        [pro.corps.eligible, proPost.statut, liste.corps.eligible, liste.corps.standard.couleur_fond, liste.corps.themes.map(x => `${x.nom}:${x.apercu.couleur_fond}:${x.apercu.texte_case}`).join(','), liste.corps.actif],
        [false, 403, true, '#4a1a2a', 'Ramadan:#0b3d2e:Ramadan Kareem,Fête nationale:#00732f:null', null]);
      const cartes = [liste.corps.standard, ...liste.corps.themes.map(x => x.apercu)];
      const fondBanniere = async a => (a.banniere || '').startsWith('data:image/png;base64,')
        ? pixel(Buffer.from(a.banniere.split(',')[1], 'base64')) : null;
      verifier('aperçu = la vraie carte : la VRAIE bannière (générée, avec sa progression) peinte sur le fond de chaque carte ; logo réel (celui du thème, sinon le logo de base) ; progression « 3 / 9 » ; QR d\'exemple',
        [await Promise.all(cartes.map(fondBanniere)), cartes.map(a => a.logo_url), cartes.map(a => `${a.rempli} / ${a.max}`), /^data:image\/png/.test(liste.corps.qr || '')],
        [['#4a1a2a', '#0b3d2e', '#00732f'], ['https://logos.exemple/standard.png', theme.logo_url, 'https://logos.exemple/standard.png'], ['3 / 9', '3 / 9', '3 / 9'], true]);
      // Thème posé sans passer par l'admin (donc jamais préparé) : le marchand ne
      // le calcule pas, ni à la première ouverture ni à la seconde ; l'admin, si.
      // Sur un marchand à part (MH), que l'admin n'a jamais touché : sur MT, la
      // préparation lancée en arrière-plan par les créations de thèmes ci-dessus
      // pouvait encore tourner, relire la liste et préparer « Hiver » (test
      // instable ≈ 1 fois sur 3, corrigé le 18/10).
      const MH = 'e3600000-0000-4000-8000-0000000000b4';
      sql(`INSERT INTO marchands (id, nom, slug, langue, forfait, type_programme, max_value, display_max_value, couleur_fond, couleur_texte,
                                  couleur_label, strip_mode, stamp_icon, logo_url, themes_actifs)
           VALUES ('${MH}', 'Filet Thème Hiver', 'filet-theme-hiver', 'fr', 'pro_plus', 'stamps', 9, 9, '#4a1a2a', '#ffffff', '#e8b4a0', 'stamps', 'coffee', 'https://logos.exemple/standard.png', true)`);
      const idHiver = sql(`INSERT INTO themes_marchand (marchand_id, nom, couleur_fond, message_ouverture)
                           VALUES ('${MH}', 'Hiver', '#1d3557', 'Bon hiver !') RETURNING id`);
      const tMH = jeton(MH);
      const hiver = async () => (await api('GET', '/api/merchants/me/themes', tMH)).corps.themes.find(x => x.nom === 'Hiver').apercu;
      const h1 = await hiver(), h2 = await hiver();
      await api('GET', `/api/admin/marchands/${MH}/themes`, jetonAdmin);
      const h3 = await hiver();
      sql(`DELETE FROM themes_marchand WHERE id = '${idHiver}'; DELETE FROM marchands WHERE id = '${MH}'`);
      verifier('« la caisse prime » : côté marchand, lecture du cache SEULEMENT (thème non préparé : pas de bannière, « en préparation », toujours rien à la 2e ouverture) ; préparé à l\'ouverture de la fiche admin, puis servi au marchand',
        [adminListe.statut, h1.banniere, h1.banniere_en_preparation, h2.banniere, await fondBanniere(h3), h3.banniere_en_preparation],
        [200, null, true, null, '#1d3557', false]);
      const jour = T.aujourdhui(), demain = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
      const erreurs = [];
      for (const [d, f] of [['2026-13-01', jour], ['2020-01-01', jour], [jour, '2020-01-01'], [jour, '2099-01-01']]) {
        erreurs.push((await api('POST', '/api/merchants/me/theme', tMT, { theme_id: idT, debut: d, fin: f })).corps.error);
      }
      verifier('dates contrôlées : invalide, début passé, fin avant début, plus de 3 mois',
        erreurs, ['dates_invalides', 'debut_passe', 'fin_avant_debut', 'duree_trop_longue']);
      const prog = await api('POST', '/api/merchants/me/theme', tMT, { theme_id: idT2, debut: demain, fin: demain });
      const remplace = await api('POST', '/api/merchants/me/theme', tMT, { theme_id: idT, debut: jour, fin: demain });
      const actif = JSON.parse(sql(`SELECT theme_actif FROM marchands WHERE id = '${MT}'`));
      const second = await api('POST', '/api/merchants/me/theme', tMT, { theme_id: idT2, debut: demain, fin: demain });
      const modif = await api('PATCH', `/api/admin/marchands/${MT}/themes/${idT}`, jetonAdmin, { texte_case: 'autre' });
      const suppr = await api('DELETE', `/api/admin/marchands/${MT}/themes/${idT}`, jetonAdmin);
      const basculeFinie = await attendre(async () => sql(`SELECT theme_bascule IS NULL FROM marchands WHERE id = '${MT}'`) === 't');
      verifier('choix : début demain → programmé ; remplacé par un autre dont le début est aujourd\'hui → ouvert tout de suite (copie du thème sur la fiche) ; un seul thème à la fois (409) ; thème choisi ni modifiable ni supprimable (409) ; bascule terminée (serveur du filet sans Apple ni Google)',
        [prog.corps.etat, remplace.corps.etat, actif.etat, actif.nom, actif.texte_case, actif.debut, second.statut, second.corps.error, modif.statut, suppr.statut, basculeFinie],
        ['programme', 'en_cours', 'en_cours', 'Ramadan', 'Ramadan Kareem', jour, 409, 'theme_en_cours', 409, 409, true]);
      const arret = await api('DELETE', '/api/merchants/me/theme', tMT);
      verifier('arrêt par le marchand : retour à la carte standard (fiche sans thème) ; bascule silencieuse lancée et terminée',
        [arret.statut, sql(`SELECT theme_actif IS NULL FROM marchands WHERE id = '${MT}'`),
         await attendre(async () => sql(`SELECT theme_bascule IS NULL FROM marchands WHERE id = '${MT}'`) === 't')], [200, 't', true]);
      const rouvert = await api('POST', '/api/merchants/me/theme', tMT, { theme_id: idT, debut: jour, fin: jour });
      const coupe = await api('PATCH', `/api/admin/marchands/${MT}`, jetonAdmin, { themes_actifs: false });
      const ferme2 = await attendre(async () => sql(`SELECT theme_actif IS NULL AND theme_bascule IS NULL FROM marchands WHERE id = '${MT}'`) === 't');
      await api('PATCH', `/api/admin/marchands/${MT}`, jetonAdmin, { themes_actifs: true });
      verifier('admin décoche les cartes à thème pendant un thème en cours : retour silencieux à la carte standard',
        [rouvert.corps.etat, coupe.statut, coupe.corps.themes_actifs, ferme2], ['en_cours', 200, false, true]);

      // Précalcul en admin de TOUS les états des vraies cartes (tampons : 0 à 9) :
      // à l'activation, tout sort du cache, rien n'est dessiné.
      const prep = await T.preparerApercus(MT);
      const themesMT = JSON.parse(sql(`SELECT json_agg(t) FROM themes_marchand t WHERE marchand_id = '${MT}'`));
      const ficheMT = JSON.parse(sql(`SELECT row_to_json(m) FROM marchands m WHERE id = '${MT}'`));
      const manquants = [];
      for (const t of themesMT) for (let v = 0; v <= 9; v++) for (const variante of ['strip2x', 'strip3x', 'hero']) {
        if (!await stripCache.lireCache({ marchand: T.avecTheme({ ...ficheMT, theme_actif: null }, t), filledCount: v, variant: variante })) manquants.push(`${t.nom}:${v}:${variante}`);
      }
      verifier('préparation en admin : aperçus (standard + 2 thèmes) puis TOUS les états des vraies cartes de chaque thème (2 × 10 soldes), les 3 variantes (Apple 2x, 3x, Google) en cache',
        [prep.apercus, prep.bannieres, manquants], [3, 20, []]);

      // ── Bascule : iPhone et Google, par lots, au débit, tracée ──
      const pousses = [], objets = [], messages = [], classes = [];
      T._pourTests({ config: { iphoneParLot: 2, googleParLot: 2, lotMs: 0 }, envoyeurs: {
        appleActif: () => true, googleActif: () => true,
        apple: async j => { pousses.push(j); if (j.endsWith('-panne')) throw new Error('APNs 410'); },
        classe: async m => { classes.push(T.appliquerTheme(m).couleur_fond); },
        objet: async (carte, m) => { objets.push(`${carte.serial_number.slice(0, 6)}:${carte.prenom}:${carte.stored_value}:${T.appliquerTheme(m).couleur_fond}`); },
        message: async (serial, texte) => { messages.push(texte); },
      } });
      const MB = 'e3600000-0000-4000-8000-000000000003', MAUTRE = 'e3600000-0000-4000-8000-000000000004';
      sql(`INSERT INTO marchands (id, nom, slug, langue, forfait, type_programme, max_value, display_max_value, couleur_fond)
           VALUES ('${MB}', 'Filet Bascule', 'filet-bascule', 'fr', 'pro_plus', 'stamps', 10, 10, '#111111'),
                  ('${MAUTRE}', 'Filet Bascule Autre', 'filet-bascule-autre', 'fr', 'pro_plus', 'stamps', 10, 10, '#111111')`);
      sql(`UPDATE marchands SET themes_actifs = true WHERE id IN ('${MB}', '${MAUTRE}')`);
      const carte = (mid, { jeton: j = null, google = false, ouvert = false } = {}) => {
        const id = crypto.randomUUID(), serial = crypto.randomUUID(), passId = crypto.randomUUID();
        sql(`INSERT INTO clients (id, marchand_id, prenom, stored_value, pass_serial_number) VALUES ('${id}', '${mid}', 'B${serial.slice(0, 2)}', 4, '${serial}');
             INSERT INTO passes (id, client_id, marchand_id, serial_number, updated_at, google_pass_url) VALUES ('${passId}', '${id}', '${mid}', '${serial}', now() - interval '3 days', ${google ? "'https://pay.google.com/x'" : 'NULL'});
             ${j ? `INSERT INTO device_tokens (pass_id, client_id, marchand_id, serial_number, device_id, push_token) VALUES ('${passId}', '${id}', '${mid}', '${serial}', 'app-${serial}', '${j}');` : ''}
             ${ouvert ? `UPDATE passes SET google_ouvert_le = now() WHERE id = '${passId}';` : ''}`);
        rendreVisibles(`id = '${id}'`);
        return serial;
      };
      const a1 = carte(MB, { jeton: 'th-1' }), a2 = carte(MB, { jeton: 'th-2' }), a3 = carte(MB, { jeton: 'th-3-panne' });
      const g1 = carte(MB, { google: true }), g2 = carte(MB, { google: true, jeton: 'th-4', ouvert: true });
      const iphoneSeul = carte(MB, { google: true, jeton: 'th-5' });   // lien Google jamais ouvert : D2, pas de Google
      const autre = carte(MAUTRE, { jeton: 'autre-1' });
      const choisi = { ...theme, id: idT, debut: jour, fin: demain, etat: 'programme' };
      sql(`UPDATE marchands SET theme_actif = '${JSON.stringify(choisi).replace(/'/g, "''")}' WHERE id = '${MB}'`);
      const majRecente = sr => sql(`SELECT updated_at > now() - interval '1 minute' FROM passes WHERE serial_number = '${sr}'`);
      const passage1 = await T.passage();
      await attendre(async () => sql(`SELECT theme_bascule IS NULL FROM marchands WHERE id = '${MB}'`) === 't', 8000);
      verifier('ouverture au passage du cron (début arrivé) : un push par iPhone du marchand (5, lots de 2), message d\'ouverture sur ses cartes iPhone, cartes marquées modifiées ; jamais un autre marchand',
        [passage1.ouverts, pousses.slice().sort().join(','), [a1, a2, a3, g2, iphoneSeul].map(sr => messageCarte(sr) === theme.message_ouverture ? 'm' : '-').join(''),
         [a1, a2, a3].map(majRecente).join(''), majRecente(autre), messageCarte(autre)],
        [1, 'th-1,th-2,th-3-panne,th-4,th-5', 'mmmmm', 'ttt', 'f', '']);
      verifier('… Google : la classe une fois aux couleurs du thème, puis chaque carte Google réelle (règle D2) redessinée (prénom, solde, fond du thème) avec le message d\'ouverture',
        [classes, objets.map(o => o.split(':').slice(1).join(':')).sort(), objets.map(o => o.slice(0, 6)).sort().join(','), messages],
        [['#0b3d2e'], [`B${g1.slice(0, 2)}:4:#0b3d2e`, `B${g2.slice(0, 2)}:4:#0b3d2e`].sort(), [g1, g2].map(x => x.slice(0, 6)).sort().join(','), [theme.message_ouverture, theme.message_ouverture]]);
      verifier('… chaque envoi tracé dans notification_envois, source « theme » (CLAUDE.md), l\'échec compris ; aucun quota consommé',
        [sql(`SELECT count(*) || '|' || count(*) FILTER (WHERE NOT ok) || '|' || count(*) FILTER (WHERE plateforme = 'google') FROM notification_envois WHERE source = 'theme' AND marchand_id = '${MB}'`),
         sql(`SELECT count(*) FROM campagnes WHERE marchand_id = '${MB}'`)], ['7|1|2', '0']);

      // Reprise après redémarrage : bascule de fin interrompue après le premier lot iPhone.
      pousses.length = 0; objets.length = 0; messages.length = 0; classes.length = 0;
      const premier = sql(`SELECT id FROM device_tokens WHERE marchand_id = '${MB}' ORDER BY id LIMIT 1 OFFSET 1`);
      const enCoursB = JSON.parse(sql(`SELECT theme_actif FROM marchands WHERE id = '${MB}'`));
      sql(`UPDATE marchands SET theme_actif = NULL, theme_bascule = '${JSON.stringify({ sens: 'fin', theme_id: idT, message: null, cree_le: '2026-10-14T00:00:00.000Z',
        apple_apres: premier, apple_fini: false, google_apres: null, google_fini: false, classe_ok: false })}' WHERE id = '${MB}'`);
      const passage2 = await T.passage();
      await attendre(async () => sql(`SELECT theme_bascule IS NULL FROM marchands WHERE id = '${MB}'`) === 't', 8000);
      verifier('fin de thème interrompue (redémarrage) : reprise au curseur par le passage suivant (seuls les iPhone restants), retour SILENCIEUX (aucun message, ni iPhone ni Google), classe et cartes Google remises au standard',
        [enCoursB.etat, passage2.reprises, pousses.length, messages.length, classes, objets.map(o => o.split(':')[3])],
        ['en_cours', 1, 3, 0, ['#111111'], ['#111111', '#111111']]);
      const avant = Number(sql(`SELECT count(*) FROM notification_envois WHERE source = 'theme' AND marchand_id = '${MB}'`));
      sql(`UPDATE marchands SET theme_actif = '${JSON.stringify({ ...choisi, etat: 'en_cours', fin: '2026-01-01' }).replace(/'/g, "''")}' WHERE id = '${MB}'`);
      const passage3 = await T.passage();
      await attendre(async () => sql(`SELECT theme_bascule IS NULL FROM marchands WHERE id = '${MB}'`) === 't', 8000);
      verifier('fin de thème au passage du cron (jour de fin passé) : fiche remise au standard, toutes les cartes mises à jour sans message, tracé',
        [passage3.fermes, sql(`SELECT theme_actif IS NULL FROM marchands WHERE id = '${MB}'`), messages.length,
         Number(sql(`SELECT count(*) FROM notification_envois WHERE source = 'theme' AND marchand_id = '${MB}'`)) - avant],
        [1, 't', 0, 7]);
    } finally {
      globalThis.fetch = fetchOrigine;
      modules.forEach(x => delete require.cache[x]);
      for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
      Object.assign(process.env, env);
      fs.rmSync(dossier, { recursive: true, force: true });
    }
    }
  }

  // ── API v1, étape 1 : le socle d'accès (migration 066, 20/10) ───────────────
  titre('API v1, étape 1 : clés d\'API, réglages de conversion, canal (20/10)');
  {
    const sha = x => crypto.createHash('sha256').update(x).digest('hex');
    const attendreMs = ms => new Promise(ok => setTimeout(ok, ms));
    const RELAIS = '198.51.100.1';
    // Serveur A : mémoire des clés à 1,5 s (au lieu de 60 s), limite par clé haute.
    const sA = await demarrerServeur('api-v1-a', urlSupabase, { API_CLE_CACHE_MS: '1500', API_V1_MAX_PAR_MINUTE: '1000' });
    const appel = (srv, methode, chemin, auth, corps, ip = '203.0.113.90') => fetch(srv.url + chemin, { method: methode,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `${ip}, ${RELAIS}`, ...(auth ? { Authorization: auth } : {}) },
      body: corps === undefined ? undefined : JSON.stringify(corps) })
      .then(async r => { const t = await r.text(); let c; try { c = JSON.parse(t); } catch { c = t; } return { statut: r.status, corps: c, retry: r.headers.get('retry-after') }; });
    let srvAdmin = sA;   // les clés de la 2e partie se créent par le serveur B
    const adm = (methode, chemin, corps) => appel(srvAdmin, methode, chemin, `Bearer ${jetonAdmin}`, corps);
    const ping = (srv, k, ip) => appel(srv, 'GET', '/api/v1/ping', k === undefined ? undefined : `Bearer ${k}`, undefined, ip);

    // Migration : réglages par défaut, canal du journal.
    verifier('réglages par défaut d\'un commerçant : 100 fils = 1 point, plafond 5 000 000 fils (50 000 AED)',
      sql(`SELECT fils_par_point || '|' || plafond_vente_fils FROM marchands WHERE id = '${M.tampons}'`), '100|5000000');
    const cScan = client(M.tampons);
    await scan(tT, cScan.serial);
    verifier('journal : un scan du comptoir est marqué canal « comptoir », sans référence ni montant ; aucun scan hors comptoir',
      [sql(`SELECT canal || '|' || coalesce(reference_externe, '-') || '|' || coalesce(montant_fils::text, '-') FROM scans WHERE client_id = '${cScan.id}'`),
       sql(`SELECT count(*) FROM scans WHERE canal <> 'comptoir'`)], ['comptoir|-|-', '0']);
    verifier('la base refuse un canal inconnu et un montant nul ou négatif',
      [refuseParLaBase(`UPDATE scans SET canal = 'borne' WHERE client_id = '${cScan.id}'`),
       refuseParLaBase(`UPDATE scans SET montant_fils = 0 WHERE client_id = '${cScan.id}'`)], [true, true]);

    // Réglages dans l'admin : entiers en fils, bornés.
    const reglage = async corps => (await adm('PATCH', `/api/admin/marchands/${M.points}`, corps)).statut;
    const okR = [await reglage({ fils_par_point: 50, plafond_vente_fils: 100000 }),
      sql(`SELECT fils_par_point || '|' || plafond_vente_fils FROM marchands WHERE id = '${M.points}'`)];
    const refusR = [];
    for (const corps of [{ fils_par_point: 0 }, { fils_par_point: -5 }, { fils_par_point: 2.5 }, { fils_par_point: '100' },
      { fils_par_point: null }, { plafond_vente_fils: 99 }, { plafond_vente_fils: 1000000001 }]) refusR.push(await reglage(corps));
    verifier('admin : conversion et plafond réglés (2 points par AED, plafond 1 000 AED) ; 0, négatif, décimal, texte, vide, hors bornes → 400, rien changé',
      [okR, refusR, sql(`SELECT fils_par_point || '|' || plafond_vente_fils FROM marchands WHERE id = '${M.points}'`)],
      [[200, '50|100000'], [400, 400, 400, 400, 400, 400, 400], '50|100000']);
    await reglage({ fils_par_point: 100, plafond_vente_fils: 5000000 });

    // Création : la clé n'est montrée qu'une fois, la base n'en garde que l'empreinte.
    const cree = await adm('POST', `/api/admin/marchands/${M.tampons}/cles-api`, { environnement: 'live' });
    const kLive = cree.corps.cle;
    verifier('admin : clé de production créée (wwk_live_ + 40 caractères), préfixe lisible, en base seulement l\'empreinte sha256',
      [cree.statut, /^wwk_live_[A-Za-z0-9_-]{40}$/.test(kLive), cree.corps.prefixe === kLive.slice(0, 15),
       sql(`SELECT count(*) FROM api_cles WHERE id = '${cree.corps.id}' AND empreinte = '${sha(kLive)}'`),
       sql(`SELECT count(*) FROM api_cles WHERE empreinte = '${kLive}' OR prefixe = '${kLive}'`)],
      [201, true, true, '1', '0']);
    const kTest = (await adm('POST', `/api/admin/marchands/${M.tampons}/cles-api`, { environnement: 'test' })).corps.cle;
    const liste = await adm('GET', `/api/admin/marchands/${M.tampons}/cles-api`);
    verifier('admin : la liste ne contient jamais la clé ni son empreinte',
      [liste.statut, liste.corps.length, liste.corps.every(k => !('cle' in k) && !('empreinte' in k)), JSON.stringify(liste.corps).includes(kLive.slice(15))],
      [200, 2, true, false]);
    const refusAdm = [(await adm('POST', `/api/admin/marchands/${M.tampons}/cles-api`, { environnement: 'prod' })).statut,
      (await adm('POST', `/api/admin/marchands/${crypto.randomUUID()}/cles-api`, { environnement: 'live' })).statut,
      (await appel(sA, 'POST', `/api/admin/marchands/${M.tampons}/cles-api`, `Bearer ${tT}`, { environnement: 'live' })).statut,
      (await appel(sA, 'POST', `/api/admin/marchands/${M.tampons}/cles-api`, `Bearer ${kLive}`, { environnement: 'live' })).statut,
      (await appel(sA, 'GET', `/api/admin/marchands/${M.tampons}/cles-api`)).statut];
    verifier('admin : environnement inconnu 400, marchand inconnu 404 ; jeton marchand 403, clé d\'API 401, sans jeton 401',
      refusAdm, [400, 404, 403, 401, 401]);

    // Authentification : seule une clé d'API ouvre /api/v1, et elle n'ouvre rien d'autre.
    const p1 = await ping(sA, kLive), p2 = await ping(sA, kTest);
    verifier('/api/v1/ping avec la clé : 200, environnement (production / test), aucune donnée du commerçant',
      [p1.statut, p1.corps, p2.corps.environnement], [200, { ok: true, environnement: 'live' }, 'test']);
    verifier('dernière utilisation de la clé notée', sql(`SELECT derniere_utilisation_le IS NOT NULL FROM api_cles WHERE id = '${cree.corps.id}'`), 't');
    const refusAuth = [await ping(sA, undefined), await ping(sA, 'n-importe-quoi'), await ping(sA, `wwk_live_${'A'.repeat(40)}`),
      await ping(sA, tT), await ping(sA, tB1), await ping(sA, jetonAdmin)];
    verifier('/api/v1 sans clé, clé mal formée, clé inconnue, jeton marchand, jeton boutique, jeton admin : 401 « cle_invalide »',
      [refusAuth.map(r => r.statut), refusAuth.every(r => r.corps.error === 'cle_invalide')], [[401, 401, 401, 401, 401, 401], true]);
    verifier('la clé d\'API n\'ouvre rien d\'autre : dashboard 401, caisse (scan) 401',
      [(await appel(sA, 'GET', '/api/merchants/me', `Bearer ${kLive}`)).statut,
       (await appel(sA, 'POST', '/api/scan', `Bearer ${kLive}`, { serial_number: cScan.serial, cle_idempotence: crypto.randomUUID() })).statut],
      [401, 401]);
    verifier('route inconnue de /api/v1 (avec une clé) : 404 JSON', [(await appel(sA, 'GET', '/api/v1/ventes', `Bearer ${kLive}`)).statut], [404]);

    // Révocation.
    const rev = await adm('POST', `/api/admin/cles-api/${cree.corps.id}/revoquer`);
    const apres = await ping(sA, kLive);
    const rev2 = await adm('POST', `/api/admin/cles-api/${cree.corps.id}/revoquer`);
    verifier('révocation depuis l\'admin : effective tout de suite sur ce serveur (401) ; la redemander ne change pas sa date ; clé inconnue 404',
      [rev.statut, apres.statut, rev2.statut, rev2.corps.revoquee_le === rev.corps.revoquee_le,
       (await adm('POST', `/api/admin/cles-api/${crypto.randomUUID()}/revoquer`)).statut], [200, 401, 200, true, 404]);
    const kT2 = (await adm('POST', `/api/admin/marchands/${M.tampons}/cles-api`, { environnement: 'live' })).corps.cle;
    await ping(sA, kT2);
    sql(`UPDATE api_cles SET revoquee_le = now() WHERE empreinte = '${sha(kT2)}'`);   // comme depuis un autre serveur
    const pendant = (await ping(sA, kT2)).statut;
    await attendreMs(1700);
    verifier('révocation faite ailleurs : la clé sert au plus le temps de sa mémoire (60 s en production, 1,5 s ici), puis 401',
      [pendant, (await ping(sA, kT2)).statut], [200, 401]);

    // Commerçant suspendu.
    const kS = (await adm('POST', `/api/admin/marchands/${M.suspendu}/cles-api`, { environnement: 'live' })).corps.cle;
    const avantS = (await ping(sA, kS)).statut;
    sql(`UPDATE marchands SET actif = false WHERE id = '${M.suspendu}'`);
    await attendreMs(1700);
    const suspendu = await ping(sA, kS);
    sql(`UPDATE marchands SET actif = true WHERE id = '${M.suspendu}'`);
    verifier('commerçant suspendu : 403 « commercant_suspendu » (au plus le temps de la mémoire)',
      [avantS, suspendu.statut, suspendu.corps.error], [200, 403, 'commercant_suspendu']);

    // Hors du limiteur global (300 / 15 min par adresse).
    const kG = (await adm('POST', `/api/admin/marchands/${M.points}/cles-api`, { environnement: 'live' })).corps.cle;
    const ipCentrale = '203.0.113.91';
    const rafale = await Promise.all(Array.from({ length: 320 }, () => ping(sA, kG, ipCentrale)));
    verifier('serveur central : 320 appels de suite depuis une adresse passent (hors du limiteur global), le dashboard de la même adresse n\'est pas freiné',
      [rafale.every(r => r.statut === 200), (await appel(sA, 'GET', '/api/merchants/me', `Bearer ${tP}`, undefined, ipCentrale)).statut],
      [true, 200]);
    sA.processus.kill();

    // Serveur B : 5 appels / min / clé, 3 échecs / 15 min / adresse.
    const sB = await demarrerServeur('api-v1-b', urlSupabase, { API_V1_MAX_PAR_MINUTE: '5', API_V1_ECHECS_MAX: '3' });
    srvAdmin = sB;
    const kB1 = (await adm('POST', `/api/admin/marchands/${M.tampons}/cles-api`, { environnement: 'live' })).corps.cle;
    const kB2 = (await adm('POST', `/api/admin/marchands/${M.points}/cles-api`, { environnement: 'live' })).corps.cle;
    const serie = [];
    for (let i = 0; i < 6; i++) serie.push(await ping(sB, kB1, '203.0.113.92'));
    verifier('limite par clé : la 6e requête de la minute reçoit 429 « trop_de_requetes » avec Retry-After ; une autre clé, même adresse, passe',
      [serie.map(r => r.statut), serie[5].corps.error, Number(serie[5].retry) > 0, (await ping(sB, kB2, '203.0.113.92')).statut],
      [[200, 200, 200, 200, 200, 429], 'trop_de_requetes', true, 200]);
    const ipMal = '203.0.113.93';
    await ping(sB, kB2, ipMal);   // clé reconnue depuis cette adresse
    const essais = [];
    for (let i = 0; i < 4; i++) essais.push(await ping(sB, `wwk_live_${String(i).repeat(40)}`, ipMal));
    const kNeuve = (await adm('POST', `/api/admin/marchands/${M.points}/cles-api`, { environnement: 'live' })).corps.cle;
    verifier('3 échecs depuis une adresse : elle ne peut plus essayer de clé nouvelle (429) ; une clé déjà reconnue y passe toujours ; une autre adresse n\'est pas touchée',
      [essais.map(r => r.statut), (await ping(sB, kB2, ipMal)).statut, (await ping(sB, kNeuve, ipMal)).statut, (await ping(sB, kNeuve, '203.0.113.94')).statut],
      [[401, 401, 401, 429], 200, 429, 200]);
    sB.processus.kill();
  }

  // ── API v1, étape 2 : POST /ventes (migration 067, 21/10) ───────────────────
  titre('API v1, étape 2 : créditer une vente (POST /api/v1/ventes, 21/10)');
  {
    const s2 = await demarrerServeur('api-v1-ventes', urlSupabase, { API_V1_MAX_PAR_MINUTE: '5000' });
    const attendreMs = ms => new Promise(ok => setTimeout(ok, ms));
    const appel = (methode, chemin, auth, corps) => fetch(s2.url + chemin, { method: methode,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body: corps === undefined ? undefined : JSON.stringify(corps) })
      .then(async r => { const t = await r.text(); let c; try { c = JSON.parse(t); } catch { c = t; } return { statut: r.status, corps: c }; });
    const adm = (methode, chemin, corps) => appel(methode, chemin, `Bearer ${jetonAdmin}`, corps);
    const cleDe = async m => (await adm('POST', `/api/admin/marchands/${m}/cles-api`, { environnement: 'live' })).corps.cle;
    const kP = await cleDe(M.points), kT = await cleDe(M.tampons), kR = await cleDe(M.reseau);
    const vente = (k, corps) => appel('POST', '/api/v1/ventes', `Bearer ${k}`, corps);
    let n = 0;
    const ref = () => `BT-TEST-${Date.now()}-${++n}`;
    const ligne = id => sql(`SELECT canal || '|' || coalesce(reference_externe, '-') || '|' || coalesce(montant_fils::text, '-') || '|' || coalesce(point_de_vente_id::text, '-') || '|' || (vendu_le IS NOT NULL)
      FROM scans WHERE client_id = '${id}' ORDER BY date_scan DESC, id DESC LIMIT 1`);

    // Vente simple, puis renvois.
    const cP = client(M.points);
    const r1 = ref();
    const v1 = await vente(kP, { reference: r1, carte: cP.serial, montant: 18550, devise: 'AED' });
    verifier('vente en points : 185,50 AED → 185 points (1 point par AED, arrondi bas), réponse complète, aucune donnée personnelle',
      [v1.statut, v1.corps, JSON.stringify(v1.corps).includes('Filet')],
      [200, { ok: true, reference: r1, enregistree: true, deja_enregistree: false, programme: 'points', points_credites: 185, solde: 185,
        seuil: 500, seuil_atteint: false, recompense_a_remettre: false, telephone: null }, false]);
    verifier('journal : une ligne canal « caisse », référence, montant en fils ; la carte a reçu son message',
      [ligne(cP.id), lignes(cP.id), messageCarte(cP.serial)], [`caisse|${r1}|18550|-|false`, 1, '+185 — Filet : 185/500 pts']);
    const v1b = await vente(kP, { reference: r1, carte: cP.serial, montant: 18550 });
    verifier('même vente renvoyée : 200 « deja_enregistree », mêmes chiffres, rien recrédité',
      [v1b.statut, v1b.corps.deja_enregistree, v1b.corps.points_credites, v1b.corps.solde, solde(cP.id), lignes(cP.id)], [200, true, 185, 185, 185, 1]);
    const autreMontant = await vente(kP, { reference: r1, carte: cP.serial, montant: 18599 });
    const cP2 = client(M.points);
    const autreCarte = await vente(kP, { reference: r1, carte: cP2.serial, montant: 18550 });
    verifier('même référence avec un autre montant (même nombre de points) ou une autre carte : 409 « reference_deja_utilisee », rien écrit',
      [autreMontant.statut, autreMontant.corps.error, autreCarte.statut, autreCarte.corps.error, solde(cP.id), lignes(cP.id), lignes(cP2.id)],
      [409, 'reference_deja_utilisee', 409, 'reference_deja_utilisee', 185, 1, 0]);
    const paralleles = await Promise.all([1, 2, 3].map(() => vente(kP, { reference: 'BT-PARALLELE-1', carte: cP2.serial, montant: 1000 })));
    verifier('trois envois simultanés de la même vente : un seul crédit',
      [paralleles.every(r => r.statut === 200), paralleles.filter(r => r.corps.deja_enregistree === false).length, solde(cP2.id), lignes(cP2.id)], [true, 1, 10, 1]);

    // Identifiant : code court, carte inconnue.
    const parCode = await vente(kP, { reference: ref(), carte: `  ${cP.serial.slice(-6).toUpperCase()} `, montant: 1000 });
    verifier('carte par code court (6 caractères, majuscules, espaces) : créditée', [parCode.statut, parCode.corps.solde], [200, 195]);
    const inconnue = await vente(kP, { reference: ref(), carte: crypto.randomUUID(), montant: 1000 });
    const ailleurs = await vente(kP, { reference: ref(), carte: client(M.tampons).serial, montant: 1000 });
    verifier('carte inconnue ou d\'un autre commerçant : 404 « carte_inconnue » avec le lien d\'installation du commerçant',
      [inconnue.statut, inconnue.corps.error, String(inconnue.corps.lien_installation).endsWith('/l/filet-points'), ailleurs.statut], [404, 'carte_inconnue', true, 404]);
    const ambA = crypto.randomUUID().slice(0, 30) + 'abc123', ambB = crypto.randomUUID().slice(0, 30) + 'abc123';
    client(M.points, { serial: ambA }); client(M.points, { serial: ambB });
    verifier('code court partagé par deux cartes : 409 « carte_ambigue », rien crédité',
      [(await vente(kP, { reference: ref(), carte: 'ABC123', montant: 1000 })).corps.error], ['carte_ambigue']);

    // Conversion, plafond, vente à 0 point.
    const zero = await vente(kP, { reference: ref(), carte: cP.serial, montant: 99 });
    verifier('vente sous 1 point (0,99 AED) : 200 « enregistree: false », rien écrit', [zero.statut, zero.corps.enregistree, zero.corps.points_credites, lignes(cP.id)], [200, false, 0, 2]);
    sql(`UPDATE marchands SET fils_par_point = 50, plafond_vente_fils = 100000 WHERE id = '${M.points}'`);
    const double = await vente(kP, { reference: ref(), carte: cP.serial, montant: 1000 });
    const plafond = await vente(kP, { reference: ref(), carte: cP.serial, montant: 100001 });
    sql(`UPDATE marchands SET fils_par_point = 100, plafond_vente_fils = 5000000 WHERE id = '${M.points}'`);
    verifier('conversion réglée à 2 points par AED : 10 AED → 20 points ; au-delà du plafond (1 000 AED) : 422 « montant_hors_plafond », rien écrit',
      [double.corps.points_credites, plafond.statut, plafond.corps.error, solde(cP.id)], [20, 422, 'montant_hors_plafond', 215]);

    // Récompense, comme au comptoir.
    sql(`UPDATE clients SET stored_value = 480 WHERE id = '${cP.id}'`);
    const seuil = await vente(kP, { reference: ref(), carte: cP.serial, montant: 5000 });
    const remise = await vente(kP, { reference: ref(), carte: cP.serial, montant: 5000 });
    verifier('points : 480 + 50 = 530, seuil atteint (récompense acquise) ; vente suivante : récompense à remettre, solde 530 − 500 + 50 = 80',
      [[seuil.corps.solde, seuil.corps.seuil_atteint, seuil.corps.recompense_a_remettre], [remise.corps.solde, remise.corps.points_credites, remise.corps.seuil_atteint, remise.corps.recompense_a_remettre]],
      [[530, true, false], [80, 50, false, true]]);
    const cT = client(M.tampons, { solde: 9 });
    const t1 = await vente(kT, { reference: ref(), carte: cT.serial, montant: 999999 });
    const t2 = await vente(kT, { reference: ref(), carte: cT.serial, montant: 100 });
    verifier('tampons : 1 tampon par vente quel que soit le montant ; 9 → 10 seuil atteint ; vente suivante : remise, 0 tampon, solde 0',
      [[t1.corps.programme, t1.corps.points_credites, t1.corps.solde, t1.corps.seuil_atteint], [t2.corps.points_credites, t2.corps.solde, t2.corps.recompense_a_remettre]],
      [['tampons', 1, 10, true], [0, 0, true]]);

    // Pas de parrainage pour une vente de caisse (décision du 20/10).
    const parrain = client(M.tampons, { solde: 2 });
    const filleul = client(M.tampons, { parrain: parrain.id });
    await vente(kT, { reference: ref(), carte: filleul.serial, montant: 1000 });
    await attendreMs(800);
    verifier('premier crédit d\'un filleul par la caisse : le parrain n\'est PAS crédité (parrainage propre au comptoir)', [solde(filleul.id), solde(parrain.id)], [1, 2]);

    // Boutiques (codes caisse).
    const code = (pdv, c) => adm('PATCH', `/api/admin/points-de-vente/${pdv}/code-caisse`, { code_externe: c });
    const codes = [await code(B.b1, 'DXB-001'), await code(B.b2, 'DXB-002'), await code(B.coupee, 'DXB-003')];
    const doublon = await code(B.b2, 'DXB-001'), mauvais = await code(B.b2, 'DXB 002');
    verifier('admin : codes caisse posés ; même code sur deux boutiques 409 ; caractères interdits 400',
      [codes.map(r => r.statut), doublon.statut, mauvais.statut, (await adm('GET', `/api/admin/marchands/${M.reseau}/points-de-vente`)).corps.find(x => x.id === B.b1).code_externe],
      [[200, 200, 200], 409, 400, 'DXB-001']);
    const cR = client(M.reseau);
    const sansB = await vente(kR, { reference: ref(), carte: cR.serial, montant: 1000 });
    const inconnueB = await vente(kR, { reference: ref(), carte: cR.serial, montant: 1000, boutique: 'DXB-999' });
    const coupee = await vente(kR, { reference: ref(), carte: cR.serial, montant: 1000, boutique: 'DXB-003' });
    const okB = await vente(kR, { reference: ref(), carte: cR.serial, montant: 1000, boutique: 'DXB-001' });
    verifier('réseau : sans boutique 400 ; code inconnu 422 ; boutique coupée 403 ; bon code : vente rattachée à la boutique',
      [[sansB.statut, sansB.corps.champ], [inconnueB.statut, inconnueB.corps.error], [coupee.statut, coupee.corps.error], okB.statut, ligne(cR.id).split('|')[3]],
      [[400, 'boutique'], [422, 'boutique_inconnue'], [403, 'boutique_fermee'], 200, B.b1]);
    verifier('commerçant sans code caisse : la boutique envoyée est ignorée, vente non attribuée',
      [(await vente(kP, { reference: ref(), carte: cP2.serial, montant: 1000, boutique: 'X-1' })).statut, ligne(cP2.id).split('|')[3]], [200, '-']);

    // Corps invalides, date, téléphone.
    const corps = { reference: ref(), carte: cP2.serial, montant: 1000 };
    const essais = [
      ['reference', { ...corps, reference: undefined }], ['reference', { ...corps, reference: 'avec espace' }], ['reference', { ...corps, reference: 'x'.repeat(65) }],
      ['carte', { ...corps, carte: undefined }], ['carte', { ...corps, carte: 'pas-une-carte' }],
      ['montant', { ...corps, montant: 185.5 }], ['montant', { ...corps, montant: '18500' }], ['montant', { ...corps, montant: 0 }], ['montant', { ...corps, montant: -1 }],
      ['devise', { ...corps, devise: 'USD' }], ['date_vente', { ...corps, date_vente: 'hier' }], ['telephone', { ...corps, telephone: 12 }],
    ];
    const obtenus = [];
    for (const [, c] of essais) { const r = await vente(kP, c); obtenus.push([r.statut, r.corps.champ]); }
    verifier('corps invalides : 400 « corps_invalide » avec le champ en cause, rien écrit',
      [obtenus, lignes(cP2.id)], [essais.map(([ch]) => [400, ch]), 2]);
    const vieille = await vente(kP, { ...corps, date_vente: new Date(Date.now() - 8 * 86400e3).toISOString() });
    const future = await vente(kP, { ...corps, date_vente: new Date(Date.now() + 600e3).toISOString() });
    const datee = await vente(kP, { ...corps, date_vente: new Date(Date.now() - 3600e3).toISOString() });
    verifier('date de vente : 8 jours 422, 10 min dans le futur 422, il y a 1 h acceptée et notée',
      [vieille.statut, future.statut, datee.statut, ligne(cP2.id).split('|')[4], datee.corps.telephone], [422, 422, 200, 'true', null]);

    // Vente annulée puis renvoyée : jamais recréditée.
    const cA = client(M.points);
    const rA = ref();
    await vente(kP, { reference: rA, carte: cA.serial, montant: 1000 });
    await annuler(tP, derniereLigne(cA.id));
    const renvoi = await vente(kP, { reference: rA, carte: cA.serial, montant: 1000 });
    verifier('vente annulée (au comptoir) puis renvoyée : 409 « vente_annulee », jamais recréditée', [renvoi.statut, renvoi.corps.error, solde(cA.id)], [409, 'vente_annulee', 0]);

    // Le comptoir n'a pas bougé.
    const cC = client(M.points);
    const rc = await scan(tP, cC.serial, 30);
    verifier('le comptoir est inchangé : scan crédité, canal « comptoir », sans référence', [rc.statut, rc.corps.stored_value_apres, ligne(cC.id)], [200, 30, 'comptoir|-|-|-|false']);
    s2.processus.kill();
  }

  // ── API v1, étape 3 : téléphone, crédit par numéro, récupération (migration 068, 22/10)
  titre('API v1, étape 3 : numéro rattaché par la vente, crédit par numéro, récupération de carte (22/10)');
  {
    const s3 = await demarrerServeur('api-v1-tel', urlSupabase, { API_V1_MAX_PAR_MINUTE: '5000', API_V1_RECUP_MAX: '4' });
    const appel = (methode, chemin, auth, corps) => fetch(s3.url + chemin, { method: methode,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body: corps === undefined ? undefined : JSON.stringify(corps) })
      .then(async r => { const t = await r.text(); let c; try { c = JSON.parse(t); } catch { c = t; } return { statut: r.status, corps: c, type: r.headers.get('content-type') || '' }; });
    const adm = (methode, chemin, corps) => appel(methode, chemin, `Bearer ${jetonAdmin}`, corps);
    const cleDe = async m => (await adm('POST', `/api/admin/marchands/${m}/cles-api`, { environnement: 'live' })).corps.cle;
    const kP = await cleDe(M.points), kT = await cleDe(M.tampons), kR = await cleDe(M.reseau);
    const vente = (k, corps) => appel('POST', '/api/v1/ventes', `Bearer ${k}`, corps);
    const recup = (k, corps) => appel('POST', '/api/v1/recuperations', `Bearer ${k}`, corps);
    let n = 0;
    const ref = () => `TEL-${Date.now()}-${++n}`;
    const fiche = id => sql(`SELECT coalesce(telephone, '-') || '|' || coalesce(telephone_normalise, '-') || '|' || coalesce(telephone_source, '-')
      || '|' || (telephone_lie_le IS NOT NULL) FROM clients WHERE id = '${id}'`);
    const sha = x => crypto.createHash('sha256').update(x).digest('hex');

    // Format : une seule règle, en base.
    const cas = [['050 123 4567', '+971501234567'], ['0501234567', '+971501234567'], ['+971 50 123 4567', '+971501234567'],
      ['00971501234567', '+971501234567'], ['971501234567', '+971501234567'], ['501234567', '+971501234567'],
      ['+971 050-123-4567', '+971501234567'], ['04 123 4567', '+97141234567'], ['(050) 123.4567', '+971501234567'],
      ['+33 6 12 34 56 78', '+33612345678'], ['12345', null], ['abc', null], ['', null], ['+0501234567', null]];
    verifier('normaliser_telephone : Émirats par défaut (05…, 5…, 971…, 00971…, +971 0…, fixe 04…), étranger avec +, le reste → null',
      cas.map(([b]) => sql(`SELECT coalesce(normaliser_telephone('${b}'), 'null')`)), cas.map(([, x]) => x || 'null'));

    // Rattachement par la vente.
    const c = client(M.points), c2 = client(M.points), cAutre = client(M.tampons);
    const v1 = await vente(kP, { reference: ref(), carte: c.serial, montant: 1000, telephone: '050 701 0001' });
    verifier('vente avec numéro : crédit fait, numéro rattaché (« rattache »), origine « caisse », AUCUNE ligne de consentement (modèle sous-traitant)',
      [v1.statut, v1.corps.solde, v1.corps.telephone, fiche(c.id), sql(`SELECT count(*) FROM consentements WHERE client_id = '${c.id}'`)],
      [200, 10, 'rattache', '+971507010001|+971507010001|caisse|true', '0']);
    const v2 = await vente(kP, { reference: ref(), carte: c.serial, montant: 1000, telephone: '+971507010001' });
    const v3 = await vente(kP, { reference: ref(), carte: c.serial, montant: 1000, telephone: '0507010099' });
    const v4 = await vente(kP, { reference: ref(), carte: c2.serial, montant: 1000, telephone: '00971 50 701 0001' });
    const v5 = await vente(kP, { reference: ref(), carte: c2.serial, montant: 1000, telephone: '123' });
    verifier('même numéro : « deja_rattache » ; autre numéro sur une carte qui en a un : « ignore_autre_numero » (jamais d\'écrasement) ; numéro d\'une autre carte : « ignore_numero_pris » ; illisible : « ignore_invalide » — et la vente est TOUJOURS créditée',
      [[v2.corps.telephone, v3.corps.telephone, v4.corps.telephone, v5.corps.telephone], [v2.statut, v3.statut, v4.statut, v5.statut],
       fiche(c.id).split('|')[1], fiche(c2.id), solde(c2.id)],
      [['deja_rattache', 'ignore_autre_numero', 'ignore_numero_pris', 'ignore_invalide'], [200, 200, 200, 200], '+971507010001', '-|-|-|false', 20]);
    verifier('même numéro chez un AUTRE commerçant : rattaché (un numéro = une carte PAR commerçant)',
      (await vente(kT, { reference: ref(), carte: cAutre.serial, montant: 1000, telephone: '0507010001' })).corps.telephone, 'rattache');
    const zero = await vente(kP, { reference: ref(), carte: c2.serial, montant: 50, telephone: '0507010002' });
    verifier('vente à 0 point avec numéro : rien crédité, numéro rattaché quand même', [zero.corps.enregistree, zero.corps.telephone, fiche(c2.id).split('|')[1]], [false, 'rattache', '+971507010002']);

    // Crédit par numéro (sans carte).
    const parNum = await vente(kP, { reference: ref(), telephone: '+971 50 701 0001', montant: 2000 });
    verifier('vente par numéro seul (rattaché) : la carte rattachée est créditée, « deja_rattache », aucune donnée personnelle',
      [parNum.statut, parNum.corps.points_credites, parNum.corps.solde, parNum.corps.telephone, solde(c.id), JSON.stringify(parNum.corps).includes('Filet')],
      [200, 20, 50, 'deja_rattache', 50, false]);
    const inconnu = await vente(kP, { reference: ref(), telephone: '0507019999', montant: 2000 });
    const illisible = await vente(kP, { reference: ref(), telephone: 'abc', montant: 2000 });
    verifier('numéro rattaché à aucune carte, ou illisible : JAMAIS de crédit sans carte, 404 « carte_inconnue » avec le lien d\'installation',
      [inconnu.statut, inconnu.corps.error, String(inconnu.corps.lien_installation).endsWith('/l/filet-points'), illisible.statut],
      [404, 'carte_inconnue', true, 404]);
    verifier('ni carte ni numéro : 400 champ carte ; numéro vide : 400 champ telephone',
      [(await vente(kP, { reference: ref(), montant: 2000 })).corps.champ, (await vente(kP, { reference: ref(), telephone: '  ', montant: 2000 })).corps.champ],
      ['carte', 'telephone']);
    const rPar = ref();
    await vente(kP, { reference: rPar, telephone: '0507010001', montant: 1000 });
    const rPar2 = await vente(kP, { reference: rPar, telephone: '0507010001', montant: 1000 });
    verifier('vente par numéro renvoyée : « deja_enregistree », rien recrédité', [rPar2.corps.deja_enregistree, solde(c.id)], [true, 60]);

    // Inscription (landing) avec un numéro déjà rattaché : la carte est créée sans numéro.
    sql(`UPDATE marchands SET landing_premium = true WHERE id = '${M.points}'`);
    const ins = await appel('POST', '/api/clients', null, { prenom: 'Nouveau', marchand_slug: 'filet-points', telephone: '050 701 0001' });
    const ins2 = await appel('POST', '/api/clients', null, { prenom: 'Autre', marchand_slug: 'filet-points', telephone: '0507010003' });
    sql(`UPDATE marchands SET landing_premium = false WHERE id = '${M.points}'`);
    // Le consentement de l'inscription s'écrit juste après la réponse (suivre()).
    await attendre(async () => sql(`SELECT count(*) FROM consentements WHERE client_id = '${ins2.corps.client_id}' AND type = 'telephone'`) === '1');
    verifier('inscription avec un numéro déjà rattaché : 201, nouvelle carte SANS numéro (l\'ancienne garde le sien) ; numéro libre : gardé, origine « inscription », consentement écrit',
      [ins.statut, fiche(ins.corps.client_id), ins2.statut, fiche(ins2.corps.client_id),
       sql(`SELECT count(*) FROM consentements WHERE client_id = '${ins2.corps.client_id}' AND type = 'telephone'`), fiche(c.id).split('|')[1]],
      [201, '-|-|-|false', 201, '0507010003|+971507010003|inscription|true', '1', '+971507010001']);
    verifier('la base refuse elle-même un doublon de numéro chez un commerçant (index unique)',
      refuseParLaBase(`UPDATE clients SET telephone = '0507010001' WHERE id = '${ins.corps.client_id}'`), true);

    // Récupération de carte.
    const rec = await recup(kP, { telephone: '050 701 0001' });
    const jeton = String(rec.corps.url || '').split('/r/')[1] || '';
    verifier('récupération : 201, lien /r/<jeton 32 hex> valable 10 min, QR, solde ; aucune donnée personnelle ; tracée (rôle api, empreinte du jeton, jamais le jeton)',
      [rec.statut, /^[0-9a-f]{32}$/.test(jeton), String(rec.corps.qrcode_png).startsWith('data:image/png'), rec.corps.solde, JSON.stringify(rec.corps).includes('Filet'),
       sql(`SELECT role || '|' || coalesce(point_de_vente_id::text, '-') || '|' || (jeton_hash = '${sha(jeton)}') || '|' || extract(epoch FROM expire_le - cree_le)::int FROM recuperations_carte WHERE client_id = '${c.id}'`),
       sql(`SELECT count(*) FROM recuperations_carte WHERE jeton_hash = '${jeton}'`)],
      [201, true, true, 60, false, 'api|-|true|600', '0']);
    const ouvre = await appel('GET', `/api/recuperation/${jeton}`);
    const ouvre2 = await appel('GET', `/api/recuperation/${jeton}`);
    const page = await appel('GET', `/r/${jeton}`);
    verifier('le client ouvre le lien : la MÊME carte (lien Apple de son numéro de série), ouvertures comptées, page servie',
      [ouvre.statut, String(ouvre.corps.apple_pass_url).endsWith(`/api/passes/${c.serial}/apple`), ouvre.corps.marchand, ouvre2.statut,
       sql(`SELECT ouvertures FROM recuperations_carte WHERE client_id = '${c.id}'`), page.statut, page.type.includes('text/html')],
      [200, true, 'Filet Points', 200, '2', 200, true]);
    sql(`UPDATE recuperations_carte SET expire_le = now() - interval '1 second' WHERE client_id = '${c.id}'`);
    verifier('lien expiré : 410, ouverture non comptée ; jeton inconnu ou mal formé : 404',
      [(await appel('GET', `/api/recuperation/${jeton}`)).statut, sql(`SELECT ouvertures FROM recuperations_carte WHERE client_id = '${c.id}'`),
       (await appel('GET', `/api/recuperation/${crypto.randomBytes(16).toString('hex')}`)).statut, (await appel('GET', '/api/recuperation/x')).statut],
      [410, '2', 404, 404]);
    const rInc = await recup(kP, { telephone: '0507019998' }), rInv = await recup(kP, { telephone: 'abc' }), rSans = await recup(kP, {});
    verifier('récupération : numéro inconnu 404 « telephone_inconnu », illisible ou absent 400 ; le numéro d\'un autre commerçant reste invisible',
      [rInc.statut, rInc.corps.error, rInv.statut, rSans.statut, (await recup(kR, { telephone: '0507010001', boutique: 'DXB-001' })).statut],
      [404, 'telephone_inconnu', 400, 400, 404]);
    const cR = client(M.reseau);
    await vente(kR, { reference: ref(), carte: cR.serial, montant: 1000, boutique: 'DXB-001', telephone: '0507010004' });
    const recR = await recup(kR, { telephone: '0507010004', boutique: 'DXB-002' });
    verifier('réseau : boutique obligatoire (400 sans), récupération tracée sur la boutique',
      [(await recup(kR, { telephone: '0507010004' })).statut, recR.statut, sql(`SELECT point_de_vente_id FROM recuperations_carte WHERE client_id = '${cR.id}'`)],
      [400, 201, B.b2]);
    const serie = [];
    for (let i = 0; i < 4; i++) serie.push((await recup(kR, { telephone: '0507010004', boutique: 'DXB-001' })).statut);
    // DXB-001 a déjà servi une fois (numéro d'un autre commerçant, plus haut) : 4 demandes au plus.
    verifier('récupérations limitées par boutique (4 ici, 30 en production) : la 5e reçoit 429 ; une autre boutique n\'est pas touchée',
      [serie, (await recup(kR, { telephone: '0507010004', boutique: 'DXB-001' })).statut, (await recup(kR, { telephone: '0507010004', boutique: 'DXB-002' })).statut],
      [[201, 201, 201, 429], 429, 201]);

    // Effacement RGPD.
    sql(`SELECT effacer_client('${c.id}', '${M.points}')`);
    verifier('effacement RGPD : numéro, origine et date effacés, récupérations supprimées ; le numéro redevient libre',
      [fiche(c.id), sql(`SELECT count(*) FROM recuperations_carte WHERE client_id = '${c.id}'`),
       (await vente(kP, { reference: ref(), carte: ins.corps.serial_number, montant: 1000, telephone: '0507010001' })).corps.telephone],
      ['-|-|-|false', '0', 'rattache']);
    s3.processus.kill();

    // Migration 068 sur une base qui a déjà des numéros : garde-fou, puis rattrapage.
    const banc = require('./lancer');
    const path = require('path'), fs = require('fs');
    const dossier = path.join(__dirname, '..', 'database');
    const base = 'winwin_m068_garde';
    banc.psqlSocket(`DROP DATABASE IF EXISTS ${base}`, 'postgres');
    banc.psqlSocket(`CREATE DATABASE ${base}`, 'postgres');
    banc.psqlSocket(`ALTER DATABASE ${base} SET search_path = "$user", public, extensions`, 'postgres');
    banc.psqlSocket('CREATE SCHEMA extensions; CREATE EXTENSION "uuid-ossp" SCHEMA extensions; CREATE EXTENSION pgcrypto SCHEMA extensions;', base);
    const avant = fs.readdirSync(dossier).filter(f => /^migration_\d+.*\.sql$/.test(f) && f < 'migration_068').sort();
    for (const f of ['schema.sql', ...avant]) banc.psqlSocket(fs.readFileSync(path.join(dossier, f), 'utf8'), base);
    const g = q => banc.psqlSocket(q, base);
    g(`INSERT INTO marchands (id, nom, slug, forfait, type_programme, max_value) VALUES ('${M.tampons}', 'G', 'g', 'pro', 'stamps', 10);
       INSERT INTO clients (marchand_id, prenom, pass_serial_number, telephone) VALUES
         ('${M.tampons}', 'A', 'g-1', '0501112222'), ('${M.tampons}', 'B', 'g-2', '+971 50 111 2222'), ('${M.tampons}', 'C', 'g-3', 'pas un numéro');`);
    const m068 = fs.readFileSync(path.join(dossier, 'migration_068_telephone_carte.sql'), 'utf8');
    let erreur = '';
    try { g(m068); } catch (e) { erreur = e.message; }
    verifier('migration 068, deux numéros égaux UNE FOIS normalisés (0501112222 et +971 50 111 2222) : arrêt, rien changé',
      [/migration 068 arrêtée : 1 numéro\(s\) en double/.test(erreur), g(`SELECT count(*) FROM information_schema.columns WHERE table_name = 'clients' AND column_name LIKE 'telephone_%'`)],
      [true, '0']);
    g(`UPDATE clients SET telephone = '0503334444' WHERE pass_serial_number = 'g-2'`);
    g(m068); g(m068);
    verifier('… doublon réglé : migration passée (rejouée deux fois), numéros existants marqués « inscription » à leur date de création, numéro illisible gardé brut',
      g(`SELECT string_agg(pass_serial_number || ':' || coalesce(telephone_normalise, '-') || ':' || coalesce(telephone_source, '-') || ':' || coalesce((telephone_lie_le = created_at)::text, '-'), ' ' ORDER BY pass_serial_number) FROM clients`),
      'g-1:+971501112222:inscription:true g-2:+971503334444:inscription:true g-3:-:-:-');
    banc.psqlSocket(`DROP DATABASE IF EXISTS ${base}`, 'postgres');
  }

  // ── API v1, étape 4 : POST /migrations (migration 069, 22/10) ───────────────
  titre('API v1, étape 4 : reverser les points d\'avant (POST /api/v1/migrations, 22/10)');
  {
    const s4 = await demarrerServeur('api-v1-migrations', urlSupabase, { API_V1_MAX_PAR_MINUTE: '5000' });
    const appel = (methode, chemin, auth, corps) => fetch(s4.url + chemin, { method: methode,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body: corps === undefined ? undefined : JSON.stringify(corps) })
      .then(async r => { const t = await r.text(); let c; try { c = JSON.parse(t); } catch { c = t; } return { statut: r.status, corps: c }; });
    const attendreMs = ms => new Promise(ok => setTimeout(ok, ms));
    const MG = 'e6900000-0000-4000-8000-000000000001';   // commerçant isolé (preuve « pas un passage »)
    sql(`INSERT INTO marchands (id, nom, slug, forfait, type_programme, max_value, display_max_value, langue)
         VALUES ('${MG}', 'Filet Migration', 'filet-migration', 'pro', 'points', 500, 500, 'fr')`);
    const cleDe = async m => (await appel('POST', `/api/admin/marchands/${m}/cles-api`, `Bearer ${jetonAdmin}`, { environnement: 'live' })).corps.cle;
    const kG = await cleDe(MG), kT = await cleDe(M.tampons);
    const migrer = (k, corps) => appel('POST', '/api/v1/migrations', `Bearer ${k}`, corps);
    const lignesMig = id => sql(`SELECT count(*) || '|' || coalesce(max(stored_value_avant || '>' || stored_value_apres), '-') FROM ajustements WHERE client_id = '${id}' AND origine = 'migration'`);

    // Crédit unique.
    const c = client(MG);
    const m1 = await migrer(kG, { carte: c.serial, points: 320 });
    verifier('migration : 320 points reversés, réponse sans donnée personnelle, une ligne « migration » au journal des AJUSTEMENTS, AUCUNE ligne de scan, la carte reçoit son message',
      [m1.statut, m1.corps, JSON.stringify(m1.corps).includes('Filet'), lignesMig(c.id), lignes(c.id), solde(c.id), messageCarte(c.serial)],
      [200, { ok: true, deja_migree: false, points_credites: 320, solde: 320, seuil: 500, seuil_atteint: false }, false, '1|0>320', 0, 320, '+320 — Filet : 320/500 pts']);
    const m2 = await migrer(kG, { carte: c.serial, points: 320 });
    const m3 = await migrer(kG, { carte: c.serial, points: 400 });
    verifier('renvoi du même nombre : 200 « deja_migree », rien recrédité ; autre nombre : 409 « migration_deja_faite », rien changé',
      [m2.statut, m2.corps.deja_migree, m2.corps.points_credites, m3.statut, m3.corps.error, solde(c.id), lignesMig(c.id)],
      [200, true, 320, 409, 'migration_deja_faite', 320, '1|0>320']);
    const cP = client(MG);
    const par = await Promise.all([1, 2, 3].map(() => migrer(kG, { carte: cP.serial, points: 100 })));
    verifier('trois envois simultanés : un seul crédit',
      [par.every(r => r.statut === 200), par.filter(r => r.corps.deja_migree === false).length, solde(cP.id), lignesMig(cP.id)], [true, 1, 100, '1|0>100']);

    // Désigner la carte : code court, numéro rattaché, inconnue.
    const cC = client(MG);
    verifier('carte par code court : migrée', (await migrer(kG, { carte: cC.serial.slice(-6).toUpperCase(), points: 10 })).corps.solde, 10);
    const cN = client(MG);
    sql(`UPDATE clients SET telephone = '0507690001', telephone_source = 'caisse' WHERE id = '${cN.id}'`);
    const parTel = await migrer(kG, { telephone: '+971 50 769 0001', points: 25 });
    const telInconnu = await migrer(kG, { telephone: '0507690099', points: 25 });
    verifier('carte par numéro rattaché : migrée ; numéro inconnu : 404 « carte_inconnue » avec le lien d\'installation, rien crédité',
      [parTel.statut, solde(cN.id), telInconnu.statut, telInconnu.corps.error, String(telInconnu.corps.lien_installation).endsWith('/l/filet-migration')],
      [200, 25, 404, 'carte_inconnue', true]);

    // Garde-fous.
    const cS = client(MG, { solde: 500 });
    const auSeuil = await migrer(kG, { carte: cS.serial, points: 50 });
    verifier('carte au seuil (récompense en attente) : 409 « recompense_en_attente », rien écrit',
      [auSeuil.statut, auSeuil.corps.error, solde(cS.id), lignesMig(cS.id)], [409, 'recompense_en_attente', 500, '0|-']);
    const cT = client(M.tampons, { solde: 3 });
    const trop = await migrer(kT, { carte: cT.serial, points: 8 });
    const juste = await migrer(kT, { carte: cT.serial, points: 7 });
    verifier('tampons : 3 + 8 = 11 > seuil 10 → 422 « points_hors_bornes », rien écrit ; 3 + 7 = 10 → migrée, seuil atteint',
      [trop.statut, trop.corps.error, juste.statut, juste.corps.solde, juste.corps.seuil_atteint], [422, 'points_hors_bornes', 200, 10, true]);
    const cI = client(MG);
    const refus = [];
    for (const corps of [{ carte: cI.serial, points: 0 }, { carte: cI.serial, points: 100001 }, { carte: cI.serial, points: 2.5 },
      { carte: cI.serial, points: '10' }, { carte: cI.serial }, { points: 10 }]) {
      const r = await migrer(kG, corps); refus.push([r.statut, r.corps.champ]);
    }
    verifier('points hors de 1 à 100 000, décimaux, en texte ou absents ; ni carte ni numéro : 400 « corps_invalide », rien écrit',
      [refus, lignesMig(cI.id)], [[[400, 'points'], [400, 'points'], [400, 'points'], [400, 'points'], [400, 'points'], [400, 'carte']], '0|-']);

    // La preuve : une migration ne compte NULLE PART comme un passage.
    const cV = client(MG);
    sql(`INSERT INTO scans (client_id, marchand_id, stored_value_avant, stored_value_apres, montant_credite, date_scan)
         VALUES ('${cV.id}', '${MG}', 0, 10, 10, now() - interval '70 days');
         UPDATE clients SET stored_value = 10 WHERE id = '${cV.id}'`);
    rendreVisibles(`marchand_id = '${MG}'`);
    const tMG = jeton(MG);
    const mesure = async () => [
      sql(`SELECT count(*) FROM scans WHERE marchand_id = '${MG}'`),
      sql(`SELECT apercu_stats('${MG}', '2026-10-22T12:00:00Z')`),
      sql(`SELECT compter_segment('${MG}', '{"type":"inactifs","jours":60}')`),
      sql(`SELECT client_dans_segment('${cV.id}', '${MG}', '{"type":"inactifs","jours":60}', now())`),
      sql(`SELECT max(date_scan)::text FROM scans WHERE client_id = '${cV.id}' AND annule_le IS NULL`),
      JSON.stringify((await api('GET', '/api/scan?lieu=1', tMG)).corps.map(x => x.id)),
    ];
    const avant = await mesure();
    const mV = await migrer(kG, { carte: cV.serial, points: 50 });
    const apres = await mesure();
    verifier('migration d\'un client inactif depuis 70 jours : scans, statistiques de l\'Aperçu, segment « inactifs 60 j » (compte et appartenance), dernier passage (base des relances) et historique des scans IDENTIQUES avant et après',
      [mV.statut, solde(cV.id), apres, avant[3]], [200, 60, avant, 't']);

    // Correction depuis le dashboard ; une migration ne se refait pas.
    const ajId = sql(`SELECT id FROM ajustements WHERE client_id = '${c.id}' AND origine = 'migration'`);
    const annul = await api('POST', `/api/clients/ajustements/${ajId}/annuler`, tMG);
    const refaite = await migrer(kG, { carte: c.serial, points: 200 });
    verifier('correction : « Annuler le dernier mouvement » de la fiche annule la migration (solde 0) ; une nouvelle migration par l\'API est refusée (one-shot strict)',
      [annul.statut, solde(c.id), refaite.statut, refaite.corps.error], [200, 0, 409, 'migration_deja_faite']);
    verifier('les ajustements du dashboard restent d\'origine « dashboard »',
      sql(`SELECT count(*) FROM ajustements WHERE origine NOT IN ('dashboard', 'migration')`), '0');

    // Ni parrainage ; le comptoir n'a pas bougé.
    const parrain = client(M.tampons, { solde: 2 });
    const filleul = client(M.tampons, { parrain: parrain.id });
    await migrer(kT, { carte: filleul.serial, points: 4 });
    await attendreMs(800);
    verifier('migration d\'un filleul : le parrain n\'est PAS crédité', [solde(filleul.id), solde(parrain.id)], [4, 2]);
    const rc = await scan(tMG, cP.serial, 30);
    verifier('le comptoir est inchangé : un scan après migration crédite normalement (100 + 30)', [rc.statut, rc.corps.stored_value_apres, lignes(cP.id)], [200, 130, 1]);
    s4.processus.kill();
  }

  // ── API v1, étape 5 : annuler une vente par sa référence (22/10) ────────────
  titre('API v1, étape 5 : annuler une vente (POST /api/v1/ventes/{ref}/annulation, 22/10)');
  {
    const s5 = await demarrerServeur('api-v1-annulation', urlSupabase, { API_V1_MAX_PAR_MINUTE: '5000' });
    const appel = (chemin, k, corps) => fetch(s5.url + chemin, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` }, body: JSON.stringify(corps || {}) })
      .then(async r => ({ statut: r.status, corps: await r.json().catch(() => ({})) }));
    const kP = (await appel(`/api/admin/marchands/${M.points}/cles-api`, jetonAdmin, { environnement: 'live' })).corps.cle;
    const vente = corps => appel('/api/v1/ventes', kP, corps);
    const annule = ref => appel(`/api/v1/ventes/${encodeURIComponent(ref)}/annulation`, kP);
    const c = client(M.points, { solde: 40 });
    const ref = `ANN-${Date.now()}`;
    await vente({ reference: ref, carte: c.serial, montant: 2500 });
    const a1 = await annule(ref), a2 = await annule(ref);
    verifier('annulation de la dernière vente : solde remis (65 → 40), ligne marquée annulée ; renvoi : 200 « deja_annulee », rien changé',
      [a1.statut, a1.corps, a2.statut, a2.corps.deja_annulee, solde(c.id), sql(`SELECT annule_le IS NOT NULL FROM scans WHERE client_id = '${c.id}'`)],
      [200, { ok: true, reference: ref, solde: 40, deja_annulee: false }, 200, true, 40, 't']);
    verifier('vente annulée renvoyée : 409 « vente_annulee », jamais recréditée',
      [(await vente({ reference: ref, carte: c.serial, montant: 2500 })).corps.error, solde(c.id)], ['vente_annulee', 40]);
    const r1 = `ANN-A-${Date.now()}`, r2 = `ANN-B-${Date.now()}`;
    await vente({ reference: r1, carte: c.serial, montant: 1000 });
    await vente({ reference: r2, carte: c.serial, montant: 1000 });
    const pasDernier = await annule(r1);
    verifier('vente qui n\'est plus le dernier mouvement : 409 « pas_le_dernier_mouvement », rien changé ; référence inconnue : 404 ; référence mal formée : 400',
      [pasDernier.statut, pasDernier.corps.error, solde(c.id), (await annule('INCONNUE-1')).corps.error, (await annule('a b')).statut],
      [409, 'pas_le_dernier_mouvement', 60, 'vente_inconnue', 400]);
    const kT = (await appel(`/api/admin/marchands/${M.tampons}/cles-api`, jetonAdmin, { environnement: 'live' })).corps.cle;
    verifier('la vente d\'un autre commerçant est introuvable avec sa clé (404)',
      (await appel(`/api/v1/ventes/${r2}/annulation`, kT)).statut, 404);
    s5.processus.kill();
  }
}

module.exports = { FIXTURES, jouer, M, B };
