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
    
    console.log(`[PASSO 1] Lendo mensagem de ${senderNumber}: "${textMessage}"`);

    try {
        console.log(`[PASSO 2] Buscando Cliente na Base de Dados (Prisma)...`);
        let cliente = await getOrCreateCliente(senderNumber);
        console.log(`[PASSO 3] Cliente Encontrado com sucesso!`);

        if (cliente.falarHumano) {
            if (textMessage.trim().toLowerCase() === '#sair') {
                await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: false } });
                await sendDelayedText(null, senderNumber, '🔄 Atendimento humano encerrado. Bem vindo de volta! Digite *"Menu"* para ver as opções.');
            }
            return; 
        }

        let userState = stateMachine.get(senderNumber) || { step: STEPS.MENU_PRINCIPAL, data: {} };
        // Atualizamos o state machine (Sem trava agressiva anti-spam para não causar bloqueios fantasma)
        stateMachine.set(senderNumber, userState);

        const msgLower = textMessage.trim().toLowerCase();
        const cmdsIntuitosUI= ['menu', 'início', 'inicio', 'voltar', 'cancelar tudo', '0'];

        console.log(`[PASSO 4] Estado Atual do Utilizador: ${userState.step}`);

        if (cmdsIntuitosUI.includes(msgLower)) {
             userState.step = STEPS.MENU_PRINCIPAL;
             userState.data = {};
             await sendMenu(null, senderNumber);
        }
        else if (userState.step.startsWith('AGENDAMENTO_')) {
            console.log(`[PASSO 5] Encaminhando para o Fluxo de Agendamento.`);
            await handleAgendamento(null, senderNumber, textMessage, senderNumber, stateMachine, STEPS);
        }
        else {
             switch (userState.step) {
                  case STEPS.MENU_PRINCIPAL:
                      console.log(`[PASSO 5] Encaminhando para Inteligência Artificial (Groq).`);
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
        console.error(`❌ Erro Crítico no Engine Central:`, error);
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
        case '2': await verPrecosEServicos(null, jid); break; 
        case '3': await verMeusAgendamentos(null, jid, senderNumber); break; 
        case '4': await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS); break;
        case '5': await sendDelayedText(null, jid, `📍 *Viajante - Como nos achar:* \n> Av. 24 de Julho (Encontra Maputo/PT), 🕒 Seg as Sb : (09 as 19)`); break;
        case '6': 
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
            await sendDelayedText(null, jid, 'Estamos acoplados agr! Vai vir alguem aí pra você ao teclado espere um cheirinho...'); break;
            
        default: 
            console.log(`🤖 | [PASSO 6] Chat Orgânico Acionado! Preparando memórias...`);
            
            await prisma.mensagemIA.create({ data: { role: 'user', content: textMessage, clienteId: senderNumber }});
            
            const asConversasPassadasGostosDelaDbMemorie = await prisma.mensagemIA.findMany({
                   where: { clienteId: senderNumber }, orderBy: { criadoEm: 'asc' }, take: 10 
            });
            const constCortesG = await prisma.agendamento.count({ where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }});
            
            console.log(`[PASSO 7] Enviando para a LPU GROQ... Aguardando raciocínio.`);
            const textIArid = await responderComGroq(textMessage, constCortesG, asConversasPassadasGostosDelaDbMemorie);
            
            console.log(`[PASSO 8] Resposta da GROQ Recebida: ${textIArid.substring(0, 30)}...`);
            const intentCheck = textIArid.trim().toUpperCase();

            // Roteamento baseado na Intenção da IA
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
                // É apenas uma conversa normal! Guarda no SQL e exibe para o cliente
                await prisma.mensagemIA.create({ data: { role: 'assistant', content: textIArid, clienteId: senderNumber }});
                await sendDelayedText(null, jid, textIArid);
                console.log(`[PASSO FINAL] Mensagem de texto enviada ao WhatsApp com sucesso!`);
            }
            break;
    }
}

module.exports = { handleMessage };