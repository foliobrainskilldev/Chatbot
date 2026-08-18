const { prisma } = require('../../db');
const whatsappService = require('../../whatsappService');
const aiService = require('../../aiService');
const webhookService = require('../../services/webhookService');
const automationEngine = require('../../services/automationEngine');
const demoService = require('../../services/demoService');

const stateMachine = new Map();

function limparMemoriaEstado(telefone = null) { 
    if (telefone) {
        stateMachine.delete(telefone);
    } else {
        stateMachine.clear(); 
    }
}

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

            if (!textoProcessado) return;

            let contentToSave = isTranscribed ? `[Áudio Transcrito]: ${textoProcessado}` : textoProcessado;
            await prisma.mensagemIA.create({ data: { role: 'user', content: contentToSave, clienteId: senderNumber } });

            // LIMPA O HISTÓRICO: Ignora avisos de automação e alertas técnicos do bot para a IA não se confundir
            const historicoRaw = await prisma.mensagemIA.findMany({ where: { clienteId: senderNumber }, take: 10, orderBy: { criadoEm: 'desc' } });
            historicoRaw.reverse();
            
            const historicoLimpo = historicoRaw.filter(h => !h.content.includes('[SISTEMA AUTOMÁTICO]') && !h.content.includes('[MEDIA:'))
                .map(h => ({ role: h.role, content: h.content.replace('[SISTEMA]', '').trim() }));

            let userState = stateMachine.get(senderNumber) || { step: 'IDLE', entities: {} };
            const configDb = await prisma.configSistema.findFirst();

            let isInteractive = message.type === 'interactive';
            let nlpResult = { intent: "UNKNOWN", confidence: 1, entities: {} };

            // Extração de Intenções e Entidades
            if (!isInteractive && textoProcessado) {
                nlpResult = await aiService.analisarMensagemNLP(textoProcessado, historicoLimpo, userState, configDb);
                console.log(`🧠 [NLP] Intenção: ${nlpResult.intent} | Entidades:`, JSON.stringify(nlpResult.entities));
            } else if (isInteractive) {
                if (textoProcessado === 'cmd_agendar') nlpResult.intent = 'BOOK_APPOINTMENT';
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
            }

            let activeIntent = nlpResult.intent || 'UNKNOWN';
            
            // Transferência Humana (Limpa a Memória Imediatamente)
            if (activeIntent === 'HUMAN_TRANSFER' || activeIntent === 'FRUSTRATION') {
                await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true, leadStatus: 'INTERESSADO' } });
                limparMemoriaEstado(senderNumber); // <--- CORREÇÃO AQUI
                
                const resp = "Entendi. Vou transferir você para nossa equipe agora mesmo. Só um instante.";
                await prisma.mensagemIA.create({ data: { role: 'assistant', content: `[SISTEMA] ${resp}`, clienteId: senderNumber } });
                await whatsappService.sendText(senderNumber, resp);
                if (global.io) global.io.emit('atualizar_fila');
                return;
            }

            // Proteção se o usuário mandar "Oi" no meio de um Agendamento
            if (activeIntent === 'GREETING' && userState.step !== 'IDLE') {
                const resp = "Olá novamente! Estávamos no meio do seu agendamento. Deseja continuar com a reserva ou prefere cancelar?";
                await whatsappService.sendInteractiveMenu(senderNumber, resp, [
                    { id: 'cmd_agendar', title: 'Continuar agendando' },
                    { id: 'cmd_cancelar_fluxo', title: 'Cancelar' }
                ]);
                return;
            }

            // Permite a Context Bridge Natural responder à dúvidas que surjam no meio do agendamento
            const queryIntents = ['TREATMENT_PRICE', 'TREATMENT_INFO', 'TREATMENT_DURATION', 'TREATMENT_LIST', 'CLINIC_HOURS', 'CLINIC_LOCATION', 'CLINIC_CONTACT', 'CLINIC_PAYMENT_METHODS', 'CHECK_UPCOMING_APPOINTMENTS', 'CHECK_PAST_APPOINTMENTS', 'UNKNOWN'];

            if (queryIntents.includes(activeIntent)) {
                const flowConsultas = require('./flowConsultas');
                await flowConsultas.processarDuvidas(senderNumber, textoProcessado, senderNumber, userState, nlpResult, configDb, historicoLimpo, cliente, isNewPatient);
                return;
            }

            // Se for comando de agendamento, salva no estado e vai pro fluxo
            stateMachine.set(senderNumber, userState);

            const bookingIntents = ['BOOK_APPOINTMENT', 'SELECT_TREATMENT', 'SELECT_PROFESSIONAL', 'SELECT_DATE', 'SELECT_TIME', 'REQUEST_MORE_TIMES', 'REQUEST_MORE_DATES', 'REQUEST_SPECIFIC_TIME', 'CONFIRM_APPOINTMENT', 'REJECT_APPOINTMENT', 'CHANGE_TREATMENT', 'CHANGE_DATE', 'CHANGE_TIME'];
            const cancelIntents = ['CANCEL_APPOINTMENT', 'RESCHEDULE_APPOINTMENT'];

            if (bookingIntents.includes(activeIntent) || userState.step.startsWith('AGENDAMENTO_')) {
                const flowAgendamento = require('./flowAgendamento');
                await flowAgendamento.processarAgendamento(senderNumber, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, cliente, isNewPatient);
            } 
            else if (cancelIntents.includes(activeIntent) || userState.step.startsWith('CANCELAMENTO_')) {
                const isRemarcacao = activeIntent === 'RESCHEDULE_APPOINTMENT';
                const flowCancelamento = require('./flowCancelamento');
                await flowCancelamento.processarCancelamento(senderNumber, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, isRemarcacao, cliente, isNewPatient);
            }

        } catch (error) {
            console.error("❌ ERRO CRÍTICO NO MOTOR DA CLÍNICA:", error);
            await whatsappService.sendText(senderNumber, "Ocorreu uma pequena falha na nossa conexão agora. Você poderia mandar novamente?");
        }
    }, 0);
}

module.exports = { processarMensagemEntrante, limparMemoriaEstado, stateMachine };