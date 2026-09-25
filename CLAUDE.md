# Règles de session WinWin

- Diagnostic avant code. Aucun push sans validation explicite de Yass.
- Migration exécutée dans Supabase AVANT le push du code qui en dépend.
- Mémoire de session non fiable (compression, conteneur recréé) : toute
  affirmation sur l'état du projet se prouve par git, code ou SQL.
- En fin de chantier, avant de rendre la main : mettre à jour
  PASSATION_TECHNIQUE.md (livré, décisions, dette découverte) et la committer.
- Toute décision prise sans passer par pilotage est notée dans la passation,
  section « Décisions hors pilotage ».
- Pas de créneau horaire imposé pour les push. Une fenêtre de déploiement
  ne s'applique que si pilotage la demande explicitement pour un push
  sensible.
- Tout fix est pensé pour la roadmap : nommer ses hypothèses (ce qui le
  ferait casser) et ses limites. Ce qui est provisoire ou reporté est écrit
  comme tel dans la passation.
- Toute nouvelle surface d'envoi (APNs ou Google) écrit dans
  notification_envois.
