'use strict';

// ════════════════════════════════════════════════════════════════════════════
// PRÉPARATION DE LA BASE DE CAMPAGNE (étape 15, temps 2) — BASE DE TEST
// UNIQUEMENT. Lancé par le pilote (pilote.js), sur Railway, dans le projet de test.
//
// Variables : CAMPAGNE_DATABASE_URL (chaîne de connexion de la base de TEST,
// « Session pooler » de Supabase : les tables temporaires de donnees.sql
// exigent une session entière), CAMPAGNE_MODE (temoin | donnees | droits),
// CHARGE_PLAFOND (5000), CHARGE_ECHELLE_REGISTRE (1), PSQL (défaut : psql).
//
// GARDE-FOU, avant toute écriture : la base est NEUVE (aucune table dans public)
// ou porte le marchand TÉMOIN. Toute autre base (la production : des marchands,
// pas de témoin) est refusée, sortie 3, rien n'est écrit. La chaîne de
// connexion n'est jamais affichée.
//
//   temoin   base neuve → rejeu du dépôt comme le filet et generer.sh
//            (schema.sql, migrations dans l'ordre, rgpd_effacement.sql), SANS le
//            prélude : Supabase a déjà ses rôles et ses extensions ; puis
//            temoin.sql. Contrôles : requête d'écarts du dépôt (verdict attendu
//            « IDENTIQUE », comme en production) — elle dit aussi si la 048 a pu
//            poser son déclencheur sur un projet neuf (HYPOTHÈSE de la 048).
//            Base déjà prête (témoin présent) → rien d'autre que temoin.sql, sans effet.
//   donnees  témoin exigé → vide TOUTES les tables de public, remet le témoin,
//            charge donnees.sql au palier CHARGE_PLAFOND ; une seule
//            transaction : en cas d'échec, la base reste comme avant.
//   droits   témoin exigé → aligne les droits de la base de test sur ceux de la
//            production quand le projet a été créé avec « Automatically expose
//            new tables » coché (passation §15 vicies C) :
//            1. privilèges par défaut du rôle postgres dans public ramenés à
//               ceux de la production (audit 00a, P5) : rien en lecture ni en
//               écriture pour anon, authenticated et service_role sur les
//               tables futures, rien sur les séquences futures ;
//            2. retrait de l'EXCÉDENT seul, calculé ligne à ligne par la requête
//               d'écarts. JAMAIS D'AJOUT : un objet qui a MOINS que la
//               production, ou un écart hors des droits de données → refus, rien
//               n'est fait (les droits viennent du dépôt, pas de ce pas) ;
//            1 et 2 en une seule transaction ;
//            3. table sonde créée puis annulée : une table future doit recevoir
//               les droits de la production (sinon le mécanisme n'est pas celui
//               des privilèges par défaut : échec) ;
//            4. requête d'écarts rejouée : IDENTIQUE exigé, sinon échec.
//            Rejouable : sur une base déjà alignée, rien à retirer.
// ════════════════════════════════════════════════════════════════════════════

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ICI = __dirname;
const DOSSIER_DB = path.join(ICI, '..', '..', 'database');
const URL_BASE = process.env.CAMPAGNE_DATABASE_URL || '';
const MODE = process.env.CAMPAGNE_MODE || '';
const PSQL = process.env.PSQL || 'psql';
const MODES = ['temoin', 'donnees', 'droits'];
const TEMOIN = 'c0ffee15-0000-4000-8000-000000000015';
const PLAFOND = Number(process.env.CHARGE_PLAFOND || 5000);
const ECHELLE = Number(process.env.CHARGE_ECHELLE_REGISTRE ?? 1);

const dire = m => console.log(`[preparer] ${m}`);
function refus(m, code = 3) { console.error(`[preparer] REFUS : ${m}`); process.exit(code); }

// Pas de délai maximal (chargement long), messages réduits aux avertissements.
const ENTETE = 'SET statement_timeout = 0;\nSET client_min_messages = warning;\n';
function psql(sqlTexte, { transaction = false } = {}) {
  const args = ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', ...(transaction ? ['-1'] : []), '-d', URL_BASE];
  const r = spawnSync(PSQL, args, { input: ENTETE + sqlTexte, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`psql introuvable (${r.error.code})`);
  if (r.status !== 0) throw new Error((r.stderr || '').trim().split('\n').slice(-3).join(' | '));
  return r.stdout.trim();
}

if (!/^postgres(ql)?:\/\//.test(URL_BASE)) refus('CAMPAGNE_DATABASE_URL absente ou invalide', 2);
if (!MODES.includes(MODE)) refus(`CAMPAGNE_MODE inconnu (« ${MODE} ») : ${MODES.join(', ')}`, 2);
if (!(Number.isInteger(PLAFOND) && PLAFOND > 0 && PLAFOND <= 78000) || !(ECHELLE > 0 && ECHELLE <= 10)) {
  refus(`CHARGE_PLAFOND (entier de 1 à 78 000) ou CHARGE_ECHELLE_REGISTRE (0 à 10) invalide`, 2);
}

const lu = fichier => fs.readFileSync(fichier, 'utf8');
const ecarts = () => psql(lu(path.join(DOSSIER_DB, 'requetes', 'ecarts_prod_depot', 'ecarts_prod_depot.sql'))).split('\n');
const DEFAUTS = `SELECT coalesce(string_agg(pg_get_userbyid(defaclrole) || ' → ' || CASE defaclobjtype WHEN 'r' THEN 'tables'
    WHEN 'S' THEN 'séquences' WHEN 'f' THEN 'fonctions' ELSE defaclobjtype::text END || ' : ' || array_to_string(defaclacl, ' '),
    ' ; ' ORDER BY 1), '(aucun)') FROM pg_default_acl WHERE defaclnamespace = 'public'::regnamespace`;

// Lettres de la requête d'écarts → privilèges, selon le genre d'objet.
const PRIVILEGES = { table: { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE' },
  sequence: { r: 'SELECT', w: 'UPDATE', U: 'USAGE' } };
const ROLES_API = ['anon', 'authenticated', 'service_role'];

function droits() {
  dire(`privilèges par défaut AVANT : ${psql(DEFAUTS)}`);
  const lignes = ecarts().filter(l => l.startsWith('2|'));
  const horsChamp = lignes.filter(l => l.split('|')[1] !== 'droits_donnees');
  if (horsChamp.length) {
    for (const l of horsChamp) dire(`écart hors droits de données : ${l}`);
    refus(`${horsChamp.length} écart(s) hors des droits de données : hors du champ de ce pas. Rien fait.`, 1);
  }
  const retraits = [], manques = [];
  for (const l of lignes) {
    const [, , objet, enBase, auDepot] = l.split('|');
    const [nom, role] = objet.split(' → ');
    if (!/^[a-z_][a-z0-9_]*$/.test(nom) || !ROLES_API.includes(role)) refus(`objet inattendu : ${objet}. Rien fait.`, 1);
    const genreBrut = psql(`SELECT relkind FROM pg_class WHERE oid = to_regclass('public.${nom}')`);
    const genre = genreBrut === 'S' ? 'sequence' : ['r', 'p'].includes(genreBrut) ? 'table' : null;
    if (!genre) refus(`${objet} : ni table ni séquence. Rien fait.`, 1);
    const base = enBase === '(aucun droit)' ? '' : enBase, depot = auDepot === '(aucun droit)' ? '' : auDepot;
    const manque = [...depot].filter(c => !base.includes(c));
    if (manque.length) { manques.push(`${objet} (il manque ${manque.join('')})`); continue; }
    const enTrop = [...base].filter(c => !depot.includes(c));
    if (enTrop.some(c => !PRIVILEGES[genre][c])) refus(`${objet} : droit inconnu (${enTrop.join('')}). Rien fait.`, 1);
    retraits.push(`REVOKE ${enTrop.map(c => PRIVILEGES[genre][c]).join(', ')} ON ${genre === 'sequence' ? 'SEQUENCE ' : ''}public.${nom} FROM ${role};`);
  }
  if (manques.length) {
    for (const m of manques) dire(`MOINS que la production : ${m}`);
    refus(`${manques.length} objet(s) ont moins de droits que la production : ce pas n'ajoute jamais rien. Rien fait.`, 1);
  }
  // 1 et 2, en une seule transaction.
  psql(['ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM anon, authenticated, service_role;',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;',
    ...retraits].join('\n'), { transaction: true });
  for (const r of retraits) dire(`retiré : ${r}`);
  dire(`${retraits.length} retrait(s) et 2 réglages par défaut appliqués, en une transaction`);
  dire(`privilèges par défaut APRÈS : ${psql(DEFAUTS)}`);
  // 3. Une table future, créée puis annulée.
  const lettres = (role, objet, genre) => Object.entries(PRIVILEGES[genre])
    .map(([c, p]) => `(CASE WHEN has_${genre === 'sequence' ? 'sequence' : 'table'}_privilege('${role}', ${objet}, '${p}') THEN '${c}' ELSE '' END)`).join(' || ');
  const sonde = psql(`BEGIN;
    CREATE TABLE public.sonde_droits_campagne (id bigint GENERATED BY DEFAULT AS IDENTITY, x int);
    SELECT ${ROLES_API.map(r => `'${r}=' || ${lettres(r, "'public.sonde_droits_campagne'", 'table')} || '/' || ${lettres(r, "pg_get_serial_sequence('public.sonde_droits_campagne', 'id')", 'sequence')}`).join(" || ' ' || ")};
    ROLLBACK;`);
  dire(`table sonde (annulée), droits table/séquence : ${sonde}`);
  if (sonde.split(' ').some(x => x.split('=')[1] !== '/')) refus('une table future recevrait encore des droits de lecture ou d\'écriture : le mécanisme n\'est pas (seulement) celui des privilèges par défaut. Envoyer ce journal.', 1);
  // 4. IDENTIQUE exigé.
  const apres = ecarts();
  for (const ligne of apres) dire(`écarts : ${ligne}`);
  if (/IDENTIQUE/.test(apres[0])) dire('VERDICT : base de test IDENTIQUE au dépôt (droits de la production)');
  else { dire('VERDICT : ÉCART après alignement — envoyer ce journal'); process.exitCode = 1; }
}
const COMPTES = `SELECT (SELECT count(*) FROM marchands) || ' marchands, ' || (SELECT count(*) FROM clients) || ' porteurs, '
  || (SELECT count(*) FROM scans) || ' scans, ' || (SELECT count(*) FROM device_tokens) || ' inscriptions iPhone, '
  || (SELECT count(DISTINCT device_id) FROM device_tokens) || ' appareils, '
  || (SELECT count(*) FROM notification_envois) || ' lignes de registre, '
  || (SELECT count(*) FROM workflow_executions) || ' relances, '
  || pg_size_pretty(pg_database_size(current_database()))`;

try {
  // ── Garde-fou : base neuve ou base de campagne ────────────────────────────
  const [tables, aMarchands] = psql(`SELECT count(*) || '|' || (to_regclass('public.marchands') IS NOT NULL)::int
    FROM pg_tables WHERE schemaname = 'public'`).split('|');
  let etat = 'neuve';
  if (Number(tables) > 0) {
    if (aMarchands !== '1') refus(`${tables} table(s) dans public, pas de table marchands : ce n'est ni une base neuve ni une base de campagne. Rien écrit.`);
    const [nb, temoin] = psql(`SELECT count(*) || '|' || count(*) FILTER (WHERE id = '${TEMOIN}') FROM marchands`).split('|');
    if (temoin !== '1') {
      refus(Number(nb) > 0
        ? `${nb} marchand(s) et PAS de témoin : ce n'est PAS une base de campagne (la production ?). Rien écrit.`
        : 'tables présentes, aucun marchand, pas de témoin : préparation précédente interrompue ? Rien tenté ; envoyer ce journal.');
    }
    etat = 'campagne';
  }
  dire(`base ${etat === 'neuve' ? 'NEUVE (aucune table dans public)' : 'de campagne (témoin présent)'}, mode ${MODE}`);
  if (MODE !== 'temoin' && etat !== 'campagne') refus(`mode ${MODE} sur une base sans témoin : faire d'abord l'étape temoin. Rien écrit.`);

  if (MODE === 'temoin') {
    if (etat === 'neuve') {
      const migrations = fs.readdirSync(DOSSIER_DB).filter(f => /^migration_\d+.*\.sql$/.test(f)).sort();
      const t0 = Date.now();
      for (const f of ['schema.sql', ...migrations, 'rgpd_effacement.sql']) {
        try { psql(lu(path.join(DOSSIER_DB, f))); }
        catch (e) { refus(`rejeu interrompu à ${f} : ${e.message}`, 1); }
      }
      dire(`dépôt rejoué : ${migrations.length + 2} fichiers (jusqu'à ${migrations[migrations.length - 1]}) en ${Math.round((Date.now() - t0) / 1000)} s`);
    }
    psql(lu(path.join(ICI, 'temoin.sql')));
    dire('témoin en place');
    // Requête d'écarts du dépôt (lecture seule), comme en production.
    const resultat = ecarts();
    for (const ligne of resultat) dire(`écarts : ${ligne}`);
    if (/IDENTIQUE/.test(resultat[0])) dire('VERDICT : base de test IDENTIQUE au dépôt');
    else { dire('VERDICT : ÉCART — la base de test diffère du dépôt ; envoyer ce journal'); process.exitCode = 1; }
  } else if (MODE === 'droits') {
    droits();
  } else {
    const t0 = Date.now();
    psql(`DO $$ DECLARE liste text; BEGIN
        SELECT string_agg(format('public.%I', tablename), ', ') INTO liste FROM pg_tables WHERE schemaname = 'public';
        EXECUTE 'TRUNCATE ' || liste || ' RESTART IDENTITY CASCADE';
      END $$;\n`
      + lu(path.join(ICI, 'temoin.sql'))
      + `\\set plafond ${PLAFOND}\n\\set echelle_registre ${ECHELLE}\n`
      + lu(path.join(ICI, 'donnees.sql')), { transaction: true });
    dire(`données factices chargées (plafond ${PLAFOND} porteurs) en ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  dire(`contenu : ${psql(COMPTES)}`);
} catch (e) {
  console.error(`[preparer] ÉCHEC : ${e.message}`);
  process.exit(1);
}
