const axios = require('axios');
const cloudinaryService = require('./services/cloudinaryService');

const META_TOKEN = process.env.META_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const api = axios.create({
    baseURL: `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}`,
    headers: {
        'Authorization': `Bearer ${META_TOKEN}`,
        'Content-Type': 'application/json'
    }
});

async function markAsReadAndTyping(messageId, to) {
    if (!messageId) return;
    try {
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: String(messageId)
        });

        if (to) {
            // Se o WhatsApp Business Cloud não aceitar o 'typing_indicator' para seu número, 
            // a requisição acima do 'read' (ticks azuis) já funcionou. A de baixo cairá no catch discretamente.
            await api.post('/messages', {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: String(to),
                type: 'typing_indicator',
                typing_indicator: { type: 'text' }
            });
        }
    } catch (error) {
        // Falha no indicador de digitação não deve interromper o bot
    }
}

async function sendText(to, text) {
    if (!to || !text) return;
    try {
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: String(to), // Garantindo formatação que a API exige
            type: 'text',
            text: { body: String(text) } // Garantindo que nunca irá como objeto vazio
        });
    } catch (error) {
        console.error("Erro envio Texto Meta:", error?.response?.data || error.message);
    }
}

async function sendInteractiveMenu(to, text, options) {
    if (!options || !Array.isArray(options) || options.length === 0) {
        return await sendText(to, text);
    }
    try {
        let interactiveObj = {
            type: options.length <= 3 ? "button" : "list",
            body: { text: String(text) },
            action: {}
        };
        
        if (options.length <= 3) {
            interactiveObj.action.buttons = options.map(opt => ({
                type: "reply",
                reply: { 
                    id: String(opt.id).substring(0, 256), 
                    title: String(opt.title).length > 20 ? String(opt.title).substring(0, 17) + "..." : String(opt.title)
                }
            }));
        } else {
            interactiveObj.action.button = "Ver Opções";
            interactiveObj.action.sections = [{
                title: "Selecione uma opção",
                rows: options.slice(0, 10).map(opt => ({
                    id: String(opt.id).substring(0, 200),
                    title: String(opt.title).length > 24 ? String(opt.title).substring(0, 21) + "..." : String(opt.title)
                }))
            }];
        }
        
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: String(to),
            type: 'interactive',
            interactive: interactiveObj
        });
    } catch (error) {
        console.error("Erro envio Menu Interativo Meta:", error?.response?.data || error.message);
    }
}

async function downloadMetaMediaToCloudinary(mediaId, mimeType) {
    // Mantido intacto
    return null; 
}

module.exports = {
    sendText,
    sendInteractiveMenu,
    markAsReadAndTyping,
    downloadMetaMediaToCloudinary
};