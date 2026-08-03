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

// CORREÇÃO DO TYPING INDICATOR (COM BASE NAS REGRAS META 2026)
async function markAsReadAndTyping(messageId, to) {
    if (!messageId) return;
    try {
        // Marca a mensagem como LIDA (Blue Ticks) e envia o estado "A escrever..." (Typing Indicator) na mesma requisição
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
            typing_indicator: {
                type: 'text'
            }
        });
    } catch (error) {
        // Ignora erros silenciosos da API da Meta
    }
}

async function sendText(to, text) {
    try {
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            type: 'text',
            text: {
                body: text
            }
        });
    } catch (error) {}
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
    } catch (error) {}
}

async function sendInteractiveMenu(to, text, options) {
    try {
        let interactiveObj = {
            type: options.length <= 3 ? "button" : "list",
            body: {
                text: text
            },
            action: {}
        };
        if (options.length <= 3) {
            interactiveObj.action.buttons = options.map(opt => ({
                type: "reply",
                reply: {
                    id: opt.id,
                    title: opt.title
                }
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
    } catch (error) {}
}

async function sendProductList(to, catalogId, headerText, bodyText, sections) {
    try {
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            type: 'interactive',
            interactive: {
                type: 'product_list',
                header: {
                    type: 'text',
                    text: headerText
                },
                body: {
                    text: bodyText
                },
                action: {
                    catalog_id: catalogId,
                    sections: sections
                }
            }
        });
    } catch (error) {
        throw error;
    }
}

async function downloadMedia(mediaId) {
    try {
        const getUrlResponse = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
            headers: {
                'Authorization': `Bearer ${META_TOKEN}`
            }
        });
        const downloadResponse = await axios.get(getUrlResponse.data.url, {
            responseType: 'arraybuffer',
            headers: {
                'Authorization': `Bearer ${META_TOKEN}`
            }
        });
        return Buffer.from(downloadResponse.data, 'binary');
    } catch (error) {
        return null;
    }
}

async function uploadMediaToMeta(filePath, mimeType) {
    try {
        const form = new FormData();
        const fileName = path.basename(filePath); 

        form.append('file', fs.createReadStream(filePath), {
            filename: fileName,
            contentType: mimeType
        });
        form.append('type', mimeType.split('/')[0]);
        form.append('messaging_product', 'whatsapp');

        const res = await axios.post(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/media`, form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${META_TOKEN}`
            }
        });
        return res.data.id;
    } catch (error) {
        console.error("❌ Erro ao subir ficheiro para a Meta:", error.response?.data || error.message);
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
        payload[type] = {
            id: mediaId
        };
        if (caption && (type === 'image' || type === 'video')) payload[type].caption = caption;
        await api.post('/messages', payload);
    } catch (error) {
        console.error(`❌ Erro ao enviar ${type}:`, error.response?.data || error.message);
    }
}

module.exports = {
    sendText,
    sendInteractiveMenu,
    markAsReadAndTyping,
    sendLocation,
    downloadMedia,
    sendProductList,
    uploadMediaToMeta,
    sendMediaMessage
};