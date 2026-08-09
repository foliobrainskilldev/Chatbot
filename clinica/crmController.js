const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const cloudinaryService = require('../services/cloudinaryService');
const { startOfDay, subDays } = require('date-fns');

exports.getDashboardStats = async (req, res) => {
    try {
        const totalLeads = await prisma.cliente.count();
        const agendamentosTotais = await prisma.agendamento.count({ where: { status: 'AGENDADO', tratamentoId: { not: null } } });
        const cancelamentosTotais = await prisma.agendamento.count({ where: { status: 'CANCELADO', tratamentoId: { not: null } } });
        
        const funil = {
            novo: await prisma.cliente.count({ where: { leadStatus: 'NOVO' } }),
            interessado: await prisma.cliente.count({ where: { leadStatus: 'INTERESSADO' } }),
            qualificado: await prisma.cliente.count({ where: { leadStatus: 'QUALIFICADO' } }),
            agendado: await prisma.cliente.count({ where: { leadStatus: 'AGENDADO' } }),
            cliente: await prisma.cliente.count({ where: { leadStatus: 'CLIENTE' } })
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

        const leadsPorDia = [];
        for (let i = 6; i >= 0; i--) {
            const dataBase = subDays(new Date(), i);
            const count = await prisma.cliente.count({
                where: { criadoEm: { gte: startOfDay(dataBase) } }
            });
            leadsPorDia.push({ data: dataBase.toISOString().split('T')[0], count });
        }

        res.status(200).json({ totalLeads, agendamentosTotais, cancelamentosTotais, funil, topServicos, leadsPorDia });
    } catch (error) { 
        console.error("Erro Dashboard:", error);
        res.status(500).json({ error: "Erro interno no dashboard." }); 
    }
};

exports.getLeads = async (req, res) => {
    try {
        const leads = await prisma.cliente.findMany({ orderBy: { ultimaInteracao: 'desc' } });
        res.status(200).json(leads);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar CRM." }); }
};

exports.atualizarStatusLead = async (req, res) => {
    try {
        const { status, tags, valorPotencial } = req.body;
        const lead = await prisma.cliente.update({ 
            where: { id: req.params.id }, 
            data: { leadStatus: status, tags, valorPotencial: parseFloat(valorPotencial) || 0 } 
        });
        res.status(200).json(lead);
    } catch (error) { res.status(500).json({ error: "Erro ao atualizar pipeline." }); }
};

// ==========================================
// FUNÇÃO QUE ESTAVA FALTANDO / CAUSOU O ERRO
// ==========================================
exports.atualizarLeadCompleto = async (req, res) => {
    try {
        const { nome, email, observacoes } = req.body;
        const lead = await prisma.cliente.update({
            where: { id: req.params.id },
            data: { nome, email, observacoes }
        });
        res.status(200).json(lead);
    } catch (error) { 
        res.status(500).json({ error: "Erro ao atualizar ficha do lead." }); 
    }
};
// ==========================================

exports.getConversasPendentes = async (req, res) => {
    try {
        const pendentes = await prisma.cliente.findMany({ 
            orderBy: { ultimaInteracao: 'desc' },
            take: 50
        });
        res.status(200).json(pendentes);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar caixa de entrada." }); }
};

exports.getMensagensConversa = async (req, res) => {
    try {
        const mensagens = await prisma.mensagemIA.findMany({ where: { clienteId: req.params.clienteId }, orderBy: { criadoEm: 'asc' } });
        res.status(200).json(mensagens);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar mensagens." }); }
};

exports.assumirAtendimentoHumano = async (req, res) => {
    try {
        await prisma.cliente.update({ where: { id: req.params.clienteId }, data: { falarHumano: true } });
        res.status(200).json({ message: "Atendimento humano assumido." });
    } catch (error) { res.status(500).json({ error: "Erro ao assumir atendimento." }); }
};

exports.resolverAtendimentoHumano = async (req, res) => {
    try {
        await prisma.cliente.update({ where: { id: req.params.clienteId }, data: { falarHumano: false } });
        res.status(200).json({ message: "Conversa devolvida para a IA." });
    } catch (error) { res.status(500).json({ error: "Erro ao devolver para IA." }); }
};

exports.enviarMensagemManual = async (req, res) => {
    try {
        const { clienteId } = req.params; 
        const texto = req.body.texto || ""; 
        let msgDb = texto;
        let cloudinaryUrl = null;

        if (req.file) {
            const mimeType = req.file.mimetype;
            const resourceType = mimeType.startsWith('image/') ? 'image' : (mimeType.startsWith('video/') ? 'video' : 'raw');
            
            const cloudResult = await cloudinaryService.uploadStream(req.file.buffer, 'clinica/atendimento', resourceType);
            cloudinaryUrl = cloudResult.secure_url;
            
            const typeMsg = mimeType.startsWith('image/') ? 'image' : (mimeType.startsWith('audio/') ? 'audio' : 'document');
            await whatsappService.sendMediaUrl(clienteId, typeMsg, cloudinaryUrl, texto);
            
            msgDb = `[MEDIA:${typeMsg}] ${cloudinaryUrl} | Texto: ${texto}`;
        } else if (texto) { 
            await whatsappService.sendText(clienteId, texto); 
        }
        
        const novaMsg = await prisma.mensagemIA.create({ data: { role: 'assistant', content: msgDb, clienteId, atendenteHumano: true } });
        if (global.io) global.io.emit('nova_mensagem', { clienteId, mensagem: novaMsg });
        res.status(200).json(novaMsg);
    } catch (error) { 
        res.status(500).json({ error: "Erro ao enviar mensagem com mídia." }); 
    }
};

exports.getTratamentos = async (req, res) => {
    try {
        const tratamentos = await prisma.tratamento.findMany();
        res.status(200).json(tratamentos);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar tratamentos." }); }
};

exports.salvarTratamento = async (req, res) => {
    try {
        let imageUrl = req.body.imagemAtual || null;
        if (req.file) {
            const cloudResult = await cloudinaryService.uploadStream(req.file.buffer, 'clinica/tratamentos', 'image');
            imageUrl = cloudResult.secure_url;
        }

        const dados = {
            nome: req.body.nome,
            descricao: req.body.descricao,
            preco: parseFloat(req.body.preco),
            duracaoMin: parseInt(req.body.duracaoMin),
            imagemUrl: imageUrl,
            status: req.body.status || 'ATIVO'
        };

        if (req.body.id) {
            const update = await prisma.tratamento.update({ where: { id: parseInt(req.body.id) }, data: dados });
            return res.status(200).json(update);
        } else {
            const create = await prisma.tratamento.create({ data: dados });
            return res.status(201).json(create);
        }
    } catch (error) { res.status(500).json({ error: "Erro ao salvar tratamento." }); }
};

exports.excluirTratamento = async (req, res) => {
    try {
        await prisma.tratamento.delete({ where: { id: parseInt(req.params.id) } });
        res.status(200).json({ message: "Tratamento removido." });
    } catch (error) { res.status(500).json({ error: "Erro ao excluir." }); }
};

exports.getConfigIA = async (req, res) => {
    try {
        const config = await prisma.configSistema.findFirst();
        res.status(200).json(config);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar config IA." }); }
};

exports.atualizarConfigIA = async (req, res) => {
    try {
        const payload = req.body;
        const config = await prisma.configSistema.update({
            where: { id: 1 },
            data: {
                nomeAssistente: payload.nomeAssistente,
                tomDeVoz: payload.tomDeVoz,
                regrasExtrasIA: payload.regrasExtrasIA,
                faq: payload.faq,
                objetivos: payload.objetivos
            }
        });
        res.status(200).json(config);
    } catch (error) { res.status(500).json({ error: "Erro ao atualizar IA." }); }
};

exports.getAgendamentosTodos = async (req, res) => {
    try {
        const agendamentos = await prisma.agendamento.findMany({ 
            where: { tratamentoId: { not: null } }, 
            include: { cliente: true, tratamento: true, profissionalSaude: true }, 
            orderBy: { dataHora: 'asc' } 
        });
        res.status(200).json(agendamentos);
    } catch (error) { res.status(500).json({ error: "Erro agenda clinica." }); }
};

exports.atualizarStatusAgendamento = async (req, res) => {
    try {
        const att = await prisma.agendamento.update({ where: { id: parseInt(req.params.id) }, data: { status: req.body.status } });
        res.status(200).json(att);
    } catch (error) { res.status(500).json({ error: "Erro atualizar consulta." }); }
};

exports.getEquipe = async (req, res) => {
    try {
        const usuarios = await prisma.usuario.findMany();
        res.status(200).json(usuarios);
    } catch (error) { res.status(500).json({ error: "Erro equipe." }); }
};

exports.criarMembroEquipe = async (req, res) => {
    try {
        const newUser = await prisma.usuario.create({
            data: { nome: req.body.nome, email: req.body.email, senha: req.body.senha, funcao: req.body.funcao, status: 'ONLINE' }
        });
        res.status(201).json(newUser);
    } catch (error) { res.status(500).json({ error: "Erro ao criar membro." }); }
};

exports.deletarMembroEquipe = async (req, res) => {
    try {
        await prisma.usuario.delete({ where: { id: parseInt(req.params.id) } });
        res.status(200).json({ message: "Membro deletado." });
    } catch (error) { res.status(500).json({ error: "Erro ao deletar." }); }
};