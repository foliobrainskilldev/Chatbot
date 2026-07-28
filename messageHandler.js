const { prisma, getOrCreateCliente } = require('./db');
const { iniciarAgendamento, handleAgendamento } = require('./flowAgendamento');
const { verPrecosEServicos, verMeusAgendamentos } = require('./flowConsultas');
const { iniciarCancelamento, processarCancelamento } = require('./flowCancelamento');

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

async function handleMessage(sock, msg) {
    const jid = msg.key.remoteJid;
    const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    if (!textMessage) return;

    const senderNumber = jid.split('@')[0];
    const cliente = await getOrCreateCliente(senderNumber);

    if (cliente.falarHumano) {
        if (textMessage.trim().toLowerCase() === '#sair') {
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: false } });
            await sock.sendMessage(jid, { text: '🔄 Atendimento humano encerrado. O bot voltou a operar.\n\nDigite *"Menu"* para recomeçar.' });
        }
        return; 
    }

    let userState = stateMachine.get(senderNumber) || { step: STEPS.MENU_PRINCIPAL, data: {} };
    // Comando universal de escape
    if (textMessage.trim().toLowerCase() === 'menu') {
        userState = { step: STEPS.MENU_PRINCIPAL, data: {} };
        stateMachine.set(senderNumber, userState);
    }

    try {
        if (userState.step.startsWith('AGENDAMENTO_')) {
            await handleAgendamento(sock, jid, textMessage, senderNumber, stateMachine, STEPS);
            return;
        }

        switch (userState.step) {
            case STEPS.MENU_PRINCIPAL:
                await handleMenuPrincipal(sock, jid, textMessage, senderNumber);
                break;
            case STEPS.CANCELAR_AGENDAMENTO:
                await processarCancelamento(sock, jid, textMessage, senderNumber, stateMachine, STEPS);
                break;
            default:
                await sendMenu(sock, jid);
                stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        }
    } catch (error) {
        console.error(`❌ Erro ao processar mensagem de ${senderNumber}:`, error);
        await sock.sendMessage(jid, { text: 'Ocorreu um erro interno. Por favor, tente novamente digitando "Menu".' });
    }
}

async function sendMenu(sock, jid) {
    const menuText = `*Bem-vindo(a) à Barbearia!* ✂️💈\n\nPor favor, escolhe uma opção digitando o número correspondente:\n\n1️⃣ - Agendar horário\n2️⃣ - Ver preços e serviços\n3️⃣ - Meus agendamentos\n4️⃣ - Cancelar / Remarcar horário\n5️⃣ - Horário de funcionamento e localização\n6️⃣ - Falar com atendente`;
    await sock.sendMessage(jid, { text: menuText });
}

async function handleMenuPrincipal(sock, jid, textMessage, senderNumber) {
    const option = textMessage.trim();

    switch (option) {
        case '1':
            await iniciarAgendamento(sock, jid, senderNumber, stateMachine, STEPS);
            break;
        case '2':
            await verPrecosEServicos(sock, jid);
            setTimeout(() => sendMenu(sock, jid), 1500);
            break;
        case '3':
            await verMeusAgendamentos(sock, jid, senderNumber);
            setTimeout(() => sendMenu(sock, jid), 1500);
            break;
        case '4':
            await iniciarCancelamento(sock, jid, senderNumber, stateMachine, STEPS);
            break;
        case '5':
            const info = `📍 *A Nossa Localização:*\nAv. 24 de Julho, Maputo, Moçambique\nGoogle Maps: https://maps.app.goo.gl/exemplo\n\n🕒 *Horário de Funcionamento:*\nSegunda a Sábado: 09:00 às 19:00\nDomingos e Feriados: Encerrado`;
            await sock.sendMessage(jid, { text: info });
            setTimeout(() => sendMenu(sock, jid), 1500); 
            break;
        case '6':
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
            await sock.sendMessage(jid, { text: 'A transferir para um dos nossos atendentes... 👨‍💻\nPor favor, aguarde um momento.\n\n*(Para voltar a falar com o bot a qualquer momento, digita #sair)*' });
            break;
        default:
            await sock.sendMessage(jid, { text: 'Desculpa, opção inválida. Por favor, escolhe um número de 1 a 6.' });
            await sendMenu(sock, jid);
            break;
    }
}

module.exports = { handleMessage };