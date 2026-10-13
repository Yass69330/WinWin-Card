-- Vrais clients par marchand (chantier « campagnes par segment », prérequis).
-- LECTURE SEULE. À lancer avant puis après la vérification Google étendue.
--
-- Visible = au moins un scan non annulé, OU un jeton Apple, OU le signal Google
-- (passes.google_ouvert_le). Masqué = tout le reste (rien n'est supprimé).
WITH c AS (
  SELECT c.marchand_id,
         EXISTS (SELECT 1 FROM scans s WHERE s.client_id = c.id AND s.annule_le IS NULL)              AS scanne,
         EXISTS (SELECT 1 FROM device_tokens d WHERE d.serial_number = c.pass_serial_number)          AS apple,
         p.google_ouvert_le IS NOT NULL                                                                AS signal_google,
         p.google_pass_url IS NOT NULL                                                                 AS lien_google
    FROM clients c
    LEFT JOIN passes p ON p.serial_number = c.pass_serial_number
   WHERE c.deleted_at IS NULL
)
SELECT m.nom,
       count(*)                                                                       AS clients_aujourdhui,
       count(*) FILTER (WHERE scanne OR apple OR signal_google)                       AS clients_apres_masquage,
       count(*) FILTER (WHERE NOT (scanne OR apple OR signal_google))                 AS masques,
       count(*) FILTER (WHERE signal_google AND NOT scanne AND NOT apple)             AS sauves_par_google,
       count(*) FILTER (WHERE NOT (scanne OR apple OR signal_google) AND lien_google) AS masques_a_verifier_google
  FROM c
  JOIN marchands m ON m.id = c.marchand_id
 GROUP BY m.nom
 ORDER BY masques DESC, m.nom;
