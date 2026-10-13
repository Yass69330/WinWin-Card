-- Migration 059 : le marchand ne voit que ses vrais clients ; campagnes par
-- segment (chantier du 13/10).
--
-- VRAIS CLIENTS (décision de Yass, 13/10). Un client est VISIBLE s'il a au moins
-- un scan non annulé, OU un jeton Apple, OU le signal Google
-- (passes.google_ouvert_le). Les autres — inscriptions jamais finalisées — sont
-- masqués partout côté marchand : liste, recherche, export, statistiques, relances,
-- campagnes. Aucun statut affiché, rien supprimé. Le scanner n'est pas filtré : un
-- client masqué qui présente sa carte est scanné, et devient visible.
--
-- POURQUOI UNE COLONNE. `clients.visible` est tenue à jour par des déclencheurs,
-- au moment où le signal apparaît (scan, jeton, clic Google) ou disparaît
-- (annulation de scan, jeton supprimé). Les lectures filtrent sur une colonne :
-- leur coût ne grossit pas avec les scans accumulés. Au scan, le déclencheur ne
-- réécrit rien quand le client est déjà visible (cas courant).
--
-- SEGMENTS (décisions du 13/10). Une campagne cible un segment, ou tous les
-- clients (segment NULL, comme avant) :
--   - {"type":"inactifs","jours":15|30|60} : venus au moins une fois, plus depuis
--     N jours ;
--   - {"type":"fideles"} : plus de `freq_seuil_haut` passages (jours avec scan)
--     sur 30 jours — la tranche haute de la barre de fréquence ;
--   - {"type":"boutique","boutique":<id>,"nom":<nom>} : au moins un passage dans
--     cette boutique sur 90 jours (réseaux ; exception voulue par Yass au Socle,
--     c'est le réseau qui envoie).
-- Une campagne CIBLÉE exclut les clients qui ont reçu une relance automatique le
-- jour (UTC) du clic. « Tous les clients » et le cron sont inchangés.
-- Le segment est évalué à l'envoi, lot par lot, par rapport à l'heure du clic
-- (campagnes.cree_le) : pas de liste de destinataires stockée.
--
-- ÉVOLUTION. Aucune table nouvelle, aucun index nouveau, aucune purge à prévoir.
-- Colonnes : clients.visible, campagnes.segment.
--
-- COMPATIBILITÉ. L'ancien code reste correct après la migration : le masquage
-- s'applique déjà aux statistiques, aux relances et à la voie Google des
-- campagnes ; lancer_campagne garde ses 4 paramètres (le 5e a une valeur par
-- défaut). La liste et l'export ne masquent qu'avec le nouveau code.
-- À exécuter AVANT le code. Rejouable.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 1. Indicateur « vrai client » ───────────────────────────────────────────
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS visible boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.clients.visible IS
  'Vrai client : au moins un scan non annulé, un jeton Apple ou le signal Google. Tenu par déclencheurs (migration 059). Les autres sont masqués côté marchand.';

-- `updated_at` (déclencheur trg_clients_updated_at) sert à la relance near_reward
-- (« le solde a bougé depuis la dernière relance »). Un changement qui ne porte
-- QUE sur `visible` ne doit pas le faire avancer : sinon le remplissage ci-dessous
-- relancerait tous les vrais clients au cron suivant. Toute autre mise à jour
-- garde son comportement d'avant (y compris une mise à jour sans changement).
DROP TRIGGER IF EXISTS trg_clients_updated_at ON public.clients;
CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON public.clients
  FOR EACH ROW
  WHEN (NOT (OLD.visible IS DISTINCT FROM NEW.visible
             AND (to_jsonb(OLD) - 'visible' - 'updated_at') = (to_jsonb(NEW) - 'visible' - 'updated_at')))
  EXECUTE FUNCTION public.set_updated_at();

UPDATE public.clients c SET visible = true
 WHERE NOT c.visible
   AND (EXISTS (SELECT 1 FROM scans s WHERE s.client_id = c.id AND s.annule_le IS NULL)
        OR EXISTS (SELECT 1 FROM device_tokens d WHERE d.serial_number = c.pass_serial_number)
        OR EXISTS (SELECT 1 FROM passes p WHERE p.serial_number = c.pass_serial_number AND p.google_ouvert_le IS NOT NULL));

-- Recalcul complet pour UN client (un signal a disparu). Rare : annulation de scan,
-- carte supprimée de l'iPhone.
CREATE OR REPLACE FUNCTION public.recalculer_visible(p_client_id uuid)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE clients c SET visible = v.ok
    FROM (SELECT c2.id,
                 EXISTS (SELECT 1 FROM scans s WHERE s.client_id = c2.id AND s.annule_le IS NULL)
                 OR EXISTS (SELECT 1 FROM device_tokens d WHERE d.serial_number = c2.pass_serial_number)
                 OR EXISTS (SELECT 1 FROM passes p WHERE p.serial_number = c2.pass_serial_number AND p.google_ouvert_le IS NOT NULL) AS ok
            FROM clients c2 WHERE c2.id = p_client_id) v
   WHERE c.id = v.id AND c.visible IS DISTINCT FROM v.ok;
$$;

CREATE OR REPLACE FUNCTION public.visible_apres_scan()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE clients SET visible = true WHERE id = NEW.client_id AND NOT visible;
  ELSE
    PERFORM recalculer_visible(NEW.client_id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.visible_apres_jeton()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    FOR v_id IN SELECT id FROM clients WHERE pass_serial_number = OLD.serial_number LOOP
      PERFORM recalculer_visible(v_id);
    END LOOP;
  ELSE
    UPDATE clients SET visible = true WHERE pass_serial_number = NEW.serial_number AND NOT visible;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.visible_apres_google()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE clients SET visible = true WHERE pass_serial_number = NEW.serial_number AND NOT visible;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS scans_visible_insert ON public.scans;
CREATE TRIGGER scans_visible_insert AFTER INSERT ON public.scans
  FOR EACH ROW WHEN (NEW.annule_le IS NULL) EXECUTE FUNCTION public.visible_apres_scan();
DROP TRIGGER IF EXISTS scans_visible_annulation ON public.scans;
CREATE TRIGGER scans_visible_annulation AFTER UPDATE OF annule_le ON public.scans
  FOR EACH ROW WHEN (OLD.annule_le IS DISTINCT FROM NEW.annule_le) EXECUTE FUNCTION public.visible_apres_scan();
DROP TRIGGER IF EXISTS device_tokens_visible ON public.device_tokens;
CREATE TRIGGER device_tokens_visible AFTER INSERT OR UPDATE OR DELETE ON public.device_tokens
  FOR EACH ROW EXECUTE FUNCTION public.visible_apres_jeton();
DROP TRIGGER IF EXISTS passes_visible_google_insert ON public.passes;
CREATE TRIGGER passes_visible_google_insert AFTER INSERT ON public.passes
  FOR EACH ROW WHEN (NEW.google_ouvert_le IS NOT NULL) EXECUTE FUNCTION public.visible_apres_google();
DROP TRIGGER IF EXISTS passes_visible_google ON public.passes;
CREATE TRIGGER passes_visible_google AFTER UPDATE OF google_ouvert_le ON public.passes
  FOR EACH ROW WHEN (OLD.google_ouvert_le IS NULL AND NEW.google_ouvert_le IS NOT NULL)
  EXECUTE FUNCTION public.visible_apres_google();

-- ── 2. Masquage dans les lectures en base ───────────────────────────────────
-- apercu_stats (056) : seule la CTE `cl` change (c.visible). Les actifs viennent
-- des scans : ils sont visibles par définition.
CREATE OR REPLACE FUNCTION public.apercu_stats(p_marchand_id uuid, p_maintenant timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
SET timezone = 'UTC'
AS $$
WITH bornes AS (
  SELECT p_maintenant                                            AS maintenant,
         date_trunc('day', p_maintenant)                         AS jour,
         date_trunc('month', p_maintenant)                       AS mois,
         date_trunc('month', p_maintenant) - interval '1 month'  AS prec,
         p_maintenant - interval '30 days'                       AS j30
),
b AS (
  -- Mêmes jours du mois précédent : même durée écoulée, jamais au-delà du 1er.
  SELECT bornes.*, LEAST(prec + (maintenant - mois), mois) AS prec_memes_jours FROM bornes
),
seuils AS (
  SELECT COALESCE(freq_seuil_bas, 5) AS bas, COALESCE(freq_seuil_haut, 10) AS haut
    FROM marchands WHERE id = p_marchand_id
),
s30 AS MATERIALIZED (
  -- n = PASSAGES : jours (UTC) avec au moins un scan non annulé (décision du
  -- 13/10 : « une visite = un jour avec scan »). Deux scans le même jour = 1.
  SELECT sc.client_id, count(DISTINCT date_trunc('day', sc.date_scan)) AS n
    FROM scans sc, b
   WHERE sc.marchand_id = p_marchand_id AND sc.annule_le IS NULL AND sc.date_scan >= b.j30 AND sc.date_scan <= b.maintenant
   GROUP BY sc.client_id
),
cl AS (
  SELECT count(*)                                                                 AS porteurs,
         count(*) FILTER (WHERE c.created_at <  b.j30)                            AS anciens,
         count(*) FILTER (WHERE c.created_at >= b.mois)                           AS nouveaux,
         count(*) FILTER (WHERE c.created_at >= b.prec AND c.created_at < b.prec_memes_jours) AS nouveaux_prec
    FROM clients c, b
   WHERE c.marchand_id = p_marchand_id AND c.deleted_at IS NULL AND c.visible AND c.created_at <= b.maintenant
),
act AS (
  SELECT count(*)                       AS actifs,
         COALESCE(sum(s.n), 0)          AS scans30,
         count(*) FILTER (WHERE s.n >= 2 AND c.deleted_at IS NULL AND c.created_at < (SELECT j30 FROM b)) AS revenus_anciens,
         count(*) FILTER (WHERE s.n <  (SELECT bas  FROM seuils))                                         AS d_bas,
         count(*) FILTER (WHERE s.n >= (SELECT bas  FROM seuils) AND s.n <= (SELECT haut FROM seuils))    AS d_milieu,
         count(*) FILTER (WHERE s.n >  (SELECT haut FROM seuils))                                         AS d_haut
    FROM s30 s LEFT JOIN clients c ON c.id = s.client_id
),
auj AS (
  SELECT count(*) AS n FROM scans sc, b
   WHERE sc.marchand_id = p_marchand_id AND sc.annule_le IS NULL AND sc.date_scan >= b.jour AND sc.date_scan <= b.maintenant
),
mois_scans AS MATERIALIZED (
  SELECT DISTINCT sc.client_id, (sc.date_scan >= b.mois) AS ce_mois
    FROM scans sc, b
   WHERE sc.marchand_id = p_marchand_id AND sc.annule_le IS NULL AND sc.date_scan >= b.prec AND sc.date_scan <= b.maintenant
),
retour AS (
  -- Inchangé (décision du 13/10) : actifs du mois entamé déjà venus le mois
  -- précédent COMPLET, ÷ actifs du mois.
  SELECT count(*) AS ce_mois,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM mois_scans p WHERE p.client_id = m.client_id AND NOT p.ce_mois)) AS revenus
    FROM mois_scans m WHERE m.ce_mois
)
SELECT jsonb_build_object(
  'porteurs',                       cl.porteurs,
  'scans_aujourdhui',               auj.n,
  'actifs_30j',                     act.actifs,
  'visites_moyennes',               CASE WHEN act.actifs > 0 THEN round(act.scans30::numeric / act.actifs, 1) ELSE 0 END,
  'retention',                      CASE WHEN cl.anciens > 0 THEN round(100.0 * act.revenus_anciens / cl.anciens)::int END,
  'nouveaux_ce_mois',               cl.nouveaux,
  'nouveaux_mois_prec_memes_jours', cl.nouveaux_prec,
  'taux_retour',                    CASE WHEN retour.ce_mois > 0 THEN round(100.0 * retour.revenus / retour.ce_mois)::int ELSE 0 END,
  'distribution', jsonb_build_object(
    'seuil_bas',  (SELECT bas  FROM seuils),
    'seuil_haut', (SELECT haut FROM seuils),
    'bas',    act.d_bas,
    'milieu', act.d_milieu,
    'haut',   act.d_haut
  )
)
FROM cl, act, auj, retour;
$$;

-- reserver_relances (057) : seule la CTE `base` change (c.visible).
CREATE OR REPLACE FUNCTION public.reserver_relances(
  p_marchand_id uuid, p_type text, p_lot uuid, p_modeles jsonb, p_limite integer,
  p_jours integer DEFAULT NULL, p_min integer DEFAULT NULL, p_max integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_maintenant timestamptz := now();
  v_jour       timestamptz := date_trunc('day',  now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_annee      timestamptz := date_trunc('year', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_mmjj       text        := to_char(now() AT TIME ZONE 'UTC', 'MM-DD');
  v_resultat   jsonb;
BEGIN
  IF p_type IS NULL OR p_type NOT IN ('inactive', 'near_reward', 'birthday') THEN
    RAISE EXCEPTION 'reserver_relances : type inconnu (%)', p_type;
  END IF;
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 1000 THEN
    RAISE EXCEPTION 'reserver_relances : limite hors de [1, 1000] (%)', p_limite;
  END IF;
  IF p_type = 'inactive' AND (p_jours IS NULL OR p_jours < 1) THEN
    RAISE EXCEPTION 'reserver_relances : délai d''inactivité absent';
  END IF;
  IF p_type = 'near_reward' AND (p_min IS NULL OR p_max IS NULL) THEN
    RAISE EXCEPTION 'reserver_relances : zone near_reward absente';
  END IF;

  -- Un seul appel à la fois par marchand, tous types confondus (règle « une par
  -- jour » entre types). L'instruction suivante prend son instantané APRÈS le
  -- verrou : elle voit les réservations de l'appel précédent.
  PERFORM pg_advisory_xact_lock(hashtextextended('relances:' || p_marchand_id::text, 0));

  WITH base AS MATERIALIZED (
    SELECT c.id, c.prenom, c.pass_serial_number AS serial, c.stored_value, c.updated_at,
           -- Règle D2 (étape 23, migration 057) : message Google seulement si le
           -- client a ouvert le lien Google, ou n'a aucune carte Apple installée.
           (p.google_pass_url IS NOT NULL
            AND (p.google_ouvert_le IS NOT NULL
                 OR NOT EXISTS (SELECT 1 FROM device_tokens d0 WHERE d0.serial_number = c.pass_serial_number))) AS google
      FROM clients c
      LEFT JOIN passes p ON p.serial_number = c.pass_serial_number AND p.marchand_id = c.marchand_id
     WHERE c.marchand_id = p_marchand_id
       AND c.deleted_at IS NULL
       AND c.visible                      -- vrais clients seulement (migration 059)
       AND c.pass_serial_number IS NOT NULL
       AND (p.google_pass_url IS NOT NULL
            OR EXISTS (SELECT 1 FROM device_tokens d WHERE d.serial_number = c.pass_serial_number))
       AND NOT EXISTS (SELECT 1 FROM workflow_executions w
                        WHERE w.marchand_id = p_marchand_id AND w.client_id = c.id AND w.executed_at >= v_jour)
       AND (p_type <> 'birthday'    OR to_char(c.date_anniversaire, 'MM-DD') = v_mmjj)
       AND (p_type <> 'near_reward' OR (c.stored_value >= p_min AND c.stored_value < p_max))
       AND (p_type <> 'inactive'    OR NOT EXISTS (
             SELECT 1 FROM scans s
              WHERE s.marchand_id = p_marchand_id AND s.client_id = c.id AND s.annule_le IS NULL
                AND s.date_scan >= v_maintenant - make_interval(days => p_jours)))
  ), cand AS MATERIALIZED (
    SELECT b.* FROM base b
     WHERE CASE p_type
       WHEN 'birthday' THEN NOT EXISTS (
         SELECT 1 FROM workflow_executions w
          WHERE w.workflow_type = 'birthday' AND w.client_id = b.id AND w.executed_at >= v_annee)
       WHEN 'near_reward' THEN NOT EXISTS (
         SELECT 1 FROM workflow_executions w
          WHERE w.workflow_type = 'near_reward' AND w.client_id = b.id AND w.executed_at >= b.updated_at)
       ELSE EXISTS (
         -- Dernier scan non annulé : il doit exister (jamais scanné = exclu) et
         -- aucune relance ne doit l'avoir suivi.
         SELECT 1 FROM (SELECT max(s.date_scan) AS dernier FROM scans s
                         WHERE s.client_id = b.id AND s.annule_le IS NULL) l
          WHERE l.dernier IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM workflow_executions w
                             WHERE w.workflow_type = 'inactive' AND w.client_id = b.id AND w.executed_at > l.dernier))
     END
  ), elus AS MATERIALIZED (
    SELECT * FROM cand ORDER BY id LIMIT p_limite
  ), textes AS MATERIALIZED (
    SELECT e.*,
           replace(COALESCE(
             CASE WHEN p_type = 'near_reward' THEN p_modeles ->> (p_max - e.stored_value)::text END,
             p_modeles ->> '*'), '{prenom}', COALESCE(e.prenom, '')) AS message
      FROM elus e
  ), inscription AS (
    INSERT INTO workflow_executions (workflow_type, client_id, marchand_id, lot)
    SELECT p_type, id, p_marchand_id, p_lot FROM elus
  ), carte AS (
    UPDATE passes p SET notification_message = t.message
      FROM textes t
     WHERE p.serial_number = t.serial AND p.marchand_id = p_marchand_id
  )
  SELECT jsonb_build_object(
    'eligibles', (SELECT count(*) FROM cand),
    'clients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'client_id', t.id, 'serial', t.serial, 'message', t.message, 'google', t.google,
               'jetons', COALESCE((SELECT jsonb_agg(d.push_token ORDER BY d.id)
                                     FROM device_tokens d WHERE d.serial_number = t.serial), '[]'::jsonb))
             ORDER BY t.id)
        FROM textes t), '[]'::jsonb))
  INTO v_resultat;

  RETURN v_resultat;
END;
$$;

-- cartes_google_campagne (057), gardée pour l'ancien code : + vrais clients.
CREATE OR REPLACE FUNCTION public.cartes_google_campagne(p_marchand_id uuid, p_apres uuid, p_limite integer)
RETURNS TABLE (id uuid, serial_number text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.id, p.serial_number
    FROM passes p
    JOIN clients c ON c.pass_serial_number = p.serial_number AND c.visible AND c.deleted_at IS NULL
   WHERE p.marchand_id = p_marchand_id
     AND p.google_pass_url IS NOT NULL
     AND (p_apres IS NULL OR p.id > p_apres)
     AND (p.google_ouvert_le IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM device_tokens d WHERE d.serial_number = p.serial_number))
   ORDER BY p.id
   LIMIT LEAST(GREATEST(p_limite, 1), 1000);
$$;

-- ── 3. Segments ─────────────────────────────────────────────────────────────
ALTER TABLE public.campagnes ADD COLUMN IF NOT EXISTS segment jsonb;
COMMENT ON COLUMN public.campagnes.segment IS
  'NULL = tous les clients. Sinon {"type":"inactifs","jours":N} | {"type":"fideles"} | {"type":"boutique","boutique":id,"nom":nom} (migration 059).';

-- Le client est-il dans le segment, à l'instant p_ref (heure du clic) ?
-- UNE définition, partagée par le compteur et les deux voies d'envoi.
CREATE OR REPLACE FUNCTION public.client_dans_segment(p_client_id uuid, p_marchand_id uuid, p_segment jsonb, p_ref timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
SET timezone = 'UTC'
AS $$
  SELECT CASE WHEN p_segment IS NULL THEN true ELSE
    -- Campagne ciblée : pas le jour (UTC) d'une relance automatique.
    NOT EXISTS (SELECT 1 FROM workflow_executions w
                 WHERE w.marchand_id = p_marchand_id AND w.executed_at >= date_trunc('day', p_ref)
                   AND w.client_id = p_client_id)
    AND CASE p_segment ->> 'type'
      WHEN 'inactifs' THEN
        EXISTS (SELECT 1 FROM scans s WHERE s.client_id = p_client_id AND s.annule_le IS NULL AND s.date_scan <= p_ref)
        AND NOT EXISTS (SELECT 1 FROM scans s WHERE s.client_id = p_client_id AND s.annule_le IS NULL
                          AND s.date_scan > p_ref - make_interval(days => (p_segment ->> 'jours')::int) AND s.date_scan <= p_ref)
      WHEN 'fideles' THEN
        (SELECT count(DISTINCT date_trunc('day', s.date_scan)) FROM scans s
          WHERE s.client_id = p_client_id AND s.marchand_id = p_marchand_id AND s.annule_le IS NULL
            AND s.date_scan >= p_ref - interval '30 days' AND s.date_scan <= p_ref)
        > (SELECT COALESCE(m.freq_seuil_haut, 10) FROM marchands m WHERE m.id = p_marchand_id)
      WHEN 'boutique' THEN
        EXISTS (SELECT 1 FROM scans s WHERE s.client_id = p_client_id AND s.annule_le IS NULL
                  AND s.point_de_vente_id = (p_segment ->> 'boutique')::uuid
                  AND s.date_scan >= p_ref - interval '90 days' AND s.date_scan <= p_ref)
      ELSE false
    END
  END;
$$;

-- Segment valide pour ce marchand ? Rend le segment complété (nom de la boutique)
-- ou NULL si invalide. NULL en entrée = tous les clients (rendu tel quel : 'tous').
CREATE OR REPLACE FUNCTION public.segment_valide(p_marchand_id uuid, p_segment jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE p_segment ->> 'type'
    WHEN 'inactifs' THEN CASE WHEN p_segment ->> 'jours' IN ('15', '30', '60')
                              THEN jsonb_build_object('type', 'inactifs', 'jours', (p_segment ->> 'jours')::int) END
    WHEN 'fideles'  THEN jsonb_build_object('type', 'fideles')
    WHEN 'boutique' THEN (SELECT jsonb_build_object('type', 'boutique', 'boutique', pdv.id, 'nom', pdv.nom)
                            FROM points_de_vente pdv
                           WHERE pdv.marchand_id = p_marchand_id AND pdv.deleted_at IS NULL
                             AND pdv.id::text = p_segment ->> 'boutique')
  END;
$$;

-- Nombre de destinataires (personnes joignables : jeton Apple ou carte Google),
-- avant l'envoi. Lu à la demande, quand le marchand choisit un segment.
CREATE OR REPLACE FUNCTION public.compter_segment(p_marchand_id uuid, p_segment jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE v_seg jsonb := NULL;
BEGIN
  IF p_segment IS NOT NULL THEN
    v_seg := segment_valide(p_marchand_id, p_segment);
    IF v_seg IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'segment'); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'destinataires', (
    SELECT count(*) FROM clients c
     WHERE c.marchand_id = p_marchand_id AND c.deleted_at IS NULL AND c.visible
       AND (EXISTS (SELECT 1 FROM device_tokens d WHERE d.serial_number = c.pass_serial_number)
            OR EXISTS (SELECT 1 FROM passes p WHERE p.serial_number = c.pass_serial_number AND p.google_pass_url IS NOT NULL))
       AND client_dans_segment(c.id, p_marchand_id, v_seg, now())));
END;
$$;

-- lancer_campagne (054) + segment. Même corps ; un segment invalide est refusé
-- avant toute écriture (quota non compté).
DROP FUNCTION IF EXISTS public.lancer_campagne(uuid, text, integer, timestamptz);
CREATE OR REPLACE FUNCTION public.lancer_campagne(
  p_marchand_id uuid, p_message text, p_limite integer, p_debut_mois timestamptz, p_segment jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_used   integer;
  v_log_id uuid;
  v_id     uuid;
  v_seg    jsonb := NULL;
BEGIN
  IF p_segment IS NOT NULL THEN
    v_seg := segment_valide(p_marchand_id, p_segment);
    IF v_seg IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'segment'); END IF;
  END IF;

  SELECT count(*) INTO v_used
    FROM notification_logs
   WHERE marchand_id = p_marchand_id AND created_at >= p_debut_mois;
  IF v_used >= p_limite THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quota', 'used', v_used);
  END IF;

  BEGIN
    INSERT INTO notification_logs (marchand_id, message)
    VALUES (p_marchand_id, p_message)
    RETURNING id INTO v_log_id;

    INSERT INTO campagnes (marchand_id, notification_log_id, message, segment)
    VALUES (p_marchand_id, v_log_id, p_message, v_seg)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'en_cours');
  END;

  RETURN jsonb_build_object('ok', true, 'campagne_id', v_id, 'used', v_used + 1);
END;
$$;

-- Voies d'envoi par campagne : même curseur (id croissant) que t37, segment de
-- la campagne évalué à l'heure du clic.
CREATE OR REPLACE FUNCTION public.campagne_lot_apple(p_campagne_id uuid, p_apres uuid, p_limite integer)
RETURNS TABLE (id uuid, push_token text, serial_number text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT d.id, d.push_token, d.serial_number
    FROM campagnes k
    JOIN device_tokens d ON d.marchand_id = k.marchand_id
   WHERE k.id = p_campagne_id
     AND (p_apres IS NULL OR d.id > p_apres)
     AND (k.segment IS NULL OR EXISTS (
           SELECT 1 FROM clients c
            WHERE c.pass_serial_number = d.serial_number AND c.marchand_id = k.marchand_id
              AND c.deleted_at IS NULL AND c.visible
              AND client_dans_segment(c.id, k.marchand_id, k.segment, k.cree_le)))
   ORDER BY d.id
   LIMIT LEAST(GREATEST(p_limite, 1), 1000);
$$;

CREATE OR REPLACE FUNCTION public.campagne_lot_google(p_campagne_id uuid, p_apres uuid, p_limite integer)
RETURNS TABLE (id uuid, serial_number text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.id, p.serial_number
    FROM campagnes k
    JOIN passes p ON p.marchand_id = k.marchand_id
    JOIN clients c ON c.pass_serial_number = p.serial_number AND c.visible AND c.deleted_at IS NULL
   WHERE k.id = p_campagne_id
     AND p.google_pass_url IS NOT NULL
     AND (p_apres IS NULL OR p.id > p_apres)
     -- Règle D2 (étape 23) : carte Google réelle.
     AND (p.google_ouvert_le IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM device_tokens d WHERE d.serial_number = p.serial_number))
     AND client_dans_segment(c.id, k.marchand_id, k.segment, k.cree_le)
   ORDER BY p.id
   LIMIT LEAST(GREATEST(p_limite, 1), 1000);
$$;

-- ── Droits ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.recalculer_visible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculer_visible(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.visible_apres_scan() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.visible_apres_jeton() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.visible_apres_google() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apercu_stats(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apercu_stats(uuid, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.reserver_relances(uuid, text, uuid, jsonb, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserver_relances(uuid, text, uuid, jsonb, integer, integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.cartes_google_campagne(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cartes_google_campagne(uuid, uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.client_dans_segment(uuid, uuid, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_dans_segment(uuid, uuid, jsonb, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.segment_valide(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.segment_valide(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.compter_segment(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compter_segment(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.lancer_campagne(uuid, text, integer, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lancer_campagne(uuid, text, integer, timestamptz, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.campagne_lot_apple(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campagne_lot_apple(uuid, uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.campagne_lot_google(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campagne_lot_google(uuid, uuid, integer) TO service_role;

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Les cinq colonnes doivent valoir true.
--
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'visible') AS colonne_ok,
--   (SELECT count(*) FROM pg_trigger WHERE tgname IN ('scans_visible_insert', 'scans_visible_annulation', 'device_tokens_visible', 'passes_visible_google', 'passes_visible_google_insert')) = 5
--     AND pg_get_triggerdef((SELECT oid FROM pg_trigger WHERE tgname = 'trg_clients_updated_at')) LIKE '%visible%' AS declencheurs_ok,
--   pg_get_functiondef('public.apercu_stats(uuid,timestamptz)'::regprocedure) LIKE '%c.visible%'
--     AND pg_get_functiondef('public.reserver_relances(uuid,text,uuid,jsonb,integer,integer,integer,integer)'::regprocedure) LIKE '%c.visible%' AS lectures_ok,
--   has_function_privilege('service_role', 'public.lancer_campagne(uuid,text,integer,timestamptz,jsonb)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.lancer_campagne(uuid,text,integer,timestamptz,jsonb)', 'EXECUTE')
--     AND NOT has_function_privilege('anon', 'public.compter_segment(uuid,jsonb)', 'EXECUTE')    AS droits_ok,
--   NOT EXISTS (SELECT 1 FROM clients c WHERE NOT c.visible
--                 AND EXISTS (SELECT 1 FROM scans s WHERE s.client_id = c.id AND s.annule_le IS NULL)) AS remplissage_ok;

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- Après avoir remis le code en arrière :
--   1. rejouer apercu_stats (056), reserver_relances et cartes_google_campagne (057) ;
--   2. rejouer lancer_campagne de 054 après
--      DROP FUNCTION public.lancer_campagne(uuid, text, integer, timestamptz, jsonb);
--   3. DROP TRIGGER scans_visible_insert ON scans ; DROP TRIGGER scans_visible_annulation ON scans ;
--      DROP TRIGGER device_tokens_visible ON device_tokens ; DROP TRIGGER passes_visible_google ON passes ;
--      DROP TRIGGER passes_visible_google_insert ON passes ;
--      trg_clients_updated_at peut rester (même effet tant que `visible` ne change plus) ;
--   4. les colonnes clients.visible et campagnes.segment peuvent rester.
