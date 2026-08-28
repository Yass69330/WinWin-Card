/**
 * ============================================================================
 *  ⭐ VOTRE CATALOGUE PRODUITS — LE SEUL FICHIER À ÉDITER POUR LES PRODUITS
 * ============================================================================
 *
 *  Chaque produit est un bloc entre accolades { ... } séparé par une virgule.
 *  Le site se met à jour tout seul : page catalogue, filtres par catégorie,
 *  fiche produit détaillée et plan du site sont générés à partir d'ici.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  POUR AJOUTER UN PRODUIT : copiez le modèle ci-dessous, collez-le dans la
 *  liste (avant le crochet final « ] ») et remplacez les textes.
 *  ─────────────────────────────────────────────────────────────────────────
 *
 *  {
 *    id: "mon-nouveau-produit",
 *    nom: "Nom du produit",
 *    categorie: "Barquettes",
 *    descriptionCourte: "Une phrase de présentation.",
 *    description: "Un paragraphe plus détaillé pour la fiche produit.",
 *    caracteristiques: [
 *      "Première caractéristique",
 *      "Deuxième caractéristique",
 *      "Troisième caractéristique"
 *    ],
 *    image: "/assets/images/produits/mon-nouveau-produit.svg",
 *    imageAlt: "Description de la photo pour Google et les malvoyants",
 *    miseEnAvant: false
 *  },
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  EXPLICATION DE CHAQUE CHAMP
 *  ─────────────────────────────────────────────────────────────────────────
 *
 *  id ............... Identifiant unique. Il devient l'adresse de la page :
 *                     id "gobelet-carton" -> monsite.fr/produits/gobelet-carton/
 *                     ⚠️ Uniquement des minuscules, chiffres et tirets.
 *                     Pas d'espace, pas d'accent, pas de majuscule.
 *                     ⚠️ Deux produits ne peuvent pas avoir le même id.
 *
 *  nom .............. Nom affiché du produit. Accents et majuscules autorisés.
 *
 *  categorie ........ Sert au filtre du catalogue. Réutilisez EXACTEMENT
 *                     l'orthographe d'une catégorie existante pour regrouper
 *                     les produits. Une nouvelle orthographe = un nouveau
 *                     bouton de filtre, créé automatiquement.
 *
 *  descriptionCourte  1 à 2 phrases. Affichée sur la carte du catalogue et
 *                     utilisée par Google comme description de la page.
 *
 *  description ...... Texte long affiché sur la fiche produit.
 *
 *  caracteristiques   Liste à puces. 2 à 3 éléments conseillés, mais vous
 *                     pouvez en mettre plus. Chaque ligne entre guillemets,
 *                     séparée par une virgule.
 *
 *  image ............ Chemin de l'image. Déposez votre photo dans le dossier
 *                     src/assets/images/produits/ puis écrivez ici :
 *                     "/assets/images/produits/ma-photo.jpg"
 *                     (les images actuelles sont des placeholders gris)
 *
 *  imageAlt ......... Description de l'image en quelques mots. Important pour
 *                     le référencement et l'accessibilité.
 *
 *  miseEnAvant ...... true  = le produit apparaît sur la page d'accueil
 *                     false = il apparaît uniquement dans le catalogue
 *                     (écrire true ou false sans guillemets)
 *                     💡 Conseil : mettez 3 ou 6 produits en avant pour
 *                     remplir des lignes complètes sur la page d'accueil.
 *
 * ============================================================================
 */

module.exports = [
  // ─── BARQUETTES ──────────────────────────────────────────────────────────
  {
    id: "barquette-aluminium-2-compartiments",
    nom: "Barquette aluminium 2 compartiments",
    categorie: "Barquettes",
    descriptionCourte:
      "Barquette aluminium rigide à deux compartiments, idéale pour les plats préparés et la vente à emporter chaude.",
    description:
      "La barquette aluminium 2 compartiments permet de séparer l'accompagnement du plat principal tout en conservant la température. Sa forme rigide résiste à l'empilement et au transport. Compatible four traditionnel jusqu'à 250 °C, elle convient aux traiteurs, cuisines centrales et restaurants proposant de la vente à emporter. Livrée avec couvercles carton assortis, disponibles séparément.",
    caracteristiques: [
      "Contenance : 2 × 450 ml",
      "Passe au four jusqu'à 250 °C",
      "Aluminium recyclable à 100 %",
      "Conditionnement : carton de 500 unités"
    ],
    image: "/assets/images/produits/barquette-aluminium.svg",
    imageAlt: "Barquette alimentaire en aluminium à deux compartiments",
    miseEnAvant: true
  },
  {
    id: "barquette-pp-operculable-750ml",
    nom: "Barquette operculable 750 ml",
    categorie: "Barquettes",
    descriptionCourte:
      "Barquette polypropylène transparente pour operculeuse, adaptée aux salades, plats froids et préparations traiteur.",
    description:
      "Conçue pour les machines à opercules standard, cette barquette assure une fermeture hermétique qui prolonge la durée de conservation et sécurise le transport. Sa transparence met le produit en valeur en rayon réfrigéré. Elle supporte le passage au micro-ondes et se range facilement grâce à sa forme empilable.",
    caracteristiques: [
      "Contenance : 750 ml",
      "Compatible operculeuse et micro-ondes",
      "Format standard 190 × 144 mm",
      "Conditionnement : carton de 600 unités"
    ],
    image: "/assets/images/produits/barquette-operculable.svg",
    imageAlt: "Barquette alimentaire transparente operculable de 750 ml",
    miseEnAvant: false
  },

  // ─── GOBELETS ET BOISSONS ────────────────────────────────────────────────
  {
    id: "gobelet-carton-double-paroi-25cl",
    nom: "Gobelet carton double paroi 25 cl",
    categorie: "Gobelets et boissons",
    descriptionCourte:
      "Gobelet carton double paroi pour boissons chaudes : le café reste chaud, la main reste protégée.",
    description:
      "La double paroi crée une couche d'air isolante qui évite d'avoir à doubler le gobelet ou à ajouter un manchon. La finition extérieure mate est personnalisable à votre logo à partir de 5 000 unités. Couvercles à clipser disponibles en noir ou blanc, vendus séparément.",
    caracteristiques: [
      "Contenance : 25 cl (8 oz)",
      "Double paroi isolante, sans manchon",
      "Personnalisation logo dès 5 000 pièces",
      "Conditionnement : carton de 1 000 unités"
    ],
    image: "/assets/images/produits/gobelet-carton.svg",
    imageAlt: "Gobelet en carton double paroi pour boisson chaude",
    miseEnAvant: true
  },
  {
    id: "porte-gobelets-carton-4-places",
    nom: "Porte-gobelets carton 4 places",
    categorie: "Gobelets et boissons",
    descriptionCourte:
      "Support carton pour transporter jusqu'à quatre boissons chaudes sans risque de renversement.",
    description:
      "Indispensable pour la vente à emporter et la livraison, ce porte-gobelets en carton recyclé maintient fermement quatre gobelets de 20 à 40 cl. Livré à plat, il se monte en un geste et prend très peu de place en réserve.",
    caracteristiques: [
      "Accueille 4 gobelets de 20 à 40 cl",
      "Carton recyclé, montage sans colle",
      "Livré à plat pour un stockage compact",
      "Conditionnement : carton de 300 unités"
    ],
    image: "/assets/images/produits/porte-gobelets.svg",
    imageAlt: "Porte-gobelets en carton quatre places",
    miseEnAvant: false
  },

  // ─── SACS ET SACHETS ─────────────────────────────────────────────────────
  {
    id: "sachet-kraft-brun-soufflet",
    nom: "Sachet kraft brun à soufflet",
    categorie: "Sacs et sachets",
    descriptionCourte:
      "Sachet kraft brun à soufflet latéral pour viennoiseries, sandwichs et snacking.",
    description:
      "Le soufflet latéral permet au sachet de tenir ouvert et d'accueillir des produits volumineux sans se déchirer. Le papier kraft brun, non blanchi, donne une image artisanale et naturelle appréciée en boulangerie et en snacking. Contact alimentaire direct autorisé.",
    caracteristiques: [
      "Dimensions : 14 × 6 × 24 cm",
      "Kraft brun 40 g/m², contact alimentaire direct",
      "Recyclable et biodégradable",
      "Conditionnement : carton de 1 000 unités"
    ],
    image: "/assets/images/produits/sachet-kraft.svg",
    imageAlt: "Sachet en papier kraft brun à soufflet",
    miseEnAvant: true
  },
  {
    id: "sac-kraft-poignees-torsadees",
    nom: "Sac kraft à poignées torsadées",
    categorie: "Sacs et sachets",
    descriptionCourte:
      "Sac papier kraft résistant à poignées torsadées, pour la livraison et la vente à emporter.",
    description:
      "Ce sac kraft à fond plat reste stable une fois posé, ce qui évite le renversement des plats pendant le transport. Ses poignées torsadées collées supportent jusqu'à 5 kg. Un format polyvalent qui convient aussi bien à la restauration rapide qu'à l'épicerie fine.",
    caracteristiques: [
      "Dimensions : 26 × 17 × 25 cm",
      "Charge supportée jusqu'à 5 kg",
      "Fond plat stable, poignées torsadées collées",
      "Conditionnement : carton de 250 unités"
    ],
    image: "/assets/images/produits/sac-kraft.svg",
    imageAlt: "Sac en papier kraft avec poignées torsadées",
    miseEnAvant: false
  },

  // ─── FILMS ET PAPIERS ────────────────────────────────────────────────────
  {
    id: "film-alimentaire-etirable-45cm",
    nom: "Film alimentaire étirable 45 cm",
    categorie: "Films et papiers",
    descriptionCourte:
      "Rouleau de film étirable professionnel de 45 cm de large, avec boîte distributrice à lame.",
    description:
      "Un film étirable de qualité professionnelle, plus résistant à la perforation que les films grand public. Sa boîte distributrice intègre une lame de découpe qui fait gagner du temps en cuisine. Adhérence forte sur inox, verre et plastique, y compris au froid positif.",
    caracteristiques: [
      "Largeur 45 cm × longueur 300 m",
      "Boîte distributrice avec lame de découpe",
      "Utilisation de -20 °C à +60 °C",
      "Conditionnement : carton de 6 rouleaux"
    ],
    image: "/assets/images/produits/film-alimentaire.svg",
    imageAlt: "Rouleau de film alimentaire étirable de 45 cm",
    miseEnAvant: false
  },
  {
    id: "papier-ingraissable-kraft",
    nom: "Papier ingraissable kraft",
    categorie: "Films et papiers",
    descriptionCourte:
      "Feuilles de papier ingraissable pour burgers, frites et produits gras, sans traitement fluoré.",
    description:
      "Ce papier ingraissable retient les matières grasses sans se détremper, ce qui garde le produit présentable jusqu'à la dégustation. Sans traitement fluoré, il répond aux exigences réglementaires actuelles sur le contact alimentaire. Se prête bien à l'emballage de burgers, paninis, frites et fritures.",
    caracteristiques: [
      "Format : 32 × 25 cm",
      "Sans traitement fluoré (conforme au règlement UE)",
      "Résiste au chaud et au gras",
      "Conditionnement : carton de 1 000 feuilles"
    ],
    image: "/assets/images/produits/papier-ingraissable.svg",
    imageAlt: "Feuilles de papier kraft ingraissable",
    miseEnAvant: false
  },

  // ─── BOÎTES À EMPORTER ───────────────────────────────────────────────────
  {
    id: "boite-emporter-kraft-1000ml",
    nom: "Boîte à emporter kraft 1000 ml",
    categorie: "Boîtes à emporter",
    descriptionCourte:
      "Boîte repas en carton kraft avec couvercle rabattable, adaptée aux plats chauds et aux poke bowls.",
    description:
      "Une boîte robuste au format généreux, pensée pour les plats complets et les bowls. L'intérieur enduit résiste aux sauces et à l'humidité, tandis que le couvercle rabattable se ferme sans agrafe. Passe au micro-ondes et s'empile facilement pour la livraison.",
    caracteristiques: [
      "Contenance : 1 000 ml",
      "Couvercle rabattable, sans agrafe",
      "Compatible micro-ondes",
      "Conditionnement : carton de 300 unités"
    ],
    image: "/assets/images/produits/boite-emporter.svg",
    imageAlt: "Boîte repas à emporter en carton kraft",
    miseEnAvant: false
  },
  {
    id: "boite-pizza-kraft-33cm",
    nom: "Boîte à pizza kraft 33 cm",
    categorie: "Boîtes à emporter",
    descriptionCourte:
      "Boîte à pizza en carton kraft ondulé 33 cm, avec aérations pour préserver le croustillant.",
    description:
      "Le carton ondulé kraft isole la chaleur et les micro-aérations laissent s'échapper la vapeur : la pâte reste croustillante pendant le trajet. Livrée à plat, la boîte se monte rapidement. Personnalisation par impression une couleur possible à partir de 2 000 unités.",
    caracteristiques: [
      "Format : 33 × 33 × 3,5 cm",
      "Carton ondulé kraft avec aérations",
      "Personnalisation possible dès 2 000 pièces",
      "Conditionnement : carton de 100 unités"
    ],
    image: "/assets/images/produits/boite-pizza.svg",
    imageAlt: "Boîte à pizza en carton kraft de 33 cm",
    miseEnAvant: false
  },

  // ─── COUVERTS ET ACCESSOIRES ─────────────────────────────────────────────
  {
    id: "kit-couverts-bois",
    nom: "Kit couverts en bois",
    categorie: "Couverts et accessoires",
    descriptionCourte:
      "Kit individuel emballé comprenant fourchette, couteau et serviette en bois de bouleau.",
    description:
      "Une alternative conforme à la réglementation sur le plastique à usage unique. Le bois de bouleau issu de forêts gérées durablement est poncé pour éviter les échardes. Chaque kit est emballé individuellement sous papier, ce qui garantit l'hygiène et simplifie la distribution en livraison.",
    caracteristiques: [
      "Contient : fourchette, couteau, serviette",
      "Bois de bouleau, sans plastique",
      "Emballage individuel hygiénique",
      "Conditionnement : carton de 500 kits"
    ],
    image: "/assets/images/produits/couverts-bois.svg",
    imageAlt: "Kit de couverts jetables en bois avec serviette",
    miseEnAvant: false
  }
];
