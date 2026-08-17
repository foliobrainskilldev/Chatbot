// barbearia/flowCancelamento.js
const { prisma } = require('../db');
const { format } = require('date-fns');
const whatsappService = require('../whatsappService');
const { processarAgendamento } = require('./flowAgendamento');

async function processarCancelamento(jid, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, isRemarcacao = false, cliente, isNewPatient) {
    let userState = stateMachine.get(senderNumber) || { step: 'IDLE', entities: {} };
    const intent = nlpResult.intent;
    const entities = nlpResult.entities || {};

    if (userState.step === 'IDLE') {
        userState.step = 'CANCELAMENTO_AWAITING_SELECTION';
    }
    
    if (intent === 'REJECT_APPOINTMENT') {
        stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
        await whatsappService.sendText(jid, 'Tudo bem, a operação foi abortada.');
        return;
    }

    if (intent === 'CANCEL_APPOINTMENT' && entities.appointment_id) userState.resolvedAppointmentId = parseInt(entities.appointment_id);

    let agendamentos = await prisma.agendamento.findMany({
        where: { clienteId: senderNumber, status: { in: ['AGENDADO', 'CONFIRMADA'] }, dataHora: { gte: new Date() }, servicoId: { not: null } },
        include: { servico: true },
        orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        await whatsappService.sendText(jid, "Você não possui horários pendentes em nossa Barbearia.");
        stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
        return;
    }

    if (!userState.resolvedAppointmentId) {
        if (agendamentos.length === 1) {
            userState.resolvedAppointmentId = agendamentos[0].id;
        } else {
            let opcoes = agendamentos.slice(0, 2).map(ag => ({ id: `canc_${ag.id}`, title: ag.servico.nome.substring(0, 24), description: format(ag.dataHora, 'dd/MM/yyyy HH:mm') }));
            opcoes.push({ id: 'cmd_cancelar_fluxo', title: 'Voltar / Desistir' });
            await whatsappService.sendInteractiveMenu(jid, "Encontrei estas reservas. Qual delas você deseja cancelar?", opcoes);
            stateMachine.set(senderNumber, userState);
            return;
        }
    }

    try {
        await prisma.agendamento.update({ 
            where: { id: userState.resolvedAppointmentId }, 
            data: { status: 'CANCELADO' }
        });
        
        await whatsappService.sendText(jid, "✅ O seu horário foi cancelado com sucesso no sistema. Agradecemos por nos avisar!");
        stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
    } catch (error) {
        await whatsappService.sendText(jid, "Tivemos uma dificuldade interna ao processar seu pedido. Tente novamente mais tarde.");
        stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
    }
}

module.exports = { processarCancelamento };