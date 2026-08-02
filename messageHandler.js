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

async function handleMessage(message, contact) {
    const senderNumber = message.from;
    let textMessage = "";
    const jid = senderNumber;

    if (message.id) await markAsReadAndTyping(message.id);

    // Processamento de mídia e texto
    if (message.type === 'text') {
        textMessage = message.text.body;
    } else if (message.type === 'interactive') {
        if (message.interactive.type === 'button_reply') textMessage = message.interactive.button_reply.id;
        else if (message.interactive.type === 'list_reply') textMessage = message.interactive.list_reply.id;
    } else if (message.type === 'audio') {
        const audioBuffer = await downloadMedia(message.audio.id);
        if (audioBuffer) {
            const fileName = `aud_${Date.now()}.ogg`;
            fs.writeFileSync(path.join(uploadsDir, fileName), audioBuffer);
            const transcricao = await transcreverAudioComGroq(audioBuffer);
            textMessage = `[MEDIA:audio] /uploads/${fileName} | Transcrição: ${transcricao}`;
        }
    } else if (message.type === 'image') {
        const imgBuffer = await downloadMedia(message.image.id);
        if (imgBuffer) {
            const fileName = `img_${Date.now()}.jpeg`;
            fs.writeFileSync(path.join(uploadsDir, fileName), imgBuffer);
            const caption = message.image.caption ? ` | Transcrição: ${message.image.caption}` : '';
            textMessage = `[MEDIA:image] /uploads/${fileName}${caption}`;
        }
    } else if (message.type === 'video') {
        const vidBuffer = await downloadMedia(message.video.id);
        if (vidBuffer) {
            const fileName = `vid_${Date.now()}.mp4`;
            fs.writeFileSync(path.join(uploadsDir, fileName), vidBuffer);
            const caption = message.video.caption ? ` | Transcrição: ${message.video.caption}` : '';
            textMessage = `[MEDIA:video] /uploads/${fileName}${caption}`;
        }
    } else if (message.type === 'order') {
        const orderItems = message.order.product_items;
        if (orderItems && orderItems.length > 0) {
            const produtoSKU = orderItems[0].product_retailer_id;
            const prod1 = process.env.PRODUTO_1_ID || 'h5fj6325da';
            const prod2 = process.env.PRODUTO_2_ID || '8pdji0vdor';
            const prod3 = process.env.PRODUTO_3_ID || 'af2o2iuwey';
            const servicosDb = await prisma.servico.findMany({
                orderBy: {
                    id: 'asc'
                }
            });
            let dbServicoId = servicosDb.length > 0 ? servicosDb[0].id.toString() : '1';
            if (produtoSKU === prod1 && servicosDb[0]) dbServicoId = servicosDb[0].id.toString();
            else if (produtoSKU === prod2 && servicosDb[1]) dbServicoId = servicosDb[1].id.toString();
            else if (produtoSKU === prod3 && servicosDb[2]) dbServicoId = servicosDb[2].id.toString();
            textMessage = 'srv_' + dbServicoId;
        }
    }

    if (!textMessage) return;

    try {
        const config = getSettings();
        if (!config.botAtivo) return; // Master switch

        let cliente = await getOrCreateCliente(senderNumber);

        // Saída do atendimento humano
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
            await sendDelayedText(null, jid, 'Atendimento automático restaurado! Podes utilizar o menu abaixo ou conversar comigo.');
            await sendMenu(null, jid);
            return;
        }

        if (cliente.falarHumano) {
            const novaMsg = await prisma.mensagemIA.create({
                data: {
                    role: 'user',
                    content: textMessage,
                    clienteId: senderNumber
                }
            });
            if (global.io) global.io.emit('nova_mensagem', {
                clienteId: senderNumber,
                mensagem: novaMsg
            });
            return;
        }

        // Fuso Horário de Moçambique
        const agora = new Date();
        const horaMaputoStr = agora.toLocaleString("pt-PT", {
            timeZone: "Africa/Maputo"
        });
        const timeFormatter = new Intl.DateTimeFormat('pt-PT', {
            timeZone: 'Africa/Maputo',
            hour: '2-digit',
            minute: '2-digit'
        });
        const horaMin = timeFormatter.format(agora);
        const diaDaSemana = new Date(agora.toLocaleString('en-US', {
            timeZone: 'Africa/Maputo'
        })).getDay();

        let foraDoExpediente = false;
        if (!config.diasTrabalho.includes(diaDaSemana)) foraDoExpediente = true;
        else if (horaMin < config.horaInicio || horaMin > config.horaFim) foraDoExpediente = true;

        let userState = stateMachine.get(senderNumber) || {
            step: STEPS.MENU_PRINCIPAL,
            data: {}
        };
        userState.lastActive = Date.now();
        userState.notified = false;

        // IA gera primeira saudação pedindo o nome dinamicamente
        if ((!cliente.nome || cliente.nome === 'Sem Nome') && userState.step === STEPS.MENU_PRINCIPAL) {
            const historicoCru = await prisma.mensagemIA.count({
                where: {
                    clienteId: senderNumber
                }
            });
            if (historicoCru === 0) {
                userState.step = STEPS.PEDIR_NOME;
                stateMachine.set(senderNumber, userState);

                const promptSaudacao = `És o assistente virtual da barbearia. O utilizador mandou mensagem e precisas de saber o seu nome. Em Moçambique agora são ${horaMaputoStr}. Dá bom dia/boa tarde/boa noite de forma amigável e pergunta com quem tens o prazer de falar. (No máximo 1 emoji).`;
                const msgSaudacao = await gerarMensagemNotificacao(promptSaudacao, 'Olá! Sou o assistente virtual da barbearia. Como te chamas?');
                await sendDelayedText(null, jid, msgSaudacao);
                return;
            }
        }

        // Cliente dá o nome, a IA gera a apresentação baseada no nome
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
                        content: textMessage,
                        clienteId: senderNumber
                    }
                });

                const promptApresentacao = `O cliente disse que se chama ${nomeFinal}. Em Moçambique agora são ${horaMaputoStr}. Dá-lhe as boas vindas, apresenta-te como o assistente da Portal da Barbearia especialista em cortes, e pergunta como podes ajudar. (Máximo 1 emoji).`;
                const textoBoasVindas = await gerarMensagemNotificacao(promptApresentacao, `Muito prazer, ${nomeFinal}! Bem-vindo à Portal da Barbearia. Como posso ajudar-te hoje?`);

                await sendInteractiveMenu(null, jid, textoBoasVindas, [{
                        id: 'btn_servicos',
                        title: 'Serviços e preços'
                    },
                    {
                        id: 'menu',
                        title: 'Menu'
                    },
                    {
                        id: 'btn_equipe',
                        title: 'Falar com atendente'
                    }
                ]);

                await prisma.mensagemIA.create({
                    data: {
                        role: 'assistant',
                        content: textoBoasVindas,
                        clienteId: senderNumber
                    }
                });
                return;
            }
        }

        stateMachine.set(senderNumber, userState);
        const msgLower = textMessage.trim().toLowerCase();
        const cmdsIntuitosUI = ['menu', 'início', 'inicio', 'voltar', 'cancelar tudo', '0'];

        if (cmdsIntuitosUI.includes(msgLower)) {
            userState.step = STEPS.MENU_PRINCIPAL;
            userState.data = {};
            await sendMenu(null, jid);
        } else if (textMessage.startsWith('srv_')) {
            const servicoId = textMessage.replace('srv_', '');
            userState.step = STEPS.AGENDAMENTO_SERVICO;
            stateMachine.set(senderNumber, userState);
            await handleAgendamento(null, jid, servicoId, senderNumber, stateMachine, STEPS);
        } else if (userState.step.startsWith('AGENDAMENTO_')) {
            await handleAgendamento(null, jid, textMessage, senderNumber, stateMachine, STEPS);
        } else {
            switch (userState.step) {
                case STEPS.MENU_PRINCIPAL:
                    await handleEstrategiaLLMSalvos(null, jid, textMessage, senderNumber, cliente.nome, horaMaputoStr, foraDoExpediente);
                    break;
                case STEPS.CANCELAR_AGENDAMENTO:
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

async function sendMenu(sockIgnorado, jid) {
    await sendInteractiveMenu(null, jid, '*Portal Da Barbearia*\nÉ bem prático! Podes simplesmente prosseguir tocando num botão abaixo', [{
        id: '1',
        title: 'Agendar',
        description: 'Cortar/Marcar novo!'
    }, {
        id: '2',
        title: 'Serviços e Preços',
        description: 'Tabela C/ preçários'
    }, {
        id: '3',
        title: 'A Minha Agenda',
        description: 'Check dos apontamentos'
    }, {
        id: '4',
        title: 'Cancelar Marcas',
        description: 'Pausar Canceladas!'
    }, {
        id: '5',
        title: 'Av., Mapa / Hrs',
        description: 'Geolocalização'
    }, {
        id: '6',
        title: 'Falar com Humano',
        description: 'Atendimento Orgânico'
    }]);
}

async function handleEstrategiaLLMSalvos(sockIgnorado, jid, textMessage, senderNumber, nomeCliente, horaMaputoStr, foraDoExpediente) {
    const option = textMessage.trim();
    switch (option) {
        case '1':
            await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS);
            break;
        case '2':
        case 'btn_servicos':
            await verPrecosEServicos(null, jid);
            await prisma.mensagemIA.create({
                data: {
                    role: 'user',
                    content: "Mostre os serviços e preços",
                    clienteId: senderNumber
                }
            });
            await prisma.mensagemIA.create({
                data: {
                    role: 'assistant',
                    content: "A enviar catálogo de serviços...",
                    clienteId: senderNumber
                }
            });
            break;
        case '3':
            await verMeusAgendamentos(null, jid, senderNumber);
            break;
        case '4':
            await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS);
            break;
        case '5':
            await sendDelayedText(null, jid, `*Como nos encontrar:*\nNós ficamos na Av. 24 de Julho, Maputo.\nAberto de Seg a Sáb (09h às 19h)\n\nAbaixo está o nosso mapa para navegares até aqui!`);
            await sendDelayedLocation(jid, -25.9744, 32.5885, "Portal Da Barbearia", "Av. 24 de Julho, Maputo");
            break;
        case '6':
        case 'btn_equipe':
            await prisma.cliente.update({
                where: {
                    id: senderNumber
                },
                data: {
                    falarHumano: true
                }
            });
            await sendDelayedText(null, jid, 'Atendimento transferido! Um de nossos barbeiros já vem te responder. Aguarda só um pouquinho...\n\n(Para voltares ao atendimento automático, digita *#sair*)');
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

            await prisma.mensagemIA.create({
                data: {
                    role: 'user',
                    content: textMessage,
                    clienteId: senderNumber
                }
            });

            const ultimo = historicoCru.length > 0 ? historicoCru[0] : null;
            let tempoPassado = "O cliente acabou de iniciar a conversa.";
            if (ultimo) {
                const diffMins = Math.floor((Date.now() - new Date(ultimo.criadoEm).getTime()) / 60000);
                if (diffMins > 60) {
                    tempoPassado = `Aviso: O cliente regressou após ${Math.floor(diffMins/60)} horas de inatividade.`;
                } else {
                    tempoPassado = `A conversa está super ativa (Última mensagem há ${diffMins} minutos).`;
                }
            }

            const infoTemporal = `Horário atual em Moçambique: ${horaMaputoStr}. ${tempoPassado} ${foraDoExpediente ? 'ATENÇÃO: A barbearia está FECHADA neste exato horário! Responda às dúvidas normalmente, mas não tentes assumir que agendarão de imediato.' : 'A barbearia está ABERTA.'} Age naturalmente.`;

            const textIArid = await responderComGroq(textMessage, 0, historicoCru.reverse(), infoTemporal, nomeCliente);
            const intentCheck = textIArid.trim().toUpperCase().replace(/\s+/g, '');

            if (intentCheck.includes('/AGENDAR')) await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS);
            else if (intentCheck.includes('/CANCELAR')) await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS);
            else if (intentCheck.includes('/PRECOS')) await verPrecosEServicos(null, jid);
            else if (intentCheck.includes('/AGENDA')) await verMeusAgendamentos(null, jid, senderNumber);
            else if (intentCheck.includes('/LOCAL')) {
                await sendDelayedText(null, jid, `*Como nos encontrar:*\nNós ficamos na Av. 24 de Julho, Maputo.\nAberto de Seg a Sáb (09h às 19h)\n\nAbaixo está o nosso mapa para navegares até aqui!`);
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
                await sendDelayedText(null, jid, 'Atendimento transferido! Um de nossos barbeiros já vem te responder. Aguarda só um pouquinho...\n\n(Para voltares ao atendimento automático, digita *#sair*)');
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