const { prisma } = require('../../db');
const automationEngine = require('../../services/automationEngine');
const webhookService = require('../../services/webhookService');
const { startOfDay, endOfDay, subDays, format } = require('date-fns');

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
        const dataCorte = startOfDay(subDays(new Date(), dias));
        const inicioHoje = startOfDay(new Date());
        const fimHoje = endOfDay(new Date());

        // OTIMIZAÇÃO MASSIVA: Reduzimos 16 consultas para apenas 3! Evita travamento (Timeout) no banco de dados.
        const [leadsNoPeriodo, agendamentosNoPeriodo, consultasHojeList] = await Promise.all([
            // 1. Busca todos os Leads do período
            prisma.cliente.findMany({
                where: { criadoEm: { gte: dataCorte } },
                select: { id: true, nome: true, leadStatus: true, origem: true, falarHumano: true, criadoEm: true, ultimaInteracao: true, tags: true }
            }),
            // 2. Busca Agendamentos criados no período
            prisma.agendamento.findMany({
                where: { tratamentoId: { not: null }, criadoEm: { gte: dataCorte } },
                include: { tratamento: true, profissionalSaude: true, cliente: true }
            }),
            // 3. Busca Agendamentos que OCORREM hoje (Independente de quando foram criados)
            prisma.agendamento.findMany({
                where: { tratamentoId: { not: null }, dataHora: { gte: inicioHoje, lte: fimHoje } },
                include: { cliente: true, tratamento: true, profissionalSaude: true }
            })
        ]);

        // Processamento ultra-rápido na Memória RAM
        const totalLeadsPeriodo = leadsNoPeriodo.length;
        const novosLeads = leadsNoPeriodo.filter(l => l.leadStatus === 'NOVO').length;
        const leadsQualificados = leadsNoPeriodo.filter(l => l.leadStatus === 'QUALIFICADO').length;
        const leadsConvertidos = leadsNoPeriodo.filter(l => l.leadStatus === 'CLIENTE').length;
        const transferidas = leadsNoPeriodo.filter(l => l.falarHumano).length;

        const agendamentosTotais = agendamentosNoPeriodo.filter(a => a.status === 'AGENDADO').length;
        
        const consultasHoje = consultasHojeList.length;
        const pendentesHoje = consultasHojeList.filter(a => a.status === 'AGENDADO').length;

        let taxaConversao = totalLeadsPeriodo > 0 ? ((leadsConvertidos / totalLeadsPeriodo) * 100).toFixed(1) : 0;
        
        const conversasIA = totalLeadsPeriodo;
        const resolvidas = Math.max(0, conversasIA - transferidas);
        let txRes = conversasIA > 0 ? ((resolvidas / conversasIA) * 100).toFixed(1) : 0;

        // Avisos de Atenção (Gente esperando humano)
        const atencaoNecessaria = leadsNoPeriodo
            .filter(l => l.falarHumano)
            .slice(0, 5)
            .map(lead => ({ clienteId: lead.id, clienteNome: lead.nome, motivo: 'Aguardando Atendimento Humano' }));

        // Leads Recentes
        const leadsRecentes = leadsNoPeriodo
            .sort((a, b) => new Date(b.ultimaInteracao) - new Date(a.ultimaInteracao))
            .slice(0, 5);

        // Consultas que acabaram de ser marcadas
        const agendamentosHojeList = agendamentosNoPeriodo
            .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm))
            .slice(0, 5);

        // FUNIL
        const getCount = (status) => leadsNoPeriodo.filter(l => l.leadStatus === status).length;
        const graficoFunil = [
            { etapa: 'Conversas', valor: conversasIA },
            { etapa: 'Novos', valor: getCount('NOVO') },
            { etapa: 'Qualificados', valor: getCount('QUALIFICADO') },
            { etapa: 'Agendados', valor: getCount('AGENDADO') },
            { etapa: 'Clientes', valor: getCount('CLIENTE') }
        ];

        // SERVIÇOS MAIS PROCURADOS
        const servicosMap = {};
        agendamentosNoPeriodo.filter(a => a.status === 'AGENDADO').forEach(a => {
            const nome = a.tratamento?.nome || 'Desconhecido';
            servicosMap[nome] = (servicosMap[nome] || 0) + 1;
        });
        const topServicos = Object.entries(servicosMap)
            .map(([nome, count]) => ({ nome, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // ORIGENS
        const origensMap = {};
        leadsNoPeriodo.forEach(l => {
            const o = l.origem || 'Outros';
            origensMap[o] = (origensMap[o] || 0) + 1;
        });
        const origensFormatadas = Object.entries(origensMap).map(([origem, count]) => ({ origem, count }));

        // EVOLUÇÃO (Gráfico de Linha Diário)
        const evolucaoMap = {};
        for (let i = dias - 1; i >= 0; i--) {
            const diaAlvo = subDays(new Date(), i);
            evolucaoMap[format(diaAlvo, 'dd/MM')] = { leads: 0, agendamentos: 0 };
        }
        leadsNoPeriodo.forEach(l => {
            const fd = format(l.criadoEm, 'dd/MM');
            if(evolucaoMap[fd]) evolucaoMap[fd].leads++;
        });
        agendamentosNoPeriodo.forEach(a => {
            const fd = format(a.criadoEm, 'dd/MM');
            if(evolucaoMap[fd]) evolucaoMap[fd].agendamentos++;
        });
        const evolucao = Object.keys(evolucaoMap).map(k => ({ data: k, leads: evolucaoMap[k].leads, agendamentos: evolucaoMap[k].agendamentos }));

        res.status(200).json({
            kpis: { conversasTotais: conversasIA, novosLeads, leadsQualificados, agendamentosTotais, taxaConversao, consultasHoje, pendentesHoje },
            agendamentosHoje: agendamentosHojeList,
            leadsRecentes: leadsRecentes,
            atencaoNecessaria: atencaoNecessaria,
            desempenhoIA: { conversasIA, transferidas, resolvidas, taxaResolucao: txRes },
            graficos: { funil: graficoFunil, servicos: topServicos, origens: origensFormatadas, evolucao: evolucao }
        });

    } catch (error) { 
        console.error("Erro interno ao mapear o Dashboard:", error);
        res.status(500).json({ error: "Erro interno ao mapear o Dashboard. Detalhe: " + error.message }); 
    }
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