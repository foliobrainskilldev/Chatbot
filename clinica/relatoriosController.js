const { prisma } = require('../db');
const { startOfMonth, subMonths, format, startOfDay, subDays } = require('date-fns');

exports.getRelatoriosGerais = async (req, res) => {
    try {
        // 1. Leads por Origem
        const leadsOrigemAgrupados = await prisma.cliente.groupBy({
            by: ['origem'],
            _count: { origem: true },
        });
        const leadsPorOrigem = leadsOrigemAgrupados.map(o => ({ nome: o.origem, count: o._count.origem }));

        // 2. Conversão do Funil (Pipeline Counts)
        const pipelineStatus = await prisma.cliente.groupBy({
            by: ['leadStatus'],
            _count: { leadStatus: true },
        });
        const conversaoFunil = pipelineStatus.map(s => ({ nome: s.leadStatus, count: s._count.leadStatus }));

        // 3. Agendamentos dos últimos 30 dias (para gráfico de linhas contínuo)
        const agendamentosPorDia = [];
        for (let i = 29; i >= 0; i--) {
            const dataBase = subDays(new Date(), i);
            const dataInicio = startOfDay(dataBase);
            const dataFim = new Date(dataInicio.getTime() + 24 * 60 * 60 * 1000);
            
            const count = await prisma.agendamento.count({
                where: { 
                    criadoEm: { gte: dataInicio, lt: dataFim },
                    tratamentoId: { not: null }
                }
            });
            agendamentosPorDia.push({ data: format(dataBase, 'dd/MM'), count });
        }

        // 4. Taxa Absoluta de Cancelamentos
        const totalAgendamentos = await prisma.agendamento.count({ where: { tratamentoId: { not: null } } });
        const cancelados = await prisma.agendamento.count({ where: { tratamentoId: { not: null }, status: 'CANCELADO' } });
        let taxaCancelamento = totalAgendamentos > 0 ? ((cancelados / totalAgendamentos) * 100).toFixed(1) : 0;

        res.status(200).json({
            leadsPorOrigem,
            conversaoFunil,
            agendamentosPorDia,
            taxaCancelamento: parseFloat(taxaCancelamento)
        });
    } catch (error) {
        console.error("Erro Relatórios Analytics:", error);
        res.status(500).json({ error: "Erro ao gerar dados analíticos." });
    }
};

exports.getRelatoriosAtendimento = async (req, res) => {
    try {
        // Separa conversas exclusivas de IA vs Intervenção Humana
        const conversasIa = await prisma.mensagemIA.count({ where: { atendenteHumano: false, role: 'assistant' } });
        const conversasHumano = await prisma.mensagemIA.count({ where: { atendenteHumano: true, role: 'assistant' } });

        res.status(200).json({
            mensagensAutomatizadas: conversasIa,
            mensagensHumanas: conversasHumano
        });
    } catch (error) {
        res.status(500).json({ error: "Erro Analytics Atendimento." });
    }
};