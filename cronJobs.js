const cron = require('node-cron');
const { prisma } = require('./db');
const whatsappService = require('./whatsappService');
const { executarAcaoEGravarHistorico } = require('./services/automationEngine');
const { format, subDays, startOfDay, endOfDay } = require('date-fns');

const lembretesEnviados = new Set(); 
const avaliacoesEnviadas = new Set();

function iniciarAutomaçoes() {
    console.log('Robôs de Automação, Filas, CRM e Lembretes ativados.');

    // 1. LEMBRETE DE COMPROMISSO (A cada 15 minutos)
    cron.schedule('*/15 * * * *', async () => {
        const agora = new Date();
        const duasHorasFrente = new Date(agora.getTime() + 2 * 60 * 60 * 1000);
        try {
            const agendamentos = await prisma.agendamento.findMany({
                where: { status: 'AGENDADO', dataHora: { gte: agora, lte: duasHorasFrente } },
                include: { tratamento: true, cliente: true }
            });

            for (let ag of agendamentos) {
                if (!lembretesEnviados.has(ag.id)) {
                    lembretesEnviados.add(ag.id);
                    const nomeT = ag.tratamento ? ag.tratamento.nome : 'consulta';
                    const msgLembrete = `Olá ${ag.cliente.nome || ''}! Passando para lembrar da sua ${nomeT} hoje às ${format(ag.dataHora, 'HH:mm')}. Esperamos você na clínica!`;
                    await whatsappService.sendText(ag.clienteId, msgLembrete);
                    
                    // Adição de isolamento [SISTEMA] para que o NLP não confunda com o histórico de respostas da IA
                    await prisma.mensagemIA.create({ 
                        data: { role: 'assistant', content: `[SISTEMA - Lembrete Automático] ${msgLembrete}`, clienteId: ag.clienteId, atendenteHumano: false } 
                    });
                }
            }
        } catch (erro) { console.error("Erro no cron nativo de lembretes:", erro); }
    });

    // 2. AVALIAÇÃO NPS (Todo dia às 10h)
    cron.schedule('0 10 * * *', async () => {
        const ontem = subDays(new Date(), 1);
        try {
            const agendamentosOntem = await prisma.agendamento.findMany({
                where: { status: 'CONCLUIDO', dataHora: { gte: startOfDay(ontem), lte: endOfDay(ontem) } },
                include: { cliente: true }
            });
            for (let ag of agendamentosOntem) {
                if (!avaliacoesEnviadas.has(ag.id)) {
                    avaliacoesEnviadas.add(ag.id);
                    const msgFeedback = `Olá ${ag.cliente.nome || ''}! Como você avalia seu atendimento conosco ontem? (Responda de 1 a 5)`;
                    await whatsappService.sendText(ag.clienteId, msgFeedback);
                }
            }
        } catch (erro) {}
    }, { timezone: "Africa/Maputo" });

    // 3. PROCESSADOR DA FILA DE AUTOMAÇÕES (DELAY/ATRASO) (A cada 1 minuto)
    cron.schedule('* * * * *', async () => {
        try {
            const agora = new Date();
            const filaPendentes = await prisma.filaAutomacao.findMany({
                where: { status: 'AGUARDANDO', dataAgendada: { lte: agora } },
                include: { automacao: true }
            });

            if (filaPendentes.length === 0) return;

            for (const itemFila of filaPendentes) {
                await prisma.filaAutomacao.update({
                    where: { id: itemFila.id },
                    data: { status: 'PROCESSANDO' }
                });

                const dadosPayload = JSON.parse(itemFila.dadosPayload || '{}');
                await executarAcaoEGravarHistorico(itemFila.automacao, itemFila.clienteId, dadosPayload);

                await prisma.filaAutomacao.update({
                    where: { id: itemFila.id },
                    data: { status: 'CONCLUIDO' }
                });
            }
        } catch (erro) {
            if (!erro.message.includes('Table')) {
                console.error("Erro no Processador da Fila de Automações Delay:", erro.message);
            }
        }
    });
}

module.exports = { iniciarAutomaçoes };