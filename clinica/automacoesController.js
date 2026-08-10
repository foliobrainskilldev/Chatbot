const { prisma } = require('../db');

exports.getAutomacoes = async (req, res) => {
    try {
        // Assume-se que criaremos um schema Automacao (id, gatilho, acao, parametro, ativo)
        // Se o schema não existir na versão local, retornaremos array mapeado simulado via config global.
        const automacoes = await prisma.automacao.findMany({
            orderBy: { criadoEm: 'desc' }
        });
        res.status(200).json(automacoes);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar automações." });
    }
};

exports.criarAutomacao = async (req, res) => {
    try {
        const { gatilho, acao, parametro } = req.body;
        
        if (!gatilho || !acao) {
            return res.status(400).json({ error: "Gatilho e Ação são obrigatórios." });
        }

        const novaAutomacao = await prisma.automacao.create({
            data: {
                gatilho,
                acao,
                parametro: parametro || "",
                ativo: true
            }
        });

        res.status(201).json(novaAutomacao);
    } catch (error) {
        console.error("Erro ao criar automação:", error);
        res.status(500).json({ error: "Erro interno ao criar automação." });
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