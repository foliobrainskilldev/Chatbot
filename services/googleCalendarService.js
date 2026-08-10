const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

// Verifica se o arquivo de credenciais existe antes de inicializar para não quebrar o SaaS
const CREDENTIALS_PATH = path.join(__dirname, '../config/google-service-account.json');
let calendar = null;

if (fs.existsSync(CREDENTIALS_PATH)) {
    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_PATH,
        scopes: ['https://www.googleapis.com/auth/calendar']
    });
    calendar = google.calendar({ version: 'v3', auth });
    console.log("✅ Integração com Google Calendar ativada.");
} else {
    console.warn("⚠️ Arquivo google-service-account.json não encontrado. Integração com Google Calendar está desativada.");
}

/**
 * Cria um evento no Google Calendar e retorna o link do evento.
 * @param {String} calendarId - O ID do calendário (Padrão: 'primary')
 * @param {Object} eventDetails - { titulo, descricao, dataInicio (Date), dataFim (Date) }
 */
async function criarEvento(calendarId = 'primary', eventDetails) {
    if (!calendar) return null;

    const event = {
        summary: eventDetails.titulo,
        description: eventDetails.descricao,
        start: {
            dateTime: eventDetails.dataInicio.toISOString(),
            timeZone: 'Africa/Maputo',
        },
        end: {
            dateTime: eventDetails.dataFim.toISOString(),
            timeZone: 'Africa/Maputo',
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
        console.error("Erro ao criar evento no Google Calendar:", error);
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
        console.error("Erro ao deletar evento no Google Calendar:", error);
        return false;
    }
}

module.exports = {
    criarEvento,
    deletarEvento
};