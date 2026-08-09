const { prisma } = require('./db');
const { format } = require('date-fns');
const whatsappService = require('./whatsappService');

async function iniciarCancelamento(jid, senderNumber, stateMachine, STEPS) {
    const agendamentos = await prisma.agendamento.findMany({
        where: { 
            clienteId: senderNumber, 
            status: 'AGENDADO', 
            dataHora: { gte: new Date() } 
        },
        include: { servico: true, tratamento: true },
        orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        await whatsappService.sendText(jid, "Você não possui nenhum agendamento pendente no momento.");
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        return;
    }

    // Mapeamento dinâmico suportando tanto Barbearia quanto Clínica
    let opcoes = agendamentos.map((ag) => {
        const nomeSrv = ag.servico ? ag.servico.nome : (ag.tratamento ? ag.tratamento.nome : 'Reserva');
        return {
            id: `canc_${ag.id}`, 
            title: nomeSrv.substring(0, 24), 
            description: format(ag.dataHora, 'dd/MM/yyyy HH:mm')
        };
    });
    
    opcoes.push({ id: '0', title: 'Voltar ao Menu' });

    stateMachine.set(senderNumber, { step: STEPS.CANCELAR_AGENDAMENTO, data: { agendamentos } });
    await whatsappService.sendInteractiveMenu(jid, "Qual destes horários você deseja cancelar?", opcoes);
}

async function processarCancelamento(jid, textMessage, senderNumber, stateMachine, STEPS) {
    const escolha = textMessage.trim();

    if (escolha === '0') {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await whatsappService.sendText(jid, 'Cancelamento abortado.');
        return;
    }

    if (!escolha.startsWith('canc_')) {
        await whatsappService.sendText(jid, '⚠️ Opção inválida. Escolha a opção correta nos botões ou digite 0 para abortar.');
        return;
    }

    const agendamentoId = parseInt(escolha.replace('canc_', ''));
    
    try {
        const agendamentoAlvo = await prisma.agendamento.findFirst({
            where: { id: agendamentoId, clienteId: senderNumber, status: 'AGENDADO' }
        });

        if (!agendamentoAlvo) {
            await whatsappService.sendText(jid, '⚠️ Agendamento não encontrado ou já processado.');
            stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
            return;
        }

        // Executa o cancelamento no Banco de Dados
        await prisma.agendamento.update({ 
            where: { id: agendamentoAlvo.id }, 
            data: { status: 'CANCELADO' } 
        });

        await whatsappService.sendText(jid, "✅ O seu agendamento foi cancelado com sucesso. Informamos a equipe.");
    } catch (error) {
        console.error("Erro no processamento de cancelamento:", error);
        await whatsappService.sendText(jid, "Desculpe, ocorreu um erro interno. Tente novamente mais tarde.");
    } finally {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
    }
}

module.exports = { 
    iniciarCancelamento, 
    processarCancelamento 
};