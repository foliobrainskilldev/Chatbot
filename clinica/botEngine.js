const { prisma } = require('../../db');
const whatsappService = require('../../whatsappService');
const aiService = require('../../aiService');
const webhookService = require('../../services/webhookService');
const automationEngine = require('../../services/automationEngine');
const supabaseService = require('../../services/supabaseService');

const demoService = require('../../services/demoService');

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
        
        if (cliente.leadStatus === 'NOVO') {
            isNewPatient = true;
        }

        await prisma.cliente.update({ where: { id: numero }, data: updates });
    }
    return { cliente, isNewPatient };
}

async function processarMensagemEntrante(message) {
    if (!message || !message.from) return; 

    if (demoService.isDemoActive()) {
        console.log(`🛑 [MODO DEMONSTRAÇÃO] Sistema em Demonstração. Ignorando mensagem real de ${message.from}.`);
        return;
    }

    setTimeout(async () => {
        const senderNumber = message.from;
        const msgId = message.id;

        try {
            console.log(`\n===========================================`);
            console.log(`🤖 [MOTOR CLÍNICA] PROCESSANDO: ${senderNumber}`);
            console.log(`===========================================`);
            
            let pushName = message.profile?.name || null;
            const { cliente, isNewPatient } = await getOrCreateCliente(senderNumber, pushName);
            
            await whatsappService.markAsReadAndTyping(msgId, senderNumber);

            const delayMs = Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000;
            await new Promise(resolve => setTimeout(resolve, delayMs));

            let textoProcessado = "";
            let midiaUrl = null;
            let tipoMidia = message.type;
            let isTranscribed = false;

            if (message.type === 'audio') {
                const mediaId = message.audio.id;
                let audioBuffer;

                try { audioBuffer = await whatsappService.downloadMedia(mediaId); } catch(e) {}

                if (audioBuffer) {
                    try {
                        const cloudRes = await supabaseService.uploadStream(audioBuffer, 'clinica/pacientes/audios', 'video');
                        midiaUrl = cloudRes.secure_url;
                    } catch (e) { }

                    try {
                        textoProcessado = await aiService.transcreverAudio(audioBuffer);
                        isTranscribed = true;
                        console.log(`🎙️ [WHISPER] Texto Transcrito: "${textoProcessado}"`);
                    } catch (e) {
                        textoProcessado = "[Falha na transcrição do áudio]";
                    }
                }

            } else if (['image', 'video', 'document'].includes(message.type)) {
                const mediaId = message[message.type].id;
                textoProcessado = message[message.type].caption || ""; 
                try {
                    const mediaBuffer = await whatsappService.downloadMedia(mediaId);
                    const resourceType = message.type === 'image' ? 'image' : (message.type === 'video' ? 'video' : 'raw');
                    const cloudRes = await supabaseService.uploadStream(mediaBuffer, `clinica/pacientes/${message.type}s`, resourceType);
                    midiaUrl = cloudRes.secure_url;
                } catch (e) {}
            } else if (message.type === 'text') {
                textoProcessado = message.text.body;
            } else if (message.type === 'interactive') {
                textoProcessado = message.interactive.button_reply?.id || message.interactive.list_reply?.id;
            }

            if (!textoProcessado && !midiaUrl) return;

            let contentToSave = textoProcessado;
            if (midiaUrl) {
                contentToSave = `[MEDIA:${tipoMidia}] ${midiaUrl} | Texto: ${textoProcessado}`;
            } else if (isTranscribed) {
                contentToSave = `[Áudio Transcrito]: ${textoProcessado}`;
            }

            await prisma.mensagemIA.create({ 
                data: { role: 'user', content: contentToSave, clienteId: senderNumber, tipoMidia: tipoMidia, midiaUrl: midiaUrl } 
            });

            if (cliente.falarHumano) {
                console.log(`🛑 [MOTOR CLÍNICA] Lead em atendimento humano. IA pausada.`);
                return; 
            }

            const historicoRaw = await prisma.mensagemIA.findMany({ 
                where: { clienteId: senderNumber }, 
                take: 8, orderBy: { criadoEm: 'desc' } 
            });
            const lastBotMsg = historicoRaw.find(h => h.role === 'assistant');
            
            // Avaliação CSAT
            if (lastBotMsg && lastBotMsg.content.includes('(Pesquisa CSAT enviada)')) {
                const nota = parseInt(textoProcessado.trim());
                if (!isNaN(nota) && nota >= 1 && nota <= 5) {
                    await prisma.notaInterna.create({ data: { texto: `📊 Avaliação de Atendimento (CSAT): ${nota} Estrela(s)`, clienteId: senderNumber, usuarioId: 1 } });
                    const msgAgradecimento = "Muito obrigado pela sua avaliação! Isso nos ajuda a melhorar sempre. 😊";
                    await whatsappService.sendText(senderNumber, msgAgradecimento);
                    await prisma.mensagemIA.create({ data: { role: 'assistant', content: msgAgradecimento, clienteId: senderNumber } });
                    return; 
                }
            }

            let isInteractive = message.type === 'interactive';
            let userState = stateMachine.get(senderNumber) || { step: 'IDLE', intent: null, entities: {} };
            
            const configDb = await prisma.configSistema.findFirst();
            
            historicoRaw.reverse();
            const historico = historicoRaw.map(h => ({ role: h.role, content: h.content }));

            let nlpResult = { intent: "unknown", confidence: 1, entities: {} };

            // Extração de Intenção
            if (!isInteractive && textoProcessado) {
                nlpResult = await aiService.analisarMensagemNLP(textoProcessado, historico, userState, configDb);
                console.log(`🧠 [NLP] Intenção: ${nlpResult.intent} | Entidades extraídas:`, JSON.stringify(nlpResult.entities));
                userState.entities = { ...userState.entities, ...nlpResult.entities };
                stateMachine.set(senderNumber, userState);
            } else if (isInteractive) {
                const agendamentoPrefixes = ['trat_', 'data_', 'hora_', 'ver_mais_', 'cmd_confirmar_reserva', 'cmd_cancelar_fluxo'];
                if (agendamentoPrefixes.some(p => textoProcessado.startsWith(p)) || textoProcessado === 'cmd_agendar') {
                    nlpResult.intent = 'appointment.create';
                } else if (textoProcessado.startsWith('canc_') || textoProcessado.startsWith('reag_')) {
                    nlpResult.intent = textoProcessado.startsWith('reag_') ? 'appointment.reschedule' : 'appointment.cancel';
                }
            }

            let activeIntent = nlpResult.intent || 'unknown';

            // Se o usuário está no fluxo de agendamento e a intenção foi unknown, vamos assumir que ele está digitando respostas fluidas de data/hora
            if (userState.step === 'AGENDAMENTO' && activeIntent === 'unknown') {
                activeIntent = 'appointment.create';
            }

            const intentsDeDuvida = ['treatment.price', 'treatment.info', 'treatment.duration', 'treatment.list', 'clinic.hours', 'clinic.location', 'clinic.contact', 'clinic.payment_methods'];

            if (activeIntent === 'human.transfer') {
                await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true, leadStatus: 'INTERESSADO' } });
                const resp = configDb?.msgTransferencia || "Vou transferir você para nossa equipe agora mesmo. Só um instante.";
                await prisma.mensagemIA.create({ data: { role: 'assistant', content: resp, clienteId: senderNumber } });
                await whatsappService.sendText(senderNumber, resp);
                
                await prisma.notaInterna.create({ data: { texto: `Transferência solicitada pelo paciente. Motivo: Intervenção Humana requerida.`, clienteId: senderNumber, usuarioId: 1 } });
                if (global.io) global.io.emit('atualizar_fila');
                return;
            }

            // Roteamento
            if (intentsDeDuvida.includes(activeIntent)) {
                const flowConsultas = require('./flowConsultas');
                await flowConsultas.processarDuvidas(senderNumber, textoProcessado, senderNumber, userState, nlpResult, configDb, historico, cliente, isNewPatient);
            } 
            else if (activeIntent === 'appointment.create' || userState.step === 'AGENDAMENTO') {
                const flowAgendamento = require('./flowAgendamento');
                await flowAgendamento.processarAgendamento(senderNumber, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, cliente, isNewPatient);
            } 
            else if (activeIntent === 'appointment.cancel' || activeIntent === 'appointment.reschedule' || userState.step === 'CANCELAMENTO') {
                const isRemarcacao = activeIntent === 'appointment.reschedule';
                const flowCancelamento = require('./flowCancelamento');
                await flowCancelamento.processarCancelamento(senderNumber, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, isRemarcacao, cliente, isNewPatient);
            } 
            else {
                // Fluxo padrão para conversação livre
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