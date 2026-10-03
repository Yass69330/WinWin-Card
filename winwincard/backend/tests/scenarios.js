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

async function jouer({ sql, sqlEnFond, verifier, api, secretJwt }) {
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
    verifier('après un ajustement : refusé (solde différent de la ligne), rien ne bouge', [a5.statut, a5.corps.reason, solde(j.id)], [409, 'solde_incoherent', 7]);

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
    verifier('ÉTAT ACTUEL — jeton marchand sur un réseau : annule le scan d\'une boutique', [(await annuler(tR, derniereLigne(r.id))).statut, solde(r.id)], [200, 0]);

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
  {
    const c = client(M.tampons, { solde: 3 });
    const r = await api('PATCH', `/api/clients/${c.id}`, tT, { stored_value: 7 });
    verifier('ajustement à 7 : accepté', [r.statut, solde(c.id)], [200, 7]);
    verifier('ÉTAT ACTUEL — aucune ligne de journal pour l\'ajustement', lignes(c.id), 0);
    const p = client(M.points, { solde: 100 });
    verifier('ÉTAT ACTUEL — en points, ajustement au-dessus du seuil (900 > 500) accepté par le serveur (l\'écran le refuse)',
      [(await api('PATCH', `/api/clients/${p.id}`, tP, { stored_value: 900 })).statut, solde(p.id)], [200, 900]);
    verifier('valeurs refusées (−1, 1 000 001) : 400',
      [(await api('PATCH', `/api/clients/${p.id}`, tP, { stored_value: -1 })).statut, (await api('PATCH', `/api/clients/${p.id}`, tP, { stored_value: 1000001 })).statut], [400, 400]);
    const s = client(M.tampons, { solde: 2 });
    await Promise.all([api('PATCH', `/api/clients/${s.id}`, tT, { stored_value: 5 }), scan(tT, s.serial)]);
    verifier('ajustement à 5 pendant un scan : résultat 5 ou 6 selon l\'ordre d\'arrivée', [5, 6].includes(solde(s.id)), true);
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

    const plein = client(M.tampons, { solde: 10 });
    const f2 = client(M.tampons, { parrain: plein.id });
    await scan(tT, f2.serial);
    await attendre(() => Number(sql(`SELECT count(*) FROM referral_credits WHERE filleul_client_id = '${f2.id}'`)) === 1);
    await new Promise(r => setTimeout(r, 300));
    verifier('ÉTAT ACTUEL — parrain déjà à 10/10 : reste à 10, le tampon est perdu', solde(plein.id), 10);

    // Écart B : la règle « jamais de parrainage en mode points » n'est pas dans le code.
    const pp = client(M.pointsParr, { solde: 100 });
    const fp = client(M.pointsParr, { parrain: pp.id });
    await scan(tPP, fp.serial, 20);
    verifier('ÉTAT ACTUEL — mode points avec parrainage coché : parrain crédité de 5 (étape 14 : jamais)', await attendre(() => solde(pp.id) === 105), true);
    const haut = client(M.pointsParr, { solde: 530 });
    const fh = client(M.pointsParr, { parrain: haut.id });
    await scan(tPP, fh.serial, 20);
    await attendre(() => Number(sql(`SELECT count(*) FROM referral_credits WHERE filleul_client_id = '${fh.id}'`)) === 1);
    verifier('ÉTAT ACTUEL — mode points, parrain à 530 (au-dessus du seuil) : ramené à 500, il PERD 30 (credit_referral, étape 14)',
      await attendre(() => solde(haut.id) === 500), true);
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
    verifier('panne à l\'écriture de la ligne : erreur, solde INCHANGÉ, aucune ligne (étape 11 : tout ou rien)', [panne.statut, solde(c.id), lignes(c.id)], [500, 0, 0]);
    sql(`DROP TRIGGER filet_panne_ligne ON scans;
         CREATE TRIGGER filet_panne_carte BEFORE UPDATE ON passes FOR EACH ROW
           WHEN (NEW.serial_number = '${c.serial}') EXECUTE FUNCTION filet_panne();`);
    const panne2 = await scan(tT, c.serial);
    verifier('panne à l\'écriture de la carte : erreur, solde INCHANGÉ, aucune ligne', [panne2.statut, solde(c.id), lignes(c.id)], [500, 0, 0]);
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
}

module.exports = { FIXTURES, jouer, M, B };
