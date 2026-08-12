const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const supabaseService = require('../services/supabaseService');
const { startOfDay, endOfDay, subDays, format } = require('date-fns');
const botEngine = require('./botEngine');

exports.getDashboardStats = async (req, res) => {
    try {
        const totalLeads = await prisma.cliente.count();
        const agendamentosTotais = await prisma.agendamento.count({ where: { status: 'AGENDADO', servicoId: { not: null } } });
        const cancelamentosTotais = await prisma.agendamento.count({ where: { status: 'CANCELADO', servicoId: { not: null } } });
        
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
        res.status(500).json({ error: "Erro ao processar estatísticas." });
    }
};

exports.getEquipe = async (req, res) => {
    try {
        const usuarios = await prisma.usuario.findMany();
        res.status(200).json(usuarios);
    } catch (error) { res.status(500).json({ error: "Erro ao listar equipe." }); }
};

exports.criarMembroEquipe = async (req, res) => {
    try {
        const newUser = await prisma.usuario.create({
            data: { nome: req.body.nome, email: req.body.email, senha: req.body.senha, funcao: req.body.funcao, status: 'ONLINE' }
        });
        res.status(200).json(newUser);
    } catch (error) { res.status(500).json({ error: "Erro ao criar membro." }); }
};

exports.deletarMembroEquipe = async (req, res) => {
    try {
        await prisma.usuario.delete({ where: { id: parseInt(req.params.id) } });
        res.status(200).json({ message: "Membro deletado." });
    } catch (error) { res.status(500).json({ error: "Erro ao deletar." }); }
};

exports.getLeads = async (req, res) => {
    try {
        const leads = await prisma.cliente.findMany({ include: { responsavel: true }, orderBy: { ultimaInteracao: 'desc' } });
        res.status(200).json(leads);
    } catch (error) { res.status(500).json({ error: "Erro ao listar leads." }); }
};

exports.atualizarStatusLead = async (req, res) => {
    try {
        const { status, tags, valorPotencial } = req.body;
        const leadAlterado = await prisma.cliente.update({ 
            where: { id: req.params.id }, 
            data: { leadStatus: status, tags, valorPotencial } 
        });
        res.status(200).json(leadAlterado);
    } catch (error) { res.status(500).json({ error: "Erro ao atualizar lead." }); }
};

exports.getConversasPendentes = async (req, res) => {
    try {
        const pendentes = await prisma.cliente.findMany({ where: { falarHumano: true }, orderBy: { ultimaInteracao: 'desc' } });
        res.status(200).json(pendentes);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar fila." }); }
};

exports.getMensagensConversa = async (req, res) => {
    try {
        const mensagens = await prisma.mensagemIA.findMany({ where: { clienteId: req.params.clienteId }, orderBy: { criadoEm: 'asc' } });
        res.status(200).json(mensagens);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar chat." }); }
};

exports.getNotasInternas = async (req, res) => {
    try {
        const notas = await prisma.notaInterna.findMany({ where: { clienteId: req.params.clienteId }, include: { usuario: true }, orderBy: { criadoEm: 'desc' } });
        res.status(200).json(notas);
    } catch (error) { res.status(500).json({ error: "Erro notas." }); }
};

exports.criarNotaInterna = async (req, res) => {
    try {
        const nota = await prisma.notaInterna.create({ data: { texto: req.body.texto, clienteId: req.params.clienteId, usuarioId: req.body.usuarioId || 1 } });
        res.status(200).json(nota);
    } catch (error) { res.status(500).json({ error: "Erro criar nota." }); }
};

exports.enviarMensagemManual = async (req, res) => {
    try {
        const { clienteId } = req.params; 
        const texto = req.body.texto || ""; 
        let msgDb = texto;
        let supabaseUrl = null;
        let typeMsg = null;

        await whatsappService.markAsReadAndTyping(null, clienteId);
        await new Promise(r => setTimeout(r, 1000)); 

        if (req.file) {
            const mimeType = req.file.mimetype; 
            const isBrowserAudio = req.file.originalname === 'audio_record.ogg';
            const isAudio = mimeType.startsWith('audio/') || isBrowserAudio;
            
            const resourceType = mimeType.startsWith('image/') ? 'image' : (isAudio ? 'audio' : (mimeType.startsWith('video/') ? 'video' : 'raw'));
            
            const cloudResult = await supabaseService.uploadStream(req.file.buffer, 'barbearia/atendimento', resourceType);
            supabaseUrl = cloudResult.secure_url;
            
            // CORREÇÃO: Tratativa da Meta API.
            let waSendType = mimeType.startsWith('image/') ? 'image' : (isAudio ? 'audio' : (mimeType.startsWith('video/') ? 'video' : 'document'));
            typeMsg = waSendType;
            
            let filename = isBrowserAudio ? "Mensagem_de_Voz.ogg" : null;

            if (waSendType === 'audio') {
                await whatsappService.sendMediaUrl(clienteId, waSendType, supabaseUrl, "", filename);
                if (texto) {
                    await whatsappService.sendText(clienteId, texto);
                }
            } else {
                await whatsappService.sendMediaUrl(clienteId, waSendType, supabaseUrl, texto, filename);
            }

            msgDb = `[MEDIA:${typeMsg}] ${supabaseUrl} | Transcrição: ${texto}`; 
        } else if (texto) { 
            await whatsappService.sendText(clienteId, texto); 
        }
        
        const novaMsg = await prisma.mensagemIA.create({ data: { role: 'assistant', content: msgDb, clienteId, atendenteHumano: true } });
        if (global.io) global.io.emit('nova_mensagem', { clienteId, mensagem: novaMsg });
        res.status(200).json(novaMsg);
    } catch (error) { res.status(500).json({ error: "Erro ao enviar mensagem manual." }); }
};

exports.resolverAtendimentoHumano = async (req, res) => {
    try {
        await prisma.cliente.update({ where: { id: req.params.clienteId }, data: { falarHumano: false, leadStatus: 'ATENDIDO' } });
        await whatsappService.sendText(req.params.clienteId, "O seu atendimento humano foi encerrado. O assistente virtual foi reativado.");
        if (global.io) global.io.emit('atualizar_fila');
        res.status(200).json({ message: "Resolvido." });
    } catch (error) { res.status(500).json({ error: "Erro resolver chat." }); }
};

exports.getAgendamentosTodos = async (req, res) => {
    try {
        const agendamentos = await prisma.agendamento.findMany({ where: { servicoId: { not: null } }, include: { cliente: true, servico: true, barbeiro: true }, orderBy: { dataHora: 'asc' } });
        res.status(200).json(agendamentos);
    } catch (error) { res.status(500).json({ error: "Erro agenda." }); }
};

exports.getAgendamentosHoje = async (req, res) => {
    try {
        const hoje = await prisma.agendamento.findMany({ where: { status: 'AGENDADO', servicoId: { not: null }, dataHora: { gte: startOfDay(new Date()) } }, include: { cliente: true, servico: true, barbeiro: true }, orderBy: { dataHora: 'asc' } });
        res.status(200).json(hoje);
    } catch (error) { res.status(500).json({ error: "Erro agenda hoje." }); }
};

exports.atualizarStatusAgendamento = async (req, res) => {
    try {
        const att = await prisma.agendamento.update({ where: { id: parseInt(req.params.id) }, data: { status: req.body.status } });
        res.status(200).json(att);
    } catch (error) { res.status(500).json({ error: "Erro att status." }); }
};

exports.formatarSistema = async (req, res) => {
    try {
        await prisma.notaInterna.deleteMany({}); 
        await prisma.mensagemIA.deleteMany({});
        await prisma.agendamento.deleteMany({}); 
        await prisma.cliente.deleteMany({});
        botEngine.limparMemoriaEstado();
        res.status(200).json({ message: "Memória formatada!" });
    } catch (error) { res.status(500).json({ error: "Erro formatar." }); }
};