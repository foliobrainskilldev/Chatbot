const { prisma } = require('../../db');
const whatsappService = require('../../whatsappService');
const supabaseService = require('../../services/supabaseService');
const automationEngine = require('../../services/automationEngine');
const webhookService = require('../../services/webhookService');
const { getHorariosDisponiveis } = require('../../dateUtils'); 
const { startOfDay, endOfDay } = require('date-fns');

exports.getAgendamentosTodos = async (req, res) => {
    try {
        const { data, status, profissionalId, tratamentoId, search } = req.query;
        const where = { tratamentoId: { not: null } };
        
        if (status) where.status = status;
        if (profissionalId) where.profissionalSaudeId = parseInt(profissionalId);
        if (tratamentoId) where.tratamentoId = parseInt(tratamentoId);
        if (data) {
            const dataFiltro = new Date(data);
            where.dataHora = { gte: startOfDay(dataFiltro), lte: endOfDay(dataFiltro) };
        }
        if (search) where.cliente = { OR: [{ nome: { contains: search, mode: 'insensitive' } }, { id: { contains: search } }] };

        const agendamentos = await prisma.agendamento.findMany({ 
            where, include: { cliente: true, tratamento: true, profissionalSaude: true }, orderBy: { dataHora: 'asc' } 
        });

        const statsBase = await prisma.agendamento.findMany({ where: { tratamentoId: { not: null } }, select: { status: true, dataHora: true } });
        const inicioHoje = startOfDay(new Date());
        const fimHoje = endOfDay(new Date());

        const stats = {
            hoje: statsBase.filter(a => a.dataHora >= inicioHoje && a.dataHora <= fimHoje).length,
            confirmadas: statsBase.filter(a => a.status === 'CONFIRMADA').length,
            pendentes: statsBase.filter(a => a.status === 'PENDENTE' || a.status === 'AGENDADO').length, 
            canceladas: statsBase.filter(a => a.status === 'CANCELADA').length,
            realizadas: statsBase.filter(a => a.status === 'REALIZADA' || a.status === 'CONCLUIDO').length,
            faltas: statsBase.filter(a => a.status === 'FALTA').length
        };

        res.status(200).json({ data: agendamentos, stats });
    } catch (error) { res.status(500).json({ error: "Erro agenda." }); }
};

exports.criarAgendamentoManual = async (req, res) => {
    try {
        const { clienteId, tratamentoId, profissionalSaudeId, dataHora, observacoes } = req.body;
        
        // CORREÇÃO DO FUSO HORÁRIO NO AGENDAMENTO MANUAL
        const configDb = await prisma.configSistema.findFirst();
        const fusoOffset = configDb?.fusoHorario === 'America/Sao_Paulo' ? '-03:00' : '+02:00';
        const dataOriginal = new Date(`${dataHora}${fusoOffset}`);
        
        const trat = await prisma.tratamento.findUnique({ where: { id: parseInt(tratamentoId) } });
        if (trat && trat.preco) {
            const cli = await prisma.cliente.findUnique({ where: { id: clienteId } });
            if (cli && (!cli.valorPotencial || cli.valorPotencial === 0)) {
                await prisma.cliente.update({ where: { id: clienteId }, data: { valorPotencial: trat.preco } });
            }
        }

        const novoAgendamento = await prisma.agendamento.create({
            data: {
                dataHora: dataOriginal, clienteId, status: 'CONFIRMADA', 
                tratamentoId: parseInt(tratamentoId), profissionalSaudeId: profissionalSaudeId ? parseInt(profissionalSaudeId) : null, observacoes: observacoes || ""
            },
            include: { cliente: true, tratamento: true, profissionalSaude: true }
        });
        
        // Exibição na moeda / horário local na mensagem do whatsapp
        const formatterData = new Intl.DateTimeFormat('pt-BR', { timeZone: configDb?.fusoHorario || 'Africa/Maputo', year: 'numeric', month: '2-digit', day: '2-digit' });
        const formatterHora = new Intl.DateTimeFormat('pt-BR', { timeZone: configDb?.fusoHorario || 'Africa/Maputo', hour: '2-digit', minute: '2-digit', hour12: false });
        
        const dataStr = formatterData.format(dataOriginal);
        const horaStr = formatterHora.format(dataOriginal);
        
        const msg = `Sua consulta para *${novoAgendamento.tratamento.nome}* foi agendada para ${dataStr} às ${horaStr}.`;
        
        await whatsappService.sendText(clienteId, msg);
        await prisma.mensagemIA.create({ data: { role: 'assistant', content: `[SISTEMA AUTOMÁTICO] ${msg}`, clienteId, atendenteHumano: false } });
        
        await prisma.cliente.update({ where: { id: clienteId }, data: { leadStatus: 'AGENDADO' } });
        
        await automationEngine.dispararAutomacoes('CONSULTA_CONFIRMADA', novoAgendamento);
        await webhookService.dispararEvento('appointment.created', novoAgendamento); 

        res.status(201).json(novoAgendamento);
    } catch (error) { res.status(500).json({ error: "Erro criar agendamento." }); }
};

exports.getHorariosLivresApi = async (req, res) => {
    try {
        const { data, tratamentoId, profissionalId } = req.query; 
        if (!data || !tratamentoId) return res.status(400).json({ error: "Faltam parâmetros" });
        const tratamentoDb = await prisma.tratamento.findUnique({ where: { id: parseInt(tratamentoId) } });
        if(!tratamentoDb) return res.status(404).json({ error: "Tratamento inválido" });
        const duracao = tratamentoDb.duracaoMin || 30;
        const profId = profissionalId ? parseInt(profissionalId) : null;
        const horarios = await getHorariosDisponiveis(data, duracao, profId);
        res.status(200).json(horarios);
    } catch (error) { res.status(500).json({ error: "Falha leitura agenda." }); }
};

exports.atualizarStatusAgendamento = async (req, res) => {
    try {
        const { status } = req.body;
        const att = await prisma.agendamento.update({ 
            where: { id: parseInt(req.params.id) }, data: { status }, include: { cliente: true, tratamento: true, profissionalSaude: true }
        });
        
        await webhookService.dispararEvento('appointment.updated', att);

        if (status === 'CONFIRMADA' || status === 'AGENDADO') {
            await automationEngine.dispararAutomacoes('CONSULTA_CONFIRMADA', att); 
        } 
        else if (status === 'REALIZADA' || status === 'CONCLUIDO') {
            await prisma.cliente.update({
                where: { id: att.clienteId },
                data: { leadStatus: 'CLIENTE' }
            });

            await automationEngine.dispararAutomacoes('CONSULTA_REALIZADA', att); 
            await webhookService.dispararEvento('appointment.completed', att); 
        } 
        else if (status === 'CANCELADA') {
            await whatsappService.sendText(att.clienteId, `Sua consulta foi cancelada. Se foi um erro, entre em contato.`);
            await automationEngine.dispararAutomacoes('CONSULTA_CANCELADA', att); 
            await webhookService.dispararEvento('appointment.cancelled', att); 
        } 
        else if (status === 'FALTA') {
            await automationEngine.dispararAutomacoes('PACIENTE_FALTOU', att); 
        }
        
        res.status(200).json(att);
    } catch (error) { res.status(500).json({ error: "Erro atualizar consulta." }); }
};

exports.getTratamentos = async (req, res) => {
    try {
        const tratamentos = await prisma.tratamento.findMany({ include: { profissionais: true }, orderBy: { nome: 'asc' } });
        res.status(200).json(tratamentos);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar tratamentos." }); }
};

exports.salvarTratamento = async (req, res) => {
    try {
        let imageUrl = req.body.imagemAtual || null;
        if (req.file) {
            const cloudResult = await supabaseService.uploadStream(req.file.buffer, 'clinica/tratamentos', 'image');
            imageUrl = cloudResult.secure_url;
        }

        let profIds = [];
        if (req.body.profissionais) {
            try { profIds = JSON.parse(req.body.profissionais).map(id => ({ id: parseInt(id) })); } 
            catch (e) {}
        }

        const dadosBase = {
            nome: req.body.nome, 
            categoria: req.body.categoria || 'Outros', 
            tipoPreco: req.body.tipoPreco || 'FIXO',
            preco: (req.body.preco && !isNaN(parseFloat(req.body.preco))) ? parseFloat(req.body.preco) : null, 
            duracaoMin: (req.body.duracaoMin && !isNaN(parseInt(req.body.duracaoMin))) ? parseInt(req.body.duracaoMin) : 30,
            descricaoCurta: req.body.descricaoCurta || '', 
            informacoesIA: req.body.informacoesIA || '', 
            faq: req.body.faq || '',
            regrasIA: req.body.regrasIA || '', 
            podeAgendarIA: req.body.podeAgendarIA === 'true', 
            status: req.body.status || 'ATIVO',
            imagemUrl: imageUrl
        };

        if (req.body.id && req.body.id !== 'undefined' && req.body.id !== '') {
            const update = await prisma.tratamento.update({ 
                where: { id: parseInt(req.body.id) }, 
                data: { ...dadosBase, profissionais: { set: profIds } }, include: { profissionais: true }
            });
            return res.status(200).json(update);
        } else {
            const create = await prisma.tratamento.create({ 
                data: { ...dadosBase, profissionais: { connect: profIds } }, include: { profissionais: true }
            });
            return res.status(201).json(create);
        }
    } catch (error) { 
        res.status(500).json({ error: "Erro ao salvar tratamento. " + error.message }); 
    }
};

exports.excluirTratamento = async (req, res) => {
    try {
        await prisma.tratamento.delete({ where: { id: parseInt(req.params.id) } });
        res.status(200).json({ message: "Tratamento removido." });
    } catch (error) { res.status(500).json({ error: "Erro ao excluir." }); }
};