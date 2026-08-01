const axios = require('axios');

const META_TOKEN = process.env.META_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// Esta é a API para enviar mensagens (usa o PHONE_NUMBER_ID)
const api = axios.create({
    baseURL: `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}`,
    headers: {
        'Authorization': `Bearer ${META_TOKEN}`,
        'Content-Type': 'application/json'
    }
});

async function markAsReadAndTyping(messageId) {
    if (!messageId) return;

    try {
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
            typing_indicator: {
                type: 'text'
            }
        });
    } catch (error) {
        console.error("Erro ao marcar como lida e escrevendo:", error.response?.data || error.message);
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

async function sendLocation(to, latitude, longitude, name, address) {
    try {
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            type: 'location',
            location: {
                latitude: latitude,
                longitude: longitude,
                name: name,
                address: address
            }
        });
    } catch (error) {
        console.error("Erro ao enviar localização:", error.response?.data || error.message);
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

// CORREÇÃO: Função para baixar mídia da Meta sem usar o PHONE_NUMBER_ID
async function downloadMedia(mediaId) {
    try {
        // 1. Obter a URL protegida do ficheiro diretamente na raiz da Graph API (sem o ID do número)
        const getUrlResponse = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${META_TOKEN}` }
        });
        
        const mediaUrl = getUrlResponse.data.url;

        // 2. Fazer download do ficheiro passando o Token
        const downloadResponse = await axios.get(mediaUrl, {
            responseType: 'arraybuffer',
            headers: { 'Authorization': `Bearer ${META_TOKEN}` }
        });
        
        return Buffer.from(downloadResponse.data, 'binary');
    } catch (error) {
        console.error("Erro ao baixar ficheiro (Áudio) da Meta:", error.response?.data || error.message);
        return null;
    }
}

module.exports = { sendText, sendInteractiveMenu, markAsReadAndTyping, sendLocation, downloadMedia };