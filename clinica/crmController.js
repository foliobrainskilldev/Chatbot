const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const cloudinaryService = require('../services/cloudinaryService');
const automationEngine = require('../services/automationEngine');
const { startOfDay, endOfDay, subDays, format } = require('date-fns');

exports.getDashboardStats = async (req, res) => {
    try {
        const dias = parseInt(req.query.dias) || 30;
        const dataCorte = subDays(new Date(), dias);
        const inicioHoje = startOfDay(new Date());
        const fimHoje = endOfDay(new Date());

        const conversasTotais = await prisma.mensagemIA.groupBy({ by: ['clienteId'] });
        const novosLeads = await prisma.cliente.count({ where: { leadStatus: 'NOVO', criadoEm: { gte: dataCorte } } });
        const leadsQualificados = await prisma.cliente.count({ where: { leadStatus: 'QUALIFICADO', criadoEm: { gte: dataCorte } } });
        const agendamentosTotais = await prisma.agendamento.count({ where: { status: 'AGENDADO', tratamentoId: { not: null }, dataHora: { gte: dataCorte } } });
        
        const consultasRealizadas = await prisma.agendamento.count({ where: { status: 'CONCLUIDO', tratamentoId: { not: null }, dataHora: { gte: dataCorte } } });
        let taxaConversao = agendamentosTotais > 0 ? ((consultasRealizadas / agendamentosTotais) * 100).toFixed(1) : 0;

        const consultasHoje = await prisma.agendamento.count({ where: { tratamentoId: { not: null }, dataHora: { gte: inicioHoje, lte: fimHoje } } });
        const pendentesHoje = await prisma.agendamento.count({ where: { status: 'AGENDADO', tratamentoId: { not: null }, dataHora: { gte: inicioHoje, lte: fimHoje } } });

        const agendamentosHojeList = await prisma.agendamento.findMany({
            where: { tratamentoId: { not: null }, dataHora: { gte: inicioHoje, lte: fimHoje } },
            include: { cliente: true, tratamento: true, profissionalSaude: true },
            orderBy: { dataHora: 'asc' }
        });

        const leadsRecentes = await prisma.cliente.findMany({
            take: 5,
            orderBy: { ultimaInteracao: 'desc' },
            select: { id: true, nome: true, leadStatus: true, origem: true, tags: true }
        });

        const atencaoNecessaria = [];
        const leadsEsperandoHumano = await prisma.cliente.findMany({
            where: { falarHumano: true },
            select: { id: true, nome: true }
        });
        leadsEsperandoHumano.forEach(lead => {
            atencaoNecessaria.push({ clienteId: lead.id, clienteNome: lead.nome, motivo: 'Aguardando Atendimento Humano' });
        });

        const agendamentosSemResposta = await prisma.agendamento.findMany({
            where: { status: 'AGENDADO', dataHora: { lte: new Date() } },
            include: { cliente: true }
        });
        agendamentosSemResposta.forEach(ag => {
            atencaoNecessaria.push({ clienteId: ag.cliente.id, clienteNome: ag.cliente.nome, motivo: 'Consulta Atrasada no Sistema' });
        });

        const totalMensagens = await prisma.mensagemIA.count({ where: { role: 'assistant', criadoEm: { gte: dataCorte } } });
        const msgsHumano = await prisma.mensagemIA.count({ where: { role: 'assistant', atendenteHumano: true, criadoEm: { gte: dataCorte } } });
        const msgsIA = totalMensagens - msgsHumano;
        
        let txRes = totalMensagens > 0 ? ((msgsIA / totalMensagens) * 100).toFixed(1) : 0;
        
        const desempenhoIA = {
            conversasIA: msgsIA,
            transferidas: leadsEsperandoHumano.length,
            resolvidas: msgsIA > leadsEsperandoHumano.length ? (msgsIA - leadsEsperandoHumano.length) : msgsIA,
            taxaResolucao: txRes
        };

        const contagemFunil = await prisma.cliente.groupBy({ by: ['leadStatus'], _count: { leadStatus: true } });
        const getCount = (status) => { const f = contagemFunil.find(c => c.leadStatus === status); return f ? f._count.leadStatus : 0; };
        
        const graficoFunil = [
            { etapa: 'Conversas', valor: conversasTotais.length },
            { etapa: 'Novos', valor: getCount('NOVO') },
            { etapa: 'Qualificados', valor: getCount('QUALIFICADO') },
            { etapa: 'Agendados', valor: getCount('AGENDADO') },
            { etapa: 'Clientes', valor: getCount('CLIENTE') }
        ];

        const topTratamentosDb = await prisma.agendamento.groupBy({
            by: ['tratamentoId'], _count: { tratamentoId: true },
            where: { tratamentoId: { not: null }, status: 'AGENDADO' },
            orderBy: { _count: { tratamentoId: 'desc' } }, take: 5
        });

        let topServicos = [];
        for (let t of topTratamentosDb) {
            const trat = await prisma.tratamento.findUnique({ where: { id: t.tratamentoId } });
            if (trat) topServicos.push({ nome: trat.nome, count: t._count.tratamentoId });
        }

        const origensAgrupadas = await prisma.cliente.groupBy({ by: ['origem'], _count: { origem: true } });
        const origensFormatadas = origensAgrupadas.map(o => ({ origem: o.origem || 'Outros', count: o._count.origem }));

        const evolucao = [];
        for (let i = dias - 1; i >= 0; i--) {
            const diaAlvo = subDays(new Date(), i);
            const ini = startOfDay(diaAlvo);
            const fim = endOfDay(diaAlvo);
            
            const leadsCount = await prisma.cliente.count({ where: { criadoEm: { gte: ini, lte: fim } } });
            const agendamentosCount = await prisma.agendamento.count({ where: { criadoEm: { gte: ini, lte: fim }, tratamentoId: { not: null } } });
            
            evolucao.push({ data: format(diaAlvo, 'dd/MM'), leads: leadsCount, agendamentos: agendamentosCount });
        }

        res.status(200).json({
            kpis: {
                conversasTotais: conversasTotais.length, novosLeads, leadsQualificados, agendamentosTotais, taxaConversao,
                consultasHoje, pendentesHoje
            },
            agendamentosHoje: agendamentosHojeList,
            leadsRecentes: leadsRecentes,
            atencaoNecessaria: atencaoNecessaria.slice(0, 5),
            desempenhoIA: desempenhoIA,
            graficos: {
                funil: graficoFunil,
                servicos: topServicos,
                origens: origensFormatadas,
                evolucao: evolucao
            }
        });

    } catch (error) { 
        console.error("Erro Dashboard Principal:", error);
        res.status(500).json({ error: "Erro interno ao mapear o Dashboard." }); 
    }
};

exports.getLeads = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 100;
        const search = req.query.search || '';
        const origem = req.query.origem || '';
        const skip = (page - 1) * limit;

        const where = {};
        
        if (search) {
            where.OR = [
                { nome: { contains: search, mode: 'insensitive' } },
                { id: { contains: search } }
            ];
        }

        if (origem) {
            where.origem = origem;
        }

        const [leads, total] = await Promise.all([
            prisma.cliente.findMany({ 
                where, 
                skip, 
                take: limit,
                orderBy: { ultimaInteracao: 'desc' },
                include: { 
                    agendamentos: { where: { status: 'AGENDADO' }, take: 1 }
                }
            }),
            prisma.cliente.count({ where })
        ]);

        res.status(200).json({
            data: leads,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) { 
        console.error("Erro CRM Paginação:", error);
        res.status(500).json({ error: "Erro ao buscar pipeline de CRM." }); 
    }
};

exports.atualizarStatusLead = async (req, res) => {
    try {
        const { status, tags, valorPotencial, responsavelId } = req.body;
        const updateData = { leadStatus: status, tags };
        
        if (valorPotencial !== undefined) updateData.valorPotencial = parseFloat(valorPotencial) || 0;
        if (responsavelId) updateData.responsavelId = parseInt(responsavelId);

        const leadAlterado = await prisma.cliente.update({ 
            where: { id: req.params.id }, 
            data: updateData 
        });

        if (status === 'QUALIFICADO' || status === 'INTERESSADO') {
            await automationEngine.dispararAutomacoes('LEAD_QUENTE', leadAlterado);
        }
        
        res.status(200).json(leadAlterado);
    } catch (error) { 
        res.status(500).json({ error: "Erro ao atualizar pipeline." }); 
    }
};

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

exports.getConversasPendentes = async (req, res) => {
    try {
        const pendentes = await prisma.cliente.findMany({ 
            orderBy: { ultimaInteracao: 'desc' },
            take: 50
        });
        res.status(200).json(pendentes);
    } catch (error) { 
        res.status(500).json({ error: "Erro ao buscar caixa de entrada." }); 
    }
};

exports.getMensagensConversa = async (req, res) => {
    try {
        const mensagens = await prisma.mensagemIA.findMany({ 
            where: { clienteId: req.params.clienteId }, 
            orderBy: { criadoEm: 'asc' } 
        });
        res.status(200).json(mensagens);
    } catch (error) { 
        res.status(500).json({ error: "Erro ao buscar mensagens." }); 
    }
};

exports.getNotasInternas = async (req, res) => {
    try {
        const notas = await prisma.notaInterna.findMany({ 
            where: { clienteId: req.params.clienteId }, 
            include: { usuario: true }, 
            orderBy: { criadoEm: 'asc' } 
        });
        res.status(200).json(notas);
    } catch (error) { 
        res.status(500).json({ error: "Erro notas." }); 
    }
};

exports.criarNotaInterna = async (req, res) => {
    try {
        const nota = await prisma.notaInterna.create({ 
            data: { 
                texto: req.body.texto, 
                clienteId: req.params.clienteId, 
                usuarioId: req.body.usuarioId || 1 
            } 
        });
        res.status(200).json(nota);
    } catch (error) { 
        res.status(500).json({ error: "Erro criar nota." }); 
    }
};

exports.assumirAtendimentoHumano = async (req, res) => {
    try {
        await prisma.cliente.update({ 
            where: { id: req.params.clienteId }, 
            data: { falarHumano: true, leadStatus: 'EM_CONVERSA' } 
        });
        if (global.io) global.io.emit('atualizar_fila');
        res.status(200).json({ message: "Atendimento humano assumido." });
    } catch (error) { 
        res.status(500).json({ error: "Erro ao assumir atendimento." }); 
    }
};

exports.resolverAtendimentoHumano = async (req, res) => {
    try {
        await prisma.cliente.update({ 
            where: { id: req.params.clienteId }, 
            data: { falarHumano: false } 
        });
        if (global.io) global.io.emit('atualizar_fila');
        res.status(200).json({ message: "Conversa devolvida para a IA." });
    } catch (error) { 
        res.status(500).json({ error: "Erro ao devolver para IA." }); 
    }
};

exports.enviarMensagemManual = async (req, res) => {
    try {
        const { clienteId } = req.params; 
        const texto = req.body.texto || ""; 
        let msgDb = texto;
        let cloudinaryUrl = null;
        let typeMsg = null;

        if (req.file) {
            const mimeType = req.file.mimetype;
            const resourceType = mimeType.startsWith('image/') ? 'image' : (mimeType.startsWith('audio/') || mimeType.startsWith('video/') ? 'video' : 'raw');
            
            const cloudResult = await cloudinaryService.uploadStream(req.file.buffer, 'clinica/atendimento', resourceType);
            cloudinaryUrl = cloudResult.secure_url;
            
            typeMsg = mimeType.startsWith('image/') ? 'image' : (mimeType.startsWith('audio/') || mimeType.endsWith('webm') ? 'audio' : 'document');
            
            await whatsappService.sendMediaUrl(clienteId, typeMsg, cloudinaryUrl, texto);
            msgDb = `[MEDIA:${typeMsg}] ${cloudinaryUrl} | Texto: ${texto}`;
        } else if (texto) { 
            await whatsappService.sendText(clienteId, texto); 
        }
        
        const novaMsg = await prisma.mensagemIA.create({ 
            data: { 
                role: 'assistant', 
                content: msgDb, 
                clienteId, 
                midiaUrl: cloudinaryUrl,
                tipoMidia: typeMsg,
                atendenteHumano: true 
            } 
        });
        
        if (global.io) global.io.emit('nova_mensagem', { clienteId, mensagem: novaMsg });
        res.status(200).json(novaMsg);
    } catch (error) { 
        console.error(error);
        res.status(500).json({ error: "Erro ao enviar mensagem manual." }); 
    }
};

exports.getTratamentos = async (req, res) => {
    try {
        const tratamentos = await prisma.tratamento.findMany();
        res.status(200).json(tratamentos);
    } catch (error) { 
        res.status(500).json({ error: "Erro ao buscar tratamentos." }); 
    }
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
    } catch (error) { 
        res.status(500).json({ error: "Erro ao salvar tratamento." }); 
    }
};

exports.excluirTratamento = async (req, res) => {
    try {
        await prisma.tratamento.delete({ where: { id: parseInt(req.params.id) } });
        res.status(200).json({ message: "Tratamento removido." });
    } catch (error) { 
        res.status(500).json({ error: "Erro ao excluir." }); 
    }
};

exports.getConfigIA = async (req, res) => {
    try {
        const config = await prisma.configSistema.findFirst();
        res.status(200).json(config);
    } catch (error) { 
        res.status(500).json({ error: "Erro ao buscar config IA." }); 
    }
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
    } catch (error) { 
        res.status(500).json({ error: "Erro ao atualizar IA." }); 
    }
};

exports.getAgendamentosTodos = async (req, res) => {
    try {
        const agendamentos = await prisma.agendamento.findMany({ 
            where: { tratamentoId: { not: null } }, 
            include: { cliente: true, tratamento: true, profissionalSaude: true }, 
            orderBy: { dataHora: 'asc' } 
        });
        res.status(200).json(agendamentos);
    } catch (error) { 
        res.status(500).json({ error: "Erro agenda clinica." }); 
    }
};

exports.atualizarStatusAgendamento = async (req, res) => {
    try {
        const { status } = req.body;
        const att = await prisma.agendamento.update({ 
            where: { id: parseInt(req.params.id) }, 
            data: { status },
            include: { cliente: true }
        });

        if (status === 'AGENDADO') {
            await automationEngine.dispararAutomacoes('CONSULTA_CONFIRMADA', att);
        } else if (status === 'CONCLUIDO') {
            await automationEngine.dispararAutomacoes('CONSULTA_REALIZADA', att);
        }

        res.status(200).json(att);
    } catch (error) { 
        res.status(500).json({ error: "Erro atualizar consulta." }); 
    }
};

exports.getEquipe = async (req, res) => {
    try {
        const usuarios = await prisma.usuario.findMany({
            orderBy: { criadoEm: 'desc' }
        });
        res.status(200).json(usuarios);
    } catch (error) { 
        res.status(500).json({ error: "Erro equipe." }); 
    }
};

exports.criarMembroEquipe = async (req, res) => {
    try {
        const newUser = await prisma.usuario.create({
            data: { 
                nome: req.body.nome, 
                email: req.body.email, 
                senha: req.body.senha, 
                funcao: req.body.funcao, 
                status: 'ONLINE' 
            }
        });
        res.status(201).json(newUser);
    } catch (error) { 
        res.status(500).json({ error: "Erro ao criar membro." }); 
    }
};

exports.deletarMembroEquipe = async (req, res) => {
    try {
        await prisma.usuario.delete({ where: { id: parseInt(req.params.id) } });
        res.status(200).json({ message: "Membro deletado." });
    } catch (error) { 
        res.status(500).json({ error: "Erro ao deletar." }); 
    }
};