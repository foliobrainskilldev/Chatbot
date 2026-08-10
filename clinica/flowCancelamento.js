const { prisma } = require('../db');
const { format } = require('date-fns');
const whatsappService = require('../whatsappService');
const { iniciarAgendamentoClinica } = require('./flowAgendamento'); // Importação circular segura

async function iniciarCancelamentoClinica(jid, senderNumber, stateMachine, STEPS, isRemarcacao = false) {
    const agendamentos = await prisma.agendamento.findMany({
        where: { 
            clienteId: senderNumber, 
            status: { in: ['AGENDADO', 'CONFIRMADA'] }, 
            dataHora: { gte: new Date() },
            tratamentoId: { not: null }
        },
        include: { tratamento: true },
        orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        await whatsappService.sendText(jid, "Você não possui consultas futuras para desmarcar ou remarcar.");
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        return;
    }

    let opcoes = agendamentos.map((ag) => ({
        id: `canc_${ag.id}`, 
        title: ag.tratamento.nome.substring(0, 24), 
        description: format(ag.dataHora, 'dd/MM/yyyy HH:mm')
    }));
    opcoes.push({ id: '0', title: 'Voltar ao Menu' });

    const passo = isRemarcacao ? STEPS.REMARCAR_CONSULTA : STEPS.CANCELAR_CONSULTA;
    stateMachine.set(senderNumber, { step: passo, data: { agendamentos } });
    
    const texto = isRemarcacao 
        ? "Para remarcar, primeiro preciso saber qual destas consultas você deseja alterar:"
        : "Qual destas consultas deseja cancelar?";
        
    await whatsappService.sendInteractiveMenu(jid, texto, opcoes);
}

async function processarCancelamentoClinica(jid, textMessage, senderNumber, stateMachine, STEPS) {
    const userState = stateMachine.get(senderNumber);
    const isRemarcacao = userState.step === STEPS.REMARCAR_CONSULTA;
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
            data: { status: isRemarcacao ? 'REMARCADA' : 'CANCELADA' } 
        });
        
        if (isRemarcacao) {
            await whatsappService.sendText(jid, "Consulta suspensa. Vamos escolher o novo horário agora.");
            // Inicia o fluxo de agendamento imediatamente
            return await iniciarAgendamentoClinica(jid, senderNumber, stateMachine, STEPS);
        } else {
            await whatsappService.sendText(jid, "✅ Sua consulta foi desmarcada com sucesso. Agradecemos por avisar.");
            stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        }
    } catch (error) {
        await whatsappService.sendText(jid, "Erro ao processar sua consulta. Tente novamente.");
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
    }
}

module.exports = { iniciarCancelamentoClinica, processarCancelamentoClinica };