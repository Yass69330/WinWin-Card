// APNs natif Apple Wallet
// sendPushUpdate : déclenche Apple à re-télécharger le pass (payload vide — standard Wallet)
// sendPushNotification : notification visible sur l'écran de verrouillage

async function sendPushUpdate(pushToken) {
  // Implémenté en Phase 3 avec node-apn ou fetch HTTP/2 natif vers api.push.apple.com
  // Apple Wallet attend un payload {} vide pour déclencher le re-téléchargement
  console.log(`[APNs] Push update → ${pushToken}`);
}

async function sendPushNotification(pushToken, { titre, message }) {
  // Implémenté en Phase 6 (dashboard notifications)
  console.log(`[APNs] Notification → ${pushToken} | ${titre}: ${message}`);
}

module.exports = { sendPushUpdate, sendPushNotification };
