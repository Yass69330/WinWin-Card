'use strict';

// Colonnes de la fiche marchand nécessaires à la fabrication d'une carte (Apple :
// retour d'un iPhone ; f17 : bascule de thème, Apple et Google). theme_actif
// (migration 063) : le thème en cours, appliqué par services/themes.js.
const COLONNES_MARCHAND_CARTE = 'id, nom, slug, forfait, langue, type_programme, pass_display_name, how_it_works, couleur_fond, couleur_fond_reward, couleur_pastille_fond, couleur_pastille_contour, couleur_pastille_icone, couleur_label_strip, couleur_barre_principale, couleur_barre_secondaire,couleur_texte, couleur_texte_reward, couleur_label, logo_url, logo_reward_url, icon_url, image_strip_url, images_tiers, max_value, display_max_value, notification_titre, notification_message, referral_enabled, referral_bonus_points, telephone, adresse, strip_mode, strip_theme, strip_illustration, strip_produit, strip_vide, stamp_icon, strip_custom_background_url, strip_config_version, strip_label, lien_avis_google, geo_actif, geo_lieux, theme_actif';

// Bascule de thème : la classe Google est réécrite en entier, elle a besoin de
// ses images propres.
const COLONNES_BASCULE = `${COLONNES_MARCHAND_CARTE}, google_logo_url, google_hero_url`;

module.exports = { COLONNES_MARCHAND_CARTE, COLONNES_BASCULE };
