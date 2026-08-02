const { prisma } = require('./db');
const { format } = require('date-fns');
const { sendInteractiveMenu, sendDelayedText } = require('./botUtils');
const { gerarMensagemNotificacao } = require('./groqApi');

async function iniciarCancelamento(sockIgnorado, jid, senderNumber, stateMachine, STEPS) {
    const agendamentos = await prisma.agendamento.findMany({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } },
        include: { servico: true },
        orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        const txtVazio = await gerarMensagemNotificacao(`Diz APENAS: "Não tens nenhum agendamento para cancelar."`, `Não tens nenhum agendamento para cancelar.`);
        await sendDelayedText(null, jid, txtVazio);
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        return;
    }

    let opcoes = agendamentos.map((ag, i) => ({
        id: String(i + 1), title: ag.servico.nome, description: format(ag.dataHora, 'dd/MM/yyyy HH:mm')
    }));
    opcoes.push({ id: '0', title: 'Voltar ao Menu' });

    stateMachine.set(senderNumber, { step: STEPS.CANCELAR_AGENDAMENTO, data: { agendamentos } });
    const txtCanc = await gerarMensagemNotificacao(`Diz APENAS: "Qual horário pretendes cancelar?"`, `Qual horário pretendes cancelar?`);
    await sendInteractiveMenu(null, jid, txtCanc, opcoes);
}

async function processarCancelamento(sockIgnorado, jid, textMessage, senderNumber, stateMachine, STEPS) {
    const userState = stateMachine.get(senderNumber);
    const escolha = parseInt(textMessage.trim());

    if (textMessage.trim() === '0' || escolha === 0) {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await sendDelayedText(null, jid, 'Cancelamento abortado.');
        return;
    }

    const agendamentoAlvo = userState.data.agendamentos[escolha - 1];
    if (!agendamentoAlvo) {
        await sendDelayedText(null, jid, 'Opção inválida.');
        return;
    }

    await prisma.agendamento.update({ where: { id: agendamentoAlvo.id }, data: { status: 'CANCELADO' } });

    const txtFim = await gerarMensagemNotificacao(`Diz APENAS: "✅ Agendamento cancelado com sucesso!"`, `✅ Agendamento cancelado com sucesso!`);
    await sendDelayedText(null, jid, txtFim);
    stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
}

module.exports = { iniciarCancelamento, processarCancelamento };