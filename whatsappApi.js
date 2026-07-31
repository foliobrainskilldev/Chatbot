const axios = require('axios');

const META_TOKEN = process.env.META_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const api = axios.create({
    baseURL: `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}`,
    headers: {
        'Authorization': `Bearer ${META_TOKEN}`,
        'Content-Type': 'application/json'
    }
});

// Marca a mensagem como Lida (Ticks Azuis)
async function markAsRead(messageId) {
    try {
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId
        });
    } catch (error) {
        console.error("Erro ao marcar como lida:", error.response?.data || error.message);
    }
}

async function sendText(to, text) {
    try {
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            type: 'text',
            text: { body: text }
        });
    } catch (error) {
        console.error("Erro ao enviar texto:", error.response?.data || error.message);
    }
}

async function sendInteractiveMenu(to, text, options) {
    try {
        let interactiveObj = {
            type: options.length <= 3 ? "button" : "list",
            body: { text: text },
            action: {}
        };

        if (options.length <= 3) {
            interactiveObj.action.buttons = options.map(opt => ({
                type: "reply",
                reply: { id: opt.id, title: opt.title }
            }));
        } else {
            interactiveObj.action.button = "Ver Opções 📋";
            interactiveObj.action.sections = [{
                title: "Escolha uma opção",
                rows: options.map(opt => ({
                    id: opt.id,
                    title: opt.title,
                    description: opt.description || ""
                }))
            }];
        }

        await api.post('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            type: 'interactive',
            interactive: interactiveObj
        });
    } catch (error) {
        console.error("Erro ao enviar menu:", error.response?.data || error.message);
    }
}

module.exports = { sendText, sendInteractiveMenu, markAsRead };