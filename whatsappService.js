const axios = require('axios');

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const API_VERSION = 'v18.0';

async function sendWhatsAppRequest(data) {
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
        console.warn("⚠️ [WhatsApp] Token ou Phone ID não configurados.");
        return null;
    }
    try {
        const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`,
            data: data,
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        console.error("❌ [WhatsApp] Erro na API:", error.response ? error.response.data : error.message);
        return null;
    }
}

async function markAsReadAndTyping(msgId, to) {
    // 1. Marca a mensagem como lida (Tiques azuis)
    if (msgId) {
        await sendWhatsAppRequest({
            messaging_product: "whatsapp",
            message_id: msgId,
            status: "read"
        });
    }
    // 2. Ativa o indicador de "Digitando..." (Typing Indicator)
    if (to) {
        await sendWhatsAppRequest({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "sender_action",
            sender_action: "typing_on"
        });
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