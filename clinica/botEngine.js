const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const aiService = require('../aiService');
const webhookService = require('../services/webhookService');
const automationEngine = require('../services/automationEngine');
const supabaseService = require('../services/supabaseService');
const demoService = require('../services/demoService');

const stateMachine = new Map();

async function getOrCreateCliente(numero, nomePushName = null) {
    let cliente = await prisma.cliente.findUnique({ where: { id: numero } });
    let isNewPatient = false;

    if (!cliente) {
        isNewPatient = true;
        cliente = await prisma.cliente.create({ 
            data: { id: numero, nome: nomePushName || 'Paciente', leadStatus: 'NOVO', origem: 'WhatsApp IA' } 
        });
        await webhookService.dispararEvento('lead.created', cliente);
        await automationEngine.dispararAutomacoes('NOVO_LEAD', cliente);
    } else {
        const updates = { ultimaInteracao: new Date() };
        if (nomePushName && !cliente.nome) updates.nome = nomePushName;
        if (cliente.leadStatus === 'NOVO') isNewPatient = true;
        await prisma.cliente.update({ where: { id: numero }, data: updates });
    }
    return { cliente, isNewPatient };
}

async function processarMensagemEntrante(message) {
    if (!message || !message.from) return; 
    if (demoService.isDemoActive()) return;

    setTimeout(async () => {
        const senderNumber = message.from;
        const msgId = message.id;

        try {
            console.log(`\n===========================================`);
            console.log(`🤖 [MOTOR CLÍNICA] PROCESSANDO: ${senderNumber}`);
            console.log(`===========================================`);
            
            let pushName = message.profile?.name || null;
            const { cliente, isNewPatient } = await getOrCreateCliente(senderNumber, pushName);
            
            if (cliente.falarHumano) {
                console.log(`🛑 [MOTOR CLÍNICA] Lead em atendimento humano. IA pausada.`);
                return; 
            }

            await whatsappService.markAsReadAndTyping(msgId, senderNumber);
            const delayMs = Math.floor(Math.random() * (3000 - 1500 + 1)) + 1500;
            await new Promise(resolve => setTimeout(resolve, delayMs));

            let textoProcessado = "";
            let midiaUrl = null;
            let tipoMidia = message.type;
            let isTranscribed = false;

            if (message.type === 'audio') {
                const mediaId = message.audio.id;
                try { 
                    const audioBuffer = await whatsappService.downloadMedia(mediaId);
                    textoProcessado = await aiService.transcreverAudio(audioBuffer);
                    isTranscribed = true;
                } catch(e) { textoProcessado = "[Falha na transcrição do áudio]"; }
            } else if (['image', 'video', 'document'].includes(message.type)) {
                textoProcessado = message[message.type].caption || "[Mídia Recebida]"; 
            } else if (message.type === 'text') {
                textoProcessado = message.text.body;
            } else if (message.type === 'interactive') {
                textoProcessado = message.interactive.button_reply?.id || message.interactive.list_reply?.id;
            }

            if (!textoProcessado && !midiaUrl) return;

            let contentToSave = isTranscribed ? `[Áudio Transcrito]: ${textoProcessado}` : textoProcessado;
            await prisma.mensagemIA.create({ data: { role: 'user', content: contentToSave, clienteId: senderNumber } });

            const historicoRaw = await prisma.mensagemIA.findMany({ where: { clienteId: senderNumber }, take: 8, orderBy: { criadoEm: 'desc' } });
            historicoRaw.reverse();
            const historico = historicoRaw.map(h => ({ role: h.role, content: h.content }));

            let userState = stateMachine.get(senderNumber) || { step: 'IDLE', entities: {} };
            const configDb = await prisma.configSistema.findFirst();

            let isInteractive = message.type === 'interactive';
            let nlpResult = { intent: "UNKNOWN", confidence: 1, entities: {} };

            // Extração de Intenções via NLU
            if (!isInteractive && textoProcessado) {
                nlpResult = await aiService.analisarMensagemNLP(textoProcessado, historico, userState, configDb);
                console.log(`🧠 [NLP] Intenção: ${nlpResult.intent} | Entidades:`, JSON.stringify(nlpResult.entities));
                userState.entities = { ...userState.entities, ...nlpResult.entities };
            } else if (isInteractive) {
                if (textoProcessado === 'cmd_agendar') nlpResult.intent = 'BOOK_APPOINTMENT';
                else if (textoProcessado.startsWith('trat_')) { nlpResult.intent = 'SELECT_TREATMENT'; nlpResult.entities.treatment_id = textoProcessado.replace('trat_', ''); }
                else if (textoProcessado.startsWith('data_')) { nlpResult.intent = 'SELECT_DATE'; nlpResult.entities.date = textoProcessado.replace('data_', ''); }
                else if (textoProcessado === 'ver_mais_data') nlpResult.intent = 'REQUEST_MORE_DATES';
                else if (textoProcessado.startsWith('hora_')) { nlpResult.intent = 'SELECT_TIME'; nlpResult.entities.time = textoProcessado.replace('hora_', ''); }
                else if (textoProcessado === 'ver_mais_hora') nlpResult.intent = 'REQUEST_MORE_TIMES';
                else if (textoProcessado === 'cmd_confirmar_reserva') nlpResult.intent = 'CONFIRM_APPOINTMENT';
                else if (textoProcessado === 'cmd_cancelar_fluxo') nlpResult.intent = 'REJECT_APPOINTMENT';
                else if (textoProcessado.startsWith('canc_')) { nlpResult.intent = 'CANCEL_APPOINTMENT'; nlpResult.entities.appointment_id = textoProcessado.replace('canc_', ''); }
                else if (textoProcessado.startsWith('reag_')) { nlpResult.intent = 'RESCHEDULE_APPOINTMENT'; nlpResult.entities.appointment_id = textoProcessado.replace('reag_', ''); }
                
                userState.entities = { ...userState.entities, ...nlpResult.entities };
            }

            let activeIntent = nlpResult.intent || 'UNKNOWN';
            
            if (activeIntent === 'HUMAN_TRANSFER' || activeIntent === 'FRUSTRATION') {
                await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true, leadStatus: 'INTERESSADO' } });
                const resp = "Entendi. Vou transferir você para nossa equipe agora mesmo. Só um instante.";
                await prisma.mensagemIA.create({ data: { role: 'assistant', content: resp, clienteId: senderNumber } });
                await whatsappService.sendText(senderNumber, resp);
                if (global.io) global.io.emit('atualizar_fila');
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
                const prompt = `Diga: Entendi que você está procurando por isso, mas nós estávamos no passo ${userState.step.replace('AGENDAMENTO_', '')} do seu agendamento. Você poderia repetir ou confirmar a opção anterior?`;
                const resp = await aiService.gerarRespostaNatural(prompt, [], {}, configDb);
                await prisma.mensagemIA.create({ data: { role: 'assistant', content: resp, clienteId: senderNumber } });
                await whatsappService.sendText(senderNumber, resp);
                return;
            }

            const bookingIntents = ['BOOK_APPOINTMENT', 'SELECT_TREATMENT', 'SELECT_DATE', 'SELECT_TIME', 'REQUEST_MORE_TIMES', 'REQUEST_MORE_DATES', 'REQUEST_SPECIFIC_TIME', 'CONFIRM_APPOINTMENT', 'REJECT_APPOINTMENT', 'CHANGE_TREATMENT', 'CHANGE_DATE', 'CHANGE_TIME'];
            const cancelIntents = ['CANCEL_APPOINTMENT', 'RESCHEDULE_APPOINTMENT'];
            const queryIntents = ['TREATMENT_PRICE', 'TREATMENT_INFO', 'TREATMENT_DURATION', 'TREATMENT_LIST', 'CLINIC_HOURS', 'CLINIC_LOCATION', 'CLINIC_CONTACT', 'CLINIC_PAYMENT_METHODS'];

            if (queryIntents.includes(activeIntent)) {
                const flowConsultas = require('./flowConsultas');
                await flowConsultas.processarDuvidas(senderNumber, textoProcessado, senderNumber, userState, nlpResult, configDb, historico, cliente, isNewPatient);
                return;
            }

            stateMachine.set(senderNumber, userState);

            if (bookingIntents.includes(activeIntent) || userState.step.startsWith('AGENDAMENTO_')) {
                const flowAgendamento = require('./flowAgendamento');
                await flowAgendamento.processarAgendamento(senderNumber, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, cliente, isNewPatient);
            } 
            else if (cancelIntents.includes(activeIntent) || userState.step.startsWith('CANCELAMENTO_')) {
                const isRemarcacao = activeIntent === 'RESCHEDULE_APPOINTMENT';
                const flowCancelamento = require('./flowCancelamento');
                await flowCancelamento.processarCancelamento(senderNumber, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, isRemarcacao, cliente, isNewPatient);
            } 
            else {
                const flowConsultas = require('./flowConsultas');
                await flowConsultas.processarDuvidas(senderNumber, textoProcessado, senderNumber, userState, nlpResult, configDb, historico, cliente, isNewPatient);
            }

        } catch (error) {
            console.error("❌ ERRO CRÍTICO NO MOTOR DA CLÍNICA:", error);
            await whatsappService.sendText(senderNumber, "Ocorreu uma pequena falha na nossa conexão agora. Você poderia mandar novamente?");
        }
    }, 0);
}

function limparMemoriaEstado() { stateMachine.clear(); }
module.exports = { processarMensagemEntrante, limparMemoriaEstado, stateMachine };