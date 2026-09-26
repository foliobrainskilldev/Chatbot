// --- START OF FILE barbearia/botEngine.js ---
const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const aiService = require('../aiService'); 

const stateMachine = new Map();
const messageBuffer = new Map();
const debounceTimers = new Map();

function limparMemoriaEstado(telefone = null) {
    if (telefone) {
        stateMachine.delete(telefone);
        messageBuffer.delete(telefone);
        if (debounceTimers.has(telefone)) clearTimeout(debounceTimers.get(telefone));
        debounceTimers.delete(telefone);
    } else {
        stateMachine.clear();
        messageBuffer.clear();
        for (let timer of debounceTimers.values()) clearTimeout(timer);
        debounceTimers.clear();
    }
}

async function getOrCreateCliente(numero, nomePushName = null) {
    let cliente = await prisma.cliente.findUnique({ where: { id: numero } });
    let isNewPatient = false;

    if (!cliente) {
        try {
            isNewPatient = true;
            cliente = await prisma.cliente.create({ 
                data: { id: numero, nome: nomePushName || 'Paciente', leadStatus: 'NOVO', origem: 'WhatsApp IA' } 
            });
        } catch (error) {
            // [FIX SECURITY]: Tratamento P2002 para Barbearia também
            if (error.code === 'P2002') {
                isNewPatient = false;
                cliente = await prisma.cliente.findUnique({ where: { id: numero } });
            } else {
                throw error;
            }
        }
    } else {
        const updates = { ultimaInteracao: new Date() };
        if (nomePushName && !cliente.nome) updates.nome = nomePushName;
        if (cliente.leadStatus === 'NOVO') isNewPatient = true;
        cliente = await prisma.cliente.update({ where: { id: numero }, data: updates });
    }
    return { cliente, isNewPatient };
}

async function processarMensagemEntrante(message) {
    if (!message || !message.from) return; 

    const senderNumber = message.from;
    const msgId = message.id;

    await whatsappService.markAsReadAndTyping(msgId, senderNumber);

    try {
        const configDb = await prisma.configSistema.findFirst();

        let textoProcessado = "";
        let isTranscribed = false;

        if (message.type === 'audio') {
            const mediaId = message.audio.id;
            try {
                const audioBuffer = await whatsappService.downloadMedia(mediaId);
                textoProcessado = await aiService.transcreverAudio(audioBuffer, configDb);
                isTranscribed = true;
            } catch (e) {
                textoProcessado = "[FALHA_AUDIO]";
            }
        } else if (message.type === 'text') {
            textoProcessado = message.text?.body || "";
        } else if (message.type === 'interactive') {
            textoProcessado = message.interactive.button_reply?.id || message.interactive.list_reply?.id;
        }
        
        if (!textoProcessado) return;

        let buffer = messageBuffer.get(senderNumber) || [];
        
        // [FIX SECURITY]: Proteção contra Denial of Wallet / Spam
        if (buffer.length >= 10) {
            console.warn(`⚠️ [SECURITY] Spam detectado na barbearia. Número: ${senderNumber}. Descartando.`);
            return;
        }

        buffer.push({
            texto: textoProcessado,
            isTranscribed: isTranscribed,
            isInteractive: message.type === 'interactive',
            pushName: message.profile?.name || null
        });
        messageBuffer.set(senderNumber, buffer);

        if (debounceTimers.has(senderNumber)) {
            clearTimeout(debounceTimers.get(senderNumber));
        }

        const timer = setTimeout(async () => {
            debounceTimers.delete(senderNumber);
            const msgs = messageBuffer.get(senderNumber);
            messageBuffer.delete(senderNumber);

            if (!msgs || msgs.length === 0) return;

            const falhas = msgs.filter(m => m.texto === "[FALHA_AUDIO]");
            if (falhas.length === msgs.length) {
                await whatsappService.sendText(senderNumber, "Desculpe, a nossa IA teve uma pequena falha técnica ao ler o áudio. Poderia repetir ou digitar?");
                return;
            }

            const validos = msgs.filter(m => m.texto !== "[FALHA_AUDIO]");
            const textoUnificado = validos.map(m => m.texto).join('. ');
            const temAudio = validos.some(m => m.isTranscribed);
            const isInteractive = validos.some(m => m.isInteractive);
            const nomePushName = validos[0].pushName;

            let textoComandoBase = textoUnificado;
            if (isInteractive) {
                const interativos = validos.filter(m => m.isInteractive);
                textoComandoBase = interativos[interativos.length - 1].texto; 
            }

            await executarLogicaCoreBarbearia(senderNumber, nomePushName, textoComandoBase, textoUnificado, temAudio, isInteractive, configDb);

        }, 3500);

        debounceTimers.set(senderNumber, timer);

    } catch (error) {
        console.error('❌ ERRO NO ACUMULADOR DA BARBEARIA:', error);
    }
}

async function executarLogicaCoreBarbearia(senderNumber, nomePushName, textoProcessado, textoUnificadoParaBD, temAudio, isInteractive, configDb) {
    try {
        let { cliente, isNewPatient } = await getOrCreateCliente(senderNumber, nomePushName);
        
        if (cliente.falarHumano) return; 

        const contentToSave = temAudio ? `[Áudio Transcrito]: ${textoUnificadoParaBD}` : textoUnificadoParaBD;
        await prisma.mensagemIA.create({ data: { role: 'user', content: contentToSave, clienteId: senderNumber } });

        const historicoRaw = await prisma.mensagemIA.findMany({ where: { clienteId: senderNumber }, take: 8, orderBy: { criadoEm: 'desc' } });
        historicoRaw.reverse();
        const historico = historicoRaw.map(h => ({ role: h.role, content: h.content }));

        let userState = stateMachine.get(senderNumber) || { step: 'IDLE', entities: {} };
        let nlpResult = { intent: "UNKNOWN", confidence: 1, entities: {} };

        if (isInteractive) {
            if (textoProcessado === 'cmd_agendar') nlpResult.intent = 'BOOK_APPOINTMENT';
            else if (textoProcessado.startsWith('srv_')) { nlpResult.intent = 'SELECT_TREATMENT'; nlpResult.entities.treatment_id = textoProcessado.replace('srv_', ''); }
            else if (textoProcessado.startsWith('barb_')) { nlpResult.intent = 'SELECT_PROFESSIONAL'; nlpResult.entities.professional_id = textoProcessado.replace('barb_', ''); }
            else if (textoProcessado.startsWith('data_')) { nlpResult.intent = 'SELECT_DATE'; nlpResult.entities.date = textoProcessado.replace('data_', ''); }
            else if (textoProcessado === 'ver_mais_data') nlpResult.intent = 'REQUEST_MORE_DATES';
            else if (textoProcessado.startsWith('hora_')) { nlpResult.intent = 'SELECT_TIME'; nlpResult.entities.time = textoProcessado.replace('hora_', ''); }
            else if (textoProcessado === 'ver_mais_hora') nlpResult.intent = 'REQUEST_MORE_TIMES';
            else if (textoProcessado === 'cmd_confirmar_reserva') nlpResult.intent = 'CONFIRM_APPOINTMENT';
            else if (textoProcessado === 'cmd_cancelar_fluxo') nlpResult.intent = 'REJECT_APPOINTMENT';
            else if (textoProcessado.startsWith('canc_')) { nlpResult.intent = 'CANCEL_APPOINTMENT'; nlpResult.entities.appointment_id = textoProcessado.replace('canc_', ''); }
            else if (textoProcessado === 'cmd_precos') nlpResult.intent = 'TREATMENT_PRICE';
            else if (textoProcessado === 'cmd_agenda') nlpResult.intent = 'CHECK_UPCOMING_APPOINTMENTS';
            else if (textoProcessado === 'cmd_humano') nlpResult.intent = 'HUMAN_TRANSFER';
            
            userState.entities = { ...userState.entities, ...nlpResult.entities };
        } else {
            nlpResult = await aiService.analisarMensagemNLP(textoUnificadoParaBD, historico, userState, configDb);
            userState.entities = { ...userState.entities, ...nlpResult.entities };
        }

        let activeIntent = nlpResult.intent || 'UNKNOWN';

        if (activeIntent === 'HUMAN_TRANSFER' || activeIntent === 'FRUSTRATION') {
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true, leadStatus: 'INTERESSADO' } });
            const resp = "Vou transferir você para nossa equipe agora mesmo. Só um instante.";
            await prisma.mensagemIA.create({ data: { role: 'assistant', content: resp, clienteId: senderNumber } });
            await whatsappService.sendText(senderNumber, resp);
            return;
        }

        if (activeIntent === 'GREETING' && userState.step !== 'IDLE') {
            const prompt = "Diga: Olá novamente! Estávamos no meio do seu agendamento. Deseja continuar escolhendo a data e horário ou prefere cancelar?";
            const resp = await aiService.gerarRespostaNatural(prompt, [], {}, configDb);
            await prisma.mensagemIA.create({ data: { role: 'assistant', content: resp, clienteId: senderNumber } });
            await whatsappService.sendText(senderNumber, resp);
            return;
        }

        if (activeIntent === 'UNKNOWN' && userState.step !== 'IDLE') {
            const contextoFase = userState.step === 'AGENDAMENTO_COLLECTING_SERVICE' ? 'qual o serviço desejado' :
                                 userState.step === 'AGENDAMENTO_COLLECTING_BARBER' ? 'qual barbeiro você prefere' :
                                 userState.step === 'AGENDAMENTO_COLLECTING_DATE' ? 'a data da reserva' :
                                 userState.step === 'AGENDAMENTO_AWAITING_TIME' ? 'o horário do corte' : 'a confirmação final';
                                 
            const prompt = `Nós estamos no meio do agendamento, aguardando que o cliente informe ${contextoFase}. O cliente disse algo que o sistema não conseguiu classificar diretamente: "${textoUnificadoParaBD}". Responda de forma extremamente gentil, diga que não entendeu muito bem e peça para ele fornecer ${contextoFase} para continuarmos. Seja breve.`;
            
            const resp = await aiService.gerarRespostaNatural(prompt, [], {}, configDb);
            await prisma.mensagemIA.create({ data: { role: 'assistant', content: resp, clienteId: senderNumber } });
            await whatsappService.sendText(senderNumber, resp);
            return;
        }

        stateMachine.set(senderNumber, userState);

        const bookingIntents = ['BOOK_APPOINTMENT', 'SELECT_TREATMENT', 'SELECT_PROFESSIONAL', 'SELECT_DATE', 'SELECT_TIME', 'REQUEST_MORE_TIMES', 'REQUEST_MORE_DATES', 'REQUEST_SPECIFIC_TIME', 'CONFIRM_APPOINTMENT', 'REJECT_APPOINTMENT', 'CHANGE_TREATMENT', 'CHANGE_DATE', 'CHANGE_TIME'];
        const cancelIntents = ['CANCEL_APPOINTMENT', 'RESCHEDULE_APPOINTMENT'];

        if (bookingIntents.includes(activeIntent) || userState.step.startsWith('AGENDAMENTO_')) {
            const flowAgendamento = require('./flowAgendamento');
            await flowAgendamento.processarAgendamento(senderNumber, textoUnificadoParaBD, senderNumber, stateMachine, nlpResult, isInteractive, configDb, cliente, isNewPatient);
        } 
        else if (cancelIntents.includes(activeIntent) || userState.step.startsWith('CANCELAMENTO_')) {
            const flowCancelamento = require('./flowCancelamento');
            await flowCancelamento.processarCancelamento(senderNumber, textoUnificadoParaBD, senderNumber, stateMachine, nlpResult, isInteractive, configDb, false, cliente, isNewPatient);
        } 
        else {
            const flowConsultas = require('./flowConsultas');
            await flowConsultas.processarDuvidas(senderNumber, textoUnificadoParaBD, senderNumber, userState, nlpResult, configDb, historico, cliente, isNewPatient);
        }
        
    } catch (error) {
        console.error('❌ ERRO CRÍTICO NO NÚCLEO DA BARBEARIA:', error);
        await whatsappService.sendText(senderNumber, "Desculpe, a nossa IA teve uma pequena falha técnica. Poderia repetir?");
    }
}

module.exports = { processarMensagemEntrante, limparMemoriaEstado, stateMachine };
// --- END OF FILE barbearia/botEngine.js ---