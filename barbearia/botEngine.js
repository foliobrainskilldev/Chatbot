// barbearia/botEngine.js
const { prisma, getOrCreateCliente } = require('../db');
const whatsappService = require('../whatsappService');
const aiService = require('../aiService'); 

const { processarAgendamento } = require('./flowAgendamento');
const { processarCancelamento } = require('./flowCancelamento');
const { processarDuvidas } = require('./flowConsultas');

const stateMachine = new Map();

function limparMemoriaEstado() {
    stateMachine.clear();
}

async function processarMensagemEntrante(message) {
    if (!message || !message.from) return; 

    setTimeout(async () => {
        const senderNumber = message.from;
        const msgId = message.id;
        
        try {
            console.log(`\n===========================================`);
            console.log(`💈 [MOTOR BARBEARIA] PROCESSANDO: ${senderNumber}`);
            console.log(`===========================================`);

            let pushName = message.profile?.name || null;
            let cliente = await getOrCreateCliente(senderNumber, pushName);
            
            if (cliente.falarHumano) {
                console.log(`🛑 [MOTOR BARBEARIA] Cliente em atendimento humano. Ignorando bot.`);
                return; 
            }

            await whatsappService.markAsReadAndTyping(msgId, senderNumber);

            const delayMs = Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000;
            await new Promise(resolve => setTimeout(resolve, delayMs));

            let textoProcessado = "";
            let isTranscribed = false;

            if (message.type === 'audio') {
                const mediaId = message.audio.id;
                console.log(`🎙️ [WHISPER] Baixando áudio do WhatsApp...`);
                try {
                    const audioBuffer = await whatsappService.downloadMedia(mediaId);
                    textoProcessado = await aiService.transcreverAudio(audioBuffer);
                    isTranscribed = true;
                    console.log(`🎙️ [WHISPER] Texto Transcrito (Barbearia): "${textoProcessado}"`);
                } catch (e) {
                    textoProcessado = "[Áudio Recebido - Falha na Transcrição]";
                }
            } else if (message.type === 'text') {
                textoProcessado = message.text?.body || "";
            } else if (message.type === 'interactive') {
                textoProcessado = message.interactive.button_reply?.id || message.interactive.list_reply?.id;
            }
            
            if (!textoProcessado) {
                console.log(`⚠️ [MOTOR BARBEARIA] Mensagem sem texto ignorada.`);
                return;
            }

            let userState = stateMachine.get(senderNumber) || { step: 'IDLE', intent: null, entities: {} };
            const configDb = await prisma.configSistema.findFirst();

            const contentToSave = isTranscribed ? `[Áudio Transcrito]: ${textoProcessado}` : textoProcessado;
            await prisma.mensagemIA.create({ 
                data: { role: 'user', content: contentToSave, clienteId: senderNumber } 
            });

            const historicoRaw = await prisma.mensagemIA.findMany({ 
                where: { clienteId: senderNumber }, 
                take: 8, orderBy: { criadoEm: 'desc' } 
            });
            historicoRaw.reverse();
            const historico = historicoRaw.map(h => ({ role: h.role, content: h.content }));

            let isInteractive = message.type === 'interactive';
            let nlpResult = { intent: "UNKNOWN", confidence: 1, entities: {} };

            if (!isInteractive && textoProcessado) {
                nlpResult = await aiService.analisarMensagemNLP(textoProcessado, historico, userState, configDb);
                console.log(`🧠 [NLP Barbearia] Intenção: ${nlpResult.intent} | Entidades:`, JSON.stringify(nlpResult.entities));
                userState.entities = { ...userState.entities, ...nlpResult.entities };
            } else if (isInteractive) {
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
            }

            let activeIntent = nlpResult.intent || 'UNKNOWN';
            stateMachine.set(senderNumber, userState);

            const bookingIntents = ['BOOK_APPOINTMENT', 'SELECT_TREATMENT', 'SELECT_PROFESSIONAL', 'SELECT_DATE', 'SELECT_TIME', 'REQUEST_MORE_TIMES', 'REQUEST_MORE_DATES', 'CONFIRM_APPOINTMENT', 'REJECT_APPOINTMENT'];
            const cancelIntents = ['CANCEL_APPOINTMENT', 'RESCHEDULE_APPOINTMENT'];
            const queryIntents = ['TREATMENT_PRICE', 'TREATMENT_INFO', 'TREATMENT_DURATION', 'TREATMENT_LIST', 'CLINIC_HOURS', 'CLINIC_LOCATION', 'CLINIC_CONTACT', 'CLINIC_PAYMENT_METHODS'];

            if (activeIntent === 'HUMAN_TRANSFER') {
                await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true, leadStatus: 'INTERESSADO' } });
                const resp = "Vou transferir você para nossa equipe agora mesmo. Só um instante.";
                await prisma.mensagemIA.create({ data: { role: 'assistant', content: resp, clienteId: senderNumber } });
                await whatsappService.sendText(senderNumber, resp);
                return;
            }

            // O mesmo roteamento resistente criado na Clínica
            if (queryIntents.includes(activeIntent)) {
                await processarDuvidas(senderNumber, textoProcessado, senderNumber, userState, nlpResult, configDb, historico, cliente, false);
            } 
            else if (bookingIntents.includes(activeIntent) || userState.step.startsWith('AGENDAMENTO_')) {
                await processarAgendamento(senderNumber, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, cliente, false);
            } 
            else if (cancelIntents.includes(activeIntent) || userState.step.startsWith('CANCELAMENTO_')) {
                await processarCancelamento(senderNumber, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, false, cliente, false);
            } 
            else {
                if (userState.step.startsWith('AGENDAMENTO_')) {
                    await processarAgendamento(senderNumber, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, cliente, false);
                } else {
                    await processarDuvidas(senderNumber, textoProcessado, senderNumber, userState, nlpResult, configDb, historico, cliente, false);
                }
            }
            
        } catch (error) {
            console.error('❌ ERRO CRÍTICO NO MOTOR DA BARBEARIA:', error);
            await whatsappService.sendText(senderNumber, "Desculpe, a nossa IA teve uma pequena falha técnica. Poderia repetir?");
        }
    }, 0);
}

module.exports = { processarMensagemEntrante, limparMemoriaEstado, stateMachine };