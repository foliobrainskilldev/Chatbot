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
        const dataCorte = subDays(new Date(), dias);
        const inicioHoje = startOfDay(new Date());
        const fimHoje = endOfDay(new Date());

        const novosLeads = await prisma.cliente.count({ where: { leadStatus: 'NOVO', criadoEm: { gte: dataCorte } } });
        const leadsQualificados = await prisma.cliente.count({ where: { leadStatus: 'QUALIFICADO', criadoEm: { gte: dataCorte } } });
        
        // CORREÇÃO: Conta os agendamentos pela data em que foram feitos (criadoEm), e não a data de quando a consulta vai ocorrer.
        const agendamentosTotais = await prisma.agendamento.count({ 
            where: { status: 'AGENDADO', tratamentoId: { not: null }, criadoEm: { gte: dataCorte } } 
        });
        
        const totalLeadsPeriodo = await prisma.cliente.count({ where: { criadoEm: { gte: dataCorte } } });
        const leadsConvertidos = await prisma.cliente.count({ where: { leadStatus: 'CLIENTE', criadoEm: { gte: dataCorte } } });
        let taxaConversao = totalLeadsPeriodo > 0 ? ((leadsConvertidos / totalLeadsPeriodo) * 100).toFixed(1) : 0;

        // CORREÇÃO DA IA: Lógica Infalível. Total de Interações vs Transferências.
        const conversasIA = totalLeadsPeriodo;
        const transferidas = await prisma.cliente.count({ where: { falarHumano: true, criadoEm: { gte: dataCorte } } });
        const resolvidas = Math.max(0, conversasIA - transferidas);
        let txRes = conversasIA > 0 ? ((resolvidas / conversasIA) * 100).toFixed(1) : 0;
        
        const desempenhoIA = {
            conversasIA: conversasIA,
            transferidas: transferidas,
            resolvidas: resolvidas,
            taxaResolucao: txRes
        };

        const consultasHoje = await prisma.agendamento.count({ where: { tratamentoId: { not: null }, dataHora: { gte: inicioHoje, lte: fimHoje } } });
        const pendentesHoje = await prisma.agendamento.count({ where: { status: 'AGENDADO', tratamentoId: { not: null }, dataHora: { gte: inicioHoje, lte: fimHoje } } });

        // Traz os últimos agendamentos recém-criados para feedback em tempo real
        const agendamentosHojeList = await prisma.agendamento.findMany({
            where: { tratamentoId: { not: null } },
            include: { cliente: true, tratamento: true, profissionalSaude: true },
            orderBy: { criadoEm: 'desc' },
            take: 5
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

        const contagemFunil = await prisma.cliente.groupBy({ by: ['leadStatus'], _count: { leadStatus: true } });
        const getCount = (status) => { const f = contagemFunil.find(c => c.leadStatus === status); return f ? f._count.leadStatus : 0; };
        
        const graficoFunil = [
            { etapa: 'Conversas', valor: conversasIA },
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
            kpis: { conversasTotais: conversasIA, novosLeads, leadsQualificados, agendamentosTotais, taxaConversao, consultasHoje, pendentesHoje },
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