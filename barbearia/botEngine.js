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
            let { cliente, isNewPatient } = await getOrCreateCliente(senderNumber, pushName);
            
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
                try {
                    const audioBuffer = await whatsappService.downloadMedia(mediaId);
                    textoProcessado = await aiService.transcreverAudio(audioBuffer);
                    isTranscribed = true;
                } catch (e) {
                    textoProcessado = "[Áudio Recebido - Falha na Transcrição]";
                }
            } else if (message.type === 'text') {
                textoProcessado = message.text?.body || "";
            } else if (message.type === 'interactive') {
                textoProcessado = message.interactive.button_reply?.id || message.interactive.list_reply?.id;
            }
            
            if (!textoProcessado) return;

            let userState = stateMachine.get(senderNumber) || { step: 'IDLE', entities: {} };
            const configDb = await prisma.configSistema.findFirst();

            const contentToSave = isTranscribed ? `[Áudio Transcrito]: ${textoProcessado}` : textoProcessado;
            await prisma.mensagemIA.create({ data: { role: 'user', content: contentToSave, clienteId: senderNumber } });

            const historicoRaw = await prisma.mensagemIA.findMany({ where: { clienteId: senderNumber }, take: 8, orderBy: { criadoEm: 'desc' } });
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
                                     
                const prompt = `Nós estamos no meio do agendamento, aguardando que o cliente informe ${contextoFase}. O cliente disse algo que o sistema não conseguiu classificar diretamente: "${textoProcessado}". Responda de forma extremamente gentil, diga que não entendeu muito bem e peça para ele fornecer ${contextoFase} para continuarmos. Seja breve.`;
                
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
                await flowAgendamento.processarAgendamento(senderNumber, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, cliente, isNewPatient);
            } 
            else if (cancelIntents.includes(activeIntent) || userState.step.startsWith('CANCELAMENTO_')) {
                const flowCancelamento = require('./flowCancelamento');
                await flowCancelamento.processarCancelamento(senderNumber, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, false, cliente, isNewPatient);
            } 
            else {
                const flowConsultas = require('./flowConsultas');
                await flowConsultas.processarDuvidas(senderNumber, textoProcessado, senderNumber, userState, nlpResult, configDb, historico, cliente, isNewPatient);
            }
            
        } catch (error) {
            console.error('❌ ERRO CRÍTICO NO MOTOR DA BARBEARIA:', error);
            await whatsappService.sendText(senderNumber, "Desculpe, a nossa IA teve uma pequena falha técnica. Poderia repetir?");
        }
    }, 0);
}

module.exports = { processarMensagemEntrante, limparMemoriaEstado, stateMachine };