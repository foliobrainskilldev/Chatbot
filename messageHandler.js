const { prisma, getOrCreateCliente } = require('./db');
const { iniciarAgendamento, handleAgendamento } = require('./flowAgendamento');
const { verPrecosEServicos, verMeusAgendamentos } = require('./flowConsultas');
const { iniciarCancelamento, processarCancelamento } = require('./flowCancelamento');
const { sendDelayedText, sendInteractiveMenu } = require('./botUtils');
const { responderComGroq } = require('./groqApi');
const { markAsRead } = require('./whatsappApi'); // Importa o tick azul

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

    // 1. Aciona instantaneamente os "Ticks Azuis" de lido no telemóvel do cliente!
    if (message.id) {
        await markAsRead(message.id);
    }

    if (message.type === 'text') {
        textMessage = message.text.body;
    } else if (message.type === 'interactive') {
        if (message.interactive.type === 'button_reply') textMessage = message.interactive.button_reply.id;
        else if (message.interactive.type === 'list_reply') textMessage = message.interactive.list_reply.id;
    }

    if (!textMessage) return;
    
    console.log(`\n[PASSO 1] Lendo mensagem de ${senderNumber}: "${textMessage}"`);

    try {
        let cliente = await getOrCreateCliente(senderNumber);

        if (cliente.falarHumano) {
            if (textMessage.trim().toLowerCase() === '#sair') {
                await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: false } });
                await sendDelayedText(null, senderNumber, '🔄 Atendimento automático restaurado! Diga *"Oi"* ou *"Menu"* para prosseguir.');
            }
            return; 
        }

        let userState = stateMachine.get(senderNumber) || { step: STEPS.MENU_PRINCIPAL, data: {} };
        stateMachine.set(senderNumber, userState);

        const msgLower = textMessage.trim().toLowerCase();
        const cmdsIntuitosUI= ['menu', 'início', 'inicio', 'voltar', 'cancelar tudo', '0'];

        if (cmdsIntuitosUI.includes(msgLower)) {
             userState.step = STEPS.MENU_PRINCIPAL;
             userState.data = {};
             await sendMenu(null, senderNumber);
        }
        // SE o cliente clicou num serviço no modal de Preços, injeta o utilizador na fase 2 de agendamento!
        else if (textMessage.startsWith('srv_')) {
            const servicoId = textMessage.replace('srv_', '');
            userState.step = STEPS.AGENDAMENTO_SERVICO;
            stateMachine.set(senderNumber, userState);
            await handleAgendamento(null, senderNumber, servicoId, senderNumber, stateMachine, STEPS);
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
        console.error(`❌ Erro no Engine Central:`, error);
    }
}

async function sendMenu(sockIgnorado, jid) {
    const menuOptions = [
        { id: '1', title: 'Agendar', description: 'Cortar/Marcar novo!' },
        { id: '2', title: 'Serviços e Preços', description: 'Tabela C/ preçários ' },
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
        case '2': 
        case 'btn_servicos':
            await verPrecosEServicos(null, jid); 
            await prisma.mensagemIA.create({ data: { role: 'user', content: "Mostre os serviços e preços", clienteId: senderNumber }});
            await prisma.mensagemIA.create({ data: { role: 'assistant', content: "Aqui estão os nossos preços.", clienteId: senderNumber }});
            break; 
        case '3': await verMeusAgendamentos(null, jid, senderNumber); break; 
        case '4': await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS); break;
        case '5': await sendDelayedText(null, jid, `📍 *Viajante - Como nos achar:* \n> Av. 24 de Julho (Encontra Maputo/PT), 🕒 Seg as Sb : (09 as 19)`); break;
        
        case 'btn_duvidas':
            await sendDelayedText(null, jid, 'Podes perguntar-me o que quiseres! Qual é a tua dúvida sobre a nossa barbearia?');
            await prisma.mensagemIA.create({ data: { role: 'user', content: "Tenho dúvidas frequentes.", clienteId: senderNumber }});
            await prisma.mensagemIA.create({ data: { role: 'assistant', content: "Podes perguntar-me o que quiseres!", clienteId: senderNumber }});
            break;

        case '6': 
        case 'btn_equipe':
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
            await sendDelayedText(null, jid, 'Atendimento transferido! Um de nossos barbeiros já vem te responder. Aguarda só um pouquinho...'); 
            break;
            
        default: 
            const historicoCru = await prisma.mensagemIA.findMany({
                   where: { clienteId: senderNumber }, 
                   orderBy: { criadoEm: 'desc' }, 
                   take: 4 
            });

            if (historicoCru.length === 0) {
                await prisma.mensagemIA.create({ data: { role: 'user', content: textMessage, clienteId: senderNumber }});
                
                const btnPrimeiraVez = [
                    { id: 'btn_servicos', title: 'Serviços e Preços' }, 
                    { id: 'btn_duvidas', title: 'Dúvidas frequentes' },
                    { id: 'btn_equipe', title: 'Falar com a equipe' }
                ];
                const textoBoasVindas = `Olá! 👋 Bem-vindo à nossa Barbearia!\nÉ um prazer ter-te por aqui. \n\nEscolhe uma das opções abaixo para começarmos:`;
                
                await sendInteractiveMenu(jid, textoBoasVindas, btnPrimeiraVez);
                await prisma.mensagemIA.create({ data: { role: 'assistant', content: textoBoasVindas, clienteId: senderNumber }});
                return; 
            }

            let statusRetorno = "NOVO";
            const ultimaMsgData = new Date(historicoCru[0].criadoEm);
            const hoje = new Date();
            
            if (ultimaMsgData.toDateString() === hoje.toDateString()) {
                statusRetorno = "RETORNO_MESMO_DIA"; 
            } else {
                statusRetorno = "RETORNO_OUTRO_DIA"; 
            }
            
            await prisma.mensagemIA.create({ data: { role: 'user', content: textMessage, clienteId: senderNumber }});
            
            const asConversasPassadas = historicoCru.reverse();
            const constCortesG = await prisma.agendamento.count({ where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }});
            
            const textIArid = await responderComGroq(textMessage, constCortesG, asConversasPassadas, statusRetorno);
            const intentCheck = textIArid.trim().toUpperCase();

            if (intentCheck.includes('/AGENDAR')) await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS);
            else if (intentCheck.includes('/CANCELAR')) await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS);
            else if (intentCheck.includes('/PRECOS')) await verPrecosEServicos(null, jid);
            else if (intentCheck.includes('/AGENDA')) await verMeusAgendamentos(null, jid, senderNumber);
            else if (intentCheck.includes('/LOCAL')) await sendDelayedText(null, jid, `📍 *Nossa Localização:* \n> Av. 24 de Julho (Encontra Maputo/PT), 🕒 Seg as Sáb : (09h às 19h)`);
            else if (intentCheck.includes('/HUMANO')) {
                await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
                await sendDelayedText(null, jid, 'Atendimento transferido! Um de nossos barbeiros já vem te responder. Aguarda só um pouquinho...');
            } 
            else if (intentCheck.includes('/MENU')) await sendMenu(null, jid);
            else {
                await prisma.mensagemIA.create({ data: { role: 'assistant', content: textIArid, clienteId: senderNumber }});
                await sendDelayedText(null, jid, textIArid);
            }
            break;
    }
}

module.exports = { handleMessage };