const { prisma } = require('../db');
const supabaseService = require('../services/supabaseService');
const botEngine = require('./botEngine');

exports.getConfigCompleta = async (req, res) => {
    try {
        const config = await prisma.configSistema.findUnique({ where: { id: 1 } });
        res.status(200).json(config);
    } catch (error) {
        console.error("Erro ao buscar configurações completas:", error);
        res.status(500).json({ error: "Erro ao buscar configurações do sistema." });
    }
};

exports.atualizarConfigCompleta = async (req, res) => {
    try {
        const data = req.body;
        let logoNovaUrl = data.logoUrl || null;
        
        if (req.file) {
            const cloudResult = await supabaseService.uploadStream(req.file.buffer, 'clinica/config', 'image');
            logoNovaUrl = cloudResult.secure_url;
        }

        const updateData = {
            nomeClinica: data.nomeClinica,
            nomeComercial: data.nomeComercial,
            telefone: data.telefone,
            whatsapp: data.whatsapp,
            email: data.email,
            endereco: data.endereco,
            cidade: data.cidade,
            pais: data.pais,
            fusoHorario: data.fusoHorario,
            moeda: data.moeda,
            site: data.site,
            
            agendamentoConfirmacao: data.agendamentoConfirmacao === 'true',
            agendamentoCancWhatsapp: data.agendamentoCancWhatsapp === 'true',
            iaAtiva: data.iaAtiva === 'true',
            iaTransferenciaAuto: data.iaTransferenciaAuto === 'true',
            
            responsavelPadrao: data.responsavelPadrao ? parseInt(data.responsavelPadrao) : null,
            agendamentoTempoMinCanc: parseInt(data.agendamentoTempoMinCanc) || 24,
            agendamentoTempoMinRemar: parseInt(data.agendamentoTempoMinRemar) || 24,
            agendamentoDuracaoPadrao: parseInt(data.agendamentoDuracaoPadrao) || 30,
            agendamentoIntervalo: parseInt(data.agendamentoIntervalo) || 0,
            agendamentoAntecedencia: parseInt(data.agendamentoAntecedencia) || 720,
            agendamentoLimiteSimultaneo: parseInt(data.agendamentoLimiteSimultaneo) || 2,
            segurancaTempoSessao: parseInt(data.segurancaTempoSessao) || 24,
            interfaceItensPagina: parseInt(data.interfaceItensPagina) || 20,
            dadosRetencaoConversas: parseInt(data.dadosRetencaoConversas) || 365,
            dadosRetencaoArquivos: parseInt(data.dadosRetencaoArquivos) || 365,
            iaTempoInatividade: parseInt(data.iaTempoInatividade) || 15,
            
            distribuicaoLeads: data.distribuicaoLeads,
            seguranca2FA: data.seguranca2FA,
            interfaceTema: data.interfaceTema,
            interfaceIdioma: data.interfaceIdioma,
            cloudinaryFolder: data.storageFolder || data.cloudinaryFolder
        };

        if (data.horarioFuncionamento) updateData.horarioFuncionamento = data.horarioFuncionamento;
        if (data.redesSociais) updateData.redesSociais = data.redesSociais;
        if (data.pipelineEtapas) updateData.pipelineEtapas = data.pipelineEtapas;
        if (data.notificacoesConfig) updateData.notificacoesConfig = data.notificacoesConfig;

        if (logoNovaUrl && logoNovaUrl !== 'null') {
            updateData.logoUrl = logoNovaUrl;
        }

        const config = await prisma.configSistema.update({
            where: { id: 1 },
            data: updateData
        });

        await prisma.atividadeEquipe.create({
            data: {
                usuarioId: 1, 
                acao: 'Configuração Atualizada',
                recurso: 'Sistema Global',
                detalhes: 'Parâmetros administrativos alterados via painel.'
            }
        });

        res.status(200).json(config);
    } catch (error) {
        console.error("Erro update config:", error);
        res.status(500).json({ error: "Erro ao atualizar configurações." });
    }
};

exports.testSupabase = async (req, res) => {
    try {
        const supabaseUrl = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.trim() : null;
        const supabaseKey = process.env.SUPABASE_KEY ? process.env.SUPABASE_KEY.trim() : null;
        const hasSupabase = !!(supabaseUrl && supabaseKey);
        res.status(200).json({ success: hasSupabase });
    } catch (error) {
        res.status(500).json({ error: "Erro ao testar Supabase." });
    }
};

// FORMATAÇÃO DO SISTEMA CLÍNICA
exports.formatarSistemaClinica = async (req, res) => {
    try {
        await prisma.automacaoHistorico.deleteMany({});
        await prisma.filaAutomacao.deleteMany({});
        await prisma.webhookLog.deleteMany({});
        await prisma.notaInterna.deleteMany({}); 
        await prisma.mensagemIA.deleteMany({});
        await prisma.agendamento.deleteMany({}); 
        await prisma.cliente.deleteMany({});
        
        botEngine.limparMemoriaEstado();

        res.status(200).json({ message: "O banco de dados do CRM foi formatado e reiniciado com sucesso." });
    } catch (error) {
        res.status(500).json({ error: "Erro ao formatar os dados." });
    }
};