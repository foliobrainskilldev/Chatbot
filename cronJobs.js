const cron = require('node-cron');
const { prisma } = require('./db');
const whatsappService = require('./whatsappService');
const webhookService = require('./services/webhookService');
const { format, subDays, startOfDay, endOfDay } = require('date-fns');

const lembretesEnviados = new Set(); 
const avaliacoesEnviadas = new Set();

function iniciarAutomaçoes() {
    console.log('Robôs de Automação, CRM e Lembretes ativados.');

    // 1. LEMBRETE DE COMPROMISSO (A cada 15 minutos)
    cron.schedule('*/15 * * * *', async () => {
        const agora = new Date();
        const duasHorasFrente = new Date(agora.getTime() + 2 * 60 * 60 * 1000);
        
        try {
            const agendamentos = await prisma.agendamento.findMany({
                where: { 
                    status: 'AGENDADO', 
                    dataHora: { gte: agora, lte: duasHorasFrente } 
                },
                include: { tratamento: true, cliente: true }
            });

            for (let ag of agendamentos) {
                if (!lembretesEnviados.has(ag.id)) {
                    lembretesEnviados.add(ag.id);
                    const nomeT = ag.tratamento ? ag.tratamento.nome : 'consulta';
                    
                    const msgLembrete = `Olá ${ag.cliente.nome || ''}! Passando para lembrar da sua ${nomeT} hoje às ${format(ag.dataHora, 'HH:mm')}. Esperamos você na clínica!`;
                    await whatsappService.sendText(ag.clienteId, msgLembrete);
                    
                    // Salva a mensagem no histórico do chat (Painel Inbox)
                    await prisma.mensagemIA.create({ data: { role: 'assistant', content: `[Lembrete Automático] ${msgLembrete}`, clienteId: ag.clienteId, atendenteHumano: false } });
                }
            }
        } catch (erro) {
            console.error("Erro no cron de lembretes:", erro);
        }
    });

    // 2. AVALIAÇÃO DE ATENDIMENTO / FEEDBACK (Todo dia às 10h da manhã)
    cron.schedule('0 10 * * *', async () => {
        const ontem = subDays(new Date(), 1);
        try {
            const agendamentosOntem = await prisma.agendamento.findMany({
                where: { 
                    status: 'CONCLUIDO', 
                    dataHora: { gte: startOfDay(ontem), lte: endOfDay(ontem) } 
                },
                include: { cliente: true }
            });
            for (let ag of agendamentosOntem) {
                if (!avaliacoesEnviadas.has(ag.id)) {
                    avaliacoesEnviadas.add(ag.id);
                    
                    // Move o Lead para CLIENTE no Funil CRM (já que ele concluiu a consulta)
                    const clienteConvertido = await prisma.cliente.update({ 
                        where: { id: ag.clienteId }, 
                        data: { leadStatus: 'CLIENTE' } 
                    });

                    const msgFeedback = `Olá ${ag.cliente.nome || ''}! Esperamos que sua experiência ontem tenha sido excelente. Como você avalia seu atendimento conosco? (Por favor, responda com uma nota de 1 a 5 ou deixe seu comentário).`;
                    await whatsappService.sendText(ag.clienteId, msgFeedback);

                    await webhookService.dispararEvento('lead.converted', clienteConvertido);
                }
            }
        } catch (erro) {}
    }, { timezone: "Africa/Maputo" });
}

module.exports = { iniciarAutomaçoes };