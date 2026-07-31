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
        if (message.interactive.type === 'button_reply') textMessage = message.interactive.button_reply.id;
        else if (message.interactive.type === 'list_reply') textMessage = message.interactive.list_reply.id;
    }

    if (!textMessage) return;

    let cliente = await getOrCreateCliente(senderNumber);

    if (cliente.falarHumano) {
        if (textMessage.trim().toLowerCase() === '#sair') {
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: false } });
            await sendDelayedText(null, senderNumber, '🔄 Atendimento humano encerrado. Bem vindo de volta! Digite *"Menu"* para ver as opções.');
        }
        return; 
    }

    let userState = stateMachine.get(senderNumber) || { step: STEPS.MENU_PRINCIPAL, data: {}, isProcessing: false };

    if (userState.isProcessing) return; 

    userState.isProcessing = true;
    stateMachine.set(senderNumber, userState);

    try {
        const msgLower = textMessage.trim().toLowerCase();
        const cmdsIntuitosUI= ['menu', 'início', 'inicio', 'voltar', 'cancelar tudo', '0'];

        if (cmdsIntuitosUI.includes(msgLower)) {
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
                      await handleEstrategiaLLMSalvos(null, senderNumber, textMessage, senderNumber);
                      break;
                  case STEPS.CANCELAR_AGENDAMENTO:
                      await processarCancelamento(null, senderNumber, textMessage, senderNumber, stateMachine, STEPS);
                      break;
                  default:
                      userState.step = STEPS.MENU_PRINCIPAL; userState.data = {};
                      break;
              }
        }
    } catch (error) {
        console.error(`❌ Erro no Engine Core/Db Central:`, error);
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
        { id: '1', title: 'Agendar', description: 'Cortar/Marcar novo!' },
        { id: '2', title: 'Serviços & Mt', description: 'Tabela C/ preçários ' },
        { id: '3', title: 'A Minha Agenda', description: 'Check dos apontamentos' },
        { id: '4', title: 'Cancelar Marcas', description: 'Pausar Canceladas!' },
        { id: '5', title: 'Av., Mapa / Hrs', description: 'Geocalização' },
        { id: '6', title: 'Trans. p/ Funcionário', description: 'Atendimento Orgânico Humano.' }
    ];
    await sendInteractiveMenu(jid, '*Portal Da Barbearia ✂️*\nÉ bem prático! Podes simplesmente prosseguir tocando num botão abaixo 👇', menuOptions);
}

async function handleEstrategiaLLMSalvos(sockIgnorado, jid, textMessage, senderNumber) {
    const option = textMessage.trim();
    
    // Fallbacks para quem clica direto num dos botões do Menu (ID numéricos)
    switch (option) {
        case '1': await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS); break;
        case '2': await verPrecosEServicos(null, jid); break; // Removido o spam do Menu
        case '3': await verMeusAgendamentos(null, jid, senderNumber); break; // Removido o spam do Menu
        case '4': await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS); break;
        case '5': await sendDelayedText(null, jid, `📍 *Viajante - Como nos achar:* \n> Av. 24 de Julho (Encontra Maputo/PT), 🕒 Seg as Sb : (09 as 19)`); break;
        case '6': 
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
            await sendDelayedText(null, jid, 'Estamos acoplados agr! Vai vir alguem aí pra você ao teclado espere um cheirinho...'); break;
            
        default: 
            console.log(`🤖 | Chat Orgânico C. LLAMA-GroqLPU! de ${senderNumber}`);
            
            // 1. Guardar a fala do Cliente
            await prisma.mensagemIA.create({ data: { role: 'user', content: textMessage, clienteId: senderNumber }});
            
            // 2. Procurar histórico para contexto fluído
            const asConversasPassadasGostosDelaDbMemorie = await prisma.mensagemIA.findMany({
                   where: { clienteId: senderNumber }, orderBy: { criadoEm: 'asc' }, take: 10 
            });
            const constCortesG = await prisma.agendamento.count({ where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }});
            
            // 3. Obter Resposta Pensada
            const textIArid = await responderComGroq(textMessage, constCortesG, asConversasPassadasGostosDelaDbMemorie);
            const intentCheck = textIArid.trim().toUpperCase();

            // 4. Executar Comando ou Enviar Texto
            if (intentCheck.includes('/AGENDAR')) {
                await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS);
            } else if (intentCheck.includes('/CANCELAR')) {
                await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS);
            } else if (intentCheck.includes('/PRECOS')) {
                await verPrecosEServicos(null, jid);
            } else if (intentCheck.includes('/AGENDA')) {
                await verMeusAgendamentos(null, jid, senderNumber);
            } else if (intentCheck.includes('/LOCAL')) {
                await sendDelayedText(null, jid, `📍 *Nossa Localização:* \n> Av. 24 de Julho (Encontra Maputo/PT), 🕒 Seg as Sáb : (09h às 19h)`);
            } else if (intentCheck.includes('/HUMANO')) {
                await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
                await sendDelayedText(null, jid, 'Atendimento transferido! Um de nossos barbeiros já vem te responder. Aguarda só um pouquinho...');
            } else if (intentCheck.includes('/MENU')) {
                await sendMenu(null, jid);
            } else {
                // É apenas uma conversa normal! Guarda no SQL e exibe para o cliente de forma amigável
                await prisma.mensagemIA.create({ data: { role: 'assistant', content: textIArid, clienteId: senderNumber }});
                await sendDelayedText(null, jid, textIArid);
            }
            break;
    }
}

module.exports = { handleMessage };