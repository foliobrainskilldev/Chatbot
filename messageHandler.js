const { prisma, getOrCreateCliente } = require('./db');
const { iniciarAgendamento, handleAgendamento } = require('./flowAgendamento');
const { verPrecosEServicos, verMeusAgendamentos } = require('./flowConsultas');
const { iniciarCancelamento, processarCancelamento } = require('./flowCancelamento');
const { sendDelayedText, sendInteractiveMenu } = require('./botUtils');
const { responderComGroq } = require('./groqApi');

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
    const senderNumber = message.from; 
    let textMessage = "";

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
            await sendDelayedText(null, senderNumber, '🔄 Atendimento humano encerrado.\nDigite *"Menu"* se precisar usar o painel da barbearia novamente.');
        }
        return; 
    }

    let userState = stateMachine.get(senderNumber) || { step: STEPS.MENU_PRINCIPAL, data: {}, isProcessing: false };

    if (userState.isProcessing) return; 

    userState.isProcessing = true;
    stateMachine.set(senderNumber, userState);

    try {
        const msgLower = textMessage.trim().toLowerCase();
        
        // "Travões absolutos" se o utilizador quiser mesmo acessar as funcionalidades duras
        const comandosInflexiveisMenu = ['menu', 'início', 'inicio', 'voltar', 'cancelar tudo', '0'];

        if (comandosInflexiveisMenu.includes(msgLower)) {
             userState.step = STEPS.MENU_PRINCIPAL;
             userState.data = {};
             await sendMenu(null, senderNumber);
        }
        else if (userState.step.startsWith('AGENDAMENTO_')) {
            await handleAgendamento(null, senderNumber, textMessage, senderNumber, stateMachine, STEPS);
        }
        else {
             switch (userState.step) {
                  case STEPS.MENU_PRINCIPAL:
                      await handleMenuEIA(null, senderNumber, textMessage, senderNumber);
                      break;
                  case STEPS.CANCELAR_AGENDAMENTO:
                      await processarCancelamento(null, senderNumber, textMessage, senderNumber, stateMachine, STEPS);
                      break;
                  default:
                      userState.step = STEPS.MENU_PRINCIPAL;
                      userState.data = {};
                      break;
              }
        }
    } catch (error) {
        console.error(`❌ Erro no Engine (Fluxos/Groq):`, error);
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
        { id: '2', title: 'Ver preços/serviços', description: 'Tabela de preços' },
        { id: '3', title: 'Meus agendamentos', description: 'Ver próximas idas' },
        { id: '4', title: 'Cancelar horário', description: 'Desmarcar agendamento' },
        { id: '5', title: 'Local / Horário', description: 'Como chegar até nós' },
        { id: '6', title: 'Falar com Atendente', description: 'Atendimento presencial' }
    ];
    await sendInteractiveMenu(jid, '*Painel da Barbearia* 💈\nBem-vindo ao Menu Rápido! Podes selecionar abaixo a opção:', menuOptions);
}


async function handleMenuEIA(sockIgnorado, jid, textMessage, senderNumber) {
    const option = textMessage.trim();
    
    switch (option) {
        case '1': await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS); break;
        case '2': await verPrecosEServicos(null, jid); await sendMenu(null, jid); break;
        case '3': await verMeusAgendamentos(null, jid, senderNumber); await sendMenu(null, jid); break;
        case '4': await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS); break;
        case '5': 
            await sendDelayedText(null, jid, `📍 *Nossa Localização:*\nAv. 24 de Julho, Maputo\n\n🕒 *Funcionamento:*\nSeg a Sáb: 09:00 às 19:00`); 
            await sendMenu(null, jid); 
            break;
        case '6': 
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
            await sendDelayedText(null, jid, 'O seu canal de comunicação humano está livre agora com um barbeiro. 👨‍💻 Aguarde a mensagem..\n\n*(Quando tiverem acabado o papo e se precisar, pode desligar mandando-nos apenas a hastag: #sair)*'); 
            break;
            
        // Caso digitem "Tem vaga?", "Eae bro" a Groq API captura aqui!
        default: 
            console.log(`🤖 | Cliente ${senderNumber} digitou natural. Chamando a Llama-3 pela Groq LPU...`)
            const textoGroqInteligente = await responderComGroq(textMessage);
            
            // Reenvia I.A pelo Cloud Oficial da Meta super veloz!
            await sendDelayedText(null, jid, textoGroqInteligente);
            break;
    }
}

module.exports = { handleMessage };