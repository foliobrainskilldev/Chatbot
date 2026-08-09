const { prisma } = require('../db'); // Sobe um nível para pegar o DB
const whatsappService = require('../whatsappService');
const { startOfDay, endOfDay, subDays, format } = require('date-fns');

exports.getDashboardStats = async (req, res) => {
    try {
        const totalLeads = await prisma.cliente.count();
        // Filtro ISOLADO: Conta apenas agendamentos da Barbearia (que possuem servicoId)
        const agendamentosTotais = await prisma.agendamento.count({ 
            where: { status: 'AGENDADO', servicoId: { not: null } } 
        });
        const cancelamentosTotais = await prisma.agendamento.count({ 
            where: { status: 'CANCELADO', servicoId: { not: null } } 
        });
        
        const funil = {
            novos: await prisma.cliente.count({ where: { leadStatus: 'NOVO' } }),
            emConversa: await prisma.cliente.count({ where: { leadStatus: 'EM_CONVERSA' } }),
            qualificados: await prisma.cliente.count({ where: { leadStatus: 'QUALIFICADO' } }),
            agendados: await prisma.cliente.count({ where: { leadStatus: 'AGENDADO' } }),
        };

        const topServicosAg = await prisma.agendamento.groupBy({
            by: ['servicoId'], _count: { servicoId: true }, 
            where: { servicoId: { not: null } }, 
            orderBy: { _count: { servicoId: 'desc' } }, take: 5
        });

        let topServicos = [];
        for (let s of topServicosAg) {
            const servDb = await prisma.servico.findUnique({ where: { id: s.servicoId } });
            if (servDb) topServicos.push({ nome: servDb.nome, count: s._count.servicoId });
        }

        res.status(200).json({ totalLeads, agendamentosTotais, cancelamentosTotais, funil, topServicos });
    } catch (error) {
        res.status(500).json({ error: "Erro ao processar estatísticas da barbearia." });
    }
};

exports.getAgendamentosTodos = async (req, res) => {
    try {
        // ISOLAMENTO: Puxa apenas a agenda de serviços (Barbearia)
        const agendamentos = await prisma.agendamento.findMany({ 
            where: { servicoId: { not: null } },
            include: { cliente: true, servico: true, barbeiro: true }, 
            orderBy: { dataHora: 'asc' } 
        });
        res.status(200).json(agendamentos);
    } catch (error) {
        res.status(500).json({ error: "Erro ao puxar dados do calendário da barbearia." });
    }
};

// Reutiliza as lógicas de chat e leads (pois o WhatsApp é o mesmo)
exports.getLeads = async (req, res) => {
    const leads = await prisma.cliente.findMany({ include: { responsavel: true }, orderBy: { ultimaInteracao: 'desc' } });
    res.status(200).json(leads);
};

exports.atualizarStatusLead = async (req, res) => {
    const { status, tags, valorPotencial } = req.body;
    const lead = await prisma.cliente.update({ 
        where: { id: req.params.id }, 
        data: { leadStatus: status, tags, valorPotencial } 
    });
    res.status(200).json(lead);
};

exports.getConversasPendentes = async (req, res) => {
    const pendentes = await prisma.cliente.findMany({ where: { falarHumano: true }, orderBy: { ultimaInteracao: 'desc' } });
    res.status(200).json(pendentes);
};

exports.getMensagensConversa = async (req, res) => {
    const mensagens = await prisma.mensagemIA.findMany({ where: { clienteId: req.params.clienteId }, orderBy: { criadoEm: 'asc' } });
    res.status(200).json(mensagens);
};

exports.enviarMensagemManual = async (req, res) => {
    const { clienteId } = req.params; 
    const texto = req.body.texto || ""; 
    await whatsappService.sendText(clienteId, texto);
    const novaMsg = await prisma.mensagemIA.create({ data: { role: 'assistant', content: texto, clienteId } });
    if (global.io) global.io.emit('nova_mensagem', { clienteId, mensagem: novaMsg });
    res.status(200).json(novaMsg);
};

exports.atualizarStatusAgendamento = async (req, res) => {
    const att = await prisma.agendamento.update({ where: { id: parseInt(req.params.id) }, data: { status: req.body.status } });
    res.status(200).json(att);
};

// Outros endpoints omitidos por brevidade (equipe, etc, mantêm a mesma estrutura limpa)