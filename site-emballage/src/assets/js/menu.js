/* ==========================================================================
   MENU MOBILE
   --------------------------------------------------------------------------
   Ouvre et ferme le menu quand on clique sur le bouton « hamburger ».
   Sur ordinateur ce bouton est masqué : ce script ne fait alors rien.
   ========================================================================== */

(function () {
  // On récupère le bouton et le menu dans la page
  var bouton = document.querySelector(".bouton-menu");
  var menu = document.querySelector(".navigation");

  // Si l'un des deux est absent, on arrête là (évite toute erreur)
  if (!bouton || !menu) return;

  bouton.addEventListener("click", function () {
    // La classe « est-ouvert » est ce qui rend le menu visible (voir le CSS)
    var estOuvert = menu.classList.toggle("est-ouvert");

    // On informe les lecteurs d'écran de l'état du menu
    bouton.setAttribute("aria-expanded", estOuvert ? "true" : "false");
  });
})();
