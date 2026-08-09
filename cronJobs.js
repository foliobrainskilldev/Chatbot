const cron = require('node-cron');
const { prisma } = require('./db');
const { sendDelayedText } = require('./botUtils');
const { gerarMensagemNotificacao } = require('./groqApi');
const { format, subDays, startOfDay, endOfDay } = require('date-fns');

let getMessageStateData = () => {
    const { stateMachine } = require('./messageHandler');
    return { stateMachine };
};

const lembretesEnviados = new Set(); 
const avaliacoesEnviadas = new Set();

function iniciarLembretesEFollowUp() {
    console.log('⏰ Robô de Automações (CRM) ativado. Verificando permissões do banco.');

    // 1. FOLLOW-UP AUTOMÁTICO (A cada 5 minutos)
    cron.schedule('*/5 * * * *', async () => {
        const config = await prisma.configSistema.findFirst();
        if (!config || !config.autoFollowUp) return; // Trava de segurança do Painel

        const { stateMachine } = getMessageStateData();
        const agora = Date.now();
        
        for (let [numero, state] of stateMachine.entries()) {
            if (state.step && (state.step.startsWith('AGENDAMENTO_') || state.step.startsWith('CLINICA_')) && !state.step.includes('CONFIRMAR')) {
                const tempoParado = agora - (state.lastActive || agora);
                
                if (tempoParado > 15 * 60 * 1000 && !state.notified) {
                    state.notified = true; 
                    const clienteDb = await prisma.cliente.findUnique({ where: { id: numero } });
                    await prisma.cliente.update({ where: { id: numero }, data: { tags: 'abandonou_funil' } });

                    const txt = await gerarMensagemNotificacao(`O cliente ${clienteDb?.nome||'Amigo'} abandonou o agendamento há 15 min. Escreva um recado perguntando se precisa de ajuda. PROIBIDO USAR EMOJIS.`, "Notei que não terminou de agendar. Posso ajudar?");
                    await sendDelayedText(null, numero, txt);
                }
            }
        }
    });

    // 2. LEMBRETE DE COMPROMISSO (A cada 15 minutos)
    cron.schedule('*/15 * * * *', async () => {
        const config = await prisma.configSistema.findFirst();
        if (!config || !config.autoLembrete) return; // Trava de segurança do Painel

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
                    const nomeServico = ag.servico ? ag.servico.nome : (ag.tratamento ? ag.tratamento.nome : 'compromisso');
                    const txt = await gerarMensagemNotificacao(`Cliente ${ag.cliente.nome||'Amigo'} tem ${nomeServico} às ${format(ag.dataHora, 'HH:mm')}. Lembre-o. Sem emojis.`, `Passando para lembrar do seu horário hoje às ${format(ag.dataHora, 'HH:mm')}.`);
                    await sendDelayedText(null, ag.clienteId, txt);
                }
            }
        } catch (erro) {}
    });

    // 3. SOLICITAÇÃO DE FEEDBACK (Pós-Venda, Corre 10h da manhã)
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
                    await sendDelayedText(null, ag.clienteId, `Olá ${ag.cliente.nome || ''}! Como avalia a sua experiência connosco ontem? (De 1 a 5) ⭐`);
                }
            }
        } catch (erro) {}
    }, { timezone: "Africa/Maputo" });
}

module.exports = { iniciarLembretesEFollowUp };