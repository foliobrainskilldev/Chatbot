const cron = require('node-cron');
const { prisma } = require('./db');
const whatsappService = require('./whatsappService');
const aiService = require('./aiService');
const { format, subDays, startOfDay, endOfDay } = require('date-fns');
const { stateMachine } = require('./botEngine');

const lembretesEnviados = new Set(); 
const avaliacoesEnviadas = new Set();

function iniciarAutomaçoes() {
    console.log('⏰ Robôs de Automação (Follow-Up / Lembretes) ativados.');

    // 1. FOLLOW-UP AUTOMÁTICO (Roda a cada 5 minutos)
    cron.schedule('*/5 * * * *', async () => {
        const config = await prisma.configSistema.findFirst();
        if (!config || !config.autoFollowUp) return;

        const agora = Date.now();
        
        for (let [numero, state] of stateMachine.entries()) {
            // Verifica se o usuário parou no meio de um agendamento
            if (state.step && state.step.includes('AGENDAMENTO_') && !state.step.includes('CONFIRMAR')) {
                const tempoParado = agora - (state.lastActive || agora);
                
                // Se parado por mais de 15 minutos e ainda não notificado
                if (tempoParado > 15 * 60 * 1000 && !state.notified) {
                    state.notified = true; 
                    const clienteDb = await prisma.cliente.findUnique({ where: { id: numero } });
                    await prisma.cliente.update({ where: { id: numero }, data: { tags: 'abandonou_funil' } });

                    const promptInstrucao = `O cliente ${clienteDb?.nome || 'Amigo'} parou no meio do agendamento há 15 minutos. Escreva uma mensagem muito curta perguntando se ele precisa de ajuda para finalizar. SEM EMOJIS.`;
                    const txt = await aiService.gerarMensagemNotificacaoIA(promptInstrucao, "Notei que você não terminou de agendar. Posso ajudar em algo?");
                    
                    await whatsappService.sendText(numero, txt, false);
                }
            }
        }
    });

    // 2. LEMBRETE DE COMPROMISSO (Roda a cada 15 minutos)
    cron.schedule('*/15 * * * *', async () => {
        const config = await prisma.configSistema.findFirst();
        if (!config || !config.autoLembrete) return;

        const agora = new Date();
        const duasHorasFrente = new Date(agora.getTime() + 2 * 60 * 60 * 1000);
        
        try {
            const agendamentos = await prisma.agendamento.findMany({
                where: { status: 'AGENDADO', dataHora: { gte: agora, lte: duasHorasFrente } },
                include: { servico: true, tratamento: true, cliente: true }
            });

            for (let ag of agendamentos) {
                if (!lembretesEnviados.has(ag.id)) {
                    lembretesEnviados.add(ag.id);
                    
                    const nomeSrv = ag.servico ? ag.servico.nome : (ag.tratamento ? ag.tratamento.nome : 'compromisso');
                    const promptInstrucao = `Gere uma notificação curta de lembrete de consulta. O cliente ${ag.cliente.nome || 'Amigo'} tem o serviço de ${nomeSrv} hoje às ${format(ag.dataHora, 'HH:mm')}. SEM EMOJIS.`;
                    
                    const txt = await aiService.gerarMensagemNotificacaoIA(promptInstrucao, `Passando para lembrar do seu horário hoje às ${format(ag.dataHora, 'HH:mm')}. Aguardamos você.`);
                    await whatsappService.sendText(ag.clienteId, txt, false);
                }
            }
        } catch (erro) {
            console.error("Erro interno no cron de lembretes:", erro);
        }
    });

    // 3. SOLICITAÇÃO DE FEEDBACK (Corre todos os dias às 10h da manhã - Horário de Maputo)
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
                    await prisma.agendamento.update({ where: { id: ag.id }, data: { status: 'AVALIADO' } });
                    await whatsappService.sendText(ag.clienteId, `Olá ${ag.cliente.nome || ''}! Como você avalia a sua experiência conosco ontem? (De 1 a 5) ⭐`, false);
                }
            }
        } catch (erro) {
            console.error("Erro interno no cron de avaliações:", erro);
        }
    }, { timezone: "Africa/Maputo" });
}

module.exports = { iniciarAutomaçoes };