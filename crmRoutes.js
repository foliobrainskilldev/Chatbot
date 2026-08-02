// --- START OF FILE crmRoutes.js ---
const express = require('express');
const router = express.Router();
const { prisma } = require('./db');
const { stateMachine } = require('./messageHandler');
const { sendText } = require('./whatsappApi'); 

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

router.get('/clientes', async (req, res) => {
    try {
        const clientes = await prisma.cliente.findMany({ orderBy: { id: 'desc' } });
        res.status(200).json(clientes);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar clientes." });
    }
});

router.get('/conversas/pendentes', async (req, res) => {
    try {
        const clientesPendentes = await prisma.cliente.findMany({
            where: { falarHumano: true }, orderBy: { id: 'desc' }
        });
        res.status(200).json(clientesPendentes);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar conversas pendentes." });
    }
});

router.get('/conversas/:clienteId', async (req, res) => {
    try {
        const { clienteId } = req.params;
        const mensagens = await prisma.mensagemIA.findMany({
            where: { clienteId: clienteId }, orderBy: { criadoEm: 'asc' } 
        });
        res.status(200).json(mensagens);
    } catch (error) {
        res.status(500).json({ error: "Erro ao carregar histórico." });
    }
});

router.post('/conversas/:clienteId/enviar', async (req, res) => {
    try {
        const { clienteId } = req.params;
        const { texto } = req.body;
        
        await sendText(clienteId, texto);
        
        const novaMsg = await prisma.mensagemIA.create({
            data: { role: 'assistant', content: texto, clienteId: clienteId }
        });
        
        // Emite para o WebSocket para aparecer no CRM na mesma hora
        if (global.io) {
            global.io.emit('nova_mensagem', { clienteId: clienteId, mensagem: novaMsg });
        }
        
        res.status(200).json(novaMsg);
    } catch (error) {
        res.status(500).json({ error: "Erro ao enviar mensagem." });
    }
});

router.post('/conversas/:clienteId/resolver', async (req, res) => {
    try {
        const { clienteId } = req.params;
        await prisma.cliente.update({ where: { id: clienteId }, data: { falarHumano: false } });
        
        await sendText(clienteId, "Atendimento humano encerrado. O Assistente Virtual assumiu novamente o comando. Digite 'Menu' para aceder às opções.");
        
        // Atualiza a fila em todos os computadores que tiverem o CRM aberto
        if (global.io) global.io.emit('atualizar_fila');
        
        res.status(200).json({ message: "Atendimento devolvido ao bot." });
    } catch (error) {
        res.status(500).json({ error: "Erro ao encerrar atendimento." });
    }
});

module.exports = router;
// --- END OF FILE crmRoutes.js ---