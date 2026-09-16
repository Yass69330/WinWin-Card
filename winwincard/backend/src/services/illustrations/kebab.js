'use strict';

// Kebab — illustration multicolore, fournie par le fondateur (validée en
// maquette). Couleurs FIGÉES : contrairement aux icônes Phosphor de
// strip-generator.js, une illustration n'est jamais recoloriée par la palette
// WCAG. Elle s'adapte au marchand par sa TAILLE et sa POSITION, pas par sa
// teinte — c'est ce qui la distingue d'une icône.
//
// Espace de dessin : 200 × 140, déclaré dans le registre (index.js). Le
// consommateur enveloppe ce fragment dans un <g transform="translate(...)
// scale(...)"> ; ce fichier ne connaît ni le strip, ni les variantes, ni le
// marchand.
function kebab() {
  return `<ellipse cx="100" cy="134" rx="80" ry="6" fill="#000" opacity="0.4"/>`
    + `<path d="M16,82 Q20,40 100,36 Q180,40 184,82 Z" fill="#d6ad74"/>`
    + `<path d="M10,84 q-2,-18 12,-18 q-2,-16 14,-14 q2,-18 18,-12 q6,-16 20,-8 q8,-14 22,-4 q10,-12 22,-2 q10,-10 20,2 q14,-8 18,8 q16,-2 14,14 q14,2 10,20 Z" fill="#3d9636"/>`
    + `<path d="M18,84 q0,-12 10,-12 q0,-12 12,-10 q4,-12 16,-6 q6,-12 18,-4 q8,-10 18,0 q10,-10 18,0 q10,-8 18,4 q12,-4 14,8 q12,0 10,14 q8,2 8,6 Z" fill="#63c34f"/>`
    + `<path d="M16,80 L184,80 L184,86 Q100,100 16,86 Z" fill="#55301a"/>`
    + `<path d="M26,86 q0,-22 20,-24 q8,-18 28,-14 q12,-14 30,-8 q16,-10 30,0 q20,-2 22,16 q14,6 14,30 Z" fill="#7a4526"/>`
    + `<path d="M40,74 q10,-6 18,2 M70,58 q12,-6 20,4 M104,54 q12,-4 20,6 M136,62 q10,-2 16,8 M50,62 q6,-4 12,0" stroke="#a86a3d" stroke-width="5" stroke-linecap="round" fill="none"/>`
    + `<path d="M58,80 q10,-6 18,2 M92,72 q10,-6 18,2 M126,78 q10,-4 16,2 M150,82 q6,-2 10,2" stroke="#55301a" stroke-width="5" stroke-linecap="round" fill="none"/>`
    + `<path d="M60,52 q10,-12 20,0" stroke="#a2418f" stroke-width="5" fill="none" stroke-linecap="round"/>`
    + `<path d="M116,48 q10,-12 20,0" stroke="#a2418f" stroke-width="5" fill="none" stroke-linecap="round"/>`
    + `<circle cx="44" cy="62" r="11" fill="#dc3427"/><circle cx="44" cy="62" r="6.5" fill="#f4694c"/><circle cx="44" cy="62" r="2" fill="#ffd2a8"/>`
    + `<circle cx="96" cy="44" r="11" fill="#dc3427"/><circle cx="96" cy="44" r="6.5" fill="#f4694c"/><circle cx="96" cy="44" r="2" fill="#ffd2a8"/>`
    + `<circle cx="156" cy="60" r="11" fill="#dc3427"/><circle cx="156" cy="60" r="6.5" fill="#f4694c"/><circle cx="156" cy="60" r="2" fill="#ffd2a8"/>`
    + `<path d="M30,78 q12,-14 24,-6 q10,-16 26,-8 q12,-14 26,-4 q12,-12 26,-2 q14,-8 24,6 q8,2 14,10" stroke="#fdf8ee" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M8,84 Q8,130 100,130 Q192,130 192,84 Q100,98 8,84 Z" fill="#f2d4a2"/>`
    + `<path d="M8,84 Q100,98 192,84 Q191,92 186,96 Q100,108 14,96 Q9,92 8,84 Z" fill="#e2b979"/>`
    + `<path d="M56,108 l14,10 M92,110 l14,10 M128,108 l14,10" stroke="#c9975a" stroke-width="5" stroke-linecap="round"/>`
    + `<path d="M26,104 q10,16 30,22" stroke="#fdebcb" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.8"/>`;
}

module.exports = kebab;
