const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const cloudinaryService = require('../services/cloudinaryService');
const automationEngine = require('../services/automationEngine');
const webhookService = require('../services/webhookService');
const aiService = require('../aiService'); 
const { getHorariosDisponiveis } = require('../dateUtils'); 
const { startOfDay, endOfDay, subDays, format, parse } = require('date-fns');

async function registrarAtividade(usuarioId, acao, recurso, detalhes = "") {
    if(!usuarioId) return;
    try {
        await prisma.atividadeEquipe.create({
            data: { usuarioId, acao, recurso, detalhes }
        });
    } catch(e) { console.error("Falha ao registrar log de equipe", e); }
}

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
            kpis: { conversasTotais: conversasTotais.length, novosLeads, leadsQualificados, agendamentosTotais, taxaConversao, consultasHoje, pendentesHoje },
            agendamentosHoje: agendamentosHojeList,
            leadsRecentes: leadsRecentes,
            atencaoNecessaria: atencaoNecessaria.slice(0, 5),
            desempenhoIA: desempenhoIA,
            graficos: { funil: graficoFunil, servicos: topServicos, origens: origensFormatadas, evolucao: evolucao }
        });

    } catch (error) { res.status(500).json({ error: "Erro interno ao mapear o Dashboard." }); }
};

exports.getLeads = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 200;
        const search = req.query.search || '';
        const origem = req.query.origem || '';
        const responsavelId = req.query.responsavelId || '';
        const tags = req.query.tags || '';
        const servicoId = req.query.servicoId || '';
        const dias = parseInt(req.query.dias) || 0;

        const skip = (page - 1) * limit;
        const where = {};
        
        if (search) {
            where.OR = [
                { nome: { contains: search, mode: 'insensitive' } },
                { id: { contains: search } }
            ];
        }

        if (origem) where.origem = origem;
        if (responsavelId) where.responsavelId = parseInt(responsavelId);
        if (tags) where.tags = { contains: tags, mode: 'insensitive' };
        if (servicoId) where.agendamentos = { some: { tratamentoId: parseInt(servicoId) } };
        
        if (dias > 0) {
            const dataCorte = subDays(new Date(), dias);
            where.criadoEm = { gte: dataCorte };
        }

        const [leads, total] = await Promise.all([
            prisma.cliente.findMany({ 
                where, skip, take: limit,
                orderBy: { ultimaInteracao: 'desc' },
                include: { 
                    responsavel: true,
                    agendamentos: { where: { status: 'AGENDADO' }, take: 1, orderBy: { dataHora: 'asc' } }
                }
            }),
            prisma.cliente.count({ where })
        ]);

        res.status(200).json({
            data: leads,
            pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) { res.status(500).json({ error: "Erro ao buscar pipeline de CRM." }); }
};

exports.criarLeadManual = async (req, res) => {
    try {
        const { id, nome, origem } = req.body;
        if (!id) return res.status(400).json({ error: "O número/ID é obrigatório." });

        const leadExistente = await prisma.cliente.findUnique({ where: { id: String(id) } });
        if(leadExistente) return res.status(409).json({ error: "Lead já existe com este número." });

        const novoLead = await prisma.cliente.create({
            data: { id: String(id), nome: nome || 'Lead Manual', origem: origem || 'Manual', leadStatus: 'NOVO' }
        });

        await automationEngine.dispararAutomacoes('NOVO_LEAD', novoLead);
        await webhookService.dispararEvento('lead.created', novoLead);

        res.status(201).json(novoLead);
    } catch (error) { res.status(500).json({ error: "Erro interno ao cadastrar." }); }
};

exports.atualizarStatusLead = async (req, res) => {
    try {
        const { status, tags, valorPotencial, responsavelId } = req.body;
        const updateData = {};
        
        if (status) updateData.leadStatus = status;
        if (tags !== undefined) updateData.tags = tags;
        if (valorPotencial !== undefined) updateData.valorPotencial = parseFloat(valorPotencial) || 0;
        if (responsavelId !== undefined) updateData.responsavelId = responsavelId ? parseInt(responsavelId) : null;

        const leadAnterior = await prisma.cliente.findUnique({ where: { id: req.params.id } });
        const leadAlterado = await prisma.cliente.update({ where: { id: req.params.id }, data: updateData });

        if (status && status !== leadAnterior.leadStatus) {
            if (status === 'QUALIFICADO') {
                await automationEngine.dispararAutomacoes('LEAD_QUALIFICADO', leadAlterado);
                await webhookService.dispararEvento('lead.qualified', leadAlterado); 
            }
            if (status === 'CLIENTE') {
                await automationEngine.dispararAutomacoes('NOVO_PACIENTE', leadAlterado);
                await webhookService.dispararEvento('lead.converted', leadAlterado); 
            }
        }
        if (tags && tags !== leadAnterior.tags) {
            await automationEngine.dispararAutomacoes('TAG_ADICIONADA', leadAlterado);
        }
        
        await webhookService.dispararEvento('lead.updated', leadAlterado);

        res.status(200).json(leadAlterado);
    } catch (error) { res.status(500).json({ error: "Erro ao atualizar pipeline." }); }
};

exports.atualizarLeadCompleto = async (req, res) => {
    try {
        const { nome, email, observacoes } = req.body;
        const lead = await prisma.cliente.update({
            where: { id: req.params.id }, data: { nome, email, observacoes }
        });
        
        await webhookService.dispararEvento('lead.updated', lead); 
        res.status(200).json(lead);
    } catch (error) { res.status(500).json({ error: "Erro ao atualizar ficha do lead." }); }
};

exports.getConversasPendentes = async (req, res) => {
    try {
        const pendentes = await prisma.cliente.findMany({ orderBy: { ultimaInteracao: 'desc' }, take: 50 });
        res.status(200).json(pendentes);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar caixa de entrada." }); }
};

exports.getMensagensConversa = async (req, res) => {
    try {
        const mensagens = await prisma.mensagemIA.findMany({ where: { clienteId: req.params.clienteId }, orderBy: { criadoEm: 'asc' } });
        res.status(200).json(mensagens);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar mensagens." }); }
};

exports.getNotasInternas = async (req, res) => {
    try {
        const notas = await prisma.notaInterna.findMany({ where: { clienteId: req.params.clienteId }, include: { usuario: true }, orderBy: { criadoEm: 'asc' } });
        res.status(200).json(notas);
    } catch (error) { res.status(500).json({ error: "Erro notas." }); }
};

exports.criarNotaInterna = async (req, res) => {
    try {
        const nota = await prisma.notaInterna.create({ data: { texto: req.body.texto, clienteId: req.params.clienteId, usuarioId: req.body.usuarioId || 1 } });
        res.status(200).json(nota);
    } catch (error) { res.status(500).json({ error: "Erro criar nota." }); }
};

exports.assumirAtendimentoHumano = async (req, res) => {
    try {
        const clienteId = req.params.clienteId;
        const lead = await prisma.cliente.update({ where: { id: clienteId }, data: { falarHumano: true, leadStatus: 'EM_CONVERSA' } });
        
        await automationEngine.dispararAutomacoes('TRANSFERIDO_HUMANO', lead);
        await webhookService.dispararEvento('lead.updated', lead);
        
        if (global.io) global.io.emit('atualizar_fila');
        res.status(200).json({ message: "Atendimento humano assumido." });
    } catch (error) { res.status(500).json({ error: "Erro ao assumir atendimento." }); }
};

exports.resolverAtendimentoHumano = async (req, res) => {
    try {
        const clienteId = req.params.clienteId;
        const lead = await prisma.cliente.update({ where: { id: clienteId }, data: { falarHumano: false } });
        
        await automationEngine.dispararAutomacoes('ATENDIMENTO_ENCERRADO', lead);
        await webhookService.dispararEvento('conversation.closed', lead); 
        
        if (global.io) global.io.emit('atualizar_fila');
        res.status(200).json({ message: "Conversa devolvida para a IA." });
    } catch (error) { res.status(500).json({ error: "Erro ao devolver para IA." }); }
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
            data: { role: 'assistant', content: msgDb, clienteId, midiaUrl: cloudinaryUrl, tipoMidia: typeMsg, atendenteHumano: true } 
        });
        
        if (global.io) global.io.emit('nova_mensagem', { clienteId, mensagem: novaMsg });
        res.status(200).json(novaMsg);
    } catch (error) { res.status(500).json({ error: "Erro ao enviar mensagem manual." }); }
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
            const cloudResult = await cloudinaryService.uploadStream(req.file.buffer, 'clinica/tratamentos', 'image');
            imageUrl = cloudResult.secure_url;
        }

        let profIds = [];
        if (req.body.profissionais) {
            try { profIds = JSON.parse(req.body.profissionais).map(id => ({ id: parseInt(id) })); } 
            catch (e) {}
        }

        const dadosBase = {
            nome: req.body.nome, categoria: req.body.categoria || 'Outros', tipoPreco: req.body.tipoPreco || 'FIXO',
            preco: req.body.preco ? parseFloat(req.body.preco) : null, duracaoMin: parseInt(req.body.duracaoMin) || 30,
            descricaoCurta: req.body.descricaoCurta || '', informacoesIA: req.body.informacoesIA || '', faq: req.body.faq || '',
            regrasIA: req.body.regrasIA || '', podeAgendarIA: req.body.podeAgendarIA === 'true', status: req.body.status || 'ATIVO',
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
        const logs = await prisma.logAlteracaoIA.findMany({ orderBy: { criadoEm: 'desc' }, take: 10 });
        res.status(200).json({ config, logs });
    } catch (error) { res.status(500).json({ error: "Erro ao buscar config IA." }); }
};

exports.atualizarConfigIA = async (req, res) => {
    try {
        const p = req.body;
        let avatarNovaUrl = p.avatarUrl || null;
        if (req.file) {
            const cloudResult = await cloudinaryService.uploadStream(req.file.buffer, 'clinica/ia', 'image');
            avatarNovaUrl = cloudResult.secure_url;
        }

        const config = await prisma.configSistema.update({
            where: { id: 1 },
            data: { 
                nomeClinica: p.nomeClinica, nomeAssistente: p.nomeAssistente, idioma: p.idioma,
                tomDeVoz: p.tomDeVoz, estiloComunicacao: p.estiloComunicacao, formalidade: p.formalidade,
                objetivos: p.objetivos, permissoes: p.permissoes, regrasExtrasIA: p.regrasExtrasIA, faq: p.faq, 
                regrasTransferencia: p.regrasTransferencia, msgTransferencia: p.msgTransferencia,
                avatarUrl: avatarNovaUrl !== 'null' ? avatarNovaUrl : null
            }
        });
        await prisma.logAlteracaoIA.create({ data: { autor: p.usuarioLogado || "Administrador", descricao: `Configurações da IA atualizadas.` } });
        res.status(200).json(config);
    } catch (error) { res.status(500).json({ error: "Erro ao atualizar IA." }); }
};

// ==========================================
// SIMULADOR DO PIPELINE NLP (ATUALIZADO)
// ==========================================
exports.testarIA = async (req, res) => {
    try {
        const { mensagem } = req.body;
        if (!mensagem) return res.status(400).json({ error: "Mensagem vazia." });

        const configDb = await prisma.configSistema.findFirst();
        const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO' } });

        // Simulação do Estado NLP
        const estadoFake = { step: 'IDLE', intent: null, entities: {} };
        const nlpResult = await aiService.analisarMensagemNLP(mensagem, [], estadoFake);

        let respostaIA = "";

        if (nlpResult.intent === 'appointment.create') {
            respostaIA = `[AÇÃO DE BACKEND]\nO motor identificou a intenção de AGENDAR.\nEntidades extraídas: ${JSON.stringify(nlpResult.entities)}\nO sistema iniciaria o fluxo de botões para escolher data e horário.`;
        } else if (nlpResult.intent === 'appointment.cancel' || nlpResult.intent === 'appointment.reschedule') {
            respostaIA = `[AÇÃO DE BACKEND]\nO motor identificou a intenção de CANCELAR/REMARCAR.\nEntidades extraídas: ${JSON.stringify(nlpResult.entities)}\nO sistema buscaria as consultas ativas do paciente.`;
        } else if (nlpResult.intent === 'human.transfer') {
            respostaIA = `[AÇÃO DE BACKEND]\nTransferindo para a fila de atendimento humano...`;
        } else {
            // Emula a Resposta Natural para intenções de FAQ e Informações
            let dadosContexto = {};
            if (nlpResult.intent.startsWith('treatment.')) {
                dadosContexto.catologo_servicos = tratamentos.map(t => ({ nome: t.nome, preco: t.preco, tipoPreco: t.tipoPreco, info: t.informacoesIA }));
            } else {
                dadosContexto.dados_operacionais = {
                    horarios: configDb?.horarioFuncionamento || "Segunda a Sexta",
                    endereco: configDb?.endereco || "Endereço cadastrado",
                    telefone: configDb?.telefone || "",
                    faq: configDb?.faq || ""
                };
            }
            const textoResposta = await aiService.gerarRespostaNatural(mensagem, [], dadosContexto, configDb);
            respostaIA = textoResposta;
        }

        res.status(200).json({ resposta: respostaIA });
    } catch (error) { 
        console.error("Erro na simulação:", error);
        res.status(500).json({ error: "Falha na simulação IA." }); 
    }
};

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
        const dataOriginal = new Date(dataHora);
        
        const novoAgendamento = await prisma.agendamento.create({
            data: {
                dataHora: dataOriginal, clienteId, status: 'CONFIRMADA', 
                tratamentoId: parseInt(tratamentoId), profissionalSaudeId: profissionalSaudeId ? parseInt(profissionalSaudeId) : null, observacoes: observacoes || ""
            },
            include: { cliente: true, tratamento: true, profissionalSaude: true }
        });
        
        const dataStr = dataOriginal.toLocaleDateString('pt-BR');
        const horaStr = dataOriginal.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const msg = `Sua consulta para *${novoAgendamento.tratamento.nome}* foi agendada para ${dataStr} às ${horaStr}.`;
        
        await whatsappService.sendText(clienteId, msg);
        await prisma.mensagemIA.create({ data: { role: 'assistant', content: `[SISTEMA AUTOMÁTICO] ${msg}`, clienteId, atendenteHumano: false } });
        
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

exports.getEquipe = async (req, res) => {
    try {
        const usuarios = await prisma.usuario.findMany({ 
            orderBy: { criadoEm: 'desc' },
            select: { id: true, nome: true, email: true, funcao: true, status: true, ultimoAcesso: true, criadoEm: true, permissoes: true }
        });
        res.status(200).json(usuarios);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar equipe." }); }
};

exports.criarMembroEquipe = async (req, res) => {
    try {
        const { nome, email, funcao } = req.body;
        
        let permissoesDefault = {};
        if(funcao === 'ADMIN') permissoesDefault = { crm: 'tudo', conversas: 'tudo', calendario: 'tudo', conf: 'tudo' };
        if(funcao === 'ATENDENTE') permissoesDefault = { crm: 'editar', conversas: 'atender', calendario: 'ver' };
        
        const newUser = await prisma.usuario.create({
            data: { 
                nome, email, 
                funcao: funcao || 'ATENDENTE', 
                status: 'PENDENTE',
                permissoes: JSON.stringify(permissoesDefault)
            }
        });
        
        await registrarAtividade(1, 'Convidou Membro', 'Equipe', `Enviou convite de acesso para ${email}`);

        res.status(201).json(newUser);
    } catch (error) { res.status(500).json({ error: "Erro ao criar convite de membro." }); }
};

exports.atualizarMembroEquipe = async (req, res) => {
    try {
        const { status, funcao, permissoes } = req.body;
        const updateData = {};
        if (status) updateData.status = status;
        if (funcao) updateData.funcao = funcao;
        if (permissoes) updateData.permissoes = JSON.stringify(permissoes);

        const updated = await prisma.usuario.update({
            where: { id: parseInt(req.params.id) },
            data: updateData
        });

        let acaoStr = status === 'SUSPENSO' ? 'Suspendeu Acesso' : 'Alterou Permissões';
        await registrarAtividade(1, acaoStr, 'Equipe', `Atualizou o perfil de ${updated.nome}`);

        res.status(200).json(updated);
    } catch (error) { res.status(500).json({ error: "Erro ao atualizar membro." }); }
};

exports.getAtividadesEquipe = async (req, res) => {
    try {
        const atividades = await prisma.atividadeEquipe.findMany({
            take: 100,
            orderBy: { criadoEm: 'desc' },
            include: { usuario: { select: { nome: true, funcao: true, avatarUrl: true } } }
        });
        res.status(200).json(atividades);
    } catch (error) {
        res.status(200).json([]); 
    }
};

exports.getMembroPerfil = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const usuario = await prisma.usuario.findUnique({
            where: { id },
            select: { id: true, nome: true, email: true, funcao: true, status: true, ultimoAcesso: true, criadoEm: true }
        });
        
        const leadsAtribuidos = await prisma.cliente.count({ where: { responsavelId: id } });
        const agendamentos = await prisma.agendamento.count({ where: { profissionalSaudeId: id } });
        
        const atividades = await prisma.atividadeEquipe.findMany({
            where: { usuarioId: id }, take: 15, orderBy: { criadoEm: 'desc' }
        });

        res.status(200).json({ usuario, stats: { leadsAtribuidos, agendamentos }, atividades });
    } catch (error) { res.status(500).json({ error: "Erro ao buscar perfil." }); }
};