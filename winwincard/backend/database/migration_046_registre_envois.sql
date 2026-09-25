-- Migration 046 : registre des envois de notification (smart notifs, phase 2)
--
-- OBJECTIF UNIQUE. Pouvoir répondre en base à « quelles notifications partent,
-- lesquelles Apple et Google acceptent ou refusent ». Aucun changement de
-- comportement visible pour les clients ou les marchands.
--
-- POURQUOI UNE TABLE NEUVE. `notification_logs` (migration 006) alimente le
-- dashboard marchand : une ligne par CAMPAGNE manuelle, avec des compteurs
-- agrégés. Elle reste strictement inchangée. Le registre, lui, est à la maille
-- de la TENTATIVE : une ligne par push, quelle qu'en soit la source. Deux
-- objets différents, deux tables.
--
-- CE QUE LE REGISTRE NE FAIT PAS. Il n'efface rien. Un 410 « Unregistered »
-- d'Apple est NOTÉ, jamais suivi d'une suppression dans device_tokens — la
-- purge des jetons morts est hors périmètre de ce lot, décidée en pilotage.
--
-- PAS DE JETON EN CLAIR. `token_hash` = md5(push_token). md5 est choisi pour
-- deux raisons : il est NATIF Postgres (aucune extension à installer, contrairement
-- à digest() qui exige pgcrypto), et c'est une CLÉ DE CORRÉLATION, pas une
-- primitive de sécurité — elle sert à rapprocher une ligne du registre d'une
-- ligne de device_tokens sans stocker le jeton. Le rapprochement se fait côté
-- SQL par `md5(dt.push_token) = e.token_hash`.
--
-- RÉTENTION 90 JOURS, via la purge existante du cron (purgeOldExecutions,
-- cron.js) qui purge déjà workflow_executions avec le même TTL. Aucun nouveau
-- planificateur.
--
-- GRANT EXPLICITE à service_role : le backend passe par PostgREST avec la clé
-- service_role. Sans GRANT, les écritures échoueraient EN SILENCE — c'est
-- exactement le mode d'échec qui a laissé workflow_executions vide de sa
-- création (migration 010) jusqu'à la migration 028.
--
-- bigserial et non uuid : table d'insertion massive, jamais jointe par sa clé.
-- Un entier séquentiel est plus compact en index et n'a pas le coût de
-- fragmentation d'un uuid aléatoire.
--
-- À exécuter dans Supabase AVANT de déployer le code. Créer la table alors que
-- personne ne l'écrit est sans effet. Rejouable (IF NOT EXISTS).

BEGIN;
SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.notification_envois (
  id          bigserial   PRIMARY KEY,
  envoye_le   timestamptz NOT NULL DEFAULT now(),

  -- Surface émettrice. Recensement complet au 2026-09-25 — huit surfaces.
  -- 'ajustement' et 'annulation' avaient été MANQUÉES au recensement de la
  -- phase 1 : toutes deux passent par syncPassAfterAdjustment (clients.js).
  source      text        NOT NULL
    CHECK (source IN ('inactive','near_reward','birthday','manuel',
                      'scan','welcome','ajustement','annulation')),

  marchand_id uuid        REFERENCES public.marchands (id) ON DELETE SET NULL,

  plateforme  text        NOT NULL CHECK (plateforme IN ('apple','google')),

  -- Statut HTTP renvoyé par APNs ou par l'API Google Wallet.
  -- NULL = aucune réponse obtenue (coupure réseau, timeout, session morte) :
  -- distinguer « refusé » de « jamais arrivé » est tout l'intérêt du registre.
  statut      integer,
  -- reason APNs ('Unregistered', 'BadDeviceToken'…) ou message d'erreur Google.
  reason      text,
  ok          boolean     NOT NULL,

  -- Corrélation sans exposition : md5, jamais le jeton lui-même.
  token_hash  text,
  -- Le serial identifie la carte ; il vit déjà en clair dans passes et
  -- device_tokens, le stocker ici n'ajoute aucune exposition et rend les
  -- requêtes de diagnostic exploitables.
  serial_number text,

  -- Identifiant de lot : regroupe les lignes écrites par un même passage
  -- (un marchand dans un workflow, une campagne manuelle).
  lot         uuid
);

CREATE INDEX IF NOT EXISTS idx_notif_envois_date
  ON public.notification_envois (envoye_le DESC);
CREATE INDEX IF NOT EXISTS idx_notif_envois_source_date
  ON public.notification_envois (source, envoye_le DESC);
CREATE INDEX IF NOT EXISTS idx_notif_envois_marchand_date
  ON public.notification_envois (marchand_id, envoye_le DESC);
-- Partiel : seuls les échecs sont interrogés en masse (« montre-moi les 410 »).
CREATE INDEX IF NOT EXISTS idx_notif_envois_echecs
  ON public.notification_envois (statut, envoye_le DESC) WHERE NOT ok;
CREATE INDEX IF NOT EXISTS idx_notif_envois_token
  ON public.notification_envois (token_hash) WHERE token_hash IS NOT NULL;

COMMENT ON TABLE public.notification_envois IS
  'Registre des tentatives d''envoi de notification, toutes surfaces. Une ligne par push. Rétention 90 j (purge du cron). N''efface jamais de jeton : un 410 est noté, pas traité.';

-- RLS activée : PostgREST n''expose pas une table sans elle. service_role a
-- BYPASSRLS mais exige quand même un GRANT explicite sur une table créée par
-- migration (contrairement à celles créées via le tableau de bord Supabase).
ALTER TABLE public.notification_envois ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_envois TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.notification_envois_id_seq TO service_role;

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Les quatre colonnes doivent valoir true.
--
-- SELECT
--   to_regclass('public.notification_envois') IS NOT NULL AS table_ok,
--   (SELECT count(*) FROM pg_indexes WHERE schemaname='public'
--     AND tablename='notification_envois') >= 5                AS index_ok,
--   has_table_privilege('service_role','public.notification_envois','INSERT') AS grant_insert_ok,
--   has_sequence_privilege('service_role','public.notification_envois_id_seq','USAGE') AS grant_seq_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- À n'exécuter QU'APRÈS avoir remis le code en arrière : le code écrit dans
-- cette table, mais ne lit jamais son contenu et ne bloque jamais sur un échec
-- d'écriture — un retour arrière du code seul est donc déjà sans danger.
--
-- DROP TABLE IF EXISTS public.notification_envois;
