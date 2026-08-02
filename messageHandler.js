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

async function sendMenu(sockIgnorado, jid, nomeCliente = '') {
    // IA ESCREVE O TEXTO DO MENU EM TEMPO REAL
    const promptMenu = `És o assistente da barbearia. Pede de forma curta, natural e direta para o cliente ${nomeCliente || 'Amigo'} escolher uma opção do menu principal abaixo. (Máximo 1 frase curta, sem parecer robô).`;
    const textoMenu = await gerarMensagemNotificacao(promptMenu, `Como posso ajudar-te hoje, ${nomeCliente || 'Amigo'}? Escolhe uma das opções:`);

    await sendInteractiveMenu(null, jid, textoMenu, [{
            id: '1',
            title: 'Agendar',
            description: 'Cortar/Marcar novo!'
        },
        {
            id: '2',
            title: 'Serviços e Preços',
            description: 'Tabela C/ preçários'
        },
        {
            id: '3',
            title: 'A Minha Agenda',
            description: 'Check dos apontamentos'
        },
        {
            id: '4',
            title: 'Cancelar Marcas',
            description: 'Pausar Canceladas!'
        },
        {
            id: '5',
            title: 'Av., Mapa / Hrs',
            description: 'Geolocalização'
        },
        {
            id: '6',
            title: 'Falar com Humano',
            description: 'Atendimento Orgânico'
        }
    ]);
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
            await sendDelayedText(null, jid, 'Atendimento automático restaurado! Podes utilizar o menu abaixo ou conversar comigo.');
            await sendMenu(null, jid, cliente.nome);
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

        const agora = new Date();
        const horaMaputoStr = agora.toLocaleString("pt-PT", {
            timeZone: "Africa/Maputo"
        });
        const maputoHour = parseInt(new Intl.DateTimeFormat('pt-PT', {
            timeZone: 'Africa/Maputo',
            hour: 'numeric',
            hour12: false
        }).format(agora));

        let periodoDia = 'Boa noite';
        if (maputoHour >= 5 && maputoHour < 12) periodoDia = 'Bom dia';
        else if (maputoHour >= 12 && maputoHour < 18) periodoDia = 'Boa tarde';

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

        // 1ª INTERAÇÃO: IA APRESENTA-SE E MANDA OS 3 BOTÕES NA MESMA MENSAGEM
        if ((!cliente.nome || cliente.nome === 'Sem Nome') && userState.step === STEPS.MENU_PRINCIPAL) {
            const historicoCru = await prisma.mensagemIA.count({
                where: {
                    clienteId: senderNumber
                }
            });
            if (historicoCru === 0) {
                userState.step = STEPS.PEDIR_NOME;
                stateMachine.set(senderNumber, userState);

                const promptSaudacao = `És o assistente virtual da barbearia. É a primeira vez que o utilizador fala contigo. Horário em Moçambique: ${horaMaputoStr}. Saudação obrigatória: "${periodoDia}". Dá-lhe as boas-vindas, apresenta-te de forma super natural e pergunta o seu nome. Avisa sutilmente que também pode usar os botões se preferir ser rápido.`;
                const msgSaudacao = await gerarMensagemNotificacao(promptSaudacao, `Olá, ${periodoDia}! Sou o assistente da Portal da Barbearia. Como te chamas? (Ou escolhe uma opção nos botões se tiveres pressa).`);

                // MANDA A MENSAGEM CRIADA PELA IA + BOTÕES
                await sendInteractiveMenu(null, jid, msgSaudacao, [{
                        id: 'menu',
                        title: 'Menu Principal'
                    },
                    {
                        id: 'btn_servicos',
                        title: 'Serviços e preços'
                    },
                    {
                        id: 'btn_equipe',
                        title: 'Falar com atendente'
                    }
                ]);
                return;
            }
        }

        // 2ª INTERAÇÃO: TRATAR A RESPOSTA (NOME OU CLIQUE NO BOTÃO)
        if (userState.step === STEPS.PEDIR_NOME) {
            const nomeExtraido = await extrairNomeComGroq(textMessage);

            if (nomeExtraido.toUpperCase() === 'IGNORAR') {
                // O cliente ignorou a pergunta do nome e clicou num botão (ex: 'menu').
                userState.step = STEPS.MENU_PRINCIPAL;
                stateMachine.set(senderNumber, userState);
                // Não damos return aqui para que o código flua para baixo e atenda o botão que ele clicou!
            } else {
                // O cliente deu o nome!
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

                // IA gera uma resposta chamando-o pelo nome e abre o menu principal dinâmico
                await sendMenu(null, jid, nomeFinal);
                return;
            }
        }

        stateMachine.set(senderNumber, userState);
        const msgLower = textMessage.trim().toLowerCase();
        const cmdsIntuitosUI = ['menu', 'início', 'inicio', 'voltar', 'cancelar tudo', '0'];

        if (cmdsIntuitosUI.includes(msgLower)) {
            userState.step = STEPS.MENU_PRINCIPAL;
            userState.data = {};
            await sendMenu(null, jid, cliente.nome);
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
                    await handleEstrategiaLLMSalvos(null, jid, textMessage, senderNumber, cliente.nome, horaMaputoStr, maputoHour, periodoDia, foraDoExpediente);
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

async function handleEstrategiaLLMSalvos(sockIgnorado, jid, textMessage, senderNumber, nomeCliente, horaMaputoStr, maputoHour, periodoDia, foraDoExpediente) {
    const option = textMessage.trim();
    switch (option) {
        case '1':
            await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS);
            break;
        case '2':
        case 'btn_servicos':
            await verPrecosEServicos(null, jid);
            break;
        case '3':
            await verMeusAgendamentos(null, jid, senderNumber);
            break;
        case '4':
            await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS);
            break;
        case '5':
            const promptLocal = `O cliente ${nomeCliente || ''} pediu a localização. Redige uma mensagem simpática dizendo que ficamos na Av. 24 de Julho, Maputo e que o mapa vai logo a seguir.`;
            const txtLocal = await gerarMensagemNotificacao(promptLocal, "Estamos na Av. 24 de Julho, Maputo. Segue o mapa abaixo:");
            await sendDelayedText(null, jid, txtLocal);
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
                if (diffMins > 1440) tempoPassado = `Aviso: Cliente regressou após ${Math.floor(diffMins/1440)} dias. Saudação "${periodoDia}" é OBRIGATÓRIA.`;
                else if (diffMins > 120) tempoPassado = `Aviso: Cliente retomou após ${Math.floor(diffMins/60)}h. Dê a saudação "${periodoDia}".`;
                else tempoPassado = `Aviso: Conversa ATIVA E CONTÍNUA. PROIBIDO repetir "Bom dia/tarde". Responda diretamente ao assunto.`;
            }

            const infoTemporal = `Horário: ${horaMaputoStr} (${periodoDia}). ${tempoPassado} ${foraDoExpediente ? 'A barbearia está FECHADA neste horário!' : 'A barbearia está ABERTA.'}`;
            const textIArid = await responderComGroq(textMessage, 0, historicoCru.reverse(), infoTemporal, nomeCliente);
            const intentCheck = textIArid.trim().toUpperCase().replace(/\s+/g, '');

            if (intentCheck.includes('/AGENDAR')) await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS);
            else if (intentCheck.includes('/CANCELAR')) await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS);
            else if (intentCheck.includes('/PRECOS')) await verPrecosEServicos(null, jid);
            else if (intentCheck.includes('/AGENDA')) await verMeusAgendamentos(null, jid, senderNumber);
            else if (intentCheck.includes('/LOCAL')) {
                const pLocal = `O cliente pediu a localização. Avisa de forma amigável que estamos na Av. 24 de Julho, Maputo e que o mapa vai em anexo.`;
                const tLocal = await gerarMensagemNotificacao(pLocal, "Estamos na Av. 24 de Julho, Maputo. Segue o nosso mapa:");
                await sendDelayedText(null, jid, tLocal);
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
            } else if (intentCheck.includes('/MENU')) await sendMenu(null, jid, nomeCliente);
            else {
                if (textIArid.trim().startsWith('/')) await sendMenu(null, jid, nomeCliente);
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