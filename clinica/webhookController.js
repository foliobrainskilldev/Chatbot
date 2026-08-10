const { prisma } = require('../db');
const webhookService = require('../services/webhookService');

exports.getWebhooks = async (req, res) => {
    try {
        const webhooks = await prisma.webhookEndpoint.findMany({
            orderBy: { criadoEm: 'desc' }
        });
        // Remove os tokens sensíveis do payload do frontend
        const safeWebhooks = webhooks.map(wb => ({
            ...wb,
            authToken: wb.authToken ? '********' : null
        }));
        res.status(200).json(safeWebhooks);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar integrações." });
    }
};

exports.createWebhook = async (req, res) => {
    try {
        const { url, authType, authToken, metodo, eventos } = req.body;
        const novoWebhook = await prisma.webhookEndpoint.create({
            data: { 
                url, 
                authType: authType || 'NONE',
                authToken: authToken || null,
                metodo: metodo || 'POST',
                eventos: eventos.join(', '), // Recebe Array e salva como string separada por vírgula
                ativo: true 
            }
        });
        res.status(201).json(novoWebhook);
    } catch (error) {
        res.status(500).json({ error: "Erro ao criar webhook." });
    }
};

exports.toggleWebhook = async (req, res) => {
    try {
        const { id } = req.params;
        const { ativo } = req.body;
        const atualizado = await prisma.webhookEndpoint.update({
            where: { id: parseInt(id) },
            data: { ativo }
        });
        res.status(200).json(atualizado);
    } catch (error) {
        res.status(500).json({ error: "Erro ao alternar status do webhook." });
    }
};

exports.deleteWebhook = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.webhookEndpoint.delete({
            where: { id: parseInt(id) }
        });
        res.status(200).json({ message: "Webhook removido com sucesso." });
    } catch (error) {
        res.status(500).json({ error: "Erro ao remover webhook." });
    }
};

// NOVO: Endpoint para Testar Webhooks Reais
exports.testWebhook = async (req, res) => {
    try {
        const { id } = req.params;
        const { evento } = req.body;

        // Gera um payload mockado estruturado para o teste
        const fakePayload = {
            id: "lead_teste_123",
            name: "Usuário de Teste",
            phone: "+258840000000",
            source: "HealthCRM Testing",
            treatment: "Simulação de API",
            status: "QUALIFICADO"
        };

        const result = await webhookService.dispararEvento(evento, fakePayload, true, parseInt(id));
        
        if (result && result.length > 0) {
            res.status(200).json(result[0]);
        } else {
            res.status(404).json({ success: false, message: "Endpoint não encontrado ou não inscrito neste evento." });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// NOVO: Buscar histórico de Webhooks para a tabela da UI
exports.getWebhookLogs = async (req, res) => {
    try {
        const logs = await prisma.webhookLog.findMany({
            orderBy: { criadoEm: 'desc' },
            take: 100, // Limitamos as últimas 100 entregas para não pesar
            include: {
                webhook: { select: { url: true } }
            }
        });
        res.status(200).json(logs);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar histórico de webhooks." });
    }
};