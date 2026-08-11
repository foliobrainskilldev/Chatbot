const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

// Verifica de forma segura se o arquivo existe antes de inicializar o SDK
const CREDENTIALS_PATH = path.join(__dirname, '../config/google-service-account.json');
let calendar = null;

if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: CREDENTIALS_PATH,
            scopes: ['https://www.googleapis.com/auth/calendar']
        });
        calendar = google.calendar({ version: 'v3', auth });
        console.log("✅ [Calendar] Integração com Google Calendar ativada.");
    } catch (error) {
        console.warn("⚠️ [Calendar] Erro ao carregar credenciais Google. Integração desativada.");
    }
} else {
    console.warn("⚠️ [Calendar] Arquivo google-service-account.json não encontrado. Integração desativada.");
}

/**
 * Cria um evento no Google Calendar e retorna o link do evento.
 * @param {String} calendarId - O ID do calendário (Padrão: 'primary')
 * @param {Object} eventDetails - { titulo, descricao, dataInicio (Date), dataFim (Date), fusoHorario }
 */
async function criarEvento(calendarId = 'primary', eventDetails) {
    if (!calendar) return null;

    const timeZone = eventDetails.fusoHorario || 'Africa/Maputo';

    const event = {
        summary: eventDetails.titulo,
        description: eventDetails.descricao,
        start: {
            dateTime: eventDetails.dataInicio.toISOString(),
            timeZone: timeZone,
        },
        end: {
            dateTime: eventDetails.dataFim.toISOString(),
            timeZone: timeZone,
        },
        reminders: {
            useDefault: false,
            overrides: [
                { method: 'email', minutes: 24 * 60 },
                { method: 'popup', minutes: 60 },
            ],
        },
    };

    try {
        const res = await calendar.events.insert({
            calendarId: calendarId,
            resource: event,
        });
        return res.data.htmlLink;
    } catch (error) {
        console.error("❌ [Calendar] Erro ao criar evento no Google Calendar:", error.message);
        return null;
    }
}

/**
 * Exclui um evento do Google Calendar caso a consulta seja cancelada.
 * @param {String} calendarId 
 * @param {String} eventId 
 */
async function deletarEvento(calendarId = 'primary', eventId) {
    if (!calendar) return false;
    
    try {
        await calendar.events.delete({
            calendarId: calendarId,
            eventId: eventId
        });
        return true;
    } catch (error) {
        console.error("❌ [Calendar] Erro ao deletar evento no Google Calendar:", error.message);
        return false;
    }
}

module.exports = {
    criarEvento,
    deletarEvento
};