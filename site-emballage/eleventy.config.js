/**
 * ============================================================================
 *  RÉGLAGES DU GÉNÉRATEUR DE SITE (Eleventy)
 * ============================================================================
 *  Ce fichier explique à Eleventy où trouver les fichiers et où écrire le site
 *  final. En temps normal, vous n'avez PAS besoin d'y toucher.
 * ============================================================================
 */

module.exports = function (eleventyConfig) {
  // --------------------------------------------------------------------------
  // 1) Copier tel quel le dossier des ressources (CSS, JavaScript, images)
  //    vers le site final. Sans ça, vos images n'apparaîtraient pas.
  // --------------------------------------------------------------------------
  eleventyConfig.addPassthroughCopy("src/assets");

  // Relancer le navigateur quand le CSS change (confort pendant le développement)
  eleventyConfig.addWatchTarget("src/assets/css/");

  // --------------------------------------------------------------------------
  // 2) FILTRE « categories »
  //    Récupère la liste des catégories présentes dans vos produits, sans
  //    doublon et triée par ordre alphabétique.
  //    Utilisé pour construire les boutons de filtre du catalogue.
  //    -> Ajoutez un produit avec une nouvelle catégorie : le bouton apparaît
  //       tout seul, vous n'avez rien d'autre à faire.
  // --------------------------------------------------------------------------
  eleventyConfig.addFilter("categories", function (produits) {
    const liste = produits.map((p) => p.categorie);
    return [...new Set(liste)].sort((a, b) => a.localeCompare(b, "fr"));
  });

  // --------------------------------------------------------------------------
  // 3) FILTRE « misEnAvant »
  //    Ne garde que les produits dont le champ « miseEnAvant » vaut true.
  //    Utilisé sur la page d'accueil.
  // --------------------------------------------------------------------------
  eleventyConfig.addFilter("misEnAvant", function (produits) {
    return produits.filter((p) => p.miseEnAvant === true);
  });

  // --------------------------------------------------------------------------
  // 4) FILTRE « memeCategorie »
  //    Sur une fiche produit, propose d'autres produits de la même catégorie
  //    (en excluant le produit affiché).
  // --------------------------------------------------------------------------
  eleventyConfig.addFilter("memeCategorie", function (produits, categorie, idExclu) {
    return produits
      .filter((p) => p.categorie === categorie && p.id !== idExclu)
      .slice(0, 3);
  });

  // --------------------------------------------------------------------------
  // 5) FILTRE « anneeCourante » : affiche l'année dans le pied de page
  // --------------------------------------------------------------------------
  eleventyConfig.addFilter("anneeCourante", () => new Date().getFullYear());

  // --------------------------------------------------------------------------
  // 6) Où sont les fichiers sources, et où écrire le site fini
  // --------------------------------------------------------------------------
  return {
    dir: {
      input: "src",           // dossier de travail
      output: "_site",        // dossier généré (ne pas éditer, il est recréé)
      includes: "_includes",  // gabarits réutilisables
      data: "_data"           // fichiers de données (produits, coordonnées)
    },
    // Les fichiers .njk et .md peuvent contenir des variables {{ }}
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["njk", "md", "html"]
  };
};
