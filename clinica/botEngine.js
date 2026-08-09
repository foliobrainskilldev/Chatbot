const { prisma, getOrCreateCliente } = require('../db');
const whatsappService = require('../whatsappService');
// Importação dos fluxos exclusivos da clínica
const { iniciarAgendamentoClinica, handleAgendamentoClinica } = require('./flowAgendamento');
const { iniciarCancelamentoClinica, processarCancelamentoClinica } = require('./flowCancelamento');

const stateMachine = new Map();

const STEPS = {
    MENU_PRINCIPAL: 'MENU_PRINCIPAL',
    AGENDAMENTO_TRATAMENTO: 'CLINICA_AG_TRATAMENTO',
    AGENDAMENTO_MEDICO: 'CLINICA_AG_MEDICO',
    AGENDAMENTO_DATA: 'CLINICA_AG_DATA',
    AGENDAMENTO_HORA: 'CLINICA_AG_HORA',
    AGENDAMENTO_CONFIRMAR: 'CLINICA_AG_CONFIRMAR',
    CANCELAR_CONSULTA: 'CLINICA_CANCELAR',
};

function limparMemoriaEstado() {
    stateMachine.clear();
}

async function enviarMenuGeral(jid) {
    const textoMenu = `Bem-vindo(a) à nossa Clínica! Como podemos ajudar hoje?`;
    await whatsappService.sendInteractiveMenu(jid, textoMenu, [
        { id: 'cmd_agendar', title: 'Agendar Consulta', description: 'Marcar atendimento médico' },
        { id: 'cmd_especialidades', title: 'Especialidades', description: 'Ver áreas de atuação' },
        { id: 'cmd_agenda', title: 'Meus Retornos', description: 'Checar suas consultas' },
        { id: 'cmd_cancelar', title: 'Cancelar Consulta', description: 'Desmarcar horário' },
        { id: 'cmd_humano', title: 'Falar com Recepção', description: 'Transferência para equipe' }
    ]);
}

async function processarMensagemEntrante(message) {
    const senderNumber = message.from;
    const jid = senderNumber;
    
    let textMessage = message.text?.body || "";
    if (message.type === 'interactive') {
        textMessage = message.interactive.button_reply?.id || message.interactive.list_reply?.id;
    }

    if (!textMessage) return;

    let cliente = await getOrCreateCliente(senderNumber);
    if (cliente.falarHumano) return; // Suporte humano ativo, bot ignora.

    let userState = stateMachine.get(senderNumber) || { step: STEPS.MENU_PRINCIPAL, data: {} };

    // ROTEAMENTO CLÍNICA
    if (textMessage.startsWith('trat_') || textMessage.startsWith('med_') || userState.step.startsWith('CLINICA_AG_')) {
        await handleAgendamentoClinica(jid, textMessage, senderNumber, stateMachine, STEPS);
        return;
    }

    if (userState.step === STEPS.CANCELAR_CONSULTA) {
        await processarCancelamentoClinica(jid, textMessage, senderNumber, stateMachine, STEPS);
        return;
    }

    if (textMessage === 'cmd_agendar') return await iniciarAgendamentoClinica(jid, senderNumber, stateMachine, STEPS);
    if (textMessage === 'cmd_cancelar') return await iniciarCancelamentoClinica(jid, senderNumber, stateMachine, STEPS);
    if (textMessage === 'cmd_humano') {
        await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
        await whatsappService.sendText(jid, 'Sua conversa foi transferida para a recepção da Clínica. Por favor, aguarde um momento.');
        return;
    }

    // Se não for nenhum comando mapeado, envia o menu
    await enviarMenuGeral(jid);
}

module.exports = { processarMensagemEntrante, limparMemoriaEstado, stateMachine };