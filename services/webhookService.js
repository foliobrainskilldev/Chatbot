const axios = require('axios');
const { prisma } = require('../db');

/**
 * Dispara eventos para URLs externas cadastradas no banco (Webhooks).
 * Com suporte real a Autenticação, Retry Automático e Logging.
 * 
 * @param {String} nomeEvento - O nome do evento (Ex: 'lead.created', 'appointment.created')
 * @param {Object} payloadData - Objeto com os dados do evento.
 * @param {Boolean} isTest - Se for true, força envio mesmo se endpoint for teste.
 * @param {Number} forceEndpointId - ID específico para testar apenas uma URL.
 */
async function dispararEvento(nomeEvento, payloadData, isTest = false, forceEndpointId = null) {
    try {
        let whereClause = { 
            ativo: true,
            eventos: { contains: nomeEvento } 
        };

        if (forceEndpointId) {
            whereClause = { id: forceEndpointId };
        }

        const endpoints = await prisma.webhookEndpoint.findMany({ where: whereClause });

        if (endpoints.length === 0) return [];

        const payloadFinal = {
            event: nomeEvento,
            timestamp: new Date().toISOString(),
            data: payloadData
        };

        const disparos = endpoints.map(async (endpoint) => {
            const headers = { 'Content-Type': 'application/json' };
            
            if (endpoint.authType === 'BEARER' && endpoint.authToken) {
                headers['Authorization'] = `Bearer ${endpoint.authToken}`; 
            } else if (endpoint.authType === 'API_KEY' && endpoint.authToken) {
                headers['x-api-key'] = endpoint.authToken;
            }

            let attempts = 0;
            const maxAttempts = isTest ? 1 : 3; // Em teste só tenta 1 vez
            let success = false;
            let responseStatus = null;
            let responseBody = null;
            let axiosResponse = null;

            while (attempts < maxAttempts && !success) {
                attempts++;
                try {
                    axiosResponse = await axios({
                        method: endpoint.metodo || 'POST',
                        url: endpoint.url,
                        data: payloadFinal,
                        headers: headers,
                        timeout: 5000
                    });
                    success = true;
                    responseStatus = axiosResponse.status;
                    responseBody = typeof axiosResponse.data === 'object' ? JSON.stringify(axiosResponse.data) : String(axiosResponse.data);
                } catch (error) {
                    responseStatus = error.response ? error.response.status : 500;
                    responseBody = error.response ? (typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : String(error.response.data)) : error.message;
                    
                    if (attempts < maxAttempts) {
                        // Backoff exponencial: 1s, 2s...
                        await new Promise(resolve => setTimeout(resolve, attempts * 1000));
                    }
                }
            }

            // Gravar o resultado no Histórico de Entregas (WebhookLog)
            try {
                await prisma.webhookLog.create({
                    data: {
                        webhookId: endpoint.id,
                        evento: nomeEvento,
                        url: endpoint.url,
                        requestPayload: JSON.stringify(payloadFinal, null, 2),
                        responseStatus: responseStatus,
                        responseBody: responseBody ? responseBody.substring(0, 2000) : null,
                        sucesso: success,
                        tentativas: attempts
                    }
                });
            } catch (logError) {
                console.error("Erro ao registrar log do webhook:", logError);
            }

            return {
                endpointId: endpoint.id,
                url: endpoint.url,
                success,
                responseStatus,
                responseBody,
                attempts
            };
        });

        const results = await Promise.all(disparos);
        return results;

    } catch (error) {
        console.error("Erro interno no gerenciador de Webhooks:", error);
        return [{ success: false, error: error.message }];
    }
}

module.exports = { dispararEvento };