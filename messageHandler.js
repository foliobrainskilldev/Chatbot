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

async function handleMessage(message, contact) {
    const senderNumber = message.from; // Número do cliente (ex: 258840000000)
    let textMessage = "";

    // Extração conforme a documentação oficial da Meta
    if (message.type === 'text') {
        textMessage = message.text.body;
    } else if (message.type === 'interactive') {
        if (message.interactive.type === 'button_reply') {
            textMessage = message.interactive.button_reply.id;
        } else if (message.interactive.type === 'list_reply') {
            textMessage = message.interactive.list_reply.id;
        }
    }

    if (!textMessage) return;

    const cliente = await getOrCreateCliente(senderNumber);

    if (cliente.falarHumano) {
        if (textMessage.trim().toLowerCase() === '#sair') {
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: false } });
            await sendDelayedText(null, senderNumber, '🔄 Atendimento humano encerrado.\nDigite *"Menu"* para recomeçar.');
        }
        return; 
    }

    let userState = stateMachine.get(senderNumber);
    const isNewSession = !userState;
    
    if (!userState) {
        userState = { step: STEPS.MENU_PRINCIPAL, data: {}, isProcessing: false };
    }
    if (userState.isProcessing) return; 

    userState.isProcessing = true;
    stateMachine.set(senderNumber, userState);

    try {
        const msgLower = textMessage.trim().toLowerCase();
        const saudacoes = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'menu', 'voltar', 'inicio'];

        if (saudacoes.includes(msgLower) || (isNewSession && userState.step === STEPS.MENU_PRINCIPAL)) {
            userState.step = STEPS.MENU_PRINCIPAL;
            userState.data = {};
            await sendMenu(null, senderNumber);
        } else if (userState.step.startsWith('AGENDAMENTO_')) {
            // Passamos 'null' no lugar do socket do Baileys para não quebrar compatibilidade interna
            await handleAgendamento(null, senderNumber, textMessage, senderNumber, stateMachine, STEPS);
        } else {
            switch (userState.step) {
                case STEPS.MENU_PRINCIPAL:
                    await handleMenuPrincipal(null, senderNumber, textMessage, senderNumber);
                    break;
                case STEPS.CANCELAR_AGENDAMENTO:
                    await processarCancelamento(null, senderNumber, textMessage, senderNumber, stateMachine, STEPS);
                    break;
                default:
                    await sendMenu(null, senderNumber);
                    userState.step = STEPS.MENU_PRINCIPAL;
                    userState.data = {};
            }
        }
    } catch (error) {
        console.error(`❌ Erro no fluxo:`, error);
        await sendDelayedText(null, senderNumber, 'Ocorreu um erro interno. Por favor, digita "Menu".');
    } finally {
        userState = stateMachine.get(senderNumber);
        if (userState) {
            userState.isProcessing = false;
            stateMachine.set(senderNumber, userState);
        }
    }
}

async function sendMenu(sockIgnorado, jid) {
    const menuOptions = [
        { id: '1', title: 'Agendar horário', description: 'Marcar um novo corte' },
        { id: '2', title: 'Ver preços e serviços', description: 'Tabela de preços' },
        { id: '3', title: 'Meus agendamentos', description: 'Ver próximas idas' },
        { id: '4', title: 'Cancelar horário', description: 'Desmarcar agendamento' },
        { id: '5', title: 'Localização / Horário', description: 'Como chegar' },
        { id: '6', title: 'Falar com atendente', description: 'Transferir para humano' }
    ];
    await sendInteractiveMenu(jid, '*Bem-vindo(a) à Barbearia!* ✂️💈\nComo podemos ajudar-te hoje?', menuOptions);
}

// O resto do handleMenuPrincipal fica exatamente como enviei da última vez (basta passar null onde pedia o 'sock')
async function handleMenuPrincipal(sockIgnorado, jid, textMessage, senderNumber) {
    const option = textMessage.trim();
    switch (option) {
        case '1': await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS); break;
        case '2': await verPrecosEServicos(null, jid); await sendMenu(null, jid); break;
        case '3': await verMeusAgendamentos(null, jid, senderNumber); await sendMenu(null, jid); break;
        case '4': await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS); break;
        case '5': await sendDelayedText(null, jid, `📍 *A Nossa Localização:*...`); await sendMenu(null, jid); break;
        case '6': 
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
            await sendDelayedText(null, jid, 'A transferir para um atendente...'); 
            break;
        default: await sendDelayedText(null, jid, 'Desculpa, não entendi.'); await sendMenu(null, jid); break;
    }
}

module.exports = { handleMessage };