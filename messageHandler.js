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
    
    console.log(`\n[PASSO 1] Lendo mensagem de ${senderNumber}: "${textMessage}"`);

    try {
        console.log(`[PASSO 2] Buscando Cliente...`);
        let cliente = await getOrCreateCliente(senderNumber);

        if (cliente.falarHumano) {
            if (textMessage.trim().toLowerCase() === '#sair') {
                console.log(`[PASSO 3.1] Bot acordou! Atendimento Humano desativado.`);
                await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: false } });
                await sendDelayedText(null, senderNumber, '🔄 Atendimento automático restaurado! Diga *"Oi"* ou *"Menu"* para prosseguir.');
            } else {
                console.log(`[⚠️ AVISO] Bot silenciado. Utilizador no modo Humano.`);
            }
            return; 
        }

        let userState = stateMachine.get(senderNumber) || { step: STEPS.MENU_PRINCIPAL, data: {} };
        stateMachine.set(senderNumber, userState);

        const msgLower = textMessage.trim().toLowerCase();
        const cmdsIntuitosUI= ['menu', 'início', 'inicio', 'voltar', 'cancelar tudo', '0'];

        console.log(`[PASSO 4] Estado Atual: ${userState.step}`);

        if (cmdsIntuitosUI.includes(msgLower)) {
             userState.step = STEPS.MENU_PRINCIPAL;
             userState.data = {};
             await sendMenu(null, senderNumber);
        }
        else if (userState.step.startsWith('AGENDAMENTO_')) {
            console.log(`[PASSO 5] Fluxo de Agendamento nativo em curso.`);
            await handleAgendamento(null, senderNumber, textMessage, senderNumber, stateMachine, STEPS);
        }
        else {
             switch (userState.step) {
                  case STEPS.MENU_PRINCIPAL:
                      console.log(`[PASSO 5] Encaminhando à IA (Groq)...`);
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
        console.error(`❌ Erro no Engine Central:`, error);
    }
}

async function sendMenu(sockIgnorado, jid) {
    const menuOptions = [
        { id: '1', title: 'Agendar', description: 'Cortar/Marcar novo!' },
        { id: '2', title: 'Serviços & Mt', description: 'Tabela C/ preçários ' },
        { id: '3', title: 'A Minha Agenda', description: 'Check dos apontamentos' },
        { id: '4', title: 'Cancelar Marcas', description: 'Pausar Canceladas!' },
        { id: '5', title: 'Av., Mapa / Hrs', description: 'Geocalização' },
        { id: '6', title: 'Falar com Humano', description: 'Atendimento Orgânico.' }
    ];
    await sendInteractiveMenu(jid, '*Portal Da Barbearia ✂️*\nÉ bem prático! Podes simplesmente prosseguir tocando num botão abaixo 👇', menuOptions);
}

async function handleEstrategiaLLMSalvos(sockIgnorado, jid, textMessage, senderNumber) {
    const option = textMessage.trim();
    
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
            console.log(`🤖 | [PASSO 6] Chat IA Acionado!`);
            
            // 1. Guarda a fala atual do utilizador
            await prisma.mensagemIA.create({ data: { role: 'user', content: textMessage, clienteId: senderNumber }});
            
            // 2. CORREÇÃO CRUCIAL: Busca apenas as 4 ÚLTIMAS mensagens de forma decrescente para não trazer velharia e depois volta a virar
            const historicoCru = await prisma.mensagemIA.findMany({
                   where: { clienteId: senderNumber }, 
                   orderBy: { criadoEm: 'desc' }, 
                   take: 4 
            });
            const asConversasPassadasGostosDelaDbMemorie = historicoCru.reverse();
            
            const constCortesG = await prisma.agendamento.count({ where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }});
            
            console.log(`[PASSO 7] Enviando para a GROQ...`);
            const textIArid = await responderComGroq(textMessage, constCortesG, asConversasPassadasGostosDelaDbMemorie);
            
            console.log(`[PASSO 8] Resposta da GROQ: ${textIArid.substring(0, 40)}...`);
            const intentCheck = textIArid.trim().toUpperCase();

            // 3. Roteamento baseado na Intenção Oculta
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
                // Conversa Normal
                await prisma.mensagemIA.create({ data: { role: 'assistant', content: textIArid, clienteId: senderNumber }});
                await sendDelayedText(null, jid, textIArid);
                console.log(`[PASSO FINAL] Resposta humanizada enviada!`);
            }
            break;
    }
}

module.exports = { handleMessage };