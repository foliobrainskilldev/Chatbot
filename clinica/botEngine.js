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
            data: { id: numero, nome: nomePushName || 'Paciente', leadStatus: 'NOVO', origem: 'WhatsApp IA' } 
        });
        await webhookService.dispararEvento('lead.created', cliente);
        await automationEngine.dispararAutomacoes('NOVO_LEAD', cliente);
    } else {
        const updates = { ultimaInteracao: new Date() };
        if (nomePushName && !cliente.nome) updates.nome = nomePushName;
        await prisma.cliente.update({ where: { id: numero }, data: updates });
    }
    return cliente;
}

async function processarMensagemEntrante(message) {
    const senderNumber = message.from;
    const msgId = message.id;

    try {
        console.log(`🤖 [MOTOR CLÍNICA] Processando mensagem de ${senderNumber}`);
        
        let pushName = message.profile?.name || null;
        let cliente = await getOrCreateCliente(senderNumber, pushName);
        
        if (cliente.falarHumano) {
            let textLog = message.text?.body || '[Mídia Recebida]';
            await prisma.mensagemIA.create({ data: { role: 'user', content: textLog, clienteId: senderNumber } });
            console.log(`🛑 [MOTOR CLÍNICA] Lead em atendimento humano. Mensagem salva, IA ignorada.`);
            return; 
        }

        // Ticks Azuis e Digitando
        await whatsappService.markAsReadAndTyping(msgId, senderNumber);

        let textoProcessado = "";
        let mediaCloudinaryUrl = null;

        if (message.type === 'image' || message.type === 'document') {
            textoProcessado = message[message.type].caption || "[Imagem/Documento]";
        } else if (message.type === 'audio') {
            textoProcessado = "[Áudio Recebido]";
        } else if (message.type === 'text') {
            textoProcessado = message.text.body;
        } else if (message.type === 'interactive') {
            textoProcessado = message.interactive.button_reply?.id || message.interactive.list_reply?.id;
        }

        if (!textoProcessado) {
            console.log(`⚠️ [MOTOR CLÍNICA] Mensagem sem texto ou tipo suportado ignorada.`);
            return;
        }

        await prisma.mensagemIA.create({ data: { role: 'user', content: textoProcessado, clienteId: senderNumber, tipoMidia: message.type } });
        
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

        if (!isInteractive && textoProcessado) {
            nlpResult = await aiService.analisarMensagemNLP(textoProcessado, historico, userState);
            console.log(`🧠 [NLP] Intenção detectada: ${nlpResult.intent}`);
        } else if (isInteractive) {
            if (textoProcessado.startsWith('trat_') || textoProcessado === 'cmd_agendar') nlpResult.intent = 'appointment.create';
            else if (textoProcessado.startsWith('canc_')) nlpResult.intent = 'appointment.cancel';
        }

        let activeIntent = nlpResult.intent || 'unknown';

        const delayMs = Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000;
        await new Promise(resolve => setTimeout(resolve, delayMs));

        if (activeIntent === 'human.transfer') {
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true, leadStatus: 'INTERESSADO' } });
            const resp = configDb?.msgTransferencia || "Vou transferir você para um atendente. Um momento.";
            await prisma.mensagemIA.create({ data: { role: 'assistant', content: resp, clienteId: senderNumber } });
            await whatsappService.sendText(senderNumber, resp);
            return;
        }

        if (activeIntent === 'appointment.create') {
            await processarAgendamento(senderNumber, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb);
        } else if (activeIntent === 'appointment.cancel' || activeIntent === 'appointment.reschedule') {
            await processarCancelamento(senderNumber, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, false);
        } else {
            await processarDuvidas(senderNumber, textoProcessado, senderNumber, userState, nlpResult, configDb, historico);
        }

    } catch (error) {
        console.error("❌ ERRO CRÍTICO NO MOTOR DA CLÍNICA:", error);
        await whatsappService.sendText(senderNumber, "Desculpe, meu sistema passou por uma instabilidade técnica agorinha. Você poderia repetir a mensagem?");
    }
}

function limparMemoriaEstado() { stateMachine.clear(); }
module.exports = { processarMensagemEntrante, limparMemoriaEstado, stateMachine };