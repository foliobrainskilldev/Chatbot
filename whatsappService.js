const axios = require('axios');
const cloudinaryService = require('./services/cloudinaryService');

// Remove espaços em branco acidentais nas variáveis de ambiente que causam erro 401/404
const META_TOKEN = (process.env.META_TOKEN || '').trim();
const PHONE_NUMBER_ID = (process.env.PHONE_NUMBER_ID || '').trim();

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
            await api.post('/messages', {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: String(to),
                type: 'typing_indicator',
                typing_indicator: { type: 'text' }
            });
        }
    } catch (error) {
        // Ignora silenciosamente se o typing_indicator não for suportado pelo número
    }
}

async function sendText(to, text) {
    if (!to || !text) return;
    try {
        await api.post('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: String(to),
            type: 'text',
            text: { body: String(text) }
        });
    } catch (error) {
        console.error("❌ Erro envio Texto Meta:", error?.response?.data || error.message);
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
                rows: options.slice(0, 10).map(opt => {
                    let row = {
                        id: String(opt.id).substring(0, 200),
                        title: String(opt.title).length > 24 ? String(opt.title).substring(0, 21) + "..." : String(opt.title)
                    };
                    // CORREÇÃO DA META API: Nunca enviar "description" vazia, senão a mensagem é bloqueada
                    if (opt.description && String(opt.description).trim() !== "") {
                        row.description = String(opt.description).substring(0, 72);
                    }
                    return row;
                })
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
        console.error("⚠️ Meta rejeitou o Menu Interativo. Enviando menu como texto puro...");
        // FALLBACK: Se a Meta rejeitar os botões, envia as opções em formato de texto para NÃO FICAR EM SILÊNCIO
        let txtFallback = text + "\n\n";
        options.forEach((opt, index) => {
            txtFallback += `*${index + 1}.* ${opt.title}\n`;
        });
        txtFallback += "\n👉 Responda com o nome da opção desejada.";
        await sendText(to, txtFallback);
    }
}

async function sendMediaUrl(to, type, url, caption = "") {
    try {
        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: String(to),
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