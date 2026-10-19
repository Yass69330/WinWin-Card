-- Préalables du Lot 1 (API caisses, 19/10) et de l'addendum f04 — LECTURE SEULE.
-- À exécuter dans Supabase (SQL Editor). Une seule ligne de résultat.
SELECT
  -- t17 b : quotas manuels déjà hors bornes (0 à 1000) — attendu 0
  (SELECT count(*) FROM marchands
    WHERE notification_quota_override IS NOT NULL
      AND (notification_quota_override < 0 OR notification_quota_override > 1000)) AS quotas_hors_bornes,
  -- t23 : le rôle courant peut-il créer un rôle de lecture qui ignore la sécurité par ligne ?
  (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)  AS moi_bypassrls,
  (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user) AS moi_createrole,
  current_user AS moi,
  -- contrat API (A.5-4) : soldes négatifs aujourd'hui — attendu 0
  (SELECT count(*) FROM clients WHERE stored_value < 0) AS soldes_negatifs,
  -- f04 : clients (non effacés) ayant déjà un téléphone, et doublons bruts par marchand
  (SELECT count(*) FROM clients WHERE deleted_at IS NULL AND coalesce(trim(telephone), '') <> '') AS clients_avec_tel,
  (SELECT count(*) FROM (
     SELECT marchand_id, regexp_replace(telephone, '[^0-9]', '', 'g') AS t
       FROM clients WHERE deleted_at IS NULL AND coalesce(trim(telephone), '') <> ''
      GROUP BY 1, 2 HAVING count(*) > 1) d) AS numeros_en_double;
