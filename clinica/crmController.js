const { prisma } = require('../db');
const whatsappService = require('../whatsappService');

exports.getDashboardStats = async (req, res) => {
    try {
        const totalLeads = await prisma.cliente.count();
        // Filtro ISOLADO: Conta apenas agendamentos da Clínica (que possuem tratamentoId)
        const agendamentosTotais = await prisma.agendamento.count({ 
            where: { status: 'AGENDADO', tratamentoId: { not: null } } 
        });
        const cancelamentosTotais = await prisma.agendamento.count({ 
            where: { status: 'CANCELADO', tratamentoId: { not: null } } 
        });
        
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
    } catch (error) {
        res.status(500).json({ error: "Erro ao processar estatísticas da clínica médica." });
    }
};

exports.getAgendamentosTodos = async (req, res) => {
    try {
        // ISOLAMENTO: Puxa apenas a agenda de Clínica
        const agendamentos = await prisma.agendamento.findMany({ 
            where: { tratamentoId: { not: null } },
            include: { cliente: true, tratamento: true, profissionalSaude: true }, 
            orderBy: { dataHora: 'asc' } 
        });
        res.status(200).json(agendamentos);
    } catch (error) {
        res.status(500).json({ error: "Erro ao puxar dados do calendário clínico." });
    }
};

// Para as conversas e leads (os endpoints base repetem os mesmos do outro, já que o WhatsApp é a mesma porta de entrada)
exports.getLeads = async (req, res) => {
    const leads = await prisma.cliente.findMany({ orderBy: { ultimaInteracao: 'desc' } });
    res.status(200).json(leads);
};

exports.atualizarStatusLead = async (req, res) => {
    const lead = await prisma.cliente.update({ where: { id: req.params.id }, data: req.body });
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
    res.status(200).json({ success: true });
};

exports.atualizarStatusAgendamento = async (req, res) => {
    const att = await prisma.agendamento.update({ where: { id: parseInt(req.params.id) }, data: { status: req.body.status } });
    res.status(200).json(att);
};