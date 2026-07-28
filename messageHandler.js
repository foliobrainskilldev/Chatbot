const { prisma, getOrCreateCliente } = require('./db');
const { iniciarAgendamento, handleAgendamento } = require('./flowAgendamento');
const { verPrecosEServicos, verMeusAgendamentos } = require('./flowConsultas');
const { iniciarCancelamento, processarCancelamento } = require('./flowCancelamento');
const { sendDelayedText, sendInteractiveMenu } = require('./botUtils');

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

async function handleMessage(sock, msg) {
    const jid = msg.key.remoteJid;
    
    // Extração Inteligente de Texto ou Clique num Botão
    let textMessage = "";
    if (msg.message.conversation) {
        textMessage = msg.message.conversation;
    } else if (msg.message.extendedTextMessage) {
        textMessage = msg.message.extendedTextMessage.text;
    } else if (msg.message.interactiveResponseMessage) {
        try {
            const btnParams = JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
            textMessage = btnParams.id; // Retorna o ID oculto do botão (1, 2, 3...)
        } catch(e) {}
    }

    if (!textMessage) return;

    const senderNumber = jid.split('@')[0];
    const cliente = await getOrCreateCliente(senderNumber);

    if (cliente.falarHumano) {
        if (textMessage.trim().toLowerCase() === '#sair') {
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: false } });
            await sendDelayedText(sock, jid, '🔄 Atendimento humano encerrado.\nDigite *"Menu"* para recomeçar.');
        }
        return; 
    }

    // PREVENÇÃO DE SPAM: Se o bot já está a processar algo para este cliente, ignora a mensagem
    let userState = stateMachine.get(senderNumber) || { step: STEPS.MENU_PRINCIPAL, data: {}, isProcessing: false };
    if (userState.isProcessing) return; 

    // Tranca o cliente
    userState.isProcessing = true;
    stateMachine.set(senderNumber, userState);

    try {
        if (textMessage.trim().toLowerCase() === 'menu') {
            userState.step = STEPS.MENU_PRINCIPAL;
            userState.data = {};
        }

        if (userState.step.startsWith('AGENDAMENTO_')) {
            await handleAgendamento(sock, jid, textMessage, senderNumber, stateMachine, STEPS);
        } else {
            switch (userState.step) {
                case STEPS.MENU_PRINCIPAL:
                    await handleMenuPrincipal(sock, jid, textMessage, senderNumber);
                    break;
                case STEPS.CANCELAR_AGENDAMENTO:
                    await processarCancelamento(sock, jid, textMessage, senderNumber, stateMachine, STEPS);
                    break;
                default:
                    await sendMenu(sock, jid);
                    stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {}, isProcessing: false });
                    return;
            }
        }
    } catch (error) {
        console.error(`❌ Erro:`, error);
        await sendDelayedText(sock, jid, 'Ocorreu um erro. Por favor, digita "Menu" para recomeçar.');
    } finally {
        // Destranca o cliente no final
        userState = stateMachine.get(senderNumber);
        if (userState) {
            userState.isProcessing = false;
            stateMachine.set(senderNumber, userState);
        }
    }
}

async function sendMenu(sock, jid) {
    const menuOptions = [
        { id: '1', title: 'Agendar horário' },
        { id: '2', title: 'Ver preços e serviços' },
        { id: '3', title: 'Meus agendamentos' },
        { id: '4', title: 'Cancelar horário' },
        { id: '5', title: 'Localização / Horário' },
        { id: '6', title: 'Falar com atendente' }
    ];
    await sendInteractiveMenu(sock, jid, '*Bem-vindo(a) à Barbearia!* ✂️💈\nComo podemos te ajudar hoje?', menuOptions);
}

async function handleMenuPrincipal(sock, jid, textMessage, senderNumber) {
    const option = textMessage.trim();

    switch (option) {
        case '1': await iniciarAgendamento(sock, jid, senderNumber, stateMachine, STEPS); break;
        case '2': 
            await verPrecosEServicos(sock, jid); 
            await sendMenu(sock, jid); 
            break;
        case '3': 
            await verMeusAgendamentos(sock, jid, senderNumber); 
            await sendMenu(sock, jid); 
            break;
        case '4': await iniciarCancelamento(sock, jid, senderNumber, stateMachine, STEPS); break;
        case '5':
            await sendDelayedText(sock, jid, `📍 *A Nossa Localização:*\nAv. 24 de Julho, Maputo\n\n🕒 *Horário de Funcionamento:*\nSeg a Sáb: 09:00 às 19:00`);
            await sendMenu(sock, jid);
            break;
        case '6':
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
            await sendDelayedText(sock, jid, 'A transferir para um atendente... 👨‍💻\n\n*(Para voltar ao bot digita #sair)*');
            break;
        default:
            await sendDelayedText(sock, jid, 'Opção inválida.');
            await sendMenu(sock, jid);
            break;
    }
}

module.exports = { handleMessage };