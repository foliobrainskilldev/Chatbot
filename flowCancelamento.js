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
        const pVazio = `O cliente quis cancelar um serviço, mas não tem nada marcado. Informa-o disso educadamente de forma breve.`;
        const txtVazio = await gerarMensagemNotificacao(pVazio, `Não tens nenhum agendamento futuro para cancelar no momento.`);
        await sendDelayedText(null, jid, txtVazio);
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        return;
    }

    let opcoes = agendamentos.map((ag, i) => ({
        id: String(i + 1), title: ag.servico.nome, description: format(ag.dataHora, 'dd/MM/yyyy HH:mm')
    }));
    opcoes.push({ id: '0', title: 'Voltar ao Menu' });

    stateMachine.set(senderNumber, { step: STEPS.CANCELAR_AGENDAMENTO, data: { agendamentos } });
    
    // IA GERA O TEXTO
    const pCanc = `O cliente quer cancelar uma marcação. Pede de forma gentil para ele escolher na lista qual é o horário que pretende cancelar.`;
    const txtCanc = await gerarMensagemNotificacao(pCanc, `Certo, qual destes horários pretendes cancelar?`);

    await sendInteractiveMenu(null, jid, txtCanc, opcoes);
}

async function processarCancelamento(sockIgnorado, jid, textMessage, senderNumber, stateMachine, STEPS) {
    const userState = stateMachine.get(senderNumber);
    const escolha = parseInt(textMessage.trim());

    if (textMessage.trim() === '0' || escolha === 0) {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await sendDelayedText(null, jid, 'Ação abortada. A voltar ao menu principal...');
        return;
    }

    const agendamentoAlvo = userState.data.agendamentos[escolha - 1];
    if (!agendamentoAlvo) {
        await sendDelayedText(null, jid, 'Opção inválida. Por favor, seleciona o número correspondente na lista.');
        return;
    }

    await prisma.agendamento.update({ where: { id: agendamentoAlvo.id }, data: { status: 'CANCELADO' } });

    const pFim = `O cliente cancelou o corte com sucesso. Dá a confirmação e diz que esperamos vê-lo de novo em breve.`;
    const txtFim = await gerarMensagemNotificacao(pFim, `✅ O teu agendamento foi cancelado com sucesso!`);
    await sendDelayedText(null, jid, txtFim);
    
    stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
}

module.exports = { iniciarCancelamento, processarCancelamento };