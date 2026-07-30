const { sendText, sendInteractiveMenu } = require('./whatsappApi');

// Como a API oficial não tem "typing...", enviamos o texto diretamente
async function sendDelayedText(sockIgnorado, jid, text) {
    await sendText(jid, text);
}

// Repassa para a nova API
async function sendMenuMeta(sockIgnorado, jid, text, options) {
    await sendInteractiveMenu(jid, text, options);
}

module.exports = { sendDelayedText, sendInteractiveMenu: sendMenuMeta };