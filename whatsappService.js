const axios = require('axios');
const cloudinaryService = require('./services/cloudinaryService');

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
        console.log(`👁️ [META API] Mensagem de ${to} marcada como lida.`);

        if (to) {
            await api.post('/messages', {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: String(to),
                type: 'typing_indicator',
                typing_indicator: { type: 'text' }
            });
            console.log(`✍️ [META API] Indicador "Digitando..." disparado para ${to}.`);
        }
    } catch (error) {
        console.log(`⚠️ [AVISO META API] Este número (${to}) não suportou o indicador de lido/digitando, ignorando e avançando. (Normal em testes)`);
    }
}

async function sendText(to, text) {
    if (!to || !text) return;
    try {
        console.log(`📤 [META API] A enviar resposta de texto para ${to}...`);
        const response = await api.post('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: String(to),
            type: 'text',
            text: { body: String(text) }
        });
        console.log(`✅ [META API] SUCESSO! Mensagem aceite pelo WhatsApp. ID:`, response.data?.messages?.[0]?.id);
    } catch (error) {
        console.error("❌ [ERRO META TEXTO]:", JSON.stringify(error?.response?.data || error.message, null, 2));
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
                    if (opt.description && String(opt.description).trim() !== "") {
                        row.description = String(opt.description).substring(0, 72);
                    }
                    return row;
                })
            }];
        }
        
        console.log(`📤 [META API] A enviar Menu Interativo para ${to}...`);
        const response = await api.post('/messages', {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: String(to),
            type: 'interactive',
            interactive: interactiveObj
        });
        console.log(`✅ [META API] SUCESSO! Menu aceite pelo WhatsApp. ID:`, response.data?.messages?.[0]?.id);
    } catch (error) {
        console.error("⚠️ [ERRO META MENU] A Meta rejeitou o menu. Acionando Fallback em Texto.", JSON.stringify(error?.response?.data || error.message, null, 2));
        let txtFallback = text + "\n\n";
        options.forEach((opt, index) => {
            txtFallback += `*${index + 1}.* ${opt.title}\n`;
        });
        txtFallback += "\n👉 Responda com o nome ou número da opção desejada.";
        await sendText(to, txtFallback);
    }
}

async function sendMediaUrl(to, type, url, caption = "") {
    try {
        console.log(`📤 [META API] A enviar Mídia (${type}) para ${to}...`);
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
        console.log(`✅ [META API] SUCESSO! Mídia enviada.`);
    } catch (error) {
        console.error(`❌ [ERRO META MÍDIA]`, JSON.stringify(error?.response?.data || error.message, null, 2));
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
        console.error("❌ [ERRO DOWNLOAD META MEDIA]", error.message);
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