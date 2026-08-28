/**
 * ============================================================================
 *  ⭐ VOS COORDONNÉES ET INFOS D'ENTREPRISE — FICHIER À PERSONNALISER
 * ============================================================================
 *
 *  Tout ce qui est écrit ici s'affiche automatiquement sur TOUT le site :
 *  en-tête, pied de page, page contact, boutons d'appel, référencement Google.
 *
 *  COMMENT MODIFIER : remplacez simplement le texte entre les guillemets.
 *  ⚠️ Ne supprimez pas les guillemets " " ni les virgules en fin de ligne.
 *
 * ============================================================================
 */

module.exports = {
  // --------------------------------------------------------------------------
  // IDENTITÉ DE L'ENTREPRISE
  // --------------------------------------------------------------------------

  // Nom commercial, affiché à côté du logo et dans le titre des pages
  nom: "Embalpro",

  // Phrase courte affichée sous le nom (accroche)
  slogan: "Fournisseur d'emballages alimentaires pour les professionnels",

  // Description générale du site : utilisée par Google si une page n'a pas
  // de description propre. Idéalement 150 à 160 caractères.
  description:
    "Embalpro, fournisseur B2B d'emballages alimentaires : barquettes, gobelets, sachets kraft, films et boîtes à emporter. Devis rapide et livraison en 48 h.",

  // --------------------------------------------------------------------------
  // COORDONNÉES  (le plus important : c'est ce qui génère vos appels)
  // --------------------------------------------------------------------------

  // Téléphone tel qu'il s'AFFICHE à l'écran
  telephone: "01 23 45 67 89",

  // Le MÊME téléphone au format international, sans espace.
  // Sert au clic sur mobile pour lancer l'appel. Format : +33 puis le numéro
  // sans le 0 initial. Exemple : 01 23 45 67 89  ->  +33123456789
  telephoneLien: "+33123456789",

  // Adresse email de contact (le clic ouvre la messagerie du visiteur)
  email: "contact@embalpro-exemple.fr",

  // --------------------------------------------------------------------------
  // ADRESSE POSTALE
  // --------------------------------------------------------------------------
  adresse: {
    rue: "12 rue des Entrepôts",
    complement: "Zone Industrielle Nord",
    codePostal: "69800",
    ville: "Saint-Priest",
    pays: "France"
  },

  // --------------------------------------------------------------------------
  // HORAIRES D'OUVERTURE
  // Ajoutez ou supprimez des lignes librement : chaque ligne = { jours, heures }
  // --------------------------------------------------------------------------
  horaires: [
    { jours: "Lundi – Jeudi", heures: "8 h 00 – 17 h 30" },
    { jours: "Vendredi", heures: "8 h 00 – 16 h 00" },
    { jours: "Samedi – Dimanche", heures: "Fermé" }
  ],

  // --------------------------------------------------------------------------
  // LOGO
  // Déposez votre logo dans le dossier src/assets/images/ puis indiquez son
  // nom de fichier ci-dessous. Formats conseillés : .svg, .png (fond transparent)
  // --------------------------------------------------------------------------
  logo: "/assets/images/logo.svg",

  // --------------------------------------------------------------------------
  // ADRESSE DU SITE EN LIGNE
  // À remplacer par votre vraie adresse une fois le site publié.
  // Sert au référencement (liens canoniques, plan du site).
  // Pas de barre oblique « / » à la fin.
  // --------------------------------------------------------------------------
  url: "https://mon-site-exemple.netlify.app",

  // --------------------------------------------------------------------------
  // MENU DE NAVIGATION
  // L'ordre des lignes = l'ordre des liens dans le menu.
  // --------------------------------------------------------------------------
  menu: [
    { titre: "Accueil", lien: "/" },
    { titre: "Nos produits", lien: "/produits/" },
    { titre: "À propos", lien: "/a-propos/" },
    { titre: "Contact", lien: "/contact/" }
  ]
};
