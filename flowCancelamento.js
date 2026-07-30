const { prisma } = require('./db');
const { format } = require('date-fns');
const { sendInteractiveMenu, sendDelayedText } = require('./botUtils');

async function iniciarCancelamento(sockIgnorado, jid, senderNumber, stateMachine, STEPS) {
    const agendamentos = await prisma.agendamento.findMany({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } },
        include: { servico: true },
        orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        await sendDelayedText(null, jid, 'Não tens agendamentos futuros para cancelar.');
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        return;
    }

    let opcoes = agendamentos.map((ag, i) => ({
        id: String(i + 1),
        title: ag.servico.nome,
        description: format(ag.dataHora, 'dd/MM/yyyy HH:mm')
    }));
    opcoes.push({ id: '0', title: 'Voltar ao Menu' });

    stateMachine.set(senderNumber, { step: STEPS.CANCELAR_AGENDAMENTO, data: { agendamentos } });
    await sendInteractiveMenu(jid, '🗑️ *Cancelar Agendamento*\nQual horário pretendes cancelar?', opcoes);
}

async function processarCancelamento(sockIgnorado, jid, textMessage, senderNumber, stateMachine, STEPS) {
    const userState = stateMachine.get(senderNumber);
    const escolha = parseInt(textMessage.trim());

    if (escolha === 0) {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await sendDelayedText(null, jid, 'Cancelamento abortado. A voltar ao menu...');
        return;
    }

    const agendamentoAlvo = userState.data.agendamentos[escolha - 1];
    if (!agendamentoAlvo) {
        await sendDelayedText(null, jid, 'Opção inválida.');
        return;
    }

    await prisma.agendamento.update({
        where: { id: agendamentoAlvo.id },
        data: { status: 'CANCELADO' }
    });

    await sendDelayedText(null, jid, '✅ O teu agendamento foi cancelado com sucesso!');
    stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
}

module.exports = { iniciarCancelamento, processarCancelamento };