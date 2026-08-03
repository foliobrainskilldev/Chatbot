const { prisma, getOrCreateCliente } = require('./db');
const { iniciarAgendamento, handleAgendamento } = require('./flowAgendamento');
const { verPrecosEServicos, verMeusAgendamentos } = require('./flowConsultas');
const { iniciarCancelamento, processarCancelamento } = require('./flowCancelamento');
const { sendDelayedText, sendInteractiveMenu, sendDelayedLocation } = require('./botUtils');
const { responderComGroq, extrairNomeComGroq, gerarMensagemNotificacao, transcreverAudioComGroq } = require('./groqApi');
const { markAsReadAndTyping, sendText, downloadMedia } = require('./whatsappApi');
const fs = require('fs');
const path = require('path');

const stateMachine = new Map();
const STEPS = {
    MENU_PRINCIPAL: 'MENU_PRINCIPAL', PEDIR_NOME: 'PEDIR_NOME', AGENDAMENTO_SERVICO: 'AGENDAMENTO_SERVICO',
    AGENDAMENTO_BARBEIRO: 'AGENDAMENTO_BARBEIRO', AGENDAMENTO_DATA: 'AGENDAMENTO_DATA', AGENDAMENTO_HORA: 'AGENDAMENTO_HORA',
    AGENDAMENTO_CONFIRMAR: 'AGENDAMENTO_CONFIRMAR', CANCELAR_AGENDAMENTO: 'CANCELAR_AGENDAMENTO',
};

const uploadsDir = path.join(__dirname, 'uploads');
const settingsPath = path.join(__dirname, 'settings.json');

function getSettings() {
    if (!fs.existsSync(settingsPath)) return { botAtivo: true, diasTrabalho: [1, 2, 3, 4, 5, 6], horaInicio: "09:00", horaFim: "19:00" };
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

async function sendMenu(sockIgnorado, jid, nomeCliente = '') {
    const promptMenu = `O cliente ${nomeCliente || 'Amigo'} precisa de ajuda. Pede-lhe de forma amigável, mas curta e direta, para escolher uma opção do menu.`;
    const textoMenu = await gerarMensagemNotificacao(promptMenu, `Como posso ajudar-te hoje, ${nomeCliente || 'Amigo'}? Escolhe uma opção abaixo:`);

    await sendInteractiveMenu(null, jid, textoMenu, [
        { id: '1', title: 'Agendar', description: 'Cortar/Marcar novo!' },
        { id: '2', title: 'Serviços e Preços', description: 'Tabela C/ preçários' },
        { id: '3', title: 'A Minha Agenda', description: 'Check dos apontamentos' },
        { id: '4', title: 'Cancelar Marcas', description: 'Pausar Canceladas!' },
        { id: '5', title: 'Av., Mapa / Hrs', description: 'Geolocalização' },
        { id: '6', title: 'Falar com Humano', description: 'Atendimento Orgânico' }
    ]);
}

async function handleMessage(message, contact) {
    const senderNumber = message.from;
    let textMessage = "";
    const jid = senderNumber;

    if (message.id) await markAsReadAndTyping(message.id);

    if (message.type === 'text') textMessage = message.text.body;
    else if (message.type === 'interactive') {
        if (message.interactive.type === 'button_reply') textMessage = message.interactive.button_reply.id;
        else if (message.interactive.type === 'list_reply') textMessage = message.interactive.list_reply.id;
    } else if (message.type === 'order') {
        const orderItems = message.order.product_items;
        if (orderItems && orderItems.length > 0) {
            const produtoSKU = orderItems[0].product_retailer_id;
            const servicosDb = await prisma.servico.findMany({ orderBy: { id: 'asc' } });
            let dbServicoId = servicosDb.length > 0 ? servicosDb[0].id.toString() : '1';
            textMessage = 'srv_' + dbServicoId;
        }
    }

    if (!textMessage) return;

    try {
        const config = getSettings();
        if (!config.botAtivo) return; 

        let cliente = await getOrCreateCliente(senderNumber);

        if (textMessage.trim().toLowerCase() === '#sair') {
            if (cliente.falarHumano) {
                await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: false } });
                if (global.io) global.io.emit('atualizar_fila');
            }
            await sendDelayedText(null, jid, 'Atendimento automático restaurado.');
            await sendMenu(null, jid, cliente.nome);
            return;
        }

        if (cliente.falarHumano) {
            const novaMsg = await prisma.mensagemIA.create({ data: { role: 'user', content: textMessage, clienteId: senderNumber } });
            if (global.io) global.io.emit('nova_mensagem', { clienteId: senderNumber, mensagem: novaMsg });
            return;
        }

        const agora = new Date();
        const maputoHour = parseInt(new Intl.DateTimeFormat('pt-PT', { timeZone: 'Africa/Maputo', hour: 'numeric', hour12: false }).format(agora));
        const horaMaputoStr = agora.toLocaleString("pt-PT", { timeZone: "Africa/Maputo" });
        
        let periodoDia = 'Boa noite';
        if (maputoHour >= 5 && maputoHour < 12) periodoDia = 'Bom dia';
        else if (maputoHour >= 12 && maputoHour < 18) periodoDia = 'Boa tarde';

        const horaMin = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Africa/Maputo', hour: '2-digit', minute: '2-digit' }).format(agora);
        const diaDaSemana = new Date(agora.toLocaleString('en-US', { timeZone: 'Africa/Maputo' })).getDay();
        let foraDoExpediente = (!config.diasTrabalho.includes(diaDaSemana) || horaMin < config.horaInicio || horaMin > config.horaFim);

        let userState = stateMachine.get(senderNumber) || { step: STEPS.MENU_PRINCIPAL, data: {} };

        // 1ª INTERAÇÃO
        if ((!cliente.nome || cliente.nome === 'Sem Nome') && userState.step === STEPS.MENU_PRINCIPAL) {
            const historicoCru = await prisma.mensagemIA.count({ where: { clienteId: senderNumber } });
            if (historicoCru === 0) {
                userState.step = STEPS.PEDIR_NOME;
                stateMachine.set(senderNumber, userState);
                
                const promptSaudacao = `És o assistente da Portal da Barbearia. Dá "${periodoDia}", apresenta-te de forma natural e simpática, e pergunta o nome do cliente. Mantém a mensagem curta (1 ou 2 frases).`;
                const msgSaudacao = await gerarMensagemNotificacao(promptSaudacao, `${periodoDia}! Sou o assistente da Portal da Barbearia. Qual é o teu nome?`);
                
                await sendInteractiveMenu(null, jid, msgSaudacao, [
                    { id: 'menu', title: 'Menu Principal' },
                    { id: 'btn_servicos', title: 'Serviços e preços' },
                    { id: 'btn_equipe', title: 'Falar com atendente' }
                ]);
                return;
            }
        }

        // 2ª INTERAÇÃO
        if (userState.step === STEPS.PEDIR_NOME) {
            const nomeExtraido = await extrairNomeComGroq(textMessage);
            if (nomeExtraido.toUpperCase() === 'IGNORAR') {
                userState.step = STEPS.MENU_PRINCIPAL;
                stateMachine.set(senderNumber, userState);
            } else {
                const nomeFinal = nomeExtraido.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                await prisma.cliente.update({ where: { id: senderNumber }, data: { nome: nomeFinal } });
                cliente.nome = nomeFinal;
                userState.step = STEPS.MENU_PRINCIPAL;
                stateMachine.set(senderNumber, userState);
                await prisma.mensagemIA.create({ data: { role: 'user', content: textMessage, clienteId: senderNumber } });

                const promptApresentacao = `Dá as boas-vindas chamando o cliente pelo nome (${nomeFinal}) de forma simpática e pede-lhe para escolher uma opção abaixo. Sem explicações longas.`;
                const txtBoasVindas = await gerarMensagemNotificacao(promptApresentacao, `Muito prazer, ${nomeFinal}! Escolhe uma das opções para continuarmos:`);
                
                await sendInteractiveMenu(null, jid, txtBoasVindas, [
                    { id: '1', title: 'Agendar', description: 'Cortar/Marcar novo!' },
                    { id: '2', title: 'Serviços e Preços', description: 'Tabela C/ preçários' },
                    { id: '3', title: 'A Minha Agenda', description: 'Check dos apontamentos' },
                    { id: '4', title: 'Cancelar Marcas', description: 'Pausar Canceladas!' },
                    { id: '5', title: 'Av., Mapa / Hrs', description: 'Geolocalização' },
                    { id: '6', title: 'Falar com Humano', description: 'Atendimento Orgânico' }
                ]);
                return;
            }
        }

        stateMachine.set(senderNumber, userState);
        const msgLower = textMessage.trim().toLowerCase();
        const cmdsIntuitosUI = ['menu', 'início', 'inicio', 'voltar', 'cancelar tudo', '0'];

        if (cmdsIntuitosUI.includes(msgLower)) {
            userState.step = STEPS.MENU_PRINCIPAL;
            userState.data = {};
            await sendMenu(null, jid, cliente.nome);
        } else if (textMessage.startsWith('srv_')) {
            const servicoId = textMessage.replace('srv_', '');
            userState.step = STEPS.AGENDAMENTO_SERVICO;
            stateMachine.set(senderNumber, userState);
            await handleAgendamento(null, jid, servicoId, senderNumber, stateMachine, STEPS);
        } else if (userState.step.startsWith('AGENDAMENTO_')) {
            await handleAgendamento(null, jid, textMessage, senderNumber, stateMachine, STEPS);
        } else {
            switch (userState.step) {
                case STEPS.MENU_PRINCIPAL:
                    await handleEstrategiaLLMSalvos(null, jid, textMessage, senderNumber, cliente.nome, horaMaputoStr, maputoHour, periodoDia, foraDoExpediente);
                    break;
                case STEPS.CANCELAR_AGENDAMENTO:
                    await processarCancelamento(null, jid, textMessage, senderNumber, stateMachine, STEPS);
                    break;
                default:
                    userState.step = STEPS.MENU_PRINCIPAL;
                    userState.data = {};
                    break;
            }
        }
    } catch (error) {}
}

async function handleEstrategiaLLMSalvos(sockIgnorado, jid, textMessage, senderNumber, nomeCliente, horaMaputoStr, maputoHour, periodoDia, foraDoExpediente) {
    const option = textMessage.trim();
    switch (option) {
        case '1': await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS); break;
        case '2':
        case 'btn_servicos': await verPrecosEServicos(null, jid); break;
        case '3': await verMeusAgendamentos(null, jid, senderNumber); break;
        case '4': await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS); break;
        case '5':
            const txtLocal = await gerarMensagemNotificacao(`Redige uma mensagem simpática e direta dizendo que estamos localizados na Av. 24 de Julho, Maputo, e que o mapa vai a seguir.`, "Ficamos na Av. 24 de Julho, Maputo. Segue o mapa abaixo:");
            await sendDelayedText(null, jid, txtLocal);
            await sendDelayedLocation(jid, -25.9744, 32.5885, "Portal Da Barbearia", "Av. 24 de Julho, Maputo");
            break;
        case '6':
        case 'btn_equipe':
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
            await sendDelayedText(null, jid, 'Transferido para o nosso atendente. Aguarda só um instante!\n(Para voltar ao bot, digita *#sair*)');
            if (global.io) global.io.emit('atualizar_fila');
            break;
        default:
            const historicoCru = await prisma.mensagemIA.findMany({ where: { clienteId: senderNumber }, orderBy: { criadoEm: 'desc' }, take: 4 });
            await prisma.mensagemIA.create({ data: { role: 'user', content: textMessage, clienteId: senderNumber } });

            let tempoPassado = "O cliente acabou de iniciar a conversa.";
            if (historicoCru.length > 0) {
                const diffMins = Math.floor((Date.now() - new Date(historicoCru[0].criadoEm).getTime()) / 60000);
                if (diffMins > 1440) tempoPassado = `Saudação "${periodoDia}" OBRIGATÓRIA.`;
                else if (diffMins > 120) tempoPassado = `Dê a saudação "${periodoDia}".`;
                else tempoPassado = `Conversa ATIVA. PROIBIDO dizer "Bom dia/tarde". Responde direto.`;
            }

            const infoTemporal = `Horário: ${horaMaputoStr} (${periodoDia}). ${tempoPassado} ${foraDoExpediente ? 'Barbearia FECHADA agora.' : 'Barbearia ABERTA.'}`;
            const textIArid = await responderComGroq(textMessage, 0, historicoCru.reverse(), infoTemporal, nomeCliente);
            const intentCheck = textIArid.trim().toUpperCase().replace(/\s+/g, '');

            if (intentCheck.includes('/AGENDAR')) await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS);
            else if (intentCheck.includes('/CANCELAR')) await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS);
            else if (intentCheck.includes('/PRECOS')) await verPrecosEServicos(null, jid);
            else if (intentCheck.includes('/AGENDA')) await verMeusAgendamentos(null, jid, senderNumber);
            else if (intentCheck.includes('/LOCAL')) {
                const tLocal = await gerarMensagemNotificacao(`Redige uma mensagem simpática dizendo que estamos na Av. 24 de Julho e que o mapa vai a seguir.`, "Ficamos na Av. 24 de Julho, Maputo. Segue o mapa:");
                await sendDelayedText(null, jid, tLocal);
                await sendDelayedLocation(jid, -25.9744, 32.5885, "Portal Da Barbearia", "Av. 24 de Julho, Maputo");
            } else if (intentCheck.includes('/HUMANO')) {
                await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
                await sendDelayedText(null, jid, 'A transferir para um atendente humano. Aguarda um pouco.\n(Para voltar, digita *#sair*)');
                if (global.io) global.io.emit('atualizar_fila');
            } else if (intentCheck.includes('/MENU')) await sendMenu(null, jid, nomeCliente);
            else {
                if (textIArid.trim().startsWith('/')) await sendMenu(null, jid, nomeCliente);
                else {
                    await prisma.mensagemIA.create({ data: { role: 'assistant', content: textIArid, clienteId: senderNumber } });
                    await sendDelayedText(null, jid, textIArid);
                }
            }
            break;
    }
}
module.exports = { handleMessage, stateMachine, STEPS };