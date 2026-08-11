const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const aiService = require('../aiService');
const webhookService = require('../services/webhookService');
const automationEngine = require('../services/automationEngine');

const { processarAgendamento } = require('./flowAgendamento');
const { processarCancelamento } = require('./flowCancelamento');
const { processarDuvidas } = require('./flowConsultas');

const stateMachine = new Map();

async function getOrCreateCliente(numero, nomePushName = null) {
    let cliente = await prisma.cliente.findUnique({ where: { id: numero } });
    if (!cliente) {
        cliente = await prisma.cliente.create({ 
            data: { id: numero, nome: nomePushName, leadStatus: 'NOVO', origem: 'WhatsApp IA' } 
        });
        await webhookService.dispararEvento('lead.created', cliente);
        await automationEngine.dispararAutomacoes('NOVO_LEAD', cliente);
    } else {
        await prisma.cliente.update({ where: { id: numero }, data: { ultimaInteracao: new Date() } });
    }
    return cliente;
}

async function processarMensagemEntrante(message) {
    const senderNumber = message.from;
    const msgId = message.id;
    let pushName = message.profile?.name || null;
    let cliente = await getOrCreateCliente(senderNumber, pushName);
    
    if (cliente.falarHumano) {
        let textLog = message.text?.body || '[Mídia Recebida]';
        await prisma.mensagemIA.create({ data: { role: 'user', content: textLog, clienteId: senderNumber } });
        await automationEngine.dispararAutomacoes('NOVA_MENSAGEM', { clienteId: senderNumber, cliente, mensagem: textLog });
        return;
    }

    await whatsappService.markAsReadAndTyping(msgId, senderNumber);
    let textoProcessado = "";
    let mediaCloudinaryUrl = null;

    if (message.type === 'image' || message.type === 'document') {
        const mediaId = message[message.type].id;
        const mimeType = message[message.type].mime_type;
        mediaCloudinaryUrl = await whatsappService.downloadMetaMediaToCloudinary(mediaId, mimeType);
        textoProcessado = message[message.type].caption || "[Paciente enviou uma imagem/documento]";
    } else if (message.type === 'audio') {
        const mediaId = message.audio.id;
        const mimeType = message.audio.mime_type;
        mediaCloudinaryUrl = await whatsappService.downloadMetaMediaToCloudinary(mediaId, mimeType);
        textoProcessado = await aiService.transcreverAudioPorUrl(mediaCloudinaryUrl);
    } else if (message.type === 'text') {
        textoProcessado = message.text.body;
    } else if (message.type === 'interactive') {
        textoProcessado = message.interactive.button_reply?.id || message.interactive.list_reply?.id;
    }

    if (!textoProcessado && !mediaCloudinaryUrl) return;

    const logConteudo = mediaCloudinaryUrl ? `[MEDIA:${message.type}] ${mediaCloudinaryUrl} | Texto: ${textoProcessado}` : textoProcessado;
    await prisma.mensagemIA.create({ data: { role: 'user', content: logConteudo, clienteId: senderNumber, midiaUrl: mediaCloudinaryUrl, tipoMidia: message.type } });
    await automationEngine.dispararAutomacoes('NOVA_MENSAGEM', { clienteId: senderNumber, cliente, mensagem: textoProcessado });

    let isInteractive = message.type === 'interactive';
    let userState = stateMachine.get(senderNumber) || { step: 'IDLE', intent: null, entities: {} };
    const configDb = await prisma.configSistema.findFirst();
    
    const historicoRaw = await prisma.mensagemIA.findMany({ 
        where: { clienteId: senderNumber }, 
        take: 8, orderBy: { criadoEm: 'desc' } 
    });
    historicoRaw.reverse();
    const historico = historicoRaw.map(h => ({ role: h.role, content: h.content }));

    let nlpResult = { intent: "unknown", confidence: 1, entities: {} };

    // ORQUESTRAÇÃO DE NLP VS MODO ESTRUTURADO INTERATIVO
    if (!isInteractive && textoProcessado) {
        nlpResult = await aiService.analisarMensagemNLP(textoProcessado, historico, userState);
    } else if (isInteractive) {
        if (textoProcessado.startsWith('trat_') || textoProcessado.match(/^\d{2}\/\d{2}\/\d{4}$/) || textoProcessado.match(/^\d{2}:\d{2}$/)) {
            nlpResult.intent = 'appointment.create';
        } else if (textoProcessado.startsWith('canc_')) {
            nlpResult.intent = userState.intent === 'appointment.reschedule' ? 'appointment.reschedule' : 'appointment.cancel';
        } else if (textoProcessado === 'cmd_agendar') {
            nlpResult.intent = 'appointment.create';
        } else if (textoProcessado === '0') {
            nlpResult.intent = 'goodbye';
        }
    }

    // Merge nas Entidades Identificadas (Memória Curta)
    userState.entities = { ...userState.entities, ...(nlpResult.entities || {}) };

    // Gestão de Confiança e Fixação de Intenção (Slot Filling)
    let activeIntent = nlpResult.intent;
    if (nlpResult.confidence < 0.3 && userState.step !== 'IDLE') {
        activeIntent = userState.intent; 
    } else if (nlpResult.intent !== 'unknown') {
        userState.intent = activeIntent;
    } else {
        activeIntent = userState.intent || 'unknown';
    }

    if (activeIntent === 'human.transfer') {
        await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true, leadStatus: 'INTERESSADO' } });
        const leadTransferido = await prisma.cliente.findUnique({ where: { id: senderNumber } });
        await automationEngine.dispararAutomacoes('TRANSFERIDO_HUMANO', leadTransferido);
        await webhookService.dispararEvento('lead.updated', leadTransferido);

        const resp = configDb.msgTransferencia || "Vou encaminhar você para nossa recepção. Um momento, por favor.";
        await prisma.mensagemIA.create({ data: { role: 'assistant', content: resp, clienteId: senderNumber } });
        await whatsappService.sendText(senderNumber, resp);
        if (global.io) global.io.emit('atualizar_fila');
        stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
        return;
    }

    // ROTEAMENTO PARA AS FERRAMENTAS DO BACKEND
    if (activeIntent === 'appointment.create') {
        await prisma.cliente.update({ where: { id: senderNumber }, data: { leadStatus: 'QUALIFICADO' } });
        await processarAgendamento(senderNumber, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb);
    } else if (activeIntent === 'appointment.cancel' || activeIntent === 'appointment.reschedule') {
        await processarCancelamento(senderNumber, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, activeIntent === 'appointment.reschedule');
    } else {
        await processarDuvidas(senderNumber, textoProcessado, senderNumber, userState, nlpResult, configDb, historico);
    }
}

function limparMemoriaEstado() {
    stateMachine.clear();
}

module.exports = { processarMensagemEntrante, limparMemoriaEstado, stateMachine };