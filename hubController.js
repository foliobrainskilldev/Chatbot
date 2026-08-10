// --- START OF FILE hubController.js ---

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

// Nova Função ISOLADA apenas para o Motor (Evita apagar outras configs de IA acidentalmente)
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

exports.formatarSistemaCompleto = async (req, res) => {
    try {
        await prisma.notaInterna.deleteMany({}); 
        await prisma.mensagemIA.deleteMany({});
        await prisma.agendamento.deleteMany({}); 
        await prisma.cliente.deleteMany({});
        
        if (botBarbearia.limparMemoriaEstado) botBarbearia.limparMemoriaEstado();
        if (botClinica.limparMemoriaEstado) botClinica.limparMemoriaEstado();

        res.status(200).json({ message: "O Sistema foi completamente formatado." });
    } catch (error) {
        console.error("Erro Hub Formatar:", error);
        res.status(500).json({ error: "Erro interno crasso ao tentar formatar." });
    }
};