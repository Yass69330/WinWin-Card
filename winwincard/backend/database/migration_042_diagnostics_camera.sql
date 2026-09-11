-- Migration 042 : table diagnostics_camera (palier 0.5 — instrument de mesure)
--
-- Contexte. Le scanner dépend de ce que la caméra accorde réellement et de ce
-- que le décodeur coûte sur le décor de chaque comptoir. Aucun de ces deux
-- chiffres n'a jamais été mesuré sur le parc : le code demande une résolution
-- en `ideal`, ce qui n'engage à rien, et le coût de jsQR varie d'un facteur 60
-- selon la scène. Cette table reçoit une empreinte par tablette, envoyée par la
-- page /diag/, étiquetée par point de vente.
--
-- INSTRUMENT TEMPORAIRE, PAS UNE FONCTIONNALITÉ. Rien du produit ne lit cette
-- table : ni le scan, ni le pass, ni le dashboard, ni la facturation. Elle est
-- alimentée par un endpoint public dédié et lue par une seule page admin
-- isolée. Quand le chantier décodeur sera tranché, table et page se suppriment
-- ensemble sans rien toucher d'autre.
--
-- ÉTIQUETTE LIBRE, PAS DE FK. `etiquette` est volontairement du texte libre
-- borné, SANS clé étrangère vers points_de_vente : la page est ouverte par un
-- employé qui n'est connecté à rien, le serveur ne peut donc pas résoudre une
-- boutique de façon fiable, et une FK ferait échouer l'enregistrement d'une
-- mesure — exactement ce qu'on veut éviter pour un instrument dont le seul rôle
-- est de ne jamais rater une mesure. Le CHECK borne la forme (minuscules,
-- chiffres, tirets, 32 caractères) ; le code applique la même règle avant
-- insertion.
--
-- AUCUNE DONNÉE CLIENT. Pas de nom, pas de serial, pas d'identifiant de pass.
-- Le User-Agent est collecté comme information d'appareil — décision assumée
-- par le fondateur, tracée ici.
--
-- GRANT service_role OBLIGATOIRE : une table créée par migration n'a AUCUN
-- droit DML pour service_role par défaut (leçon des migrations 028/030). Sans
-- ce grant, le backend — clé service_role via PostgREST — ne pourrait pas y
-- écrire, EN SILENCE.
--
-- Non-régression : table purement additive, aucune fonction touchée, aucune
-- colonne ajoutée à une table existante. Rejouable sans risque.
--
-- À exécuter dans Supabase.

CREATE TABLE IF NOT EXISTS public.diagnostics_camera (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  etiquette   text        NOT NULL,
  mesure      jsonb       NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Forme de l'étiquette : miroir exact de la liste blanche appliquée dans
-- src/routes/diag.js. Le filet DB reste si le code venait à être contourné.
ALTER TABLE public.diagnostics_camera
  DROP CONSTRAINT IF EXISTS diagnostics_camera_etiquette_forme;
ALTER TABLE public.diagnostics_camera
  ADD CONSTRAINT diagnostics_camera_etiquette_forme
  CHECK (etiquette ~ '^[a-z0-9-]{1,32}$');

-- Lecture de la page de résultats : dernière mesure par étiquette, donc tri
-- décroissant sur la date, groupé par étiquette.
CREATE INDEX IF NOT EXISTS idx_diagnostics_camera_etiquette_date
  ON public.diagnostics_camera (etiquette, created_at DESC);

-- DML pour le backend (service_role). Miroir de migration_006 / 028 / 030 / 032.
GRANT SELECT, INSERT, DELETE ON public.diagnostics_camera TO service_role;
