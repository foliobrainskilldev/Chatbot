const {
    prisma,
    getOrCreateCliente
} = require('./db');
const {
    iniciarAgendamento,
    handleAgendamento
} = require('./flowAgendamento');
const {
    verPrecosEServicos,
    verMeusAgendamentos
} = require('./flowConsultas');
const {
    iniciarCancelamento,
    processarCancelamento
} = require('./flowCancelamento');
const {
    handleClinicaMessage,
    STEPS_CLINICA
} = require('./flowClinica');
const {
    sendDelayedText,
    sendInteractiveMenu,
    sendDelayedLocation
} = require('./botUtils');
const {
    responderComGroq,
    extrairNomeComGroq,
    transcreverAudioComGroq
} = require('./groqApi');
const {
    markAsReadAndTyping,
    sendText,
    downloadMedia
} = require('./whatsappApi');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

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
const settingsPath = path.join(__dirname, 'settings.json');

function getSettings() {
    if (!fs.existsSync(settingsPath)) return {
        botAtivo: true,
        diasTrabalho: [1, 2, 3, 4, 5, 6],
        horaInicio: "09:00",
        horaFim: "19:00"
    };
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

async function dispararWebhook(config, evento, dados) {
    if (config && config.webhookUrl && config.webhookUrl.startsWith('http')) {
        try {
            await axios.post(config.webhookUrl, {
                evento,
                dados,
                dataHora: new Date()
            });
        } catch (e) {}
    }
}

async function atribuirLead(configDb, clienteId) {
    if (configDb.distribuicaoLeads === 'ROTATIVO') {
        const atendentes = await prisma.usuario.findMany({
            where: {
                status: 'ONLINE'
            },
            orderBy: {
                id: 'asc'
            }
        });
        if (atendentes.length > 0) {
            const sorteado = atendentes[Math.floor(Math.random() * atendentes.length)];
            await prisma.cliente.update({
                where: {
                    id: clienteId
                },
                data: {
                    responsavelId: sorteado.id
                }
            });
        }
    }
}

async function sendMenu(sockIgnorado, jid) {
    const textoMenu = `Selecione uma das opções abaixo para prosseguir:`;
    await sendInteractiveMenu(null, jid, textoMenu, [{
            id: 'cmd_agendar',
            title: 'Agendar',
            description: 'Cortar/Marcar novo!'
        },
        {
            id: 'cmd_precos',
            title: 'Serviços e Preços',
            description: 'Tabela C/ preçários'
        },
        {
            id: 'cmd_agenda',
            title: 'A Minha Agenda',
            description: 'Check dos apontamentos'
        },
        {
            id: 'cmd_cancelar',
            title: 'Cancelar Marcas',
            description: 'Pausar Canceladas!'
        },
        {
            id: 'cmd_local',
            title: 'Av., Mapa / Hrs',
            description: 'Geolocalização'
        },
        {
            id: 'cmd_humano',
            title: 'Falar com Humano',
            description: 'Atendimento Orgânico'
        }
    ]);
}

async function handleMessage(message, contact) {
    const senderNumber = message.from;
    let textMessage = "";
    let displayMessage = "";
    const jid = senderNumber;

    if (message.id) await markAsReadAndTyping(message.id, senderNumber);

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
        const audioBuffer = await downloadMedia(message.audio.id);
        if (audioBuffer) {
            const fileName = `aud_${Date.now()}.ogg`;
            fs.writeFileSync(path.join(uploadsDir, fileName), audioBuffer);
            const transcricao = await transcreverAudioComGroq(audioBuffer);
            textMessage = transcricao || "(Áudio inaudível)";
            displayMessage = `[MEDIA:audio] /uploads/${fileName} | Transcrição: ${transcricao}`;
        }
    } else if (message.type === 'image') {
        const imgBuffer = await downloadMedia(message.image.id);
        if (imgBuffer) {
            const fileName = `img_${Date.now()}.jpeg`;
            fs.writeFileSync(path.join(uploadsDir, fileName), imgBuffer);
            const caption = message.image.caption || '';
            textMessage = caption || "(Imagem enviada)";
            displayMessage = `[MEDIA:image] /uploads/${fileName}` + (caption ? ` | Transcrição: ${caption}` : '');
            await prisma.cliente.update({
                where: {
                    id: senderNumber
                },
                data: {
                    tags: 'enviou_imagem'
                }
            });
        }
    } else if (message.type === 'video') {
        const vidBuffer = await downloadMedia(message.video.id);
        if (vidBuffer) {
            const fileName = `vid_${Date.now()}.mp4`;
            fs.writeFileSync(path.join(uploadsDir, fileName), vidBuffer);
            const caption = message.video.caption || '';
            textMessage = caption || "(Vídeo enviado)";
            displayMessage = `[MEDIA:video] /uploads/${fileName}` + (caption ? ` | Transcrição: ${caption}` : '');
        }
    }

    if (!textMessage && !displayMessage) return;

    try {
        const configLocal = getSettings();
        if (!configLocal.botAtivo) return;

        let cliente = await getOrCreateCliente(senderNumber);
        let configDb = await prisma.configSistema.findFirst() || {
            modoAtivo: 'BARBEARIA'
        };
        const MODO_ATIVO = configDb.modoAtivo;

        if (textMessage.trim().toLowerCase() === '#sair') {
            if (cliente.falarHumano) {
                await prisma.cliente.update({
                    where: {
                        id: senderNumber
                    },
                    data: {
                        falarHumano: false
                    }
                });
                if (global.io) global.io.emit('atualizar_fila');
            }
            await sendDelayedText(null, jid, 'Atendimento automático restaurado.');
            if (MODO_ATIVO === 'BARBEARIA') await sendMenu(null, jid);
            return;
        }

        if (cliente.falarHumano) {
            const novaMsg = await prisma.mensagemIA.create({
                data: {
                    role: 'user',
                    content: displayMessage,
                    clienteId: senderNumber
                }
            });
            if (global.io) global.io.emit('nova_mensagem', {
                clienteId: senderNumber,
                mensagem: novaMsg
            });
            return;
        }

        const agora = new Date();
        const horaMaputoStr = agora.toLocaleString("pt-PT", {
            timeZone: "Africa/Maputo"
        });
        const maputoHour = parseInt(agora.toLocaleString("en-US", {
            timeZone: "Africa/Maputo",
            hour12: false,
            hour: "numeric"
        }), 10);
        let periodoDia = maputoHour >= 5 && maputoHour < 12 ? 'Bom dia' : (maputoHour >= 12 && maputoHour < 18 ? 'Boa tarde' : 'Boa noite');
        const horaMin = new Intl.DateTimeFormat('pt-PT', {
            timeZone: 'Africa/Maputo',
            hour: '2-digit',
            minute: '2-digit'
        }).format(agora);
        const diaDaSemana = new Date(agora.toLocaleString('en-US', {
            timeZone: 'Africa/Maputo'
        })).getDay();
        let foraDoExpediente = (!configLocal.diasTrabalho.includes(diaDaSemana) || horaMin < configLocal.horaInicio || horaMin > configLocal.horaFim);

        let userState = stateMachine.get(senderNumber) || {
            step: STEPS.MENU_PRINCIPAL,
            data: {}
        };
        userState.lastActive = Date.now();
        userState.notified = false;

        if (MODO_ATIVO === 'CLINICA') {
            await handleClinicaMessage(jid, textMessage, displayMessage, senderNumber, cliente, stateMachine, configDb, periodoDia, foraDoExpediente);
            return;
        }

        if ((!cliente.nome || cliente.nome === 'Sem Nome') && userState.step === STEPS.MENU_PRINCIPAL) {
            const historicoCru = await prisma.mensagemIA.count({
                where: {
                    clienteId: senderNumber
                }
            });
            if (historicoCru === 0) {
                userState.step = STEPS.PEDIR_NOME;
                stateMachine.set(senderNumber, userState);
                if (configDb.notificarNovosLeads) await dispararWebhook(configDb, 'NOVO_LEAD', {
                    id: senderNumber
                });

                const msgSaudacao = `${periodoDia}! Sou o assistente virtual.\nComo posso te chamar?`;
                await prisma.mensagemIA.create({
                    data: {
                        role: 'assistant',
                        content: msgSaudacao,
                        clienteId: senderNumber
                    }
                });
                await sendDelayedText(null, jid, msgSaudacao);
                return;
            }
        }

        const isGlobalBtn = textMessage.startsWith('cmd_') || textMessage.startsWith('btn_');
        if (isGlobalBtn) {
            userState.step = STEPS.MENU_PRINCIPAL;
            userState.data = {};
            stateMachine.set(senderNumber, userState);
            await handleEstrategiaLLMSalvos(null, jid, textMessage, displayMessage, senderNumber, cliente.nome, horaMaputoStr, maputoHour, periodoDia, foraDoExpediente, configDb);
            return;
        }

        if (userState.step === STEPS.PEDIR_NOME) {
            const nomeExtraido = await extrairNomeComGroq(textMessage);
            const nomeFinal = (nomeExtraido.toUpperCase() !== 'IGNORAR') ? nomeExtraido.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : textMessage.split(' ')[0];

            await prisma.cliente.update({
                where: {
                    id: senderNumber
                },
                data: {
                    nome: nomeFinal
                }
            });
            cliente.nome = nomeFinal;
            userState.step = STEPS.MENU_PRINCIPAL;
            stateMachine.set(senderNumber, userState);
            await prisma.mensagemIA.create({
                data: {
                    role: 'user',
                    content: displayMessage,
                    clienteId: senderNumber
                }
            });
            await sendDelayedText(null, jid, `Muito prazer, ${nomeFinal}!`);
            await sendMenu(null, jid);
            return;
        }

        stateMachine.set(senderNumber, userState);
        const msgLower = textMessage.trim().toLowerCase();
        if (['menu', 'início', 'inicio', 'voltar', 'cancelar tudo', '0'].includes(msgLower)) {
            userState.step = STEPS.MENU_PRINCIPAL;
            userState.data = {};
            await prisma.mensagemIA.create({
                data: {
                    role: 'user',
                    content: displayMessage,
                    clienteId: senderNumber
                }
            });
            await sendMenu(null, jid);
        } else if (textMessage.startsWith('srv_') || userState.step.startsWith('AGENDAMENTO_')) {
            await prisma.mensagemIA.create({
                data: {
                    role: 'user',
                    content: displayMessage,
                    clienteId: senderNumber
                }
            });
            await handleAgendamento(null, jid, textMessage, senderNumber, stateMachine, STEPS);
        } else {
            switch (userState.step) {
                case STEPS.MENU_PRINCIPAL:
                    await handleEstrategiaLLMSalvos(null, jid, textMessage, displayMessage, senderNumber, cliente.nome, horaMaputoStr, maputoHour, periodoDia, foraDoExpediente, configDb);
                    break;
                case STEPS.CANCELAR_AGENDAMENTO:
                    await prisma.mensagemIA.create({
                        data: {
                            role: 'user',
                            content: displayMessage,
                            clienteId: senderNumber
                        }
                    });
                    await processarCancelamento(null, jid, textMessage, senderNumber, stateMachine, STEPS);
                    break;
                default:
                    userState.step = STEPS.MENU_PRINCIPAL;
                    userState.data = {};
                    break;
            }
        }
    } catch (error) {
        console.error(`❌ Erro no Engine Central:`, error);
    }
}

async function handleEstrategiaLLMSalvos(sockIgnorado, jid, textMessage, displayMessage, senderNumber, nomeCliente, horaMaputoStr, maputoHour, periodoDia, foraDoExpediente, configDb) {
    const novaMensagem = await prisma.mensagemIA.create({
        data: {
            role: 'user',
            content: displayMessage,
            clienteId: senderNumber
        }
    });
    const option = textMessage.trim();

    if (option === 'cmd_agendar') return await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS);
    if (['cmd_precos', 'btn_servicos'].includes(option)) return await verPrecosEServicos(null, jid);
    if (option === 'cmd_agenda') return await verMeusAgendamentos(null, jid, senderNumber);
    if (option === 'cmd_cancelar') return await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS);
    if (option === 'cmd_menu') return await sendMenu(null, jid);
    if (option === 'cmd_local') {
        await sendDelayedText(null, jid, "Ficamos na Av. 24 de Julho, Maputo.");
        return await sendDelayedLocation(jid, -25.9744, 32.5885, "Portal Da Barbearia", "Av. 24 de Julho, Maputo");
    }
    if (['cmd_humano', 'btn_equipe'].includes(option)) {
        await prisma.cliente.update({
            where: {
                id: senderNumber
            },
            data: {
                falarHumano: true,
                leadStatus: 'QUALIFICADO'
            }
        });
        await atribuirLead(configDb, senderNumber);
        await dispararWebhook(configDb, 'ATENDIMENTO_HUMANO', {
            id: senderNumber
        });
        await sendDelayedText(null, jid, 'Transferido para o nosso atendente. Aguarde!\n(Para voltar ao bot, digite *#sair*)');
        if (global.io) global.io.emit('atualizar_fila');
        return;
    }

    const historicoCru = await prisma.mensagemIA.findMany({
        where: {
            clienteId: senderNumber
        },
        orderBy: {
            criadoEm: 'desc'
        },
        take: 5
    });
    const historicoAnterior = historicoCru.filter(msg => msg.id !== novaMensagem.id).reverse();

    // CONSTRUÇÃO DO CÉREBRO DA IA (Prompt Dinâmico via Painel)
    const promptPersonalizado = `És o ${configDb.nomeAssistente}. Tom: ${configDb.tomDeVoz}. Objetivos: ${configDb.objetivos}.
[Base de Conhecimento Extras]: ${configDb.regrasExtrasIA}
[FAQ Frequente]: ${configDb.faq}
[Transferência para Humano]: ${configDb.regrasTransferencia}

Contexto do Cliente: Nome: ${nomeCliente}. Horário: ${horaMaputoStr} (${periodoDia}). A barbearia está ${foraDoExpediente ? 'FECHADA' : 'ABERTA'}.
REGRA DE OURO: Para ações diretas devolva APENAS as tags:
Quero agendar 👉 /AGENDAR
Falar com humano/atendente 👉 /HUMANO
Cancelar 👉 /CANCELAR
Preços 👉 /PRECOS
Minha agenda 👉 /AGENDA
Onde fica 👉 /LOCAL
Menu 👉 /MENU`;

    const textIArid = await responderComGroq(textMessage, 0, historicoAnterior, promptPersonalizado, nomeCliente);
    const intentCheck = textIArid.trim().toUpperCase().replace(/\s+/g, '');

    if (intentCheck.includes('/AGENDAR')) await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS);
    else if (intentCheck.includes('/CANCELAR')) await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS);
    else if (intentCheck.includes('/PRECOS')) await verPrecosEServicos(null, jid);
    else if (intentCheck.includes('/AGENDA')) await verMeusAgendamentos(null, jid, senderNumber);
    else if (intentCheck.includes('/LOCAL')) {
        await sendDelayedText(null, jid, "Ficamos na Av. 24 de Julho, Maputo.");
    } else if (intentCheck.includes('/HUMANO')) {
        await prisma.cliente.update({
            where: {
                id: senderNumber
            },
            data: {
                falarHumano: true,
                leadStatus: 'QUALIFICADO'
            }
        });
        await atribuirLead(configDb, senderNumber);
        await dispararWebhook(configDb, 'ATENDIMENTO_HUMANO_IA', {
            id: senderNumber
        });
        await sendDelayedText(null, jid, 'A transferir para um atendente humano. Aguarde um pouco.\n(Para voltar, digite *#sair*)');
        if (global.io) global.io.emit('atualizar_fila');
    } else if (intentCheck.includes('/MENU')) await sendMenu(null, jid);
    else {
        if (textIArid.trim().startsWith('/')) await sendMenu(null, jid);
        else {
            await prisma.mensagemIA.create({
                data: {
                    role: 'assistant',
                    content: textIArid,
                    clienteId: senderNumber
                }
            });
            await sendDelayedText(null, jid, textIArid);
        }
    }
}
module.exports = {
    handleMessage,
    stateMachine,
    STEPS
};