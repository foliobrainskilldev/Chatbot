const { prisma } = require('./db');
const { format } = require('date-fns');

async function iniciarCancelamento(sock, jid, senderNumber, stateMachine, STEPS) {
    const agendamentos = await prisma.agendamento.findMany({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } },
        include: { servico: true },
        orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        await sock.sendMessage(jid, { text: 'Não tens agendamentos futuros para cancelar.' });
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        return;
    }

    let texto = `🗑️ *Cancelar Agendamento*\nQual horário pretendes cancelar?\n\n`;
    agendamentos.forEach((ag, i) => {
        texto += `${i + 1}️⃣ - ${ag.servico.nome} (${format(ag.dataHora, 'dd/MM/yyyy HH:mm')})\n`;
    });
    texto += `\n0️⃣ - Voltar ao Menu`;

    stateMachine.set(senderNumber, { step: STEPS.CANCELAR_AGENDAMENTO, data: { agendamentos } });
    await sock.sendMessage(jid, { text: texto });
}

async function processarCancelamento(sock, jid, textMessage, senderNumber, stateMachine, STEPS) {
    const userState = stateMachine.get(senderNumber);
    const escolha = parseInt(textMessage.trim());

    if (escolha === 0) {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await sock.sendMessage(jid, { text: 'Cancelamento abortado. A voltar ao menu principal...' });
        return;
    }

    const agendamentoAlvo = userState.data.agendamentos[escolha - 1];
    if (!agendamentoAlvo) {
        await sock.sendMessage(jid, { text: 'Opção inválida. Tenta novamente ou digita 0 para voltar.' });
        return;
    }

    await prisma.agendamento.update({
        where: { id: agendamentoAlvo.id },
        data: { status: 'CANCELADO' }
    });

    await sock.sendMessage(jid, { text: '✅ O teu agendamento foi cancelado com sucesso!\nPara remarcar, basta voltar ao Menu Principal e escolher "Agendar horário".' });
    stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
}

module.exports = { iniciarCancelamento, processarCancelamento };