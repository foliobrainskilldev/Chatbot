const cron = require('node-cron');
const { prisma } = require('./db');
const { sendDelayedText } = require('./botUtils');
const { gerarMensagemNotificacao } = require('./groqApi');
const { format, subDays, startOfDay, endOfDay } = require('date-fns');

let getMessageStateData = () => {
    const { stateMachine, STEPS } = require('./messageHandler');
    return { stateMachine, STEPS };
};

const lembretesEnviados = new Set(); 
const avaliacoesEnviadas = new Set();

function iniciarLembretesEFollowUp() {
    console.log('⏰ Robô Inteligente de Automações, Lembretes e Follow-up (CRM) iniciado!');

    // 1. RECUPERAÇÃO DE ABANDONO (Follow-up de Leads - Corre a cada 5 minutos)
    cron.schedule('*/5 * * * *', async () => {
        const { stateMachine } = getMessageStateData();
        const agora = Date.now();
        const horaMaputo = new Date().toLocaleString("pt-PT", { timeZone: "Africa/Maputo" });
        
        for (let [numero, state] of stateMachine.entries()) {
            if (state.step && (state.step.startsWith('AGENDAMENTO_') || state.step.startsWith('CLINICA_')) && !state.step.includes('CONFIRMAR')) {
                const tempoParado = agora - (state.lastActive || agora);
                
                // 15 minutos de inatividade no meio de uma marcação
                if (tempoParado > 15 * 60 * 1000 && !state.notified) {
                    state.notified = true; 
                    
                    const clienteDb = await prisma.cliente.findUnique({ where: { id: numero } });
                    const nomeCli = clienteDb?.nome || 'Amigo';

                    // Atualiza no CRM que o lead precisa de follow-up
                    await prisma.cliente.update({ where: { id: numero }, data: { tags: 'abandonou_funil' } });

                    const promptIa = `O cliente ${nomeCli} abandonou o processo de agendamento há 15 minutos. Escreve uma mensagem curta e amigável perguntando se ele precisa de ajuda ou se prefere enviar 'Menu' para recomeçar. PROIBIDO USAR EMOJIS.`;
                    const fallbackMsg = `Notei que começaste a agendar mas não terminaste. Posso ajudar ou preferes enviar Menu para recomeçar?`;
                    
                    const textoIa = await gerarMensagemNotificacao(promptIa, fallbackMsg);
                    await sendDelayedText(null, numero, textoIa);
                }
            }
        }
    });

    // 2. LEMBRETE DE COMPROMISSO (Barbearia e Clínica - Corre a cada 15 minutos)
    cron.schedule('*/15 * * * *', async () => {
        const agora = new Date();
        const duasHorasFrente = new Date(agora.getTime() + 2 * 60 * 60 * 1000);
        
        try {
            const agendamentos = await prisma.agendamento.findMany({
                where: {
                    status: 'AGENDADO',
                    dataHora: { gte: agora, lte: duasHorasFrente }
                },
                include: { servico: true, tratamento: true, cliente: true }
            });

            for (let ag of agendamentos) {
                if (!lembretesEnviados.has(ag.id)) {
                    lembretesEnviados.add(ag.id);
                    
                    const horaFormatada = format(ag.dataHora, 'HH:mm');
                    const nomeCli = ag.cliente?.nome || 'Cliente';
                    const nomeServico = ag.servico ? ag.servico.nome : (ag.tratamento ? ag.tratamento.nome : 'seu compromisso');

                    const promptIa = `O cliente ${nomeCli} tem ${nomeServico} marcado para daqui a pouco, às ${horaFormatada}. Escreve um lembrete educado confirmando. Sem emojis.`;
                    const fallbackMsg = `Passando para lembrar do seu agendamento de ${nomeServico} hoje às ${horaFormatada}. Aguardamos por si.`;
                    
                    const textoIa = await gerarMensagemNotificacao(promptIa, fallbackMsg);
                    await sendDelayedText(null, ag.clienteId, textoIa);
                }
            }
        } catch (erro) {
            console.error('❌ Erro no robô de lembretes:', erro);
        }
    });

    // 3. SOLICITAÇÃO DE AVALIAÇÃO PÓS-ATENDIMENTO (Corre todos os dias às 10:00 da manhã)
    cron.schedule('0 10 * * *', async () => {
        const ontem = subDays(new Date(), 1);
        const inicioOntem = startOfDay(ontem);
        const fimOntem = endOfDay(ontem);

        try {
            // Busca todos os agendamentos que ocorreram ontem
            const agendamentosOntem = await prisma.agendamento.findMany({
                where: {
                    status: 'AGENDADO', // Na prática do CRM, o lojista marcaria como CONCLUIDO, mas verificamos pela data passada
                    dataHora: { gte: inicioOntem, lte: fimOntem }
                },
                include: { cliente: true }
            });

            for (let ag of agendamentosOntem) {
                if (!avaliacoesEnviadas.has(ag.id)) {
                    avaliacoesEnviadas.add(ag.id);
                    // Atualiza status para avaliado para não enviar novamente
                    await prisma.agendamento.update({ where: { id: ag.id }, data: { status: 'AVALIADO' } });
                    
                    const msgAvaliacao = `Olá ${ag.cliente.nome || ''}! Esperamos que tenha gostado do seu atendimento ontem.\nDe 1 a 5, como avalia a sua experiência connosco?\n\n(Pode apenas responder com o número, ou deixar um comentário!)`;
                    await sendDelayedText(null, ag.clienteId, msgAvaliacao);
                }
            }
        } catch (erro) {
            console.error('❌ Erro no robô de avaliação:', erro);
        }
    }, {
        timezone: "Africa/Maputo"
    });
}

module.exports = { iniciarLembretesEFollowUp };