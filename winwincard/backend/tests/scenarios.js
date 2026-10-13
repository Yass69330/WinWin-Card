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

async function jouer({ sql, sqlEnFond, verifier, api, secretJwt, demarrerServeur, demarrerPostgrest, urlSupabase, cleService, urlServeur }) {
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
  const scan = (jt, serial, points) => api('POST', '/api/scan', jt, points === undefined ? { serial_number: serial } : { serial_number: serial, points });
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

    const f = client(M.tampons);
    await scan(tT, f.serial); await scan(tT, f.serial);
    verifier('TRANSITION — sans clé (écran d\'avant 11b) : deux crédits, acceptés jusqu\'à la clé obligatoire', [solde(f.id), lignes(f.id)], [2, 2]);

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
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jt}` }, body: JSON.stringify(corps) })
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
    const scan14 = (jt, serial, corps = {}) => appel('POST', '/api/scan', jt, { serial_number: serial, ...corps });
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
      panne.motif = /^\/rest\/v1\/device_tokens/;
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

      // Date limite : 24 h après le clic (ici 1,5 s), la campagne interrompue est abandonnée.
      camp._pourTests({ config: { limiteMs: 1500, relancesMs: [300], essais: 2 } });
      const journalA = [];
      console.error = (...x) => { journalA.push(x.join(' ')); };
      panne.motif = /^\/rest\/v1\/device_tokens/;
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
    const scanPanne = await appel('POST', '/api/scan', `Bearer ${tT}`, { serial_number: client(M.tampons).serial });
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
    const scanPendant = await appel('POST', '/api/scan', `Bearer ${tT}`, { serial_number: client(M.tampons).serial });
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
      [6, 0, 'Salut Neuf1 ! Plus que 1 point pour débloquer ta récompense chez Filet Relance C. Passe nous voir ! 🎁',
       'Salut Huit1 ! Plus que 2 points pour débloquer ta récompense chez Filet Relance C. Passe nous voir ! 🎁']);
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
    verifier('lecture des marchands impossible : passage « erreurs » (avant : « ok » avec 0 envoi), les trois relances en erreur',
      sql(`SELECT statut || '|' || (details -> 'erreurs')::text FROM cron_passages ORDER BY debut DESC LIMIT 1`),
      'erreurs|["birthday", "near_reward", "inactive"]');

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
    const clientNe = (m, prenom, cree) => sql(`INSERT INTO clients (marchand_id, prenom, created_at) VALUES ('${m}', '${prenom}', '${cree}') RETURNING id`);
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
}

module.exports = { FIXTURES, jouer, M, B };
