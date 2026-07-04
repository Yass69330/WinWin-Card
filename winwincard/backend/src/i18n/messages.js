// i18n serveur — messages des notifications automatiques (FR/EN).
// La langue vient de marchand.langue (figée à la création). Fallback : 'en'.
//
// Chaque message est une fonction (vars) => string : l'interpolation et la
// gestion du pluriel se font naturellement en JS, sans moteur de template.
//
// Périmètre : les 5 notifications système (bienvenue, pass mis à jour ×3,
// relance inactif, near reward, parrainage). Le contenu écrit par le marchand
// (override workflow_inactive_message, notif marketing manuelle) n'est PAS ici.

const messages = {
  // ── Bienvenue (à l'installation du pass) ────────────────────────────────
  welcome: {
    en: ({ nom }) => `Welcome to ${nom}! 👋 Collect points with every visit.`,
    fr: ({ nom }) => `Bienvenue chez ${nom} ! 👋 Cumule des points à chaque visite.`,
  },

  // ── Pass mis à jour après un scan ───────────────────────────────────────
  passReset: {
    en: ({ prenom, max }) => `Card updated — ${prenom}: 0/${max} pts`,
    fr: ({ prenom, max }) => `Carte remise à zéro — ${prenom} : 0/${max} pts`,
  },
  passReward: {
    en: ({ prenom }) => `Congrats ${prenom}! Reward unlocked 🎉`,
    fr: ({ prenom }) => `Bravo ${prenom} ! Récompense débloquée 🎉`,
  },
  passProgress: {
    en: ({ prenom, value, max }) => `+1 — ${prenom}: ${value}/${max} pts`,
    fr: ({ prenom, value, max }) => `+1 — ${prenom} : ${value}/${max} pts`,
  },

  // ── Relance client inactif (défaut ; l'override marchand reste prioritaire) ─
  inactive: {
    en: ({ prenom, nom }) => `Hi ${prenom}! We miss you at ${nom}. Come visit us soon! 🎯`,
    fr: ({ prenom, nom }) => `Salut ${prenom} ! Tu nous manques chez ${nom}. Reviens vite ! 🎯`,
  },

  // ── Proche de la récompense ─────────────────────────────────────────────
  nearReward: {
    en: ({ prenom, remaining, nom }) =>
      `Hi ${prenom}! Only ${remaining} more point${remaining > 1 ? 's' : ''} to unlock your reward at ${nom}. Come visit us! 🎁`,
    fr: ({ prenom, remaining, nom }) =>
      `Salut ${prenom} ! Plus que ${remaining} point${remaining > 1 ? 's' : ''} pour débloquer ta récompense chez ${nom}. Passe nous voir ! 🎁`,
  },

  // ── Bonus parrainage crédité au parrain ─────────────────────────────────
  referral: {
    en: ({ prenom, bonus, value, max }) => `+${bonus} referral bonus — ${prenom}: ${value}/${max} pts`,
    fr: ({ prenom, bonus, value, max }) => `+${bonus} bonus parrainage — ${prenom} : ${value}/${max} pts`,
  },
};

// notif(key, lang, vars) → string localisée. Fallback 'en' si langue absente/inconnue.
function notif(key, lang, vars = {}) {
  const entry = messages[key];
  if (!entry) throw new Error(`[i18n] clé notif inconnue : ${key}`);
  const fn = entry[lang] || entry.en;
  return fn(vars);
}

module.exports = { notif, messages };
