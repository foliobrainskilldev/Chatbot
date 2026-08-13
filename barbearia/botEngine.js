const { prisma, getOrCreateCliente } = require('../db');
const whatsappService = require('../whatsappService');
const aiService = require('../aiService');

const { iniciarAgendamento, handleAgendamento } = require('./flowAgendamento');
const { iniciarCancelamento, processarCancelamento } = require('./flowCancelamento');
const { verPrecosEServicos, verMeusAgendamentos } = require('./flowConsultas');

const stateMachine = new Map();

const STEPS = {
    MENU_PRINCIPAL: 'MENU_PRINCIPAL',
    AGENDAMENTO_SERVICO: 'AGENDAMENTO_SERVICO',
    AGENDAMENTO_BARBEIRO: 'AGENDAMENTO_BARBEIRO',
    AGENDAMENTO_DATA: 'AGENDAMENTO_DATA',
    AGENDAMENTO_HORA: 'AGENDAMENTO_HORA',
    AGENDAMENTO_CONFIRMAR: 'AGENDAMENTO_CONFIRMAR',
    CANCELAR_AGENDAMENTO: 'CANCELAR_AGENDAMENTO',
};

function limparMemoriaEstado() {
    stateMachine.clear();
}

async function enviarMenuGeral(jid) {
    const textoMenu = `Bem-vindo à nossa Barbearia! Selecione uma opção:`;
    await whatsappService.sendInteractiveMenu(jid, textoMenu, [
        { id: 'cmd_agendar', title: 'Agendar Corte', description: 'Marcar novo horário' },
        { id: 'cmd_precos', title: 'Serviços e Preços', description: 'Tabela de preçários' },
        { id: 'cmd_agenda', title: 'Minha Agenda', description: 'Checar seus agendamentos' },
        { id: 'cmd_cancelar', title: 'Cancelar Horário', description: 'Suspender serviço' },
        { id: 'cmd_humano', title: 'Falar com Atendente', description: 'Transferência para equipe' }
    ]);
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

            let cliente = await getOrCreateCliente(senderNumber);
            
            if (cliente.falarHumano) {
                console.log(`🛑 [MOTOR BARBEARIA] Cliente em atendimento humano. Ignorando bot.`);
                return; 
            }

            // Mágica do typing indicator oficial e marcação de leitura acontecendo aqui
            await whatsappService.markAsReadAndTyping(msgId, senderNumber);

            // Delay natural de 2 a 5 segundos (Typing indicator ativado e aparecendo pro usuário)
            const delayMs = Math.floor(Math.random() * (5000 - 2000 + 1)) + 2000;
            await new Promise(resolve => setTimeout(resolve, delayMs));

            let textMessage = "";
            let isTranscribed = false;

            if (message.type === 'audio') {
                const mediaId = message.audio.id;
                console.log(`🎙️ [WHISPER] Baixando áudio do WhatsApp...`);
                try {
                    const audioBuffer = await whatsappService.downloadMedia(mediaId);
                    textMessage = await aiService.transcreverAudio(audioBuffer);
                    isTranscribed = true;
                    console.log(`🎙️ [WHISPER] Texto Transcrito (Barbearia): "${textMessage}"`);
                } catch (e) {
                    textMessage = "[Áudio Recebido - Falha na Transcrição]";
                }
            } else if (message.type === 'text') {
                textMessage = message.text?.body || "";
            } else if (message.type === 'interactive') {
                textMessage = message.interactive.button_reply?.id || message.interactive.list_reply?.id;
            }
            
            if (!textMessage) {
                console.log(`⚠️ [MOTOR BARBEARIA] Mensagem sem texto ignorada.`);
                return;
            }

            let userState = stateMachine.get(senderNumber) || { step: STEPS.MENU_PRINCIPAL, data: {} };

            const msgLow = textMessage.toLowerCase();

            if (textMessage.startsWith('srv_') || textMessage.startsWith('barb_') || userState.step.startsWith('AGENDAMENTO_')) {
                await handleAgendamento(senderNumber, textMessage, senderNumber, stateMachine, STEPS);
                return;
            }

            if (userState.step === STEPS.CANCELAR_AGENDAMENTO) {
                await processarCancelamento(senderNumber, textMessage, senderNumber, stateMachine, STEPS);
                return;
            }

            if (textMessage === 'cmd_agendar' || msgLow.includes('agendar') || msgLow.includes('marcar') || msgLow.includes('corte')) {
                return await iniciarAgendamento(senderNumber, senderNumber, stateMachine, STEPS);
            }
            if (textMessage === 'cmd_precos' || msgLow.includes('preço') || msgLow.includes('valor')) {
                return await verPrecosEServicos(senderNumber);
            }
            if (textMessage === 'cmd_agenda' || msgLow.includes('minha agenda')) {
                return await verMeusAgendamentos(senderNumber, senderNumber);
            }
            if (textMessage === 'cmd_cancelar' || msgLow.includes('cancelar')) {
                return await iniciarCancelamento(senderNumber, senderNumber, stateMachine, STEPS);
            }
            if (textMessage === 'cmd_humano' || msgLow.includes('atendente') || msgLow.includes('pessoa')) {
                await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
                await whatsappService.sendText(senderNumber, 'A transferir para a equipa da Barbearia. Aguarde por favor.');
                return;
            }

            await enviarMenuGeral(senderNumber);
            
        } catch (error) {
            console.error('❌ ERRO CRÍTICO NO MOTOR DA BARBEARIA:', error);
            await whatsappService.sendText(senderNumber, "Desculpe, a nossa IA teve uma pequena falha. Diga 'Oi' para recomeçarmos!");
        }
    }, 0);
}

module.exports = { processarMensagemEntrante, limparMemoriaEstado, stateMachine };