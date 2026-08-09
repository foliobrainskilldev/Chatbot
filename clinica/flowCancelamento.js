const { prisma } = require('../db');
const { format } = require('date-fns');
const whatsappService = require('../whatsappService');

async function iniciarCancelamentoClinica(jid, senderNumber, stateMachine, STEPS) {
    const agendamentos = await prisma.agendamento.findMany({
        where: { 
            clienteId: senderNumber, 
            status: 'AGENDADO', 
            dataHora: { gte: new Date() },
            tratamentoId: { not: null } // ISOLAMENTO: Apenas Clínica
        },
        include: { tratamento: true },
        orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        await whatsappService.sendText(jid, "Você não possui consultas médicas pendentes no sistema.");
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        return;
    }

    let opcoes = agendamentos.map((ag) => ({
        id: `canc_${ag.id}`, 
        title: ag.tratamento.nome.substring(0, 24), 
        description: format(ag.dataHora, 'dd/MM/yyyy HH:mm')
    }));
    opcoes.push({ id: '0', title: 'Voltar ao Menu' });

    stateMachine.set(senderNumber, { step: STEPS.CANCELAR_CONSULTA, data: { agendamentos } });
    await whatsappService.sendInteractiveMenu(jid, "Qual destas consultas deseja cancelar?", opcoes);
}

async function processarCancelamentoClinica(jid, textMessage, senderNumber, stateMachine, STEPS) {
    const escolha = textMessage.trim();

    if (escolha === '0') {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await whatsappService.sendText(jid, 'Operação abortada.');
        return;
    }

    if (!escolha.startsWith('canc_')) return await whatsappService.sendText(jid, '⚠️ Opção inválida.');

    const agendamentoId = parseInt(escolha.replace('canc_', ''));
    
    try {
        await prisma.agendamento.update({ 
            where: { id: agendamentoId }, 
            data: { status: 'CANCELADO' } 
        });
        await whatsappService.sendText(jid, "✅ Sua consulta foi desmarcada com sucesso. Agradecemos por avisar.");
    } catch (error) {
        await whatsappService.sendText(jid, "Erro ao desmarcar consulta. Tente novamente.");
    } finally {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
    }
}

module.exports = { iniciarCancelamentoClinica, processarCancelamentoClinica };