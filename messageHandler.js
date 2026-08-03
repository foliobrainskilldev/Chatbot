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
    sendDelayedText,
    sendInteractiveMenu,
    sendDelayedLocation
} = require('./botUtils');
const {
    responderComGroq,
    extrairNomeComGroq,
    gerarMensagemNotificacao,
    transcreverAudioComGroq
} = require('./groqApi');
const {
    markAsReadAndTyping,
    sendText,
    downloadMedia
} = require('./whatsappApi');
const fs = require('fs');
const path = require('path');

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
    let displayMessage = ""; // NOME BONITO PARA O PAINEL CRM
    const jid = senderNumber;

    if (message.id) await markAsReadAndTyping(message.id);

    if (message.type === 'text') {
        textMessage = message.text.body;
        displayMessage = textMessage;
    } else if (message.type === 'interactive') {
        if (message.interactive.type === 'button_reply') {
            textMessage = message.interactive.button_reply.id;
            displayMessage = message.interactive.button_reply.title; // Salva o nome (ex: "Agendar")
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
            textMessage = transcricao || "(Áudio inaudível)"; // A IA VAI LER A TRANSCRIÇÃO
            displayMessage = `[MEDIA:audio] /uploads/${fileName} | Transcrição: ${transcricao}`; // O CRM MOSTRA O PLAYER
        }
    } else if (message.type === 'image') {
        const imgBuffer = await downloadMedia(message.image.id);
        if (imgBuffer) {
            const fileName = `img_${Date.now()}.jpeg`;
            fs.writeFileSync(path.join(uploadsDir, fileName), imgBuffer);
            const caption = message.image.caption || '';
            textMessage = caption || "(Imagem enviada)";
            displayMessage = `[MEDIA:image] /uploads/${fileName}` + (caption ? ` | Transcrição: ${caption}` : '');
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
    } else if (message.type === 'order') {
        const orderItems = message.order.product_items;
        if (orderItems && orderItems.length > 0) {
            const produtoSKU = orderItems[0].product_retailer_id;
            const servicosDb = await prisma.servico.findMany({
                orderBy: {
                    id: 'asc'
                }
            });
            let dbServicoId = servicosDb.length > 0 ? servicosDb[0].id.toString() : '1';
            textMessage = 'srv_' + dbServicoId;
            displayMessage = "Encomenda feita pelo Catálogo";
        }
    }

    if (!textMessage && !displayMessage) return;

    try {
        const config = getSettings();
        if (!config.botAtivo) return;

        let cliente = await getOrCreateCliente(senderNumber);

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
            await sendMenu(null, jid);
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
        const horaFormatoEn = agora.toLocaleString("en-US", {
            timeZone: "Africa/Maputo",
            hour12: false,
            hour: "numeric"
        });
        const maputoHour = parseInt(horaFormatoEn, 10);
        const horaMaputoStr = agora.toLocaleString("pt-PT", {
            timeZone: "Africa/Maputo"
        });

        let periodoDia = 'Boa noite';
        if (maputoHour >= 5 && maputoHour < 12) periodoDia = 'Bom dia';
        else if (maputoHour >= 12 && maputoHour < 18) periodoDia = 'Boa tarde';

        const horaMin = new Intl.DateTimeFormat('pt-PT', {
            timeZone: 'Africa/Maputo',
            hour: '2-digit',
            minute: '2-digit'
        }).format(agora);
        const diaDaSemana = new Date(agora.toLocaleString('en-US', {
            timeZone: 'Africa/Maputo'
        })).getDay();
        let foraDoExpediente = (!config.diasTrabalho.includes(diaDaSemana) || horaMin < config.horaInicio || horaMin > config.horaFim);

        let userState = stateMachine.get(senderNumber) || {
            step: STEPS.MENU_PRINCIPAL,
            data: {}
        };

        // 1ª INTERAÇÃO
        if ((!cliente.nome || cliente.nome === 'Sem Nome') && userState.step === STEPS.MENU_PRINCIPAL) {
            const historicoCru = await prisma.mensagemIA.count({
                where: {
                    clienteId: senderNumber
                }
            });
            if (historicoCru === 0) {
                userState.step = STEPS.PEDIR_NOME;
                stateMachine.set(senderNumber, userState);

                const promptSaudacao = `Escreve EXATAMENTE esta frase, substituindo apenas a saudação pela hora certa: "${periodoDia}! Sou o assistente da Portal da Barbearia. Para que o nosso atendimento seja mais amigável, como posso te chamar?". PROIBIDO usar aspas ("").`;
                const msgSaudacao = await gerarMensagemNotificacao(promptSaudacao, `${periodoDia}! Sou o assistente da Portal da Barbearia. Para que o nosso atendimento seja mais amigável, como posso te chamar?`);

                await prisma.mensagemIA.create({
                    data: {
                        role: 'assistant',
                        content: msgSaudacao,
                        clienteId: senderNumber
                    }
                });

                await sendInteractiveMenu(null, jid, msgSaudacao, [{
                        id: 'cmd_menu',
                        title: 'Menu Principal'
                    },
                    {
                        id: 'cmd_precos',
                        title: 'Serviços e preços'
                    },
                    {
                        id: 'cmd_humano',
                        title: 'Falar com atendente'
                    }
                ]);
                return;
            }
        }

        const isGlobalBtn = textMessage.startsWith('cmd_') || textMessage.startsWith('btn_');

        if (isGlobalBtn) {
            userState.step = STEPS.MENU_PRINCIPAL;
            userState.data = {};
            stateMachine.set(senderNumber, userState);
            await handleEstrategiaLLMSalvos(null, jid, textMessage, displayMessage, senderNumber, cliente.nome, horaMaputoStr, maputoHour, periodoDia, foraDoExpediente);
            return;
        }

        // 2ª INTERAÇÃO
        if (userState.step === STEPS.PEDIR_NOME) {
            const nomeExtraido = await extrairNomeComGroq(textMessage);

            if (nomeExtraido.toUpperCase() === 'IGNORAR') {
                userState.step = STEPS.MENU_PRINCIPAL;
                stateMachine.set(senderNumber, userState);
            } else {
                const nomeFinal = nomeExtraido.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
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

                const txtBoasVindas = `Muito prazer, ${nomeFinal}! Selecione uma das opções abaixo para prosseguir:`;
                await sendInteractiveMenu(null, jid, txtBoasVindas, [{
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
                return;
            }
        }

        stateMachine.set(senderNumber, userState);
        const msgLower = textMessage.trim().toLowerCase();
        const cmdsIntuitosUI = ['menu', 'início', 'inicio', 'voltar', 'cancelar tudo', '0'];

        if (cmdsIntuitosUI.includes(msgLower)) {
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
        } else if (textMessage.startsWith('srv_')) {
            userState.step = STEPS.AGENDAMENTO_SERVICO;
            stateMachine.set(senderNumber, userState);
            await prisma.mensagemIA.create({
                data: {
                    role: 'user',
                    content: displayMessage,
                    clienteId: senderNumber
                }
            });
            await handleAgendamento(null, jid, textMessage, senderNumber, stateMachine, STEPS);
        } else if (userState.step.startsWith('AGENDAMENTO_')) {
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
                    await handleEstrategiaLLMSalvos(null, jid, textMessage, displayMessage, senderNumber, cliente.nome, horaMaputoStr, maputoHour, periodoDia, foraDoExpediente);
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

async function handleEstrategiaLLMSalvos(sockIgnorado, jid, textMessage, displayMessage, senderNumber, nomeCliente, horaMaputoStr, maputoHour, periodoDia, foraDoExpediente) {

    // Grava TUDO no banco de dados para o CRM ver bonito (Texto/Áudio/Nome do Botão)
    await prisma.mensagemIA.create({
        data: {
            role: 'user',
            content: displayMessage,
            clienteId: senderNumber
        }
    });

    const option = textMessage.trim();
    switch (option) {
        case 'cmd_agendar':
            await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS);
            break;
        case 'cmd_precos':
        case 'btn_servicos':
            await verPrecosEServicos(null, jid);
            break;
        case 'cmd_agenda':
            await verMeusAgendamentos(null, jid, senderNumber);
            break;
        case 'cmd_cancelar':
            await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS);
            break;
        case 'cmd_menu':
            await sendMenu(null, jid);
            break;
        case 'cmd_local':
            await sendDelayedText(null, jid, "Ficamos na Av. 24 de Julho, Maputo. Segue o mapa abaixo:");
            await sendDelayedLocation(jid, -25.9744, 32.5885, "Portal Da Barbearia", "Av. 24 de Julho, Maputo");
            break;
        case 'cmd_humano':
        case 'btn_equipe':
            await prisma.cliente.update({
                where: {
                    id: senderNumber
                },
                data: {
                    falarHumano: true
                }
            });
            await sendDelayedText(null, jid, 'Transferido para o nosso atendente. Aguarda só um instante!\n(Para voltar ao bot, digita *#sair*)');
            if (global.io) global.io.emit('atualizar_fila');
            break;
        default:
            const historicoCru = await prisma.mensagemIA.findMany({
                where: {
                    clienteId: senderNumber
                },
                orderBy: {
                    criadoEm: 'desc'
                },
                take: 4
            });

            let tempoPassado = "O cliente acabou de iniciar a conversa.";
            if (historicoCru.length > 0) {
                const diffMins = Math.floor((Date.now() - new Date(historicoCru[0].criadoEm).getTime()) / 60000);
                if (diffMins > 1440) tempoPassado = `Saudação "${periodoDia}" OBRIGATÓRIA.`;
                else if (diffMins > 120) tempoPassado = `Dê a saudação "${periodoDia}".`;
                else tempoPassado = `Conversa ATIVA. PROIBIDO dizer "Bom dia/tarde". Responda direto.`;
            }

            const infoTemporal = `Horário: ${horaMaputoStr} (${periodoDia}). ${tempoPassado} ${foraDoExpediente ? 'Barbearia FECHADA agora.' : 'Barbearia ABERTA.'}`;

            // A IA analisa o textMessage limpo (se for áudio, lê a transcrição e não os links de media)
            const textIArid = await responderComGroq(textMessage, 0, historicoCru.reverse(), infoTemporal, nomeCliente);
            const intentCheck = textIArid.trim().toUpperCase().replace(/\s+/g, '');

            if (intentCheck.includes('/AGENDAR')) await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS);
            else if (intentCheck.includes('/CANCELAR')) await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS);
            else if (intentCheck.includes('/PRECOS')) await verPrecosEServicos(null, jid);
            else if (intentCheck.includes('/AGENDA')) await verMeusAgendamentos(null, jid, senderNumber);
            else if (intentCheck.includes('/LOCAL')) {
                await sendDelayedText(null, jid, "Ficamos na Av. 24 de Julho, Maputo. Segue o mapa:");
                await sendDelayedLocation(jid, -25.9744, 32.5885, "Portal Da Barbearia", "Av. 24 de Julho, Maputo");
            } else if (intentCheck.includes('/HUMANO')) {
                await prisma.cliente.update({
                    where: {
                        id: senderNumber
                    },
                    data: {
                        falarHumano: true
                    }
                });
                await sendDelayedText(null, jid, 'A transferir para um atendente humano. Aguarda um pouco.\n(Para voltar, digita *#sair*)');
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
            break;
    }
}
module.exports = {
    handleMessage,
    stateMachine,
    STEPS
};