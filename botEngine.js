const fs = require('fs');
const path = require('path');
const { prisma, getOrCreateCliente } = require('./db');
const whatsappService = require('./whatsappService');
const aiService = require('./aiService');

// Importação dos Fluxos (Flows) Isolados
const { iniciarAgendamento, handleAgendamento } = require('./flowAgendamento');
const { iniciarCancelamento, processarCancelamento } = require('./flowCancelamento');
const { verPrecosEServicos, verMeusAgendamentos } = require('./flowConsultas');
const { iniciarAgendamentoClinica, handleAgendamentoClinica, STEPS_CLINICA } = require('./flowClinica');

const stateMachine = new Map();

const STEPS = {
    MENU_PRINCIPAL: 'MENU_PRINCIPAL',
    PEDIR_NOME: 'PEDIR_NOME',
    AGENDAMENTO_SERVICO: 'AGENDAMENTO_SERVICO',
    AGENDAMENTO_BARBEIRO: 'AGENDAMENTO_BARBEIRO',
    AGENDAMENTO_DATA: 'AGENDAMENTO_DATA',
    AGENDAMENTO_HORA: 'AGENDAMENTO_HORA',
    AGENDAMENTO_CONFIRMAR: 'AGENDAMENTO_CONFIRMAR',
    CANCELAR_AGENDAMENTO: 'CANCELAR_AGENDAMENTO',
};

const uploadsDir = path.join(__dirname, 'uploads');

function limparMemoriaEstado() {
    stateMachine.clear();
}

// ==========================================
// CONFIGURAÇÃO DO WEBHOOK META (VERIFICAÇÃO)
// ==========================================
exports.verificarWebhook = (req, res) => {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'barbearia_secreta_2024';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook autorizado com sucesso pela Meta!');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
};

exports.processarWebhook = (req, res) => {
    res.sendStatus(200); // Exigência da Meta: Responder IMEDIATAMENTE com 200 OK.
    (async () => {
        try {
            const body = req.body;
            if (body.object) {
                let changes = body.entry?.[0]?.changes?.[0]?.value;
                if (changes?.messages?.[0]) {
                    const message = changes.messages[0];
                    await processarMensagemEntrante(message);
                } 
            }
        } catch (error) {
            console.error('❌ ERRO INTERNO NO PROCESSAMENTO DO WEBHOOK:', error);
        }
    })();
};

// ==========================================
// FUNÇÕES UTILITÁRIAS E MENUS
// ==========================================
async function enviarMenuGeral(jid) {
    const textoMenu = `Selecione uma das opções abaixo para prosseguir:`;
    await whatsappService.sendInteractiveMenu(jid, textoMenu, [
        { id: 'cmd_agendar', title: 'Agendar Horário', description: 'Marcar novo apontamento' },
        { id: 'cmd_precos', title: 'Serviços e Preços', description: 'Tabela de preçários' },
        { id: 'cmd_agenda', title: 'A Minha Agenda', description: 'Checar seus agendamentos' },
        { id: 'cmd_cancelar', title: 'Cancelar Marcações', description: 'Suspender serviço' },
        { id: 'cmd_local', title: 'Endereço e Mapa', description: 'Geolocalização da empresa' },
        { id: 'cmd_humano', title: 'Falar com Atendente', description: 'Transferência para equipe' }
    ]);
}

// ==========================================
// MOTOR CENTRAL DE PROCESSAMENTO
// ==========================================
async function processarMensagemEntrante(message) {
    const senderNumber = message.from;
    const jid = senderNumber;
    let textMessage = "";
    let displayMessage = "";

    if (message.id) await whatsappService.markAsReadAndTyping(message.id, jid);

    // 1. COMPILADOR MULTIMÉDIA (Transforma Mídia em Texto)
    if (message.type === 'text') {
        textMessage = message.text.body;
        displayMessage = textMessage;
    } else if (message.type === 'interactive') {
        if (message.interactive.type === 'button_reply') {
            textMessage = message.interactive.button_reply.id;
            displayMessage = message.interactive.button_reply.title;
        } else if (message.interactive.type === 'list_reply') {
            textMessage = message.interactive.list_reply.id;
            displayMessage = message.interactive.list_reply.title;
        }
    } else if (message.type === 'audio') {
        const audioBuffer = await whatsappService.downloadMedia(message.audio.id);
        if (audioBuffer) {
            const fileName = `aud_${Date.now()}.ogg`;
            fs.writeFileSync(path.join(uploadsDir, fileName), audioBuffer);
            const transcricao = await aiService.transcreverAudioComIA(audioBuffer);
            textMessage = transcricao || "(Áudio inaudível)";
            displayMessage = `[MEDIA:audio] /uploads/${fileName} | Transcrição: ${transcricao}`;
        }
    } else if (message.type === 'image') {
        const imgBuffer = await whatsappService.downloadMedia(message.image.id);
        if (imgBuffer) {
            const fileName = `img_${Date.now()}.jpeg`;
            fs.writeFileSync(path.join(uploadsDir, fileName), imgBuffer);
            const caption = message.image.caption || '';
            textMessage = caption || "(Imagem enviada pela câmera)";
            displayMessage = `[MEDIA:image] /uploads/${fileName} | Transcrição: ${caption}`;
        }
    } else if (message.type === 'video') {
        const vidBuffer = await whatsappService.downloadMedia(message.video.id);
        if (vidBuffer) {
            const fileName = `vid_${Date.now()}.mp4`;
            fs.writeFileSync(path.join(uploadsDir, fileName), vidBuffer);
            textMessage = message.video.caption || "(Vídeo enviado)";
            displayMessage = `[MEDIA:video] /uploads/${fileName} | Transcrição: ${textMessage}`;
        }
    }

    if (!textMessage && !displayMessage) return;

    // 2. RECUPERAÇÃO DO CRM DE DADOS (Verificação do Estado)
    const configDb = await prisma.configSistema.findFirst();
    if (!configDb) return; 

    let cliente = await getOrCreateCliente(senderNumber);

    // Cancelamento Rápido de Atendimento Humano
    if (textMessage.trim().toLowerCase() === '#sair') {
        if (cliente.falarHumano) {
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: false, leadStatus: 'EM_CONVERSA' } });
            if (global.io) global.io.emit('atualizar_fila');
        }
        await whatsappService.sendText(jid, 'Atendimento automático restaurado.');
        await enviarMenuGeral(jid);
        return;
    }

    // Se estiver em modo atendimento humano, a IA não responde
    if (cliente.falarHumano) {
        const novaMsg = await prisma.mensagemIA.create({ data: { role: 'user', content: displayMessage, clienteId: senderNumber } });
        if (global.io) global.io.emit('nova_mensagem', { clienteId: senderNumber, mensagem: novaMsg });
        return;
    }

    let userState = stateMachine.get(senderNumber) || { step: STEPS.MENU_PRINCIPAL, data: {} };
    userState.lastActive = Date.now();
    userState.notified = false;

    // 3. IDENTIDADE E ABORDAGEM DE NOVOS LEADS
    if ((!cliente.nome || cliente.nome === 'Sem Nome') && userState.step === STEPS.MENU_PRINCIPAL) {
        const historicoCru = await prisma.mensagemIA.count({ where: { clienteId: senderNumber } });
        if (historicoCru === 0) {
            userState.step = STEPS.PEDIR_NOME;
            stateMachine.set(senderNumber, userState);

            const msgSaudacao = `Olá! Sou o assistente virtual.\nComo posso te chamar?`;
            await prisma.mensagemIA.create({ data: { role: 'assistant', content: msgSaudacao, clienteId: senderNumber } });
            await whatsappService.sendText(jid, msgSaudacao);
            return;
        }
    }

    // 4. INTERCEPTAÇÃO RÁPIDA DE BOTÕES DIRETOS DO MENU
    const isGlobalBtn = textMessage.startsWith('cmd_') || textMessage.startsWith('btn_');
    if (isGlobalBtn) {
        userState.step = STEPS.MENU_PRINCIPAL;
        userState.data = {};
        stateMachine.set(senderNumber, userState);
        await handleEstrategiaLLMSalvos(jid, textMessage, displayMessage, senderNumber, cliente.nome, configDb);
        return;
    }

    // 5. TRATAMENTO DE COLETA DE NOME
    if (userState.step === STEPS.PEDIR_NOME) {
        const nomeExtraido = await aiService.extrairNomeComIA(textMessage);
        const nomeFinal = (nomeExtraido.toUpperCase() !== 'IGNORAR') 
            ? nomeExtraido.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') 
            : textMessage.split(' ')[0];

        await prisma.cliente.update({ where: { id: senderNumber }, data: { nome: nomeFinal, leadStatus: 'EM_CONVERSA' } });
        cliente.nome = nomeFinal;
        userState.step = STEPS.MENU_PRINCIPAL;
        stateMachine.set(senderNumber, userState);
        
        await prisma.mensagemIA.create({ data: { role: 'user', content: displayMessage, clienteId: senderNumber } });
        await whatsappService.sendText(jid, `Muito prazer, ${nomeFinal}!`);
        await enviarMenuGeral(jid);
        return;
    }

    // 6. MÁQUINA DE ESTADOS (ROTEAMENTO PARA OS FLUXOS)
    stateMachine.set(senderNumber, userState);
    const msgLower = textMessage.trim().toLowerCase();

    // Palavras chaves globais para resetar o fluxo a qualquer momento
    if (['menu', 'início', 'inicio', 'voltar', 'cancelar tudo', '0'].includes(msgLower) && !userState.step.includes('HORA')) {
        userState.step = STEPS.MENU_PRINCIPAL;
        userState.data = {};
        await prisma.mensagemIA.create({ data: { role: 'user', content: displayMessage, clienteId: senderNumber } });
        await enviarMenuGeral(jid);
        return;
    }

    // Se a mensagem for relacionada a um Agendamento em andamento
    if (textMessage.startsWith('srv_') || textMessage.startsWith('barb_') || userState.step.startsWith('AGENDAMENTO_')) {
        await prisma.mensagemIA.create({ data: { role: 'user', content: displayMessage, clienteId: senderNumber } });
        await handleAgendamento(jid, textMessage, senderNumber, stateMachine, STEPS);
        return;
    }

    // Se a mensagem for relacionada ao SaaS Clínica Médica
    if (textMessage.startsWith('trat_') || textMessage.startsWith('med_') || userState.step.startsWith('CLINICA_')) {
        await prisma.mensagemIA.create({ data: { role: 'user', content: displayMessage, clienteId: senderNumber } });
        await handleAgendamentoClinica(jid, textMessage, senderNumber, stateMachine, STEPS.MENU_PRINCIPAL);
        return;
    }

    // Processamento Default baseado no Passo atual
    switch (userState.step) {
        case STEPS.MENU_PRINCIPAL:
            await handleEstrategiaLLMSalvos(jid, textMessage, displayMessage, senderNumber, cliente.nome, configDb);
            break;
        case STEPS.CANCELAR_AGENDAMENTO:
            await prisma.mensagemIA.create({ data: { role: 'user', content: displayMessage, clienteId: senderNumber } });
            await processarCancelamento(jid, textMessage, senderNumber, stateMachine, STEPS);
            break;
        default:
            userState.step = STEPS.MENU_PRINCIPAL;
            userState.data = {};
            break;
    }
}

// ==========================================
// INTELIGÊNCIA ARTIFICIAL E INTERCEPTAÇÃO
// ==========================================
async function handleEstrategiaLLMSalvos(jid, textMessage, displayMessage, senderNumber, nomeCliente, configDb) {
    const novaMensagem = await prisma.mensagemIA.create({
        data: { role: 'user', content: displayMessage, clienteId: senderNumber }
    });

    const option = textMessage.trim();

    // 1. MAPEAMENTO DIRETO DE BOTÕES (Passa reto pela IA)
    if (option === 'cmd_agendar') {
        if (configDb.modoAtivo === 'CLINICA') return await iniciarAgendamentoClinica(jid, senderNumber, stateMachine, STEPS.MENU_PRINCIPAL);
        return await iniciarAgendamento(jid, senderNumber, stateMachine, STEPS);
    }
    if (['cmd_precos', 'btn_servicos'].includes(option)) return await verPrecosEServicos(jid);
    if (option === 'cmd_agenda') return await verMeusAgendamentos(jid, senderNumber);
    if (option === 'cmd_cancelar') return await iniciarCancelamento(jid, senderNumber, stateMachine, STEPS);
    if (option === 'cmd_menu') return await enviarMenuGeral(jid);
    if (option === 'cmd_local') {
        await whatsappService.sendText(jid, "Nossa unidade fica localizada em Maputo, Moçambique.");
        return await whatsappService.sendLocation(jid, -25.9744, 32.5885, "Nossa Empresa", "Maputo, Moçambique");
    }
    if (['cmd_humano', 'btn_equipe'].includes(option)) {
        await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true, leadStatus: 'QUALIFICADO' } });
        await whatsappService.sendText(jid, 'Transferido para nossa equipe de humanos orgânicos. Aguarde um instante!\n(Para voltar ao robô a qualquer instante, digite *#sair*)');
        if (global.io) global.io.emit('atualizar_fila');
        return;
    }

    // 2. LÓGICA DO CÉREBRO CONVERSACIONAL (LLM Groq)
    const historicoCru = await prisma.mensagemIA.findMany({ where: { clienteId: senderNumber }, orderBy: { criadoEm: 'desc' }, take: 5 });
    const historicoAnterior = historicoCru.filter(msg => msg.id !== novaMensagem.id).reverse();

    const promptPersonalizado = `Você é o ${configDb.nomeAssistente}. Tom de Voz: ${configDb.tomDeVoz}. Objetivos: ${configDb.objetivos}.
[Regras Base]: ${configDb.regrasExtrasIA}
[FAQ Frequente]: ${configDb.faq}
[Transferência para Humano]: ${configDb.regrasTransferencia}`;

    const textIArid = await aiService.responderComContextoIA(textMessage, historicoAnterior, promptPersonalizado, nomeCliente);
    
    // 3. O INTERCEPTOR (Isolador e Protetor de Intenções)
    const intentMatch = /\/[A-Z]+/.exec(textIArid.trim().toUpperCase());

    if (intentMatch) {
        const actionTag = intentMatch[0]; // Captura a tag, mesmo as inventadas como /VAGAR
        
        if (actionTag === '/AGENDAR') {
            if (configDb.modoAtivo === 'CLINICA') return await iniciarAgendamentoClinica(jid, senderNumber, stateMachine, STEPS.MENU_PRINCIPAL);
            await iniciarAgendamento(jid, senderNumber, stateMachine, STEPS);
        }
        else if (actionTag === '/CANCELAR') await iniciarCancelamento(jid, senderNumber, stateMachine, STEPS);
        else if (actionTag === '/PRECOS') await verPrecosEServicos(jid);
        else if (actionTag === '/AGENDA') await verMeusAgendamentos(jid, senderNumber);
        else if (actionTag === '/LOCAL') {
            await whatsappService.sendText(jid, "Nossa unidade fica localizada em Maputo, Moçambique.");
            await whatsappService.sendLocation(jid, -25.9744, 32.5885, "Central", "Maputo");
        } 
        else if (actionTag === '/HUMANO') {
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true, leadStatus: 'QUALIFICADO' } });
            await whatsappService.sendText(jid, 'A transferir para um atendente humano. Aguarde.\n(Para voltar ao Bot, digite *#sair*)');
            if (global.io) global.io.emit('atualizar_fila');
        } 
        else if (actionTag === '/MENU') {
            await enviarMenuGeral(jid);
        } 
        else {
            // Se a IA alucinar (/VAGAR, /AJUDA, /MARCAR), intercepta e força o menu sem mostrar a tag ao cliente
            console.log(`[CÉREBRO] A IA alucinou a tag: ${actionTag}. Interceptando...`);
            await enviarMenuGeral(jid);
        }
    } else {
        // Fluxo Conversacional Limpo - A IA escreveu um texto normal
        await prisma.mensagemIA.create({ data: { role: 'assistant', content: textIArid, clienteId: senderNumber } });
        await whatsappService.sendText(jid, textIArid);
    }
}

module.exports = {
    verificarWebhook,
    processarWebhook,
    limparMemoriaEstado,
    stateMachine
};