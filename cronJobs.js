const cron = require('node-cron');
const { prisma } = require('./db');
const whatsappService = require('./whatsappService');
const { executarAcaoEGravarHistorico } = require('./services/automationEngine');
const { format, subDays, startOfDay, endOfDay } = require('date-fns');

const lembretesEnviados = new Set(); 
const avaliacoesEnviadas = new Set();

function iniciarAutomaçoes() {
    console.log('Robôs de Automação, Filas, CRM e Lembretes ativados.');

    // 1. LEMBRETE DE COMPROMISSO (Roda a cada 15 minutos e lê as próximas 2 horas absolutas do servidor)
    cron.schedule('*/15 * * * *', async () => {
        const agora = new Date();
        const duasHorasFrente = new Date(agora.getTime() + 2 * 60 * 60 * 1000);
        try {
            const agendamentos = await prisma.agendamento.findMany({
                where: { status: 'AGENDADO', dataHora: { gte: agora, lte: duasHorasFrente } },
                include: { tratamento: true, servico: true, cliente: true }
            });

            for (let ag of agendamentos) {
                if (!lembretesEnviados.has(ag.id)) {
                    lembretesEnviados.add(ag.id);
                    // Suporta tanto o modelo da barbearia (servico) quanto o da clínica (tratamento)
                    const nomeT = ag.tratamento ? ag.tratamento.nome : (ag.servico ? ag.servico.nome : 'consulta/serviço');
                    const msgLembrete = `Olá ${ag.cliente.nome || ''}! Passando para lembrar do seu agendamento de ${nomeT} hoje às ${format(ag.dataHora, 'HH:mm')}. Esperamos você!`;
                    
                    await whatsappService.sendText(ag.clienteId, msgLembrete);
                    
                    // Adição de isolamento [SISTEMA] para que o NLP não confunda com o histórico de respostas da IA
                    await prisma.mensagemIA.create({ 
                        data: { role: 'assistant', content: `[SISTEMA - Lembrete Automático] ${msgLembrete}`, clienteId: ag.clienteId, atendenteHumano: false } 
                    });
                }
            }
        } catch (erro) { console.error("Erro no cron nativo de lembretes:", erro); }
    });

    // 2. AVALIAÇÃO NPS (Roda a cada hora redonda - Verifica se é 10h da manhã no fuso configurado no banco)
    cron.schedule('0 * * * *', async () => {
        try {
            const configDb = await prisma.configSistema.findFirst();
            const fusoHorario = configDb?.fusoHorario || 'Africa/Maputo';
            
            // Pega a hora atual exatamente no fuso horário configurado pelo usuário
            const horaLocalIntl = new Intl.DateTimeFormat('pt-BR', { timeZone: fusoHorario, hour: 'numeric', hourCycle: 'h23' }).format(new Date());
            
            // Se for 10h da manhã no país configurado, dispara o NPS do dia anterior
            if (parseInt(horaLocalIntl) === 10) {
                const ontem = subDays(new Date(), 1);
                
                const agendamentosOntem = await prisma.agendamento.findMany({
                    where: { status: { in: ['CONCLUIDO', 'REALIZADA'] }, dataHora: { gte: startOfDay(ontem), lte: endOfDay(ontem) } },
                    include: { cliente: true }
                });
                
                for (let ag of agendamentosOntem) {
                    if (!avaliacoesEnviadas.has(ag.id)) {
                        avaliacoesEnviadas.add(ag.id);
                        const msgFeedback = `Olá ${ag.cliente.nome || ''}! Como você avalia seu atendimento conosco ontem? (Responda com um número de 1 a 5)`;
                        await whatsappService.sendText(ag.clienteId, msgFeedback);
                        
                        await prisma.mensagemIA.create({ 
                            data: { role: 'assistant', content: `[SISTEMA - Pesquisa NPS] ${msgFeedback}`, clienteId: ag.clienteId, atendenteHumano: false } 
                        });
                    }
                }
            }
        } catch (erro) {
            console.error("Erro no cron de Avaliação NPS:", erro.message);
        }
    });

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