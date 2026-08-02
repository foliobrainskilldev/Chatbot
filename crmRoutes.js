// --- START OF FILE crmRoutes.js ---
const express = require('express');
const router = express.Router();
const { prisma } = require('./db');
const { stateMachine } = require('./messageHandler');

// Rota 1: Resetar a memória do Bot (Antigo /api/reset)
router.post('/reset', async (req, res) => {
    try {
        await prisma.mensagemIA.deleteMany({});
        await prisma.agendamento.deleteMany({});
        await prisma.cliente.deleteMany({});
        
        if (stateMachine) {
            stateMachine.clear();
        }
        
        console.log("🚨 BANCO DE DADOS E MEMÓRIA RAM RESETADOS COM SUCESSO!");
        // Retorna sempre JSON para o frontend processar
        res.status(200).json({ message: "Memória do bot apagada com sucesso! Todos os clientes foram esquecidos e a RAM foi limpa." });
    } catch(error) {
        console.error("❌ Erro ao resetar DB:", error);
        res.status(500).json({ error: "Erro interno ao apagar dados." });
    }
});

// Rota 2: Listar Clientes (Exemplo base para começar o seu CRM)
router.get('/clientes', async (req, res) => {
    try {
        const clientes = await prisma.cliente.findMany({
            orderBy: { id: 'desc' } // Ordena pelos mais recentes
        });
        res.status(200).json(clientes);
    } catch (error) {
        console.error("❌ Erro ao buscar clientes:", error);
        res.status(500).json({ error: "Erro ao buscar clientes na base de dados." });
    }
});

module.exports = router;