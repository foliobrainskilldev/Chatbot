const { prisma } = require('../db');

exports.getAutomacoes = async (req, res) => {
    try {
        const automacoes = await prisma.automacao.findMany({
            orderBy: { criadoEm: 'desc' }
        });
        res.status(200).json(automacoes);
    } catch (error) {
        console.error("Erro getAutomacoes:", error);
        res.status(500).json({ error: "Erro ao buscar automações." });
    }
};

exports.criarAutomacao = async (req, res) => {
    try {
        const { nome, gatilho, condicoes, acao, parametro, atraso } = req.body;
        
        if (!gatilho || !acao || !nome) {
            return res.status(400).json({ error: "Nome, Gatilho e Ação são obrigatórios." });
        }

        const novaAutomacao = await prisma.automacao.create({
            data: {
                nome,
                gatilho,
                condicoes: condicoes || "[]",
                acao,
                parametro: parametro || "",
                atraso: parseInt(atraso) || 0,
                ativo: true,
                execucoes: 0
            }
        });

        res.status(201).json(novaAutomacao);
    } catch (error) {
        console.error("Erro criarAutomacao:", error);
        res.status(500).json({ error: "Erro interno ao criar automação. Verifique se o banco de dados foi atualizado." });
    }
};

exports.toggleAutomacao = async (req, res) => {
    try {
        const { ativo } = req.body;
        const atualizada = await prisma.automacao.update({
            where: { id: parseInt(req.params.id) },
            data: { ativo: ativo }
        });
        res.status(200).json(atualizada);
    } catch (error) {
        res.status(500).json({ error: "Erro ao alternar status da automação." });
    }
};

exports.deletarAutomacao = async (req, res) => {
    try {
        await prisma.automacao.delete({
            where: { id: parseInt(req.params.id) }
        });
        res.status(200).json({ message: "Automação removida." });
    } catch (error) {
        res.status(500).json({ error: "Erro ao remover automação." });
    }
};

exports.getHistoricoExecucao = async (req, res) => {
    try {
        // Tenta buscar o histórico. Se a tabela não existir, cai no catch.
        const historico = await prisma.automacaoHistorico.findMany({
            orderBy: { dataExecucao: 'desc' },
            take: 100, // Limite para performance do dashboard
            include: { automacao: true, cliente: true }
        });
        res.status(200).json(historico);
    } catch (error) {
        console.warn("Aviso: Falha ao buscar histórico de automações (Tabela ausente ou erro DB). Retornando array vazio.");
        res.status(200).json([]); // Fallback para não quebrar o frontend
    }
};