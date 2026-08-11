const axios = require('axios');
const { prisma } = require('../db');

/**
 * Dispara eventos para URLs externas cadastradas no banco (Webhooks).
 * Com suporte real a Autenticação, Retry Automático e Logging.
 * Roda de forma assíncrona para não travar o event loop do WhatsApp.
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

        // Usa Promise.allSettled para não deixar uma URL lenta quebrar as outras
        const disparos = endpoints.map(async (endpoint) => {
            const headers = { 'Content-Type': 'application/json' };
            
            if (endpoint.authType === 'BEARER' && endpoint.authToken) {
                headers['Authorization'] = `Bearer ${endpoint.authToken}`; 
            } else if (endpoint.authType === 'API_KEY' && endpoint.authToken) {
                headers['x-api-key'] = endpoint.authToken;
            }

            let attempts = 0;
            const maxAttempts = isTest ? 1 : 3; 
            let success = false;
            let responseStatus = null;
            let responseBody = null;

            while (attempts < maxAttempts && !success) {
                attempts++;
                try {
                    const axiosResponse = await axios({
                        method: endpoint.metodo || 'POST',
                        url: endpoint.url,
                        data: payloadFinal,
                        headers: headers,
                        timeout: 5000 // Segurança: 5 seg máx por tentativa
                    });
                    success = true;
                    responseStatus = axiosResponse.status;
                    responseBody = typeof axiosResponse.data === 'object' ? JSON.stringify(axiosResponse.data) : String(axiosResponse.data);
                } catch (error) {
                    responseStatus = error.response ? error.response.status : 500;
                    responseBody = error.response ? (typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : String(error.response.data)) : error.message;
                    
                    if (attempts < maxAttempts) {
                        // Backoff exponencial: aguarda antes de tentar de novo
                        await new Promise(resolve => setTimeout(resolve, attempts * 1000));
                    }
                }
            }

            // Gravar o resultado no Histórico de Entregas
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
                console.error("⚠️ [Webhook] Erro ao registrar log:", logError.message);
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

        return await Promise.all(disparos);

    } catch (error) {
        console.error("❌ [Webhook] Erro interno no gerenciador:", error.message);
        return [{ success: false, error: error.message }];
    }
}

module.exports = { dispararEvento };