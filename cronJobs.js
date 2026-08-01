// --- START OF FILE cronJobs.js ---
const cron = require('node-cron');
const { prisma } = require('./db');
const { sendDelayedText } = require('./botUtils');
const { gerarMensagemNotificacao } = require('./groqApi');
const { format } = require('date-fns');

// Como o node require guarda a referência na memória, podemos importar o stateMachine depois que o server arrancar
let getMessageStateData = () => {
    const { stateMachine, STEPS } = require('./messageHandler');
    return { stateMachine, STEPS };
};

const lembretesEnviados = new Set(); 

function iniciarLembretesEFollowUp() {
    console.log('⏰ Robô Inteligente de Lembretes e Recuperação iniciado!');

    // 1. RECUPERAÇÃO DE ABANDONO (Corre a cada 5 minutos)
    cron.schedule('*/5 * * * *', async () => {
        const { stateMachine, STEPS } = getMessageStateData();
        const agora = Date.now();
        
        for (let [numero, state] of stateMachine.entries()) {
            if (state.step && state.step.startsWith('AGENDAMENTO_') && state.step !== STEPS.AGENDAMENTO_CONFIRMAR) {
                const tempoParado = agora - (state.lastActive || agora);
                
                // 15 minutos de inatividade
                if (tempoParado > 15 * 60 * 1000 && !state.notified) {
                    state.notified = true; 
                    
                    // Busca nome do cliente para a IA personalizar
                    const clienteDb = await prisma.cliente.findUnique({ where: { id: numero } });
                    const nomeCli = clienteDb?.nome || 'Amigo';

                    const promptIa = `O cliente ${nomeCli} estava a tentar marcar um serviço na barbearia mas abandonou a conversa no meio do processo há 15 minutos. Escreve uma mensagem perguntando se ele precisa de ajuda ou se quer recomeçar enviando a palavra Menu. (LEMBRE-SE: PROIBIDO USAR EMOJIS).`;
                    const fallbackMsg = `Notei que comecaste a agendar mas nao terminaste. Posso ajudar ou preferes enviar Menu para recomecar?`;
                    
                    const textoIa = await gerarMensagemNotificacao(promptIa, fallbackMsg);
                    await sendDelayedText(null, numero, textoIa);
                    console.log(`♻️ Follow-up IA (Sem Emojis) enviado para: ${numero}`);
                }
            }
        }
    });

    // 2. LEMBRETE DE CORTE (Corre a cada 15 minutos)
    cron.schedule('*/15 * * * *', async () => {
        const agora = new Date();
        const duasHorasFrente = new Date(agora.getTime() + 2 * 60 * 60 * 1000);
        
        try {
            const agendamentos = await prisma.agendamento.findMany({
                where: {
                    status: 'AGENDADO',
                    dataHora: { gte: agora, lte: duasHorasFrente }
                },
                include: { servico: true, cliente: true }
            });

            for (let ag of agendamentos) {
                if (!lembretesEnviados.has(ag.id)) {
                    lembretesEnviados.add(ag.id);
                    
                    const horaFormatada = format(ag.dataHora, 'HH:mm');
                    const nomeCli = ag.cliente?.nome || 'Cliente';
                    const servicoNome = ag.servico.nome;

                    const promptIa = `O cliente ${nomeCli} tem um agendamento do serviço de ${servicoNome} marcado para daqui a pouco, exatamente às ${horaFormatada}. Escreve uma mensagem educada de lembrete confirmando que estamos aguardando por ele. (LEMBRE-SE: PROIBIDO USAR EMOJIS).`;
                    const fallbackMsg = `Passando para lembrar que o teu ${servicoNome} esta marcado para daqui a pouco, as ${horaFormatada}. Aguardamos por ti.`;
                    
                    const textoIa = await gerarMensagemNotificacao(promptIa, fallbackMsg);
                    await sendDelayedText(null, ag.clienteId, textoIa);
                    console.log(`🔔 Lembrete IA (Sem Emojis) enviado para: ${ag.clienteId}`);
                }
            }
        } catch (erro) {
            console.error('❌ Erro no robô de lembretes:', erro);
        }
    });
}

module.exports = { iniciarLembretesEFollowUp };