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
    
    // Extração Super Inteligente (Capta texto, botões novos e botões antigos do iOS/Android)
    let textMessage = "";
    const type = Object.keys(msg.message)[0];
    
    if (type === 'conversation') {
        textMessage = msg.message.conversation;
    } else if (type === 'extendedTextMessage') {
        textMessage = msg.message.extendedTextMessage.text;
    } else if (type === 'interactiveResponseMessage') {
        try {
            const btnParams = JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
            textMessage = btnParams.id;
        } catch(e) {}
    } else if (type === 'buttonsResponseMessage') {
        textMessage = msg.message.buttonsResponseMessage.selectedButtonId;
    } else if (type === 'listResponseMessage') {
        textMessage = msg.message.listResponseMessage.singleSelectReply.selectedRowId;
    }

    if (!textMessage) return;

    const senderNumber = jid.split('@')[0];
    const cliente = await getOrCreateCliente(senderNumber);

    // MODO HUMANO
    if (cliente.falarHumano) {
        if (textMessage.trim().toLowerCase() === '#sair') {
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: false } });
            await sendDelayedText(sock, jid, '🔄 Atendimento humano encerrado.\nDigite *"Menu"* para recomeçar.');
        }
        return; 
    }

    // PREVENÇÃO DE SPAM E ESTADO
    let userState = stateMachine.get(senderNumber);
    const isNewSession = !userState; // Deteta se é a primeira mensagem da pessoa
    
    if (!userState) {
        userState = { step: STEPS.MENU_PRINCIPAL, data: {}, isProcessing: false };
    }

    if (userState.isProcessing) return; 

    // Tranca o cliente para evitar processamento duplicado
    userState.isProcessing = true;
    stateMachine.set(senderNumber, userState);

    try {
        const msgLower = textMessage.trim().toLowerCase();
        
        // Palavras de escape (Saudações universais)
        const saudacoes = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'menu', 'voltar', 'inicio'];

        // SE for uma saudação OU for a primeira mensagem do utilizador -> Envia apenas o Menu
        if (saudacoes.includes(msgLower) || (isNewSession && userState.step === STEPS.MENU_PRINCIPAL)) {
            userState.step = STEPS.MENU_PRINCIPAL;
            userState.data = {};
            await sendMenu(sock, jid);
        } 
        // Lida com o Agendamento
        else if (userState.step.startsWith('AGENDAMENTO_')) {
            await handleAgendamento(sock, jid, textMessage, senderNumber, stateMachine, STEPS);
        } 
        // Lida com o resto
        else {
            switch (userState.step) {
                case STEPS.MENU_PRINCIPAL:
                    await handleMenuPrincipal(sock, jid, textMessage, senderNumber);
                    break;
                case STEPS.CANCELAR_AGENDAMENTO:
                    await processarCancelamento(sock, jid, textMessage, senderNumber, stateMachine, STEPS);
                    break;
                default:
                    await sendMenu(sock, jid);
                    userState.step = STEPS.MENU_PRINCIPAL;
                    userState.data = {};
            }
        }
    } catch (error) {
        console.error(`❌ Erro no bot para o número ${senderNumber}:`, error);
        await sendDelayedText(sock, jid, 'Ocorreu um erro interno. Por favor, digita "Menu" para recomeçar.');
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
        { id: '1', title: 'Agendar horário', description: 'Marcar um novo corte' },
        { id: '2', title: 'Ver preços e serviços', description: 'Tabela de preços' },
        { id: '3', title: 'Meus agendamentos', description: 'Ver próximas idas' },
        { id: '4', title: 'Cancelar horário', description: 'Desmarcar agendamento' },
        { id: '5', title: 'Localização / Horário', description: 'Como chegar' },
        { id: '6', title: 'Falar com atendente', description: 'Transferir para humano' }
    ];
    await sendInteractiveMenu(sock, jid, '*Bem-vindo(a) à Barbearia!* ✂️💈\nComo podemos ajudar-te hoje?', menuOptions);
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
            await sendDelayedText(sock, jid, 'Desculpa, não entendi. Por favor, escolhe uma opção válida.');
            await sendMenu(sock, jid);
            break;
    }
}

module.exports = { handleMessage };