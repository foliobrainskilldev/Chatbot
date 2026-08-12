const { prisma } = require('./db');
const botBarbearia = require('./barbearia/botEngine');
const botClinica = require('./clinica/botEngine');

exports.getConfigSistema = async (req, res) => {
    try {
        let config = await prisma.configSistema.findUnique({ where: { id: 1 } });
        if (!config) {
            config = await prisma.configSistema.create({
                data: { id: 1, modoAtivo: 'BARBEARIA', nomeAssistente: 'Assistente', tomDeVoz: 'Profissional' }
            });
        }
        res.status(200).json(config);
    } catch (e) {
        console.error("Erro Hub Config GET:", e);
        res.status(500).json({ error: "Erro ao buscar configurações no banco central." });
    }
};

exports.mudarMotorAtivo = async (req, res) => {
    try {
        const { modoAtivo } = req.body;
        
        const config = await prisma.configSistema.upsert({
            where: { id: 1 },
            update: { modoAtivo: modoAtivo },
            create: { 
                id: 1, 
                modoAtivo: modoAtivo, 
                nomeAssistente: 'Assistente', 
                tomDeVoz: 'Profissional' 
            }
        });

        console.log(`[HUB] Motor de Roteamento alterado para: ${modoAtivo}`);
        res.status(200).json(config);
    } catch (e) {
        console.error("Erro ao mudar motor:", e);
        res.status(500).json({ error: "Erro ao alterar roteamento do sistema." });
    }
};

exports.saveConfigSistema = async (req, res) => {
    try {
        const d = req.body;
        await prisma.configSistema.upsert({
            where: { id: 1 },
            update: {
                modoAtivo: d.modoAtivo, 
                nomeAssistente: d.nomeAssistente, 
                tomDeVoz: d.tomDeVoz,
                objetivos: d.objetivos, 
                regrasExtrasIA: d.regrasExtrasIA, 
                faq: d.faq,
                ignorarDiagnosticos: d.ignorarDiagnosticos, 
                regrasTransferencia: d.regrasTransferencia,
                notificarNovosLeads: d.notificarNovosLeads, 
                autoFollowUp: d.autoFollowUp,
                autoLembrete: d.autoLembrete, 
                distribuicaoLeads: d.distribuicaoLeads,
                webhookUrl: d.webhookUrl, 
                metaToken: d.metaToken
            },
            create: {
                id: 1, 
                modoAtivo: d.modoAtivo || "BARBEARIA", 
                nomeAssistente: d.nomeAssistente || "Assistente",
                tomDeVoz: d.tomDeVoz || "Amigável", 
                objetivos: d.objetivos || "", 
                regrasExtrasIA: d.regrasExtrasIA || "", 
                faq: d.faq || ""
            }
        });
        res.status(200).json({ message: "Configurações Globais salvas com sucesso." });
    } catch (e) {
        console.error("Erro Hub Config POST:", e);
        res.status(500).json({ error: "Erro ao atualizar configurações centrais." });
    }
};

exports.getHubStats = async (req, res) => {
    try {
        const totalLeads = await prisma.cliente.count();
        const agendamentosTotais = await prisma.agendamento.count({ where: { status: 'AGENDADO' } });
        res.status(200).json({ totalLeads, agendamentosTotais });
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar estatísticas neutras do painel." });
    }
};

// MOTOR DE FORMATAÇÃO GLOBAL
exports.formatarSistemaCompleto = async (req, res) => {
    try {
        console.log("⚠️ Iniciando formatação geral do banco de dados...");
        // A ordem aqui é vital para não quebrar as relações de chaves estrangeiras
        await prisma.automacaoHistorico.deleteMany({});
        await prisma.filaAutomacao.deleteMany({});
        await prisma.webhookLog.deleteMany({});
        await prisma.notaInterna.deleteMany({}); 
        await prisma.mensagemIA.deleteMany({});
        await prisma.agendamento.deleteMany({}); 
        await prisma.cliente.deleteMany({});
        
        // Limpa a memória RAM de contexto da IA
        if (botBarbearia.limparMemoriaEstado) botBarbearia.limparMemoriaEstado();
        if (botClinica.limparMemoriaEstado) botClinica.limparMemoriaEstado();

        console.log("✅ Sistema formatado com sucesso.");
        res.status(200).json({ message: "Banco de Dados e Memória da IA formatados com sucesso." });
    } catch (error) {
        console.error("❌ Erro ao Formatar Sistema:", error);
        res.status(500).json({ error: "Erro crítico ao tentar formatar." });
    }
};