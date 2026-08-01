// --- START OF FILE messageHandler.js ---
const { prisma, getOrCreateCliente } = require('./db');
const { iniciarAgendamento, handleAgendamento } = require('./flowAgendamento');
const { verPrecosEServicos, verMeusAgendamentos } = require('./flowConsultas');
const { iniciarCancelamento, processarCancelamento } = require('./flowCancelamento');
const { sendDelayedText, sendInteractiveMenu, sendDelayedLocation } = require('./botUtils');
const { responderComGroq, extrairNomeComGroq, transcreverAudioComGroq } = require('./groqApi');
const { markAsReadAndTyping, sendText, downloadMedia } = require('./whatsappApi'); 

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

async function handleMessage(message, contact) {
    const senderNumber = message.from; 
    let textMessage = "";
    const jid = senderNumber;

    if (message.id) {
        await markAsReadAndTyping(message.id); 
    }

    if (message.type === 'text') {
        textMessage = message.text.body;
    } else if (message.type === 'interactive') {
        if (message.interactive.type === 'button_reply') textMessage = message.interactive.button_reply.id;
        else if (message.interactive.type === 'list_reply') textMessage = message.interactive.list_reply.id;
    } else if (message.type === 'audio') {
        const mediaId = message.audio.id;
        const audioBuffer = await downloadMedia(mediaId);
        
        if (audioBuffer) {
            textMessage = await transcreverAudioComGroq(audioBuffer);
            console.log(`🎙️ [ÁUDIO TRANSCREVIDO] ${senderNumber}: "${textMessage}"`);
        } else {
            await sendDelayedText(null, jid, "Desculpa, não consegui ouvir o teu áudio neste momento. Podes escrever?");
            return;
        }
    }

    if (!textMessage) return;
    
    console.log(`\n[PASSO 1] Lendo mensagem de ${senderNumber}: "${textMessage}"`);

    try {
        let cliente = await getOrCreateCliente(senderNumber);

        if (textMessage.trim().toLowerCase() === '#sair') {
            if (cliente.falarHumano) {
                await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: false } });
            }
            await sendDelayedText(null, jid, 'Atendimento automatico restaurado! Podes utilizar o menu abaixo ou conversar comigo.');
            await sendMenu(null, jid);
            return; 
        }

        if (cliente.falarHumano) return; 

        let userState = stateMachine.get(senderNumber) || { step: STEPS.MENU_PRINCIPAL, data: {} };
        
        // RECUPERAÇÃO DE ABANDONO: Sempre que o usuário manda mensagem, reinicia o tempo e o estado do robô
        userState.lastActive = Date.now();
        userState.notified = false;
        
        if (!cliente.nome && userState.step === STEPS.MENU_PRINCIPAL) {
            const historicoCru = await prisma.mensagemIA.count({ where: { clienteId: senderNumber } });
            if (historicoCru === 0) {
                userState.step = STEPS.PEDIR_NOME;
                stateMachine.set(senderNumber, userState);
                
                await sendDelayedText(null, jid, 'Ola! Sou o Assistente Virtual da Barbearia, seja muito bem-vindo!\nE um prazer ter-te por aqui.');
                await sendText(jid, 'Para que o nosso atendimento seja mais amigavel, como gostarias de ser chamado?');
                return;
            }
        }

        if (userState.step === STEPS.PEDIR_NOME) {
            const nomeExtraido = await extrairNomeComGroq(textMessage);
            
            if (nomeExtraido.toUpperCase() === 'IGNORAR') {
                userState.step = STEPS.MENU_PRINCIPAL;
                stateMachine.set(senderNumber, userState);
            } else {
                const nomeFinal = nomeExtraido.charAt(0).toUpperCase() + nomeExtraido.slice(1).toLowerCase();
                await prisma.cliente.update({ where: { id: senderNumber }, data: { nome: nomeFinal } });
                cliente.nome = nomeFinal; 
                
                userState.step = STEPS.MENU_PRINCIPAL;
                stateMachine.set(senderNumber, userState);
                
                await prisma.mensagemIA.create({ data: { role: 'user', content: `O meu nome e ${nomeFinal}`, clienteId: senderNumber }});

                const btnPrimeiraVez = [
                    { id: 'menu', title: 'Menu Principal' }, 
                    { id: 'btn_duvidas', title: 'Duvidas frequentes' },
                    { id: 'btn_equipe', title: 'Falar com a equipe' }
                ];
                
                const textoBoasVindas = `Muito prazer, ${nomeFinal}!\n\nEscolhe uma das opcoes abaixo para comecarmos ou conversa comigo a vontade (podes ate enviar audios!):`;
                
                await sendInteractiveMenu(null, jid, textoBoasVindas, btnPrimeiraVez);
                await prisma.mensagemIA.create({ data: { role: 'assistant', content: textoBoasVindas, clienteId: senderNumber }});
                return; 
            }
        }

        stateMachine.set(senderNumber, userState);

        const msgLower = textMessage.trim().toLowerCase();
        const cmdsIntuitosUI= ['menu', 'início', 'inicio', 'voltar', 'cancelar tudo', '0'];

        if (cmdsIntuitosUI.includes(msgLower)) {
             userState.step = STEPS.MENU_PRINCIPAL;
             userState.data = {};
             await sendMenu(null, jid);
        }
        else if (textMessage.startsWith('srv_')) {
            const servicoId = textMessage.replace('srv_', '');
            userState.step = STEPS.AGENDAMENTO_SERVICO;
            stateMachine.set(senderNumber, userState);
            await handleAgendamento(null, jid, servicoId, senderNumber, stateMachine, STEPS);
        }
        else if (userState.step.startsWith('AGENDAMENTO_')) {
            await handleAgendamento(null, jid, textMessage, senderNumber, stateMachine, STEPS);
        }
        else {
             switch (userState.step) {
                  case STEPS.MENU_PRINCIPAL:
                      await handleEstrategiaLLMSalvos(null, jid, textMessage, senderNumber, cliente.nome);
                      break;
                  case STEPS.CANCELAR_AGENDAMENTO:
                      await processarCancelamento(null, jid, textMessage, senderNumber, stateMachine, STEPS);
                      break;
                  default:
                      userState.step = STEPS.MENU_PRINCIPAL; userState.data = {};
                      break;
              }
        }
    } catch (error) {
        console.error(`❌ Erro no Engine Central:`, error);
    }
}

async function sendMenu(sockIgnorado, jid) {
    const menuOptions = [
        { id: '1', title: 'Agendar', description: 'Cortar/Marcar novo!' },
        { id: '2', title: 'Servicos e Precos', description: 'Tabela C/ precarios' },
        { id: '3', title: 'A Minha Agenda', description: 'Check dos apontamentos' },
        { id: '4', title: 'Cancelar Marcas', description: 'Pausar Canceladas!' },
        { id: '5', title: 'Av., Mapa / Hrs', description: 'Geocalizacao' },
        { id: '6', title: 'Falar com Humano', description: 'Atendimento Organico' }
    ];
    await sendInteractiveMenu(null, jid, '*Portal Da Barbearia*\nE bem pratico! Podes simplesmente prosseguir tocando num botao abaixo', menuOptions);
}

async function handleEstrategiaLLMSalvos(sockIgnorado, jid, textMessage, senderNumber, nomeCliente) {
    const option = textMessage.trim();
    
    switch (option) {
        case '1': await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS); break;
        case '2': 
        case 'btn_servicos':
            await verPrecosEServicos(null, jid); 
            await prisma.mensagemIA.create({ data: { role: 'user', content: "Mostre os serviços e preços", clienteId: senderNumber }});
            await prisma.mensagemIA.create({ data: { role: 'assistant', content: "Aqui estão os nossos serviços e preços.", clienteId: senderNumber }});
            break; 
        case '3': await verMeusAgendamentos(null, jid, senderNumber); break; 
        case '4': await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS); break;
        
        case '5': 
            await sendDelayedText(null, jid, `*Como nos encontrar:*\nNos ficamos na Av. 24 de Julho, Maputo.\nAberto de Seg a Sab (09h as 19h)\n\nAbaixo esta o nosso mapa para navegares ate aqui!`);
            await sendDelayedLocation(jid, -25.9744, 32.5885, "Portal Da Barbearia", "Av. 24 de Julho, Maputo");
            break;
        
        case 'btn_duvidas':
            await sendDelayedText(null, jid, 'Podes perguntar-me o que quiseres! Qual e a tua duvida sobre a nossa barbearia? (Se preferires, envia um audio!)');
            await prisma.mensagemIA.create({ data: { role: 'user', content: "Tenho dúvidas frequentes.", clienteId: senderNumber }});
            await prisma.mensagemIA.create({ data: { role: 'assistant', content: "Podes perguntar-me o que quiseres!", clienteId: senderNumber }});
            break;

        case '6': 
        case 'btn_equipe':
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
            await sendDelayedText(null, jid, 'Atendimento transferido! Um de nossos barbeiros ja vem te responder. Aguarda so um pouquinho...\n\n(Para voltares ao atendimento automatico a qualquer momento, digita *#sair*)'); 
            break;
            
        default: 
            const historicoCru = await prisma.mensagemIA.findMany({
                   where: { clienteId: senderNumber }, 
                   orderBy: { criadoEm: 'desc' }, 
                   take: 4 
            });

            const agora = new Date();
            const horaMaputoStr = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Africa/Maputo', hour: 'numeric', hour12: false }).format(agora);
            const horaMaputo = parseInt(horaMaputoStr);

            let saudacao = "Boa noite";
            if (horaMaputo >= 5 && horaMaputo < 12) saudacao = "Bom dia";
            else if (horaMaputo >= 12 && horaMaputo < 18) saudacao = "Boa tarde";

            let infoTemporal = `NOVA CONVERSA. Hora atual: ${horaMaputo}h (${saudacao}). Cumprimenta o cliente com ${saudacao}!`;

            if (historicoCru.length > 0) {
                const ultimaMsgData = new Date(historicoCru[0].criadoEm);
                const horasPassadas = (agora - ultimaMsgData) / (1000 * 60 * 60); 
                
                if (horasPassadas < 3) {
                    infoTemporal = `CONVERSA CONTÍNUA. Última mensagem há menos de 3h. PROIBIDO dizer Bom dia, Boa tarde ou Boa noite. Vai direto ao assunto.`;
                } else if (horasPassadas >= 3 && horasPassadas < 16) {
                    infoTemporal = `RETORNO (passaram algumas horas). Hora atual: ${horaMaputo}h. Podes voltar a dizer ${saudacao}.`;
                } else {
                    infoTemporal = `NOVO DIA/MUITO TEMPO. Hora atual: ${horaMaputo}h. OBRIGATÓRIO cumprimentar com ${saudacao}!`;
                }
            }
            
            await prisma.mensagemIA.create({ data: { role: 'user', content: textMessage, clienteId: senderNumber }});
            
            const asConversasPassadas = historicoCru.reverse();
            const constCortesG = await prisma.agendamento.count({ where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }});
            
            const textIArid = await responderComGroq(textMessage, constCortesG, asConversasPassadas, infoTemporal, nomeCliente);
            
            const intentCheck = textIArid.trim().toUpperCase().replace(/\s+/g, '');

            if (intentCheck.includes('/AGENDAR') || intentCheck.includes('/MARCAR') || intentCheck.includes('/NOVO')) {
                await iniciarAgendamento(null, jid, senderNumber, stateMachine, STEPS);
            }
            else if (intentCheck.includes('/CANCELAR') || intentCheck.includes('/DESMARCAR')) {
                await iniciarCancelamento(null, jid, senderNumber, stateMachine, STEPS);
            }
            else if (intentCheck.includes('/PRECOS') || intentCheck.includes('/SERVICOS') || intentCheck.includes('/VALOR')) {
                await verPrecosEServicos(null, jid);
            }
            else if (intentCheck.includes('/AGENDA') || intentCheck.includes('/ESTADO') || intentCheck.includes('/CONSULTA') || intentCheck.includes('LAGENDA')) {
                await verMeusAgendamentos(null, jid, senderNumber);
            }
            else if (intentCheck.includes('/LOCAL') || intentCheck.includes('/MAPA') || intentCheck.includes('/ENDERECO')) {
                await sendDelayedText(null, jid, `*Como nos encontrar:*\nNos ficamos na Av. 24 de Julho, Maputo.\nAberto de Seg a Sab (09h as 19h)\n\nAbaixo esta o nosso mapa para navegares ate aqui!`);
                await sendDelayedLocation(jid, -25.9744, 32.5885, "Portal Da Barbearia", "Av. 24 de Julho, Maputo");
            }
            else if (intentCheck.includes('/HUMANO') || intentCheck.includes('/ATENDENTE') || intentCheck.includes('/PESSOA')) {
                await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
                await sendDelayedText(null, jid, 'Atendimento transferido! Um de nossos barbeiros ja vem te responder. Aguarda so um pouquinho...\n\n(Para voltares ao atendimento automatico, digita *#sair*)');
            } 
            else if (intentCheck.includes('/MENU')) {
                await sendMenu(null, jid);
            }
            else {
                if (textIArid.trim().startsWith('/')) {
                    await sendMenu(null, jid);
                } else {
                    await prisma.mensagemIA.create({ data: { role: 'assistant', content: textIArid, clienteId: senderNumber }});
                    await sendDelayedText(null, jid, textIArid);
                }
            }
            break;
    }
}

// Expõe a máquina de estados para o robô que verifica o abandono do carrinho
module.exports = { handleMessage, stateMachine, STEPS };