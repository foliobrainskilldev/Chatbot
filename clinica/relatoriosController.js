const { prisma } = require('../db');
const { startOfDay, endOfDay, subDays, format, parseISO } = require('date-fns');

function parsePeriodo(req) {
    const { periodo, inicio, fim } = req.query;
    let dataInicio, dataFim;
    
    if (periodo === 'custom' && inicio && fim) {
        dataInicio = startOfDay(parseISO(inicio));
        dataFim = endOfDay(parseISO(fim));
    } else {
        let dias = 30;
        if(periodo === 'hoje') dias = 0;
        else if(periodo === '7') dias = 7;
        else if(periodo === '90') dias = 90;
        else if(periodo === 'all') dias = 3650; // 10 anos
        
        dataInicio = startOfDay(subDays(new Date(), dias));
        dataFim = endOfDay(new Date());
    }
    return { dataInicio, dataFim };
}

function calcPercent(part, total) {
    return total > 0 ? ((part / total) * 100).toFixed(1) : 0;
}

exports.getRelatoriosGerais = async (req, res) => {
    try {
        const { dataInicio, dataFim } = parsePeriodo(req);
        const wherePeriodo = { criadoEm: { gte: dataInicio, lte: dataFim } };
        // CORREÇÃO: Relatórios devem buscar os agendamentos "CRIADOS NO PERÍODO" para refletir as conversões
        const whereAgendaPeriodo = { criadoEm: { gte: dataInicio, lte: dataFim }, tratamentoId: { not: null } };

        // 1. CARDS: Conversas
        const msgs = await prisma.mensagemIA.findMany({ where: wherePeriodo, select: { clienteId: true, role: true, atendenteHumano: true, tipoMidia: true, criadoEm: true } });
        const clientesIdsConversa = [...new Set(msgs.map(m => m.clienteId))];
        const clientesConversaram = await prisma.cliente.findMany({ where: { id: { in: clientesIdsConversa } } });
        
        const convTotal = clientesConversaram.length;
        const convNovas = clientesConversaram.filter(c => c.criadoEm >= dataInicio).length;
        const convResolvidas = clientesConversaram.filter(c => !c.falarHumano && ['AGENDADO', 'CLIENTE', 'QUALIFICADO'].includes(c.leadStatus)).length;

        // 2. CARDS: Leads
        const leadsNoPeriodo = await prisma.cliente.findMany({ where: wherePeriodo });
        const leadsNovos = leadsNoPeriodo.length;
        const leadsQualificados = leadsNoPeriodo.filter(l => ['QUALIFICADO', 'AGENDADO', 'CLIENTE'].includes(l.leadStatus)).length;
        const leadsConvertidos = leadsNoPeriodo.filter(l => l.leadStatus === 'CLIENTE').length;

        // 3. CARDS: Agendamentos
        const agendamentosAll = await prisma.agendamento.findMany({ where: whereAgendaPeriodo, include: { tratamento: true, profissionalSaude: true, cliente: true } });
        const agSolicitados = agendamentosAll.length;
        const agConfirmados = agendamentosAll.filter(a => a.status === 'CONFIRMADA' || a.status === 'AGENDADO').length;
        const agRealizados = agendamentosAll.filter(a => a.status === 'REALIZADA' || a.status === 'CONCLUIDO').length;
        const agCancelados = agendamentosAll.filter(a => a.status === 'CANCELADA').length;
        const agFalta = agendamentosAll.filter(a => a.status === 'FALTA').length;
        const agRemarcados = agendamentosAll.filter(a => a.status === 'REMARCADA').length;

        // 4. CARDS: IA Performance
        const transferidas = clientesConversaram.filter(c => c.falarHumano).length;
        const resolvidasIA = convTotal - transferidas;
        const iaAgendou = agendamentosAll.filter(a => !a.cliente.falarHumano).length;
        const msgsRec = msgs.filter(m => m.role === 'user').length;
        const msgsIa = msgs.filter(m => m.role === 'assistant' && !m.atendenteHumano).length;
        const msgsHum = msgs.filter(m => m.role === 'assistant' && m.atendenteHumano).length;
        
        // 5. FUNIL COM LOSS
        const stepInteressados = leadsNovos;
        const stepQualificados = leadsQualificados;
        const stepAgendados = agendamentosAll.filter(a => a.status !== 'CANCELADA').map(a => a.clienteId);
        const uniqueAgendados = [...new Set(stepAgendados)].length;
        const uniquePacientes = [...new Set(agendamentosAll.filter(a => a.status === 'REALIZADA' || a.status === 'CONCLUIDO').map(a => a.clienteId))].length;

        const funil = [
            { nome: 'Interessados', valor: stepInteressados, perdaQtd: stepInteressados - stepQualificados, perdaPerc: calcPercent(stepInteressados - stepQualificados, stepInteressados) },
            { nome: 'Qualificados', valor: stepQualificados, perdaQtd: stepQualificados - uniqueAgendados, perdaPerc: calcPercent(stepQualificados - uniqueAgendados, stepQualificados) },
            { nome: 'Consulta Marcada', valor: uniqueAgendados, perdaQtd: uniqueAgendados - uniquePacientes, perdaPerc: calcPercent(uniqueAgendados - uniquePacientes, uniqueAgendados) },
            { nome: 'Pacientes', valor: uniquePacientes, perdaQtd: 0, perdaPerc: 0 }
        ];

        // 6. ORIGENS E TRATAMENTOS
        const origensMap = {};
        leadsNoPeriodo.forEach(l => {
            const o = l.origem || 'Desconhecida';
            if(!origensMap[o]) origensMap[o] = { origem: o, leads: 0, qualificados: 0, agendados: 0 };
            origensMap[o].leads++;
            if(['QUALIFICADO', 'AGENDADO', 'CLIENTE'].includes(l.leadStatus)) origensMap[o].qualificados++;
        });
        agendamentosAll.forEach(a => {
            const o = a.cliente.origem || 'Desconhecida';
            if(origensMap[o]) origensMap[o].agendados++;
        });
        const origensData = Object.values(origensMap).map(o => ({ ...o, conversao: calcPercent(o.agendados, o.leads) }));

        const tratMap = {};
        agendamentosAll.forEach(a => {
            const t = a.tratamento.nome;
            const p = a.tratamento.preco || 0;
            if(!tratMap[t]) tratMap[t] = { nome: t, interessados: 0, agendados: 0, pacientes: 0, valorPotencial: 0 };
            tratMap[t].agendados++;
            if(a.status === 'REALIZADA' || a.status === 'CONCLUIDO') tratMap[t].pacientes++;
            tratMap[t].valorPotencial += p;
        });
        const tratData = Object.values(tratMap).map(t => ({ ...t, interessados: Math.floor(t.agendados * 1.5) }));

        // 7. EVOLUÇÃO
        const evolucaoMap = {};
        let stepDate = new Date(dataInicio);
        while(stepDate <= dataFim) {
            const fd = format(stepDate, 'dd/MM');
            evolucaoMap[fd] = { data: fd, leads: 0, qualificados: 0, agendamentos: 0 };
            stepDate.setDate(stepDate.getDate() + 1);
        }
        leadsNoPeriodo.forEach(l => {
            const fd = format(l.criadoEm, 'dd/MM');
            if(evolucaoMap[fd]) {
                evolucaoMap[fd].leads++;
                if(['QUALIFICADO','AGENDADO','CLIENTE'].includes(l.leadStatus)) evolucaoMap[fd].qualificados++;
            }
        });
        agendamentosAll.forEach(a => {
            const fd = format(a.criadoEm, 'dd/MM'); // Corrigido para computar o gráfico pelo dia da venda/agendamento
            if(evolucaoMap[fd]) evolucaoMap[fd].agendamentos++;
        });

        res.status(200).json({
            cards: {
                conversas: { total: convTotal, novas: convNovas, resolvidas: convResolvidas },
                leads: { novos: leadsNovos, qualificados: leadsQualificados, convertidos: leadsConvertidos },
                agendamentos: { solicitados: agSolicitados, confirmados: agConfirmados, realizados: agRealizados, cancelados: agCancelados, faltas: agFalta },
                conversao: { 
                    qualificacao: calcPercent(leadsQualificados, leadsNovos), 
                    agendamento: calcPercent(uniqueAgendados, leadsQualificados), 
                    comparecimento: calcPercent(agRealizados, agConfirmados),
                    final: calcPercent(agRealizados, leadsNovos) 
                }
            },
            ia: {
                atendidas: convTotal,
                resolvidas: resolvidasIA,
                transferidas: transferidas,
                taxaResolucao: calcPercent(resolvidasIA, convTotal),
                agendamentos: iaAgendou
            },
            funil: funil,
            origens: origensData,
            tratamentos: tratData,
            evolucao: Object.values(evolucaoMap)
        });

    } catch (error) {
        console.error("❌ Erro Relatórios Analíticos Completo:", error);
        res.status(500).json({ error: "Erro ao gerar matriz de dados analíticos." });
    }
};

exports.exportarRelatorioCSV = async (req, res) => {
    try {
        const { tipo, dias } = req.query;
        let dataInicio = startOfDay(subDays(new Date(), dias === 'all' ? 3650 : (parseInt(dias) || 30)));
        let csv = "";

        if (tipo === 'leads' || tipo === 'completo') {
            const leads = await prisma.cliente.findMany({ where: { criadoEm: { gte: dataInicio } } });
            csv += "ID,NOME,STATUS,ORIGEM,VALOR POTENCIAL,CRIADO EM\n";
            leads.forEach(l => { csv += `${l.id},${l.nome || 'Sem Nome'},${l.leadStatus},${l.origem},${l.valorPotencial},${format(l.criadoEm, 'dd/MM/yyyy')}\n`; });
            if(tipo === 'completo') csv += "\n\n";
        }

        if (tipo === 'agendamentos' || tipo === 'completo') {
            const ags = await prisma.agendamento.findMany({ 
                where: { dataHora: { gte: dataInicio }, tratamentoId: { not: null } },
                include: { cliente: true, tratamento: true, profissionalSaude: true }
            });
            if(tipo === 'completo') csv += "--- AGENDAMENTOS ---\n";
            csv += "DATA HORA,PACIENTE,TRATAMENTO,MEDICO,STATUS\n";
            ags.forEach(a => { csv += `${format(a.dataHora, 'dd/MM/yyyy HH:mm')},${a.cliente.nome || a.clienteId},${a.tratamento.nome},${a.profissionalSaude?.nome || 'Sem Preferência'},${a.status}\n`; });
        }

        res.header('Content-Type', 'text/csv');
        res.attachment(`export_${tipo}_${Date.now()}.csv`);
        res.status(200).send(csv);
    } catch (error) {
        res.status(500).json({ error: "Erro ao gerar arquivo de exportação." });
    }
};

exports.getRelatoriosAtendimento = async (req, res) => {
    res.status(200).json({ message: "Rota obsoleta. Usar getRelatoriosGerais." });
};