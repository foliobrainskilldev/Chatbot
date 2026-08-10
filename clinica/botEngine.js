const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const aiService = require('../aiService');
const webhookService = require('../services/webhookService');
const { iniciarAgendamentoClinica, handleAgendamentoClinica } = require('./flowAgendamento');
const { iniciarCancelamentoClinica, processarCancelamentoClinica } = require('./flowCancelamento'); // Modificado para aceitar remarcação

const stateMachine = new Map();
const STEPS = { 
    MENU_PRINCIPAL: 'MENU_PRINCIPAL', 
    AGENDAMENTO_TRATAMENTO: 'CLINICA_AG_TRATAMENTO', 
    AGENDAMENTO_MEDICO: 'CLINICA_AG_MEDICO', 
    AGENDAMENTO_DATA: 'CLINICA_AG_DATA', 
    AGENDAMENTO_HORA: 'CLINICA_AG_HORA', 
    AGENDAMENTO_CONFIRMAR: 'CLINICA_AG_CONFIRMAR',
    CANCELAR_CONSULTA: 'CLINICA_CANCELAR',
    REMARCAR_CONSULTA: 'CLINICA_REMARCAR'
};

async function getOrCreateCliente(numero, nomePushName = null) {
    let cliente = await prisma.cliente.findUnique({ where: { id: numero } });
    if (!cliente) {
        cliente = await prisma.cliente.create({ 
            data: { id: numero, nome: nomePushName, leadStatus: 'NOVO', origem: 'WhatsApp IA' } 
        });
        await webhookService.dispararEvento('lead.created', cliente);
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
    } 
    else if (message.type === 'audio') {
        const mediaId = message.audio.id;
        const mimeType = message.audio.mime_type;
        mediaCloudinaryUrl = await whatsappService.downloadMetaMediaToCloudinary(mediaId, mimeType);
        textoProcessado = await aiService.transcreverAudioPorUrl(mediaCloudinaryUrl);
    } 
    else if (message.type === 'text') {
        textoProcessado = message.text.body;
    } 
    else if (message.type === 'interactive') {
        textoProcessado = message.interactive.button_reply?.id || message.interactive.list_reply?.id;
    }

    if (!textoProcessado && !mediaCloudinaryUrl) return;

    const logConteudo = mediaCloudinaryUrl ? `[MEDIA:${message.type}] ${mediaCloudinaryUrl} | Texto: ${textoProcessado}` : textoProcessado;
    await prisma.mensagemIA.create({ data: { role: 'user', content: logConteudo, clienteId: senderNumber, midiaUrl: mediaCloudinaryUrl, tipoMidia: message.type } });

    let userState = stateMachine.get(senderNumber) || { step: STEPS.MENU_PRINCIPAL, data: {} };

    // Interceptadores Hardcoded (Ações no meio de um fluxo de botões)
    if (userState.step.startsWith('CLINICA_AG_')) {
        await handleAgendamentoClinica(senderNumber, textoProcessado, senderNumber, stateMachine, STEPS);
        return;
    }
    
    if (userState.step === STEPS.CANCELAR_CONSULTA || userState.step === STEPS.REMARCAR_CONSULTA) {
        await processarCancelamentoClinica(senderNumber, textoProcessado, senderNumber, stateMachine, STEPS);
        return;
    }

    // 1. NLP - Entender a Intenção do Paciente
    let intencao = await aiService.classificarIntencao(textoProcessado);
    
    // Fallback manual para caso o LLaMA da Groq não pegue "remarcar" perfeitamente
    if (textoProcessado.toLowerCase().includes('remarcar')) {
        intencao = 'REMARCAR';
    }

    // 2. Roteamento de Intenções
    if (intencao === 'HUMANO') {
        await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true, leadStatus: 'INTERESSADO' } });
        const resp = "Sua conversa foi transferida para nossa recepção. Um momento, por favor.";
        await prisma.mensagemIA.create({ data: { role: 'assistant', content: resp, clienteId: senderNumber } });
        await whatsappService.sendText(senderNumber, resp);
        if (global.io) global.io.emit('atualizar_fila');
        return;
    }

    if (intencao === 'AGENDAR' || textoProcessado === 'cmd_agendar') {
        await prisma.cliente.update({ where: { id: senderNumber }, data: { leadStatus: 'QUALIFICADO' } });
        return await iniciarAgendamentoClinica(senderNumber, senderNumber, stateMachine, STEPS);
    }

    if (intencao === 'CANCELAR') {
        return await iniciarCancelamentoClinica(senderNumber, senderNumber, stateMachine, STEPS, false);
    }

    if (intencao === 'REMARCAR') {
        return await iniciarCancelamentoClinica(senderNumber, senderNumber, stateMachine, STEPS, true);
    }

    const configDb = await prisma.configSistema.findFirst();
    const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO' } });
    const historico = await prisma.mensagemIA.findMany({ where: { clienteId: senderNumber }, take: 10, orderBy: { criadoEm: 'desc' } });
    historico.reverse();

    const respostaIA = await aiService.responderComContextoIA(textoProcessado, historico, configDb, tratamentos);
    
    await prisma.mensagemIA.create({ data: { role: 'assistant', content: respostaIA, clienteId: senderNumber } });
    await whatsappService.sendText(senderNumber, respostaIA);
}

function limparMemoriaEstado() {
    stateMachine.clear();
}

module.exports = { processarMensagemEntrante, limparMemoriaEstado, stateMachine, STEPS };