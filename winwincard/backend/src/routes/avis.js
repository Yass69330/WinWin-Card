const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { lienValide } = require('../services/avis');

// GET /avis/:serial — le lien imprimé au dos de la carte (Apple backField,
// linksModuleData Google).
//
// Pourquoi ne pas mettre directement le lien Google sur la carte : parce qu'un
// clic serait alors invisible. Ce détour est la SEULE façon de mesurer combien
// de demandes d'avis aboutissent, et il ne coûte qu'une lecture.
//
// Contrat : la redirection n'attend RIEN. Une lecture pour résoudre la
// destination (indispensable), puis 302 ; l'enregistrement du clic part après,
// sans être attendu. Si l'insert échoue, le client arrive quand même sur la page
// d'avis — on perd une mesure, jamais une visite.
//
// Le serial vient d'un pass installé sur un téléphone : pas d'authentification
// possible, et aucune n'est souhaitable. La seule donnée qu'un serial inconnu
// permet d'obtenir ici est la page d'avis publique du marchand.

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function introuvable(res) {
  return res.status(404).type('html').send(
    '<!doctype html><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Lien indisponible</title>'
    + '<div style="font-family:system-ui,sans-serif;padding:40px;text-align:center;color:#333">'
    + '<p>Ce lien d\'avis n\'est plus disponible.</p></div>'
  );
}

router.get('/:serial', asyncHandler(async (req, res) => {
  const serial = String(req.params.serial || '').trim().toLowerCase();
  if (!RE_UUID.test(serial)) return introuvable(res);

  // UNE seule lecture : le client (pour l'attribution du clic) et le lien du
  // marchand (la destination) arrivent ensemble par la jointure.
  const { data: client, error } = await supabase
    .from('clients')
    .select('id, marchand_id, marchands(lien_avis_google)')
    .eq('pass_serial_number', serial)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) console.error('[avis] lecture clic:', error.message);

  // On redirige vers l'URL VALIDÉE, jamais vers la valeur brute de la base : un
  // lien sans schéma deviendrait une redirection relative sur notre domaine.
  const lien = lienValide(client?.marchands?.lien_avis_google);
  if (!client || !lien) return introuvable(res);

  // no-store est INDISPENSABLE : un 302 mis en cache par le téléphone enverrait
  // les clics suivants directement chez Google, sans repasser par nous — les
  // compteurs sous-compteraient sans qu'on puisse le voir.
  res.set('Cache-Control', 'no-store');
  res.redirect(302, lien);

  // Après la redirection. Le clic est une mesure, pas un maillon : jamais attendu,
  // jamais bloquant. Même règle que le registre des envois (migration 046).
  supabase.from('avis_clics')
    .insert({ marchand_id: client.marchand_id, client_id: client.id, serial_number: serial })
    .then(({ error: errClic }) => { if (errClic) console.error('[avis] insert clic:', errClic.message); })
    .catch(e => console.error('[avis] insert clic exception:', e.message));
}));

module.exports = router;
