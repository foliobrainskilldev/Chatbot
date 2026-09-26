// --- START OF FILE clinica/botEngine.js ---
const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const aiService = require('../aiService');
const webhookService = require('../services/webhookService');
const automationEngine = require('../services/automationEngine');
const demoService = require('../services/demoService');

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
            await webhookService.dispararEvento('lead.created', cliente);
            await automationEngine.dispararAutomacoes('NOVO_LEAD', cliente);
        } catch (error) {
            // [FIX SECURITY]: Race Condition (Evita crash no P2002)
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
    if (demoService.isDemoActive()) return;

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
                if (textoProcessado.includes("Não foi possível compreender") || textoProcessado.trim() === "") {
                    textoProcessado = "[FALHA_AUDIO]";
                }
            } catch(e) { 
                textoProcessado = "[FALHA_AUDIO]"; 
            }
        } else if (['image', 'video', 'document'].includes(message.type)) {
            textoProcessado = message[message.type].caption || "[Mídia Recebida]"; 
        } else if (message.type === 'text') {
            textoProcessado = message.text.body;
        } else if (message.type === 'interactive') {
            textoProcessado = message.interactive.button_reply?.id || message.interactive.list_reply?.id;
        }

        if (!textoProcessado) return;

        let buffer = messageBuffer.get(senderNumber) || [];
        
        // [FIX SECURITY]: Proteção contra Denial of Wallet / Ataque OOM
        if (buffer.length >= 10) {
            console.warn(`⚠️ [SECURITY] Spam detectado do número ${senderNumber}. Mensagem descartada.`);
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
                await prisma.mensagemIA.create({ data: { role: 'user', content: '[Áudio Recebido - Incompreensível]', clienteId: senderNumber } });
                const isEnglish = configDb?.idioma?.includes('Inglês');
                const respFalha = isEnglish 
                    ? "Sorry, I couldn't hear your audio clearly. Could you record it again or type the message?" 
                    : "Desculpe, não consegui ouvir direito o seu áudio. Você poderia gravar novamente ou digitar a mensagem?";
                await prisma.mensagemIA.create({ data: { role: 'assistant', content: respFalha, clienteId: senderNumber } });
                await whatsappService.sendText(senderNumber, respFalha);
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

            await executarLogicaCoreClinica(senderNumber, nomePushName, textoComandoBase, textoUnificado, temAudio, isInteractive, configDb);

        }, 3500); 

        debounceTimers.set(senderNumber, timer);

    } catch (error) {
        console.error("❌ ERRO CRÍTICO NO ACUMULADOR DA CLÍNICA:", error);
    }
}

async function executarLogicaCoreClinica(senderNumber, nomePushName, textoProcessado, textoUnificadoParaBD, temAudio, isInteractive, configDb) {
    try {
        const { cliente, isNewPatient } = await getOrCreateCliente(senderNumber, nomePushName);
        
        if (cliente.falarHumano) return; 

        const isEnglish = configDb?.idioma?.includes('Inglês');

        let contentToSave = temAudio ? `[Áudio Transcrito]: ${textoUnificadoParaBD}` : textoUnificadoParaBD;
        await prisma.mensagemIA.create({ data: { role: 'user', content: contentToSave, clienteId: senderNumber } });

        const historicoRaw = await prisma.mensagemIA.findMany({ where: { clienteId: senderNumber }, take: 4, orderBy: { criadoEm: 'desc' } });
        historicoRaw.reverse();
        
        const historicoLimpo = historicoRaw
            .filter(h => !h.content.includes('[SISTEMA AUTOMÁTICO]') && !h.content.includes('[MEDIA:'))
            .map(h => ({ role: h.role, content: h.content.replace(/\[.*?\]/g, '').trim() }));

        let userState = stateMachine.get(senderNumber) || { step: 'IDLE', entities: {}, frustrationCount: 0 };
        let nlpResult = { intent: "UNKNOWN", confidence: 1, entities: {} };

        if (isInteractive) {
            if (textoProcessado === 'cmd_agendar') nlpResult.intent = 'BOOK_APPOINTMENT';
            else if (textoProcessado === 'cmd_menu_tratamentos') nlpResult.intent = 'TREATMENT_LIST';
            else if (textoProcessado === 'cmd_humano') nlpResult.intent = 'HUMAN_TRANSFER';
            else if (textoProcessado.startsWith('trat_')) { nlpResult.intent = 'SELECT_TREATMENT'; nlpResult.entities = { treatment_id: textoProcessado.replace('trat_', '') }; }
            else if (textoProcessado.startsWith('prof_')) { nlpResult.intent = 'SELECT_PROFESSIONAL'; nlpResult.entities = { professional_id: textoProcessado.replace('prof_', '') }; }
            else if (textoProcessado.startsWith('data_')) { nlpResult.intent = 'SELECT_DATE'; nlpResult.entities = { date: textoProcessado.replace('data_', '') }; }
            else if (textoProcessado === 'ver_mais_data') nlpResult.intent = 'REQUEST_MORE_DATES';
            else if (textoProcessado.startsWith('hora_')) { nlpResult.intent = 'SELECT_TIME'; nlpResult.entities = { time: textoProcessado.replace('hora_', '') }; }
            else if (textoProcessado === 'ver_mais_hora') nlpResult.intent = 'REQUEST_MORE_TIMES';
            else if (textoProcessado === 'cmd_confirmar_reserva') nlpResult.intent = 'CONFIRM_APPOINTMENT';
            else if (textoProcessado === 'cmd_cancelar_fluxo') nlpResult.intent = 'REJECT_APPOINTMENT';
            else if (textoProcessado.startsWith('canc_')) { nlpResult.intent = 'CANCEL_APPOINTMENT'; nlpResult.entities = { appointment_id: textoProcessado.replace('canc_', '') }; }
            else if (textoProcessado.startsWith('reag_')) { nlpResult.intent = 'RESCHEDULE_APPOINTMENT'; nlpResult.entities = { appointment_id: textoProcessado.replace('reag_', '') }; }
        } else {
            nlpResult = await aiService.analisarMensagemNLP(textoUnificadoParaBD, historicoLimpo, userState, configDb);
        }

        let activeIntent = nlpResult.intent || 'UNKNOWN';

        if (activeIntent === 'UNKNOWN') {
            userState.frustrationCount = (userState.frustrationCount || 0) + 1;
        } else {
            userState.frustrationCount = 0;
        }

        if (userState.frustrationCount >= 3 || activeIntent === 'HUMAN_TRANSFER' || activeIntent === 'FRUSTRATION') {
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true, leadStatus: 'INTERESSADO' } });
            limparMemoriaEstado(senderNumber);
            
            const resp = isEnglish 
                ? "Chat transferred. From now on, you are talking directly to our human team. How can we help?" 
                : "Atendimento transferido. A partir de agora, você está falando diretamente com a nossa equipe humana. Como podemos ajudar?";
            await prisma.mensagemIA.create({ data: { role: 'assistant', content: `[SISTEMA] ${resp}`, clienteId: senderNumber } });
            await whatsappService.sendText(senderNumber, resp);
            if (global.io) global.io.emit('atualizar_fila');
            return;
        }

        if (activeIntent === 'GREETING') {
            userState.frustrationCount = 0;
            if (userState.step !== 'IDLE') {
                const resp = isEnglish 
                    ? "Hello again! We were in the middle of your booking. Do you want to continue or cancel?" 
                    : "Olá novamente! Estávamos no meio do seu agendamento. Deseja continuar com a reserva ou prefere cancelar?";
                await whatsappService.sendInteractiveMenu(senderNumber, resp, [
                    { id: 'cmd_agendar', title: isEnglish ? 'Continue' : 'Continuar' },
                    { id: 'cmd_cancelar_fluxo', title: isEnglish ? 'Cancel' : 'Cancelar' }
                ]);
                return;
            } else {
                const nomeClinica = configDb?.nomeClinica || (isEnglish ? 'our clinic' : 'nossa clínica');
                const resp = isEnglish 
                    ? `Hello! Welcome to ${nomeClinica}. How can I help you today?` 
                    : `Olá! Seja bem-vindo(a) à ${nomeClinica}. Como posso ajudar hoje?`;
                await whatsappService.sendInteractiveMenu(senderNumber, resp, [
                    { id: 'cmd_agendar', title: isEnglish ? 'Book appointment' : 'Marcar consulta' },
                    { id: 'cmd_menu_tratamentos', title: isEnglish ? 'View treatments' : 'Ver tratamentos' },
                    { id: 'cmd_humano', title: isEnglish ? 'Talk to staff' : 'Falar com a equipe' }
                ]);
                return;
            }
        }

        const queryIntents = ['TREATMENT_PRICE', 'TREATMENT_INFO', 'TREATMENT_DURATION', 'TREATMENT_LIST', 'CLINIC_HOURS', 'CLINIC_LOCATION', 'CLINIC_CONTACT', 'CLINIC_PAYMENT_METHODS', 'CHECK_UPCOMING_APPOINTMENTS', 'CHECK_PAST_APPOINTMENTS', 'UNKNOWN', 'GOODBYE', 'ASK_DATE_REFERENCE'];

        if (queryIntents.includes(activeIntent)) {
            const flowConsultas = require('./flowConsultas');
            await flowConsultas.processarDuvidas(senderNumber, textoUnificadoParaBD, senderNumber, userState, nlpResult, configDb, historicoLimpo, cliente, isNewPatient);
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
            const isRemarcacao = activeIntent === 'RESCHEDULE_APPOINTMENT';
            const flowCancelamento = require('./flowCancelamento');
            await flowCancelamento.processarCancelamento(senderNumber, textoUnificadoParaBD, senderNumber, stateMachine, nlpResult, isInteractive, configDb, isRemarcacao, cliente, isNewPatient);
        }
        else {
            const flowConsultas = require('./flowConsultas');
            await flowConsultas.processarDuvidas(senderNumber, textoUnificadoParaBD, senderNumber, userState, nlpResult, configDb, historicoLimpo, cliente, isNewPatient);
        }

    } catch (error) {
        console.error("❌ ERRO CRÍTICO NO NÚCLEO DA CLÍNICA:", error);
        const isEnglish = (await prisma.configSistema.findFirst())?.idioma?.includes('Inglês');
        const errMsg = isEnglish 
            ? "A small connection error occurred. Could you send that again?" 
            : "Ocorreu uma pequena falha na nossa conexão agora. Você poderia mandar novamente?";
        await whatsappService.sendText(senderNumber, errMsg);
    }
}

module.exports = { processarMensagemEntrante, limparMemoriaEstado, stateMachine };
// --- END OF FILE clinica/botEngine.js ---