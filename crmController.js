const fs = require('fs');
const path = require('path');
const { startOfDay, endOfDay, subDays, format } = require('date-fns');
const { prisma } = require('./db');
const whatsappService = require('./whatsappService');
const botEngine = require('./botEngine');

const settingsPath = path.join(__dirname, 'settings.json');

exports.getSettings = (req, res) => {
    try {
        if (!fs.existsSync(settingsPath)) {
            return res.status(200).json({ botAtivo: true, diasTrabalho: [1, 2, 3, 4, 5, 6], horaInicio: "09:00", horaFim: "19:00" });
        }
        res.status(200).json(JSON.parse(fs.readFileSync(settingsPath, 'utf8')));
    } catch (e) {
        res.status(500).json({ error: "Erro ao ler configurações do arquivo." });
    }
};

exports.saveSettings = (req, res) => {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(req.body, null, 2));
        res.status(200).json({ message: "Configurações salvas com sucesso." });
    } catch (e) {
        res.status(500).json({ error: "Erro ao salvar configurações no arquivo." });
    }
};

exports.getDashboardStats = async (req, res) => {
    try {
        const totalLeads = await prisma.cliente.count();
        const leadsHoje = await prisma.cliente.count({ where: { criadoEm: { gte: startOfDay(new Date()) } } });
        const agendamentosTotais = await prisma.agendamento.count({ where: { status: 'AGENDADO' } });
        const cancelamentosTotais = await prisma.agendamento.count({ where: { status: 'CANCELADO' } });
        
        const funil = {
            novos: await prisma.cliente.count({ where: { leadStatus: 'NOVO' } }),
            emConversa: await prisma.cliente.count({ where: { leadStatus: 'EM_CONVERSA' } }),
            qualificados: await prisma.cliente.count({ where: { leadStatus: 'QUALIFICADO' } }),
            agendados: await prisma.cliente.count({ where: { leadStatus: 'AGENDADO' } }),
        };

        const origensRaw = await prisma.cliente.groupBy({ by: ['origem'], _count: { origem: true } });
        const origens = origensRaw.map(o => ({ rotulo: o.origem, contagem: o._count.origem }));
        
        let leadsPorDia = [];
        for (let i = 6; i >= 0; i--) {
            const dataBase = subDays(new Date(), i);
            const count = await prisma.cliente.count({ where: { criadoEm: { gte: startOfDay(dataBase), lte: endOfDay(dataBase) } } });
            leadsPorDia.push({ dia: format(dataBase, 'dd/MM'), count });
        }

        const topServicosAg = await prisma.agendamento.groupBy({
            by: ['servicoId'], _count: { servicoId: true }, where: { servicoId: { not: null } }, orderBy: { _count: { servicoId: 'desc' } }, take: 5
        });
        const topTratamentosAg = await prisma.agendamento.groupBy({
            by: ['tratamentoId'], _count: { tratamentoId: true }, where: { tratamentoId: { not: null } }, orderBy: { _count: { tratamentoId: 'desc' } }, take: 5
        });

        let topServicos = [];
        for (let s of topServicosAg) {
            const servDb = await prisma.servico.findUnique({ where: { id: s.servicoId } });
            if (servDb) topServicos.push({ nome: servDb.nome, count: s._count.servicoId });
        }
        for (let t of topTratamentosAg) {
            const tratDb = await prisma.tratamento.findUnique({ where: { id: t.tratamentoId } });
            if (tratDb) topServicos.push({ nome: tratDb.nome, count: t._count.tratamentoId });
        }
        
        topServicos.sort((a, b) => b.count - a.count);
        topServicos = topServicos.slice(0, 5);

        res.status(200).json({ totalLeads, leadsHoje, agendamentosTotais, cancelamentosTotais, funil, origens, leadsPorDia, topServicos });
    } catch (error) {
        res.status(500).json({ error: "Erro ao processar estatísticas do painel." });
    }
};

exports.getConfigSistema = async (req, res) => {
    try {
        const config = await prisma.configSistema.findFirst();
        res.status(200).json(config || {});
    } catch (e) {
        res.status(500).json({ error: "Erro ao buscar configurações no banco." });
    }
};

exports.saveConfigSistema = async (req, res) => {
    try {
        const d = req.body;
        await prisma.configSistema.upsert({
            where: { id: 1 },
            update: {
                modoAtivo: d.modoAtivo, nomeAssistente: d.nomeAssistente, tomDeVoz: d.tomDeVoz,
                objetivos: d.objetivos, regrasExtrasIA: d.regrasExtrasIA, faq: d.faq,
                ignorarDiagnosticos: d.ignorarDiagnosticos, regrasTransferencia: d.regrasTransferencia,
                notificarNovosLeads: d.notificarNovosLeads, autoFollowUp: d.autoFollowUp,
                autoLembrete: d.autoLembrete, distribuicaoLeads: d.distribuicaoLeads,
                webhookUrl: d.webhookUrl, metaToken: d.metaToken
            },
            create: {
                id: 1, modoAtivo: d.modoAtivo || "BARBEARIA", nomeAssistente: d.nomeAssistente,
                tomDeVoz: d.tomDeVoz, objetivos: d.objetivos, regrasExtrasIA: d.regrasExtrasIA, faq: d.faq,
                ignorarDiagnosticos: d.ignorarDiagnosticos || false, regrasTransferencia: d.regrasTransferencia,
                notificarNovosLeads: d.notificarNovosLeads, autoFollowUp: d.autoFollowUp,
                autoLembrete: d.autoLembrete, distribuicaoLeads: d.distribuicaoLeads,
                webhookUrl: d.webhookUrl, metaToken: d.metaToken
            }
        });
        res.status(200).json({ message: "Configurações salvas no banco com sucesso." });
    } catch (e) {
        res.status(500).json({ error: "Erro ao atualizar configurações da inteligência." });
    }
};

exports.getEquipe = async (req, res) => {
    try {
        const usuarios = await prisma.usuario.findMany();
        res.status(200).json(usuarios);
    } catch (error) {
        res.status(500).json({ error: "Erro ao listar equipe." });
    }
};

exports.criarMembroEquipe = async (req, res) => {
    try {
        const newUser = await prisma.usuario.create({
            data: { nome: req.body.nome, email: req.body.email, senha: req.body.senha, funcao: req.body.funcao, status: 'ONLINE' }
        });
        res.status(200).json(newUser);
    } catch (error) {
        res.status(500).json({ error: "Erro ao criar membro. Email já cadastrado ou campos incorretos." });
    }
};

exports.deletarMembroEquipe = async (req, res) => {
    try {
        await prisma.usuario.delete({ where: { id: parseInt(req.params.id) } });
        res.status(200).json({ message: "Membro da equipe deletado permanentemente." });
    } catch (error) {
        res.status(500).json({ error: "Erro ao deletar membro da equipe." });
    }
};

exports.getLeads = async (req, res) => {
    try {
        const leads = await prisma.cliente.findMany({ include: { responsavel: true }, orderBy: { ultimaInteracao: 'desc' } });
        res.status(200).json(leads);
    } catch (error) {
        res.status(500).json({ error: "Erro ao listar leads base." });
    }
};

exports.atualizarStatusLead = async (req, res) => {
    try {
        const { status, tags, observacoes, valorPotencial, responsavelId } = req.body;
        const dataUpdate = { leadStatus: status };
        if (tags !== undefined) dataUpdate.tags = tags;
        if (observacoes !== undefined) dataUpdate.observacoes = observacoes;
        if (valorPotencial !== undefined) dataUpdate.valorPotencial = valorPotencial;
        if (responsavelId !== undefined) dataUpdate.responsavelId = responsavelId ? parseInt(responsavelId) : null;
        const leadAlterado = await prisma.cliente.update({ where: { id: req.params.id }, data: dataUpdate });
        res.status(200).json(leadAlterado);
    } catch (error) {
        res.status(500).json({ error: "Erro ao atualizar dados do lead." });
    }
};

exports.getNotasInternas = async (req, res) => {
    try {
        const notas = await prisma.notaInterna.findMany({ where: { clienteId: req.params.clienteId }, include: { usuario: true }, orderBy: { criadoEm: 'desc' } });
        res.status(200).json(notas);
    } catch (error) {
        res.status(500).json({ error: "Erro ao carregar notas da conversa." });
    }
};

exports.criarNotaInterna = async (req, res) => {
    try {
        const nota = await prisma.notaInterna.create({ data: { texto: req.body.texto, clienteId: req.params.clienteId, usuarioId: req.body.usuarioId || 1 } });
        res.status(200).json(nota);
    } catch (error) {
        res.status(500).json({ error: "Erro ao registrar nota interna secreta." });
    }
};

exports.getConversasPendentes = async (req, res) => {
    try {
        const pendentes = await prisma.cliente.findMany({ where: { falarHumano: true }, include: { responsavel: true }, orderBy: { ultimaInteracao: 'desc' } });
        res.status(200).json(pendentes);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar a fila de atendimento humano." });
    }
};

exports.getMensagensConversa = async (req, res) => {
    try {
        const mensagens = await prisma.mensagemIA.findMany({ where: { clienteId: req.params.clienteId }, orderBy: { criadoEm: 'asc' } });
        res.status(200).json(mensagens);
    } catch (error) {
        res.status(500).json({ error: "Erro ao resgatar histórico do cliente." });
    }
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
    } catch (error) {
        res.status(500).json({ error: "Erro ao enviar mensagem pelo painel humano." });
    }
};

exports.resolverAtendimentoHumano = async (req, res) => {
    try {
        await prisma.cliente.update({ where: { id: req.params.clienteId }, data: { falarHumano: false, leadStatus: 'ATENDIDO' } });
        await whatsappService.sendText(req.params.clienteId, "O seu atendimento com nossa equipe foi encerrado. O assistente virtual foi reativado para lhe ajudar a qualquer instante.");
        if (global.io) global.io.emit('atualizar_fila');
        res.status(200).json({ message: "Conversa resolvida com sucesso." });
    } catch (error) {
        res.status(500).json({ error: "Erro ao resolver encerramento do chat." });
    }
};

exports.getAgendamentosTodos = async (req, res) => {
    try {
        const agendamentos = await prisma.agendamento.findMany({ include: { cliente: true, servico: true, barbeiro: true, tratamento: true, profissionalSaude: true }, orderBy: { dataHora: 'asc' } });
        res.status(200).json(agendamentos);
    } catch (error) {
        res.status(500).json({ error: "Erro ao puxar dados do calendário." });
    }
};

exports.getAgendamentosHoje = async (req, res) => {
    try {
        const hoje = await prisma.agendamento.findMany({ where: { status: 'AGENDADO', dataHora: { gte: startOfDay(new Date()) } }, include: { cliente: true, servico: true, barbeiro: true, tratamento: true, profissionalSaude: true }, orderBy: { dataHora: 'asc' } });
        res.status(200).json(hoje);
    } catch (error) {
        res.status(500).json({ error: "Erro ao filtrar agenda do dia." });
    }
};

exports.atualizarStatusAgendamento = async (req, res) => {
    try {
        const att = await prisma.agendamento.update({ where: { id: parseInt(req.params.id) }, data: { status: req.body.status } });
        res.status(200).json(att);
    } catch (error) {
        res.status(500).json({ error: "Erro ao modificar o status da reserva." });
    }
};

exports.formatarSistema = async (req, res) => {
    try {
        await prisma.notaInterna.deleteMany({}); 
        await prisma.mensagemIA.deleteMany({});
        await prisma.agendamento.deleteMany({}); 
        await prisma.cliente.deleteMany({});
        botEngine.limparMemoriaEstado();
        res.status(200).json({ message: "Memória do sistema totalmente purgada!" });
    } catch (error) {
        res.status(500).json({ error: "Erro interno crasso ao tentar formatar." });
    }
};