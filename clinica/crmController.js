const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const { startOfDay, format } = require('date-fns');

exports.getDashboardStats = async (req, res) => {
    try {
        const totalLeads = await prisma.cliente.count();
        const agendamentosTotais = await prisma.agendamento.count({ where: { status: 'AGENDADO', tratamentoId: { not: null } } });
        const cancelamentosTotais = await prisma.agendamento.count({ where: { status: 'CANCELADO', tratamentoId: { not: null } } });
        
        const funil = {
            novos: await prisma.cliente.count({ where: { leadStatus: 'NOVO' } }),
            agendados: await prisma.cliente.count({ where: { leadStatus: 'AGENDADO' } }),
        };

        const topTratamentosAg = await prisma.agendamento.groupBy({
            by: ['tratamentoId'], _count: { tratamentoId: true }, 
            where: { tratamentoId: { not: null } }, 
            orderBy: { _count: { tratamentoId: 'desc' } }, take: 5
        });

        let topServicos = [];
        for (let t of topTratamentosAg) {
            const tratDb = await prisma.tratamento.findUnique({ where: { id: t.tratamentoId } });
            if (tratDb) topServicos.push({ nome: tratDb.nome, count: t._count.tratamentoId });
        }

        res.status(200).json({ totalLeads, agendamentosTotais, cancelamentosTotais, funil, topServicos });
    } catch (error) { res.status(500).json({ error: "Erro dashboard clinica." }); }
};

exports.getEquipe = async (req, res) => {
    try {
        const usuarios = await prisma.usuario.findMany();
        res.status(200).json(usuarios);
    } catch (error) { res.status(500).json({ error: "Erro equipe." }); }
};

exports.getLeads = async (req, res) => {
    try {
        const leads = await prisma.cliente.findMany({ orderBy: { ultimaInteracao: 'desc' } });
        res.status(200).json(leads);
    } catch (error) { res.status(500).json({ error: "Erro leads clinica." }); }
};

exports.atualizarStatusLead = async (req, res) => {
    try {
        const { status, tags } = req.body;
        const lead = await prisma.cliente.update({ where: { id: req.params.id }, data: { leadStatus: status, tags } });
        res.status(200).json(lead);
    } catch (error) { res.status(500).json({ error: "Erro atualizar paciente." }); }
};

exports.getConversasPendentes = async (req, res) => {
    try {
        const pendentes = await prisma.cliente.findMany({ where: { falarHumano: true }, orderBy: { ultimaInteracao: 'desc' } });
        res.status(200).json(pendentes);
    } catch (error) { res.status(500).json({ error: "Erro pendentes clinica." }); }
};

exports.getMensagensConversa = async (req, res) => {
    try {
        const mensagens = await prisma.mensagemIA.findMany({ where: { clienteId: req.params.clienteId }, orderBy: { criadoEm: 'asc' } });
        res.status(200).json(mensagens);
    } catch (error) { res.status(500).json({ error: "Erro mensagens clinica." }); }
};

exports.enviarMensagemManual = async (req, res) => {
    try {
        const { clienteId } = req.params; 
        const texto = req.body.texto || ""; 
        let msgDb = texto;

        if (req.file) {
            const mimeType = req.file.mimetype; 
            const type = mimeType.startsWith('image/') ? 'image' : (mimeType.startsWith('video/') ? 'video' : 'document');
            const mediaId = await whatsappService.uploadMediaToMeta(req.file.path, mimeType);
            if (mediaId) {
                await whatsappService.sendMediaMessage(clienteId, type, mediaId, texto); 
                msgDb = `[MEDIA:${type}] /${req.file.path} | Transcrição: ${texto}`; 
            }
        } else if (texto) { 
            await whatsappService.sendText(clienteId, texto); 
        }
        
        const novaMsg = await prisma.mensagemIA.create({ data: { role: 'assistant', content: msgDb, clienteId } });
        if (global.io) global.io.emit('nova_mensagem', { clienteId, mensagem: novaMsg });
        res.status(200).json(novaMsg);
    } catch (error) { res.status(500).json({ error: "Erro enviar clinica." }); }
};

exports.resolverAtendimentoHumano = async (req, res) => {
    try {
        await prisma.cliente.update({ where: { id: req.params.clienteId }, data: { falarHumano: false, leadStatus: 'ATENDIDO' } });
        await whatsappService.sendText(req.params.clienteId, "Atendimento com a recepção encerrado. O bot está ativo novamente.");
        if (global.io) global.io.emit('atualizar_fila');
        res.status(200).json({ message: "Resolvido." });
    } catch (error) { res.status(500).json({ error: "Erro resolver clinica." }); }
};

exports.getAgendamentosTodos = async (req, res) => {
    try {
        const agendamentos = await prisma.agendamento.findMany({ where: { tratamentoId: { not: null } }, include: { cliente: true, tratamento: true, profissionalSaude: true }, orderBy: { dataHora: 'asc' } });
        res.status(200).json(agendamentos);
    } catch (error) { res.status(500).json({ error: "Erro agenda clinica." }); }
};

exports.atualizarStatusAgendamento = async (req, res) => {
    try {
        const att = await prisma.agendamento.update({ where: { id: parseInt(req.params.id) }, data: { status: req.body.status } });
        res.status(200).json(att);
    } catch (error) { res.status(500).json({ error: "Erro atualizar consulta." }); }
};