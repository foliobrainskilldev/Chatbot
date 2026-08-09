const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const META_TOKEN = process.env.META_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const api = axios.create({
    baseURL: `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}`,
    headers: {
        'Authorization': `Bearer ${META_TOKEN}`,
        'Content-Type': 'application/json'
    }
});

const aguardar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function markAsReadAndTyping(messageId, to) {
    if (!messageId) return;
    try {
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
            typing_indicator: { type: 'text' }
        });
    } catch (error) {
        console.error("Falha ao marcar status digitando:", error?.response?.data || error.message);
    }
}

async function sendText(to, text, delayHumano = true) {
    if (delayHumano) {
        const compassoRandomSegundos = Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000;
        await aguardar(compassoRandomSegundos);
    }
    try {
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            type: 'text',
            text: { body: text }
        });
    } catch (error) {
        console.error("Erro no envio de Texto Meta:", error?.response?.data || error.message);
    }
}

async function sendLocation(to, latitude, longitude, name, address) {
    const compassoRandomSegundos = Math.floor(Math.random() * (3000 - 1500 + 1)) + 1500;
    await aguardar(compassoRandomSegundos);
    try {
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            type: 'location',
            location: { latitude, longitude, name, address }
        });
    } catch (error) {
        console.error("Erro no envio de Localização Meta:", error?.response?.data || error.message);
    }
}

async function sendInteractiveMenu(to, text, options) {
    const compassoRandomSegundos = Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000;
    await aguardar(compassoRandomSegundos); 

    if (!options || !Array.isArray(options) || options.length === 0) {
        return await sendText(to, text, false);
    }

    try {
        let interactiveObj = {
            type: options.length <= 3 ? "button" : "list",
            body: { text: text },
            action: {}
        };
        
        if (options.length <= 3) {
            interactiveObj.action.buttons = options.map(opt => ({
                type: "reply",
                reply: { id: String(opt.id), title: String(opt.title).substring(0, 20) }
            }));
        } else {
            let safeOptions = options.length > 10 ? options.slice(0, 10) : options;
            interactiveObj.action.button = "Ver Opções 📋";
            interactiveObj.action.sections = [{
                title: "Selecione",
                rows: safeOptions.map(opt => ({
                    id: String(opt.id),
                    title: String(opt.title).substring(0, 24),
                    description: opt.description ? String(opt.description).substring(0, 72) : ""
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
        console.error("Erro no envio de Menu Interativo Meta:", error?.response?.data || error.message);
    }
}

async function downloadMedia(mediaId) {
    try {
        const getUrlResponse = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${META_TOKEN}` }
        });
        const downloadResponse = await axios.get(getUrlResponse.data.url, {
            responseType: 'arraybuffer',
            headers: { 'Authorization': `Bearer ${META_TOKEN}` }
        });
        return Buffer.from(downloadResponse.data, 'binary');
    } catch (error) {
        console.error("Erro no download de mídia Meta:", error?.response?.data || error.message);
        return null;
    }
}

async function uploadMediaToMeta(filePath, mimeType) {
    try {
        const form = new FormData();
        const fileName = path.basename(filePath); 

        form.append('file', fs.createReadStream(filePath), { filename: fileName, contentType: mimeType });
        form.append('type', mimeType.split('/')[0]);
        form.append('messaging_product', 'whatsapp');

        const res = await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/media`, form, {
            headers: { ...form.getHeaders(), 'Authorization': `Bearer ${META_TOKEN}` }
        });
        return res.data.id;
    } catch (error) {
        console.error("Erro ao subir arquivo para a Meta:", error?.response?.data || error.message);
        return null;
    }
}

async function sendMediaMessage(to, type, mediaId, caption = "") {
    try {
        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            type: type
        };
        payload[type] = { id: mediaId };
        if (caption && (type === 'image' || type === 'video')) payload[type].caption = caption;
        
        await api.post('/messages', payload);
    } catch (error) {
        console.error(`Erro ao enviar mídia tipo ${type}:`, error?.response?.data || error.message);
    }
}

module.exports = {
    sendText,
    sendInteractiveMenu,
    markAsReadAndTyping,
    sendLocation,
    downloadMedia,
    uploadMediaToMeta,
    sendMediaMessage
};