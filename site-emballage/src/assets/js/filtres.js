/* ==========================================================================
   FILTRE PAR CATÉGORIE (page « Nos produits »)
   --------------------------------------------------------------------------
   Comment ça marche :
     - chaque bouton de filtre porte un attribut  data-filtre="Barquettes"
     - chaque carte produit porte un attribut     data-categorie="Barquettes"
     - au clic, on masque les cartes dont la catégorie ne correspond pas.

   Rien à modifier ici quand vous ajoutez un produit ou une catégorie :
   tout est généré automatiquement depuis src/_data/produits.js.
   ========================================================================== */

(function () {
  var boutons = document.querySelectorAll(".filtre");
  var cartes = document.querySelectorAll("#liste-produits .carte");
  var messageVide = document.getElementById("aucun-resultat");

  // Si on n'est pas sur la page catalogue, on ne fait rien
  if (!boutons.length || !cartes.length) return;

  /**
   * Affiche uniquement les produits de la catégorie demandée.
   * @param {string} categorie - le nom d'une catégorie, ou "toutes"
   */
  function appliquerFiltre(categorie) {
    var nombreVisibles = 0;

    cartes.forEach(function (carte) {
      var correspond =
        categorie === "toutes" || carte.dataset.categorie === categorie;

      // hidden masque l'élément et le retire aussi des lecteurs d'écran
      carte.hidden = !correspond;
      if (correspond) nombreVisibles++;
    });

    // Message « aucun produit » si la catégorie est vide
    if (messageVide) messageVide.hidden = nombreVisibles > 0;

    // On met en surbrillance le bouton sélectionné
    boutons.forEach(function (bouton) {
      bouton.classList.toggle("est-actif", bouton.dataset.filtre === categorie);
    });
  }

  // Un clic sur un bouton applique le filtre correspondant
  boutons.forEach(function (bouton) {
    bouton.addEventListener("click", function () {
      var categorie = bouton.dataset.filtre;
      appliquerFiltre(categorie);

      // On note la catégorie dans l'adresse de la page : le visiteur peut
      // ainsi partager ou recharger le lien en gardant son filtre.
      var url = new URL(window.location.href);
      if (categorie === "toutes") {
        url.searchParams.delete("categorie");
      } else {
        url.searchParams.set("categorie", categorie);
      }
      window.history.replaceState({}, "", url);
    });
  });

  // Au chargement : si l'adresse contient ?categorie=..., on applique ce filtre
  var categorieDemandee = new URL(window.location.href).searchParams.get("categorie");
  if (categorieDemandee) appliquerFiltre(categorieDemandee);
})();
