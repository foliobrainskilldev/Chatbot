const axios = require('axios');
const cloudinaryService = require('./services/cloudinaryService');

const META_TOKEN = process.env.META_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const api = axios.create({
    // Atualizado para a API v20.0 para suportar a feature nativa de Typing Indicator
    baseURL: `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}`,
    headers: {
        'Authorization': `Bearer ${META_TOKEN}`,
        'Content-Type': 'application/json'
    }
});

// Envia os Ticks Azuis e ativa o "Digitando..." no celular do paciente
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
        console.error("Falha ao marcar status lido/digitando Meta:", error?.response?.data || error.message);
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
        console.error("Erro envio Texto Meta:", error?.response?.data || error.message);
    }
}

async function sendMediaUrl(to, type, url, caption = "") {
    try {
        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            type: type
        };
        
        payload[type] = { link: url };
        
        if (caption && (type === 'image' || type === 'video' || type === 'document')) {
            payload[type].caption = caption;
        }
        
        await api.post('/messages', payload);
    } catch (error) {
        console.error(`Erro envio Mídia (${type}) Meta:`, error?.response?.data || error.message);
    }
}

async function sendInteractiveMenu(to, text, options) {
    if (!options || !Array.isArray(options) || options.length === 0) {
        return await sendText(to, text);
    }

    try {
        let interactiveObj = {
            type: options.length <= 3 ? "button" : "list",
            body: { text: text },
            action: {}
        };
        
        // CORREÇÃO CRÍTICA: API da Meta rejeita botões > 20 caracteres e listas > 24.
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
                    title: String(opt.title).length > 24 ? String(opt.title).substring(0, 21) + "..." : String(opt.title),
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
        console.error("Erro envio Menu Interativo Meta:", error?.response?.data || error.message);
    }
}

async function downloadMetaMediaToCloudinary(mediaId, mimeType) {
    try {
        const getUrlResponse = await axios.get(`https://graph.facebook.com/v20.0/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${META_TOKEN}` }
        });
        
        const downloadResponse = await axios.get(getUrlResponse.data.url, {
            responseType: 'arraybuffer',
            headers: { 'Authorization': `Bearer ${META_TOKEN}` }
        });
        
        const buffer = Buffer.from(downloadResponse.data, 'binary');
        const resourceType = mimeType.startsWith('image/') ? 'image' : (mimeType.startsWith('audio/') ? 'video' : 'raw');
        
        const cloudResult = await cloudinaryService.uploadStream(buffer, 'clinica/recebidos', resourceType);
        return cloudResult.secure_url;
    } catch (error) {
        console.error("Erro download Mídia Meta:", error?.response?.data || error.message);
        return null;
    }
}

module.exports = {
    sendText,
    sendInteractiveMenu,
    markAsReadAndTyping,
    sendMediaUrl,
    downloadMetaMediaToCloudinary
};