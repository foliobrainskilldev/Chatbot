const { prisma, getOrCreateCliente } = require('../db');
const whatsappService = require('../whatsappService');

const { iniciarAgendamento, handleAgendamento } = require('./flowAgendamento');
const { iniciarCancelamento, processarCancelamento } = require('./flowCancelamento');
const { verPrecosEServicos, verMeusAgendamentos } = require('./flowConsultas');

const stateMachine = new Map();

const STEPS = {
    MENU_PRINCIPAL: 'MENU_PRINCIPAL',
    AGENDAMENTO_SERVICO: 'AGENDAMENTO_SERVICO',
    AGENDAMENTO_BARBEIRO: 'AGENDAMENTO_BARBEIRO',
    AGENDAMENTO_DATA: 'AGENDAMENTO_DATA',
    AGENDAMENTO_HORA: 'AGENDAMENTO_HORA',
    AGENDAMENTO_CONFIRMAR: 'AGENDAMENTO_CONFIRMAR',
    CANCELAR_AGENDAMENTO: 'CANCELAR_AGENDAMENTO',
};

function limparMemoriaEstado() {
    stateMachine.clear();
}

async function enviarMenuGeral(jid) {
    const textoMenu = `Bem-vindo à nossa Barbearia! Selecione uma opção:`;
    await whatsappService.sendInteractiveMenu(jid, textoMenu, [
        { id: 'cmd_agendar', title: 'Agendar Corte', description: 'Marcar novo horário' },
        { id: 'cmd_precos', title: 'Serviços e Preços', description: 'Tabela de preçários' },
        { id: 'cmd_agenda', title: 'Minha Agenda', description: 'Checar seus agendamentos' },
        { id: 'cmd_cancelar', title: 'Cancelar Horário', description: 'Suspender serviço' },
        { id: 'cmd_humano', title: 'Falar com Atendente', description: 'Transferência para equipe' }
    ]);
}

async function processarMensagemEntrante(message) {
    const senderNumber = message.from;
    const jid = senderNumber;
    
    try {
        console.log(`💈 [MOTOR BARBEARIA] Processando mensagem de ${senderNumber}`);

        let textMessage = message.text?.body || "";
        if (message.type === 'interactive') {
            textMessage = message.interactive.button_reply?.id || message.interactive.list_reply?.id;
        }

        let cliente = await getOrCreateCliente(senderNumber);
        
        if (cliente.falarHumano) {
            console.log(`🛑 [MOTOR BARBEARIA] Cliente em atendimento humano. Ignorando bot.`);
            return; 
        }
        
        if (!textMessage) {
            console.log(`⚠️ [MOTOR BARBEARIA] Mensagem sem texto ignorada.`);
            return;
        }

        await whatsappService.markAsReadAndTyping(message.id, senderNumber);

        let userState = stateMachine.get(senderNumber) || { step: STEPS.MENU_PRINCIPAL, data: {} };
        
        const delayMs = Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000;
        await new Promise(resolve => setTimeout(resolve, delayMs));

        if (textMessage.startsWith('srv_') || textMessage.startsWith('barb_') || userState.step.startsWith('AGENDAMENTO_')) {
            await handleAgendamento(jid, textMessage, senderNumber, stateMachine, STEPS);
            return;
        }

        if (userState.step === STEPS.CANCELAR_AGENDAMENTO) {
            await processarCancelamento(jid, textMessage, senderNumber, stateMachine, STEPS);
            return;
        }

        if (textMessage === 'cmd_agendar' || textMessage.includes('agendar') || textMessage.includes('marcar')) return await iniciarAgendamento(jid, senderNumber, stateMachine, STEPS);
        if (textMessage === 'cmd_precos') return await verPrecosEServicos(jid);
        if (textMessage === 'cmd_agenda') return await verMeusAgendamentos(jid, senderNumber);
        if (textMessage === 'cmd_cancelar') return await iniciarCancelamento(jid, senderNumber, stateMachine, STEPS);
        
        if (textMessage === 'cmd_humano') {
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
            await whatsappService.sendText(jid, 'A transferir para a equipa da Barbearia. Aguarde por favor.');
            return;
        }

        // Se não reconheceu comando, envia o menu.
        await enviarMenuGeral(jid);
        
    } catch (error) {
        console.error('❌ ERRO CRÍTICO NO MOTOR DA BARBEARIA:', error);
        await whatsappService.sendText(senderNumber, "Desculpe, a nossa IA teve uma pequena falha. Diga 'Oi' para recomeçarmos!");
    }
}

module.exports = { processarMensagemEntrante, limparMemoriaEstado, stateMachine };