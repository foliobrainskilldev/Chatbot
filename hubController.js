const { prisma } = require('./db');

exports.getConfigSistema = async (req, res) => {
    try {
        const config = await prisma.configSistema.findFirst();
        res.status(200).json(config || {});
    } catch (e) {
        res.status(500).json({ error: "Erro ao buscar configurações no banco central." });
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
                nomeAssistente: d.nomeAssistente,
                tomDeVoz: d.tomDeVoz, 
                objetivos: d.objetivos, 
                regrasExtrasIA: d.regrasExtrasIA, 
                faq: d.faq,
                ignorarDiagnosticos: d.ignorarDiagnosticos || false, 
                regrasTransferencia: d.regrasTransferencia,
                notificarNovosLeads: d.notificarNovosLeads, 
                autoFollowUp: d.autoFollowUp,
                autoLembrete: d.autoLembrete, 
                distribuicaoLeads: d.distribuicaoLeads,
                webhookUrl: d.webhookUrl, 
                metaToken: d.metaToken
            }
        });
        res.status(200).json({ message: "Configurações Globais salvas com sucesso." });
    } catch (e) {
        res.status(500).json({ error: "Erro ao atualizar configurações centrais." });
    }
};

exports.getHubStats = async (req, res) => {
    try {
        // Estatísticas básicas para o Hub Neutro apenas para exibir a vida do sistema
        const totalLeads = await prisma.cliente.count();
        const agendamentosTotais = await prisma.agendamento.count({ where: { status: 'AGENDADO' } });
        res.status(200).json({ totalLeads, agendamentosTotais });
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar estatísticas neutras do painel." });
    }
};