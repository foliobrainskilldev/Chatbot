const { prisma } = require('../db');

exports.getWebhooks = async (req, res) => {
    try {
        const webhooks = await prisma.webhookEndpoint.findMany({
            orderBy: { criadoEm: 'desc' }
        });
        res.status(200).json(webhooks);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar integrações." });
    }
};

exports.createWebhook = async (req, res) => {
    try {
        const { url, secret, eventos } = req.body;
        const novoWebhook = await prisma.webhookEndpoint.create({
            data: { url, secret, eventos, ativo: true }
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