const axios = require('axios');
const { prisma } = require('../db');

/**
 * Dispara eventos para URLs externas cadastradas no banco (Webhooks).
 * Mantém o isolamento de eventos e garante retry simples.
 * 
 * @param {String} nomeEvento - O nome do evento (Ex: 'lead.created', 'appointment.created')
 * @param {Object} payloadData - Objeto com os dados do evento.
 */
async function dispararEvento(nomeEvento, payloadData) {
    try {
        // Busca endpoints cadastrados para o evento específico
        const endpoints = await prisma.webhookEndpoint.findMany({
            where: { 
                ativo: true,
                eventos: { contains: nomeEvento } 
            }
        });

        if (endpoints.length === 0) return;

        const payloadFinal = {
            event: nomeEvento,
            timestamp: new Date().toISOString(),
            data: payloadData
        };

        const disparos = endpoints.map(async (endpoint) => {
            const headers = { 'Content-Type': 'application/json' };
            if (endpoint.secret) {
                // Implementação básica de Authorization
                headers['Authorization'] = `Bearer ${endpoint.secret}`; 
            }

            try {
                await axios.post(endpoint.url, payloadFinal, { 
                    headers: headers,
                    timeout: 5000 
                });
            } catch (postError) {
                console.error(`Falha ao disparar webhook para ${endpoint.url}:`, postError.message);
                // NOTA: Para um SaaS corporativo real, aqui enviaríamos para uma fila SQS/RabbitMQ para Retry. 
                // Por agora, ignoramos a falha silenciosamente para não travar o fluxo do Node.
            }
        });

        await Promise.all(disparos);
    } catch (error) {
        console.error("Erro interno no gerenciador de Webhooks:", error);
    }
}

module.exports = { dispararEvento };