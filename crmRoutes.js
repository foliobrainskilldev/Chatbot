// --- START OF FILE crmRoutes.js ---
const express = require('express');
const router = express.Router();
const { prisma } = require('./db');
const { stateMachine } = require('./messageHandler');
const { sendText } = require('./whatsappApi'); // Importar para enviar mensagens

// Rota 1: Resetar a memória do Bot
router.post('/reset', async (req, res) => {
    try {
        await prisma.mensagemIA.deleteMany({});
        await prisma.agendamento.deleteMany({});
        await prisma.cliente.deleteMany({});
        
        if (stateMachine) stateMachine.clear();
        
        res.status(200).json({ message: "Memória do bot apagada com sucesso!" });
    } catch(error) {
        res.status(500).json({ error: "Erro interno ao apagar dados." });
    }
});

// Rota 2: Listar Clientes
router.get('/clientes', async (req, res) => {
    try {
        const clientes = await prisma.cliente.findMany({
            orderBy: { id: 'desc' }
        });
        res.status(200).json(clientes);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar clientes." });
    }
});

// ==========================================
// MÓDULO DE ATENDIMENTO HUMANO (CONVERSAS)
// ==========================================

// Rota 3: Listar clientes que pediram para falar com humano
router.get('/conversas/pendentes', async (req, res) => {
    try {
        const clientesPendentes = await prisma.cliente.findMany({
            where: { falarHumano: true },
            orderBy: { id: 'desc' }
        });
        res.status(200).json(clientesPendentes);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar conversas pendentes." });
    }
});

// Rota 4: Ver histórico de mensagens de um cliente específico
router.get('/conversas/:clienteId', async (req, res) => {
    try {
        const { clienteId } = req.params;
        const mensagens = await prisma.mensagemIA.findMany({
            where: { clienteId: clienteId },
            orderBy: { criadoEm: 'asc' } // Ordem cronológica (mais antigas em cima)
        });
        res.status(200).json(mensagens);
    } catch (error) {
        res.status(500).json({ error: "Erro ao carregar histórico." });
    }
});

// Rota 5: Enviar mensagem do CRM para o WhatsApp do Cliente
router.post('/conversas/:clienteId/enviar', async (req, res) => {
    try {
        const { clienteId } = req.params;
        const { texto } = req.body;
        
        // Envia para o WhatsApp via Meta API
        await sendText(clienteId, texto);
        
        // Salva na base de dados (Memória) como assistente
        const novaMsg = await prisma.mensagemIA.create({
            data: { role: 'assistant', content: texto, clienteId: clienteId }
        });
        
        res.status(200).json(novaMsg);
    } catch (error) {
        console.error("Erro ao enviar mensagem manual:", error);
        res.status(500).json({ error: "Erro ao enviar mensagem." });
    }
});

// Rota 6: Encerrar o atendimento humano e devolver para o Bot
router.post('/conversas/:clienteId/resolver', async (req, res) => {
    try {
        const { clienteId } = req.params;
        await prisma.cliente.update({
            where: { id: clienteId },
            data: { falarHumano: false }
        });
        
        // Envia mensagem avisando o cliente
        await sendText(clienteId, "Atendimento humano encerrado. O Assistente Virtual assumiu novamente o comando. Digite 'Menu' para aceder às opções.");
        
        res.status(200).json({ message: "Atendimento devolvido ao bot." });
    } catch (error) {
        res.status(500).json({ error: "Erro ao encerrar atendimento." });
    }
});

module.exports = router;
// --- END OF FILE crmRoutes.js ---