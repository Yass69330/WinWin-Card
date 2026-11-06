// Petite page HTML de fin de parcours (connexion Hubrise), sans script ni
// ressource externe. Le texte est échappé ; aucune donnée sensible n'y figure.
'use strict';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(res, statut, titre, texte) {
  res.status(statut)
    .set('Cache-Control', 'no-store')
    .set('Referrer-Policy', 'no-referrer')
    .type('html')
    .send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WinWin · Hubrise</title><style>body{font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;color:#1a1a1a;background:#fafafa}
h1{font-size:20px}p{line-height:1.5;color:#444}</style></head><body><h1>${esc(titre)}</h1><p>${esc(texte)}</p></body></html>`);
}

module.exports = { page };
