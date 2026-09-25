-- Requêtes de pilotage — chantier « Avis Google + ouverture des workflows au Pro »
-- (2026-09-25). Lecture seule : aucune de ces requêtes n'écrit.
-- À coller telles quelles dans l'éditeur SQL Supabase.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. MARCHANDS ÉLIGIBLES AUX WORKFLOWS, AVEC L'ÉTAT DE LEURS INTERRUPTEURS
--    C'est la photographie à regarder AVANT et APRÈS le déploiement : le
--    changement de périmètre n'allume rien, il rend seulement les interrupteurs
--    opérants. Une ligne qui passe de « éteint » à « allumé » ne peut venir que
--    du formulaire admin.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  m.nom,
  m.slug,
  m.forfait,
  m.workflow_inactive_enabled                AS relance_inactifs,
  m.workflow_inactive_days                   AS relance_apres_jours,
  m.workflow_near_reward_enabled             AS recompense_imminente,
  m.workflow_birthday_enabled                AS anniversaire,
  m.landing_premium                          AS landing_premium_requise_pour_anniv,
  (m.lien_avis_google IS NOT NULL)           AS avis_google_actif,
  m.lien_avis_google
FROM public.marchands m
WHERE m.forfait IN ('pro', 'pro_plus')
  AND m.actif = true
ORDER BY m.forfait, m.nom;

-- Résumé chiffré de la même photographie.
SELECT
  forfait,
  count(*)                                              AS marchands_actifs,
  count(*) FILTER (WHERE workflow_inactive_enabled)     AS relance_allumee,
  count(*) FILTER (WHERE workflow_near_reward_enabled)  AS recompense_allumee,
  count(*) FILTER (WHERE workflow_birthday_enabled)     AS anniversaire_allume,
  count(*) FILTER (WHERE lien_avis_google IS NOT NULL)  AS avis_configure
FROM public.marchands
WHERE forfait IN ('pro', 'pro_plus') AND actif = true
GROUP BY forfait
ORDER BY forfait;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. SUIVI DU WORKFLOW D'AVIS (à lancer après quelques jours de production)
--    Envois tracés par le registre (migration 046) et clics mesurés par la
--    table avis_clics (migration 047).
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  m.nom,
  count(*) FILTER (WHERE e.plateforme = 'apple')            AS envois_apple,
  count(*) FILTER (WHERE e.plateforme = 'google')           AS envois_google,
  count(*) FILTER (WHERE NOT e.ok)                          AS echecs,
  (SELECT count(*) FROM public.avis_clics c WHERE c.marchand_id = m.id) AS clics
FROM public.notification_envois e
JOIN public.marchands m ON m.id = e.marchand_id
WHERE e.source = 'avis'
GROUP BY m.id, m.nom
ORDER BY count(*) DESC;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. VÉRIFICATION ANNEXE (demandée en pilotage) — iPhone de Yass
--    device_id b1fa63b0dd423c29b4e2207e07389700.
--
--    Question posée : Yass a reçu une relance « inactif » d'un marchand chez
--    qui il n'a eu AUCUNE autre notification entre deux relances. Cela
--    contredirait la règle « iOS n'affiche rien si la valeur de la case ne
--    change pas ».
--
--    Cette requête reconstruit la CHRONOLOGIE de chaque carte de cet appareil :
--    tout ce qui a réécrit passes.notification_message, mélangé aux relances.
--    Lire la colonne `quoi` de haut en bas, par marchand : si deux lignes
--    « RELANCE inactif » se suivent sans rien entre elles, la règle est
--    contredite et il faudra rouvrir le sujet.
--
--    LIMITE : workflow_executions est purgée à 90 jours et le registre des
--    envois n'existe que depuis le 25/09/2026 — rien d'antérieur n'est visible.
-- ═══════════════════════════════════════════════════════════════════════════
WITH cartes AS (
  SELECT DISTINCT
    c.id                AS client_id,
    c.prenom,
    c.pass_serial_number,
    c.marchand_id,
    m.nom               AS marchand
  FROM public.device_tokens dt
  JOIN public.clients   c ON c.pass_serial_number = dt.serial_number
  JOIN public.marchands m ON m.id = c.marchand_id
  WHERE dt.device_id = 'b1fa63b0dd423c29b4e2207e07389700'
),
evenements AS (
  -- Les relances et les autres workflows automatiques
  SELECT k.marchand, k.prenom, we.executed_at AS quand,
         CASE we.workflow_type
           WHEN 'inactive'    THEN 'RELANCE inactif'
           WHEN 'near_reward' THEN 'workflow récompense imminente'
           WHEN 'birthday'    THEN 'workflow anniversaire'
           ELSE 'workflow ' || we.workflow_type
         END AS quoi
  FROM public.workflow_executions we
  JOIN cartes k ON k.client_id = we.client_id

  UNION ALL

  -- Les scans : ils réécrivent notification_message avec une valeur qui change
  SELECT k.marchand, k.prenom, s.date_scan,
         'scan ' || s.stored_value_avant || ' → ' || s.stored_value_apres
           || CASE WHEN s.annule_le IS NOT NULL THEN ' (annulé)' ELSE '' END
  FROM public.scans s
  JOIN cartes k ON k.client_id = s.client_id

  UNION ALL

  -- Les campagnes manuelles du marchand : elles touchent toutes ses cartes
  SELECT k.marchand, k.prenom, nl.created_at,
         'campagne manuelle : ' || left(nl.message, 60)
  FROM public.notification_logs nl
  JOIN cartes k ON k.marchand_id = nl.marchand_id

  UNION ALL

  -- Le registre des envois, depuis le 25/09/2026 seulement
  SELECT k.marchand, k.prenom, e.envoye_le,
         'envoi ' || e.source || ' / ' || e.plateforme
           || ' → ' || coalesce(e.statut::text, 'aucune réponse')
  FROM public.notification_envois e
  JOIN cartes k ON k.pass_serial_number = e.serial_number
)
SELECT marchand, prenom, quand, quoi
FROM evenements
ORDER BY marchand, quand DESC;
