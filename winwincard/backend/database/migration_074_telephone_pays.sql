-- Migration 074 : le téléphone selon le PAYS du marchand (H0, prérequis Hubrise ;
-- GO du pilotage du 05/11, docs/hubrise/01-diagnostic.md §4.2)
--
-- POURQUOI. La règle de format de la migration 068 (normaliser_telephone) est
-- celle des Émirats. Chez un marchand français, « 06 12 34 56 78 » donne NULL
-- (carte introuvable par son numéro) et « 05 56 12 34 56 » devient +971 556…
-- (faux numéro). Le crédit par numéro (API v1, puis Hubrise) et la récupération
-- de carte ne marchent donc pas en France.
--
-- EXIGENCE DURE : ADDITIF. normaliser_telephone N'EST PAS TOUCHÉE (ni redéfinie,
-- ni recréée) : un marchand AE garde octet pour octet le même résultat. Le
-- français est une branche NEUVE à côté, choisie par le pays du marchand :
--   normaliser_telephone_pays(brut, pays) = normaliser_telephone_fr(brut) si 'FR',
--                                           normaliser_telephone(brut)     sinon.
-- Preuve DANS la migration : la forme normalisée de chaque client est photographiée
-- avant ; après la réécriture, un seul écart chez un client AE ARRÊTE la migration
-- (rien n'est changé).
--
-- CE QUE FAIT LA MIGRATION.
--   1. normaliser_telephone_fr, normaliser_telephone_pays (nouvelles) ;
--   2. marchands.pays ('AE' | 'FR', défaut 'AE') ; AU PREMIER PASSAGE SEULEMENT,
--      'FR' pour les marchands de langue 'fr' (liste à valider AVANT avec la
--      requête database/requetes/h0_telephone_pays.sql, bloc A) ;
--   3. clients.pays_telephone (copie du pays du marchand, posée à l'inscription
--      par un déclencheur) ;
--   4. garde-fou : deux clients d'un même marchand avec le même numéro une fois
--      normalisé selon son pays → arrêt, rien n'est changé (comme la 068) ;
--   5. clients.telephone_normalise recalculée selon (telephone, pays_telephone)
--      et son index unique reconstruit ; contrôle « AE inchangé » ;
--   6. attacher_telephone et trouver_carte_par_telephone normalisent le numéro
--      reçu selon le pays du marchand (mêmes signatures) ;
--   7. regler_pays_marchand : changer le pays d'un marchand plus tard (admin),
--      aperçu puis écriture, refus si doublons.
--
-- CE QUI EST RÉPARÉ POUR L'EXISTANT FR. La colonne normalisée est recalculée
-- depuis la valeur BRUTE (clients.telephone), qui est gardée telle que tapée à
-- l'inscription. Donc « 06… », « +33 (0)6… », « 33 6… » deviennent lisibles, et
-- « 05… » passe de +9715… à +335…. N'EST PAS réparable : une valeur brute déjà
-- réécrite en +971… par attacher_telephone (rattachement par la caisse ou l'API
-- d'un marchand FR : la brute d'origine est perdue), un numéro tronqué ou faux,
-- un numéro national étranger sans « + ». La requête du bloc C les compte.
--
-- COÛT. La colonne générée RÉÉCRIT la table clients une fois (5,6 s mesurées
-- pour 100 000 clients en 068 ; requête de taille AVANT, moment calme). Les scans
-- attendent pendant la réécriture. Ensuite, le recalcul à chaque mise à jour d'un
-- client passe par une fonction de plus (SQL, inlinable).
-- COMPATIBILITÉ. L'ancien code marche après la migration (le déclencheur pose le
-- pays à l'inscription, les signatures ne changent pas). À exécuter AVANT le code
-- de H0 (l'admin écrit marchands.pays). Rejouable : la réinitialisation par la
-- langue et la réécriture ne se font qu'une fois.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 1. La règle française, à côté de celle des Émirats ──────────────────────
-- Même nettoyage que normaliser_telephone (espaces, points, barres, tirets,
-- parenthèses ; « 00 » devant → « + »). Puis :
--   0X XX XX XX XX (10 chiffres, X ≠ 0)  → +33 X XX XX XX XX
--   33 X XX XX XX XX                     → +33 X…
--   +33 0X XX XX XX XX (« +33 (0)6… »)   → +33 X…
--   « + » suivi de 8 à 15 chiffres       → gardé (étranger), comme la règle AE
--   le reste                             → NULL (valeur brute gardée).
-- Limite : un numéro d'outre-mer tapé au format national (0692…) devient +33…
-- et non +262… ; 9 chiffres sans le 0 (612345678) → NULL (pas deviné).
CREATE OR REPLACE FUNCTION public.normaliser_telephone_fr(brut text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN s ~ '^0[1-9][0-9]{8}$'       THEN '+33' || substr(s, 2)
    WHEN s ~ '^33[1-9][0-9]{8}$'      THEN '+' || s
    WHEN s ~ '^\+330[1-9][0-9]{8}$'   THEN '+33' || substr(s, 5)
    WHEN s ~ '^\+[1-9][0-9]{7,14}$'   THEN s
    ELSE NULL
  END
  FROM (SELECT CASE WHEN t LIKE '00%' THEN '+' || substr(t, 3) ELSE t END AS s
          FROM (SELECT regexp_replace(coalesce(brut, ''), '[[:space:]./()-]', '', 'g') AS t) a) b
$$;
GRANT EXECUTE ON FUNCTION public.normaliser_telephone_fr(text) TO service_role;

-- Aiguillage : 'FR' → règle française ; tout le reste (AE, NULL) → la règle de la
-- 068, appelée telle quelle. C'est ce qui rend le résultat AE identique.
CREATE OR REPLACE FUNCTION public.normaliser_telephone_pays(brut text, pays text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN pays = 'FR' THEN public.normaliser_telephone_fr(brut)
              ELSE public.normaliser_telephone(brut) END
$$;
GRANT EXECUTE ON FUNCTION public.normaliser_telephone_pays(text, text) TO service_role;

-- ── 2. Le pays du marchand ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 'marchands' AND column_name = 'pays') THEN
    ALTER TABLE public.marchands ADD COLUMN pays text NOT NULL DEFAULT 'AE';
    -- Premier passage seulement : un rejeu n'écrase pas un pays réglé depuis dans l'admin.
    UPDATE public.marchands SET pays = 'FR' WHERE langue = 'fr';
  END IF;
END $$;
ALTER TABLE public.marchands DROP CONSTRAINT IF EXISTS marchands_pays_check;
ALTER TABLE public.marchands ADD CONSTRAINT marchands_pays_check CHECK (pays IN ('AE', 'FR'));
COMMENT ON COLUMN public.marchands.pays IS
  'Pays du marchand : règle de format des numéros de ses clients (AE = règle 068 inchangée, FR = normaliser_telephone_fr). Migration 074.';

-- ── 3. Le pays du numéro de chaque client (une colonne générée ne lit pas marchands)
-- Défaut constant : ajout sans réécriture. Puis la copie du pays du marchand.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS pays_telephone text NOT NULL DEFAULT 'AE';
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_pays_telephone_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_pays_telephone_check CHECK (pays_telephone IN ('AE', 'FR'));
UPDATE public.clients c SET pays_telephone = m.pays
  FROM public.marchands m
 WHERE m.id = c.marchand_id AND c.pays_telephone IS DISTINCT FROM m.pays;

-- Déclencheur : à l'inscription (toute insertion), le pays du marchand. La colonne
-- générée est calculée APRÈS les déclencheurs BEFORE : elle voit ce pays.
CREATE OR REPLACE FUNCTION public.clients_pays_telephone()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.pays_telephone := coalesce((SELECT pays FROM public.marchands WHERE id = NEW.marchand_id), 'AE');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clients_pays_telephone ON public.clients;
CREATE TRIGGER clients_pays_telephone BEFORE INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_pays_telephone();

-- ── 4. et 5. Garde-fou, réécriture, preuve « AE inchangé » ───────────────────
DO $$
DECLARE
  n_doublons integer;
  n_ae       integer;
  deja       boolean;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) LIKE '%pays_telephone%' INTO deja
    FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.clients'::regclass AND a.attname = 'telephone_normalise';
  IF deja THEN
    RETURN;   -- rejeu : déjà réécrite
  END IF;

  SELECT count(*) INTO n_doublons FROM (
    SELECT 1 FROM public.clients
     WHERE deleted_at IS NULL AND public.normaliser_telephone_pays(telephone, pays_telephone) IS NOT NULL
     GROUP BY marchand_id, public.normaliser_telephone_pays(telephone, pays_telephone) HAVING count(*) > 1) d;
  IF n_doublons > 0 THEN
    RAISE EXCEPTION 'migration 074 arrêtée : % numéro(s) en double une fois normalisé(s) selon le pays, rien n''a été changé', n_doublons;
  END IF;

  CREATE TEMP TABLE m074_avant ON COMMIT DROP AS
    SELECT id, telephone_normalise FROM public.clients;

  ALTER TABLE public.clients DROP COLUMN telephone_normalise;   -- emporte clients_telephone_unique
  ALTER TABLE public.clients ADD COLUMN telephone_normalise text
    GENERATED ALWAYS AS (public.normaliser_telephone_pays(telephone, pays_telephone)) STORED;
  CREATE UNIQUE INDEX clients_telephone_unique
    ON public.clients (marchand_id, telephone_normalise)
    WHERE telephone_normalise IS NOT NULL AND deleted_at IS NULL;

  -- PREUVE : aucun client AE ne change, octet pour octet.
  SELECT count(*) INTO n_ae
    FROM public.clients c JOIN m074_avant a ON a.id = c.id
   WHERE c.pays_telephone = 'AE' AND c.telephone_normalise IS DISTINCT FROM a.telephone_normalise;
  IF n_ae > 0 THEN
    RAISE EXCEPTION 'migration 074 arrêtée : % client(s) AE changeraient de numéro normalisé, rien n''a été changé', n_ae;
  END IF;
END $$;

-- ── 6. Les fonctions du numéro : le numéro reçu est lu selon le pays du marchand
-- Mêmes signatures et même corps que la 068, à une expression près.
CREATE OR REPLACE FUNCTION public.attacher_telephone(
  p_marchand_id uuid, p_serial text, p_brut text, p_source text, p_ecrire boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_norm  text := public.normaliser_telephone_pays(p_brut, (SELECT pays FROM public.marchands WHERE id = p_marchand_id));
  v_id    uuid;
  v_prenom text;
  v_actuel text;
  v_autre text;
BEGIN
  IF v_norm IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'numero_invalide');
  END IF;
  IF p_ecrire THEN
    SELECT id, prenom, telephone_normalise INTO v_id, v_prenom, v_actuel FROM public.clients
     WHERE marchand_id = p_marchand_id AND pass_serial_number = p_serial AND deleted_at IS NULL
     FOR UPDATE;
  ELSE
    SELECT id, prenom, telephone_normalise INTO v_id, v_prenom, v_actuel FROM public.clients
     WHERE marchand_id = p_marchand_id AND pass_serial_number = p_serial AND deleted_at IS NULL;
  END IF;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'carte_introuvable');
  END IF;
  IF v_actuel = v_norm THEN
    RETURN jsonb_build_object('ok', true, 'inchange', true, 'telephone', v_norm, 'prenom', v_prenom);
  END IF;
  IF v_actuel IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'deja_un_numero', 'fin', right(v_actuel, 4));
  END IF;
  SELECT prenom INTO v_autre FROM public.clients
   WHERE marchand_id = p_marchand_id AND telephone_normalise = v_norm AND deleted_at IS NULL AND id <> v_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'numero_pris', 'prenom_autre', v_autre);
  END IF;
  IF NOT p_ecrire THEN
    RETURN jsonb_build_object('ok', true, 'apercu', true, 'telephone', v_norm, 'prenom', v_prenom);
  END IF;
  BEGIN
    UPDATE public.clients
       SET telephone = v_norm, telephone_source = p_source, telephone_lie_le = now()
     WHERE id = v_id;
  EXCEPTION WHEN unique_violation THEN   -- même numéro attaché au même instant ailleurs
    RETURN jsonb_build_object('ok', false, 'reason', 'numero_pris');
  END;
  -- Rattachement par la caisse d'un commerçant (API) : pas de ligne de
  -- consentement (modèle sous-traitant, décision du pilotage du 20/10).
  IF p_source <> 'caisse' THEN
    INSERT INTO public.consentements (client_id, marchand_id, type, valeur, source)
    VALUES (v_id, p_marchand_id, 'telephone', true, p_source);
  END IF;
  RETURN jsonb_build_object('ok', true, 'telephone', v_norm, 'prenom', v_prenom);
END $$;
GRANT EXECUTE ON FUNCTION public.attacher_telephone(uuid, text, text, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.trouver_carte_par_telephone(p_marchand_id uuid, p_brut text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN n.norm IS NULL THEN jsonb_build_object('ok', false, 'reason', 'numero_invalide')
    ELSE coalesce((
      SELECT jsonb_build_object('ok', true, 'client_id', c.id, 'prenom', c.prenom, 'solde', c.stored_value,
                                'serial', c.pass_serial_number)
        FROM public.clients c
       WHERE c.marchand_id = p_marchand_id AND c.deleted_at IS NULL
         AND c.telephone_normalise = n.norm),
      jsonb_build_object('ok', false, 'reason', 'introuvable'))
  END
  FROM (SELECT public.normaliser_telephone_pays(p_brut,
                 (SELECT pays FROM public.marchands WHERE id = p_marchand_id)) AS norm) n
$$;
GRANT EXECUTE ON FUNCTION public.trouver_carte_par_telephone(uuid, text) TO service_role;

-- ── 7. Changer le pays d'un marchand (admin) ────────────────────────────────
-- p_ecrire = false : aperçu (combien de numéros changent, deviennent lisibles ou
-- illisibles ; doublons) ; true : écriture, refusée s'il y a des doublons.
-- Réécrit les lignes clients de CE marchand (une à une, verrou de ligne).
CREATE OR REPLACE FUNCTION public.regler_pays_marchand(p_marchand_id uuid, p_pays text, p_ecrire boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_actuel   text;
  v_changent integer;
  v_lisibles integer;
  v_perdus   integer;
  v_doublons integer;
BEGIN
  IF p_pays IS NULL OR p_pays NOT IN ('AE', 'FR') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pays_invalide');
  END IF;
  IF p_ecrire THEN
    SELECT pays INTO v_actuel FROM public.marchands WHERE id = p_marchand_id FOR UPDATE;
  ELSE
    SELECT pays INTO v_actuel FROM public.marchands WHERE id = p_marchand_id;
  END IF;
  IF v_actuel IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'marchand_introuvable');
  END IF;
  IF v_actuel = p_pays THEN
    RETURN jsonb_build_object('ok', true, 'inchange', true, 'pays', p_pays);
  END IF;
  SELECT count(*) FILTER (WHERE public.normaliser_telephone_pays(telephone, p_pays) IS DISTINCT FROM telephone_normalise),
         count(*) FILTER (WHERE telephone_normalise IS NULL AND public.normaliser_telephone_pays(telephone, p_pays) IS NOT NULL),
         count(*) FILTER (WHERE telephone_normalise IS NOT NULL AND public.normaliser_telephone_pays(telephone, p_pays) IS NULL)
    INTO v_changent, v_lisibles, v_perdus
    FROM public.clients
   WHERE marchand_id = p_marchand_id AND deleted_at IS NULL AND coalesce(trim(telephone), '') <> '';
  SELECT count(*) INTO v_doublons FROM (
    SELECT 1 FROM public.clients
     WHERE marchand_id = p_marchand_id AND deleted_at IS NULL
       AND public.normaliser_telephone_pays(telephone, p_pays) IS NOT NULL
     GROUP BY public.normaliser_telephone_pays(telephone, p_pays) HAVING count(*) > 1) d;
  IF v_doublons > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'doublons', 'doublons', v_doublons);
  END IF;
  IF NOT p_ecrire THEN
    RETURN jsonb_build_object('ok', true, 'apercu', true, 'pays', p_pays,
      'numeros_changent', v_changent, 'deviennent_lisibles', v_lisibles, 'deviennent_illisibles', v_perdus);
  END IF;
  BEGIN
    UPDATE public.marchands SET pays = p_pays WHERE id = p_marchand_id;
    UPDATE public.clients SET pays_telephone = p_pays WHERE marchand_id = p_marchand_id;
  EXCEPTION WHEN unique_violation THEN   -- un numéro inscrit au même instant
    RETURN jsonb_build_object('ok', false, 'reason', 'doublons', 'doublons', 1);
  END;
  RETURN jsonb_build_object('ok', true, 'pays', p_pays,
    'numeros_changent', v_changent, 'deviennent_lisibles', v_lisibles, 'deviennent_illisibles', v_perdus);
END $$;
REVOKE ALL ON FUNCTION public.regler_pays_marchand(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.regler_pays_marchand(uuid, text, boolean) TO service_role;

COMMIT;

-- ── VÉRIFICATION (à coller juste après) ──────────────────────────────────
-- Une ligne. Attendu : true | true | true | 0 | 0 | (nombre de marchands FR)
--
-- SELECT
--   (SELECT pg_get_expr(d.adbin, d.adrelid) LIKE '%normaliser_telephone_pays%'
--      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
--     WHERE d.adrelid = 'public.clients'::regclass AND a.attname = 'telephone_normalise') AS colonne_ok,
--   (SELECT count(*) = 1 FROM pg_indexes WHERE indexname = 'clients_telephone_unique')  AS index_ok,
--   (SELECT count(*) = 1 FROM pg_trigger WHERE tgname = 'clients_pays_telephone')       AS declencheur_ok,
--   (SELECT count(*) FROM clients WHERE pays_telephone = 'AE'
--       AND telephone_normalise IS DISTINCT FROM normaliser_telephone(telephone))       AS ecarts_ae,
--   (SELECT count(*) FROM clients c JOIN marchands m ON m.id = c.marchand_id
--     WHERE c.pays_telephone <> m.pays)                                                 AS pays_desaccordes,
--   (SELECT count(*) FROM marchands WHERE pays = 'FR')                                  AS marchands_fr;
-- Détail (écarts, réparés, irrécupérables) : database/requetes/h0_telephone_pays.sql, bloc C.

-- ── RETOUR ARRIÈRE ────────────────────────────────────────────────────────
-- Code d'abord (l'admin écrit marchands.pays). Puis, pour revenir à la règle
-- 068 seule sans rien perdre : passer chaque marchand FR en AE avec
-- regler_pays_marchand(id, 'AE', true) — la colonne redonne alors exactement
-- normaliser_telephone(telephone). Les colonnes et fonctions peuvent rester.
