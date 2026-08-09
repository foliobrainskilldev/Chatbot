const { prisma } = require('../db');
const { format } = require('date-fns');
const whatsappService = require('../whatsappService');

async function iniciarCancelamento(jid, senderNumber, stateMachine, STEPS) {
    const agendamentos = await prisma.agendamento.findMany({
        where: { 
            clienteId: senderNumber, 
            status: 'AGENDADO', 
            dataHora: { gte: new Date() },
            servicoId: { not: null } // ISOLAMENTO: Apenas Barbearia
        },
        include: { servico: true },
        orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        await whatsappService.sendText(jid, "Você não possui horários pendentes em nossa Barbearia.");
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        return;
    }

    let opcoes = agendamentos.map((ag) => ({
        id: `canc_${ag.id}`, 
        title: ag.servico.nome.substring(0, 24), 
        description: format(ag.dataHora, 'dd/MM/yyyy HH:mm')
    }));
    opcoes.push({ id: '0', title: 'Voltar ao Menu' });

    stateMachine.set(senderNumber, { step: STEPS.CANCELAR_AGENDAMENTO, data: { agendamentos } });
    await whatsappService.sendInteractiveMenu(jid, "Qual destes horários deseja cancelar?", opcoes);
}

async function processarCancelamento(jid, textMessage, senderNumber, stateMachine, STEPS) {
    const escolha = textMessage.trim();

    if (escolha === '0') {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await whatsappService.sendText(jid, 'Cancelamento abortado.');
        return;
    }

    if (!escolha.startsWith('canc_')) return await whatsappService.sendText(jid, '⚠️ Opção inválida.');

    const agendamentoId = parseInt(escolha.replace('canc_', ''));
    
    try {
        await prisma.agendamento.update({ 
            where: { id: agendamentoId }, 
            data: { status: 'CANCELADO' } 
        });
        await whatsappService.sendText(jid, "✅ O seu horário foi cancelado com sucesso.");
    } catch (error) {
        await whatsappService.sendText(jid, "Erro ao cancelar. Tente novamente.");
    } finally {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
    }
}

module.exports = { iniciarCancelamento, processarCancelamento };