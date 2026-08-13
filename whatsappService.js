const axios = require('axios');

const API_VERSION = 'v18.0';

async function sendWhatsAppRequest(data) {
    const META_TOKEN = process.env.META_TOKEN ? process.env.META_TOKEN.trim() : null;
    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID ? String(process.env.PHONE_NUMBER_ID).trim() : null;

    if (!META_TOKEN || !PHONE_NUMBER_ID) {
        console.error("⚠️ [WhatsApp] FALTAM CREDENCIAIS: Verifique o META_TOKEN e PHONE_NUMBER_ID no .env");
        return null;
    }
    
    try {
        const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`,
            data: data,
            headers: {
                'Authorization': `Bearer ${META_TOKEN}`,
                'Content-Type': 'application/json'
            },
            timeout: 8000 
        });
        return response.data;
    } catch (error) {
        console.error("❌ [WhatsApp API ERRO]:", error.response ? JSON.stringify(error.response.data) : error.message);
        return null;
    }
}

async function markAsReadAndTyping(msgId, to) {
    try {
        if (msgId) {
            await sendWhatsAppRequest({
                messaging_product: "whatsapp",
                message_id: msgId,
                status: "read"
            });
        }
    } catch (e) {
        console.error("⚠️ [WhatsApp] Erro não crítico ao tentar marcar como lida:", e.message);
    }
}

async function sendTypingIndicator(to) {
    try {
        await sendWhatsAppRequest({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "typing_indicator",
            typing_indicator: {
                type: "text"
            }
        });
    } catch (e) {
        console.error("⚠️ [WhatsApp] Erro ao enviar status digitando:", e.message);
    }
}

async function sendText(to, text) {
    return await sendWhatsAppRequest({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "text",
        text: { preview_url: true, body: text }
    });
}

async function sendInteractiveMenu(to, text, buttons) {
    const actionButtons = buttons.slice(0, 3).map(btn => ({
        type: "reply",
        reply: { id: btn.id, title: btn.title }
    }));

    return await sendWhatsAppRequest({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "interactive",
        interactive: {
            type: "button",
            body: { text: text },
            action: { buttons: actionButtons }
        }
    });
}

async function sendInteractiveList(to, text, buttonText, sections) {
    return await sendWhatsAppRequest({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "interactive",
        interactive: {
            type: "list",
            body: { text: text },
            action: {
                button: buttonText,
                sections: sections
            }
        }
    });
}

// CORREÇÃO CRÍTICA: A Meta rejeita o envio de Áudio se o objeto contiver "caption" (texto) ou "filename".
async function sendMediaUrl(to, type, url, caption = "", filename = null) {
    const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: type
    };

    if (type === 'audio') {
        // Para áudio, enviamos SOMENTE o link.
        payload.audio = { link: url };
    } else if (type === 'image') {
        payload.image = { link: url };
        if (caption) payload.image.caption = caption;
    } else if (type === 'video') {
        payload.video = { link: url };
        if (caption) payload.video.caption = caption;
    } else if (type === 'document') {
        payload.document = { link: url };
        if (caption) payload.document.caption = caption;
        if (filename) payload.document.filename = filename;
    }

    return await sendWhatsAppRequest(payload);
}

async function downloadMedia(mediaId) {
    const META_TOKEN = process.env.META_TOKEN ? process.env.META_TOKEN.trim() : null;
    if (!META_TOKEN) throw new Error("META_TOKEN ausente.");

    try {
        const resUrl = await axios.get(`https://graph.facebook.com/${API_VERSION}/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${META_TOKEN}` }
        });
        const mediaUrl = resUrl.data.url;

        const resBinary = await axios.get(mediaUrl, {
            headers: { 'Authorization': `Bearer ${META_TOKEN}` },
            responseType: 'arraybuffer' 
        });

        return Buffer.from(resBinary.data);
    } catch (error) {
        console.error("❌ [WhatsApp Media ERRO]: Falha ao baixar arquivo de mídia.");
        throw error;
    }
}

module.exports = {
    sendText,
    sendInteractiveMenu,
    sendInteractiveList,
    sendMediaUrl,
    markAsReadAndTyping,
    sendTypingIndicator,
    downloadMedia
};