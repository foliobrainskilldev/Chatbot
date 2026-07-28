const { delay, generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');

// Função para simular o estado "a escrever..." com delay aleatório de 2 a 5 segundos
async function simulateTyping(sock, jid) {
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate('composing', jid);
    
    // Calcula um tempo aleatório entre 2000ms (2s) e 5000ms (5s)
    const delayMs = Math.floor(Math.random() * (5000 - 2000 + 1)) + 2000;
    await delay(delayMs);
    
    await sock.sendPresenceUpdate('paused', jid);
}

// Envia mensagem de texto normal após simular escrita
async function sendDelayedText(sock, jid, text) {
    await simulateTyping(sock, jid);
    await sock.sendMessage(jid, { text });
}

// Envia botões reais clicáveis
async function sendInteractiveMenu(sock, jid, text, options) {
    await simulateTyping(sock, jid);
    
    let buttons = [];
    
    // Se forem até 3 opções, usamos os botões rápidos normais
    if (options.length <= 3) {
        buttons = options.map(opt => ({
            name: "quick_reply",
            buttonParamsJson: JSON.stringify({ display_text: opt.title, id: String(opt.id) })
        }));
    } 
    // Se forem mais de 3 (ex: menu principal), usamos uma Lista Clicável elegante
    else {
        buttons = [{
            name: "single_select",
            buttonParamsJson: JSON.stringify({
                title: "Ver Opções 📋",
                sections: [{
                    title: "Escolha uma opção",
                    rows: options.map(opt => ({ id: String(opt.id), title: opt.title, description: opt.description || "" }))
                }]
            })
        }];
    }

    const msg = generateWAMessageFromContent(jid, {
        viewOnceMessage: {
            message: {
                messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                interactiveMessage: proto.Message.InteractiveMessage.create({
                    body: proto.Message.InteractiveMessage.Body.create({ text: text }),
                    footer: proto.Message.InteractiveMessage.Footer.create({ text: "💈 Barbearia" }),
                    header: proto.Message.InteractiveMessage.Header.create({ title: "", hasMediaAttachment: false }),
                    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                        buttons: buttons
                    })
                })
            }
        }
    }, { userJid: sock.user.id });

    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
}

module.exports = { sendDelayedText, sendInteractiveMenu };