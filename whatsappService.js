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
        if (to) {
            await sendWhatsAppRequest({
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: to,
                type: "sender_action",
                sender_action: "typing_on"
            });
        }
    } catch (e) {
        console.error("⚠️ [WhatsApp] Erro não crítico ao tentar marcar como lida/digitando:", e.message);
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

async function sendMediaUrl(to, type, url, caption = "") {
    const mediaObj = { link: url };
    if (caption && (type === 'image' || type === 'video' || type === 'document')) {
        mediaObj.caption = caption;
    }
    
    const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: type
    };
    payload[type] = mediaObj;

    return await sendWhatsAppRequest(payload);
}

module.exports = {
    sendText,
    sendInteractiveMenu,
    sendMediaUrl,
    markAsReadAndTyping
};