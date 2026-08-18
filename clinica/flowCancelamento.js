// clinica/flowCancelamento.js
const { prisma } = require('../db');
const { format } = require('date-fns');
const whatsappService = require('../whatsappService');
const automationEngine = require('../services/automationEngine');
const webhookService = require('../services/webhookService');
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
        await whatsappService.sendText(jid, 'Tudo bem, a operação foi abortada. Como mais posso ajudar hoje?');
        return;
    }

    if (intent === 'CANCEL_APPOINTMENT' && entities.appointment_id) {
        userState.resolvedAppointmentId = parseInt(entities.appointment_id);
    }
    if (intent === 'RESCHEDULE_APPOINTMENT' && entities.appointment_id) {
        userState.resolvedAppointmentId = parseInt(entities.appointment_id);
        isRemarcacao = true;
    }

    let agendamentos = await prisma.agendamento.findMany({
        where: { clienteId: senderNumber, status: { in: ['AGENDADO', 'CONFIRMADA'] }, dataHora: { gte: new Date() }, tratamentoId: { not: null } },
        include: { tratamento: true },
        orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        await whatsappService.sendText(jid, "Você não possui consultas futuras marcadas na nossa agenda.");
        stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
        return;
    }

    if (entities.treatment && agendamentos.length > 1) {
        const search = entities.treatment.toLowerCase();
        const filtrados = agendamentos.filter(ag => ag.tratamento.nome.toLowerCase().includes(search));
        if (filtrados.length > 0) agendamentos = filtrados;
    }

    if (!userState.resolvedAppointmentId) {
        if (agendamentos.length === 1) {
            userState.resolvedAppointmentId = agendamentos[0].id;
        } else {
            let opcoes = agendamentos.slice(0, 9).map(ag => ({ id: `canc_${ag.id}`, title: ag.tratamento.nome.substring(0, 24), description: format(ag.dataHora, 'dd/MM/yyyy HH:mm') }));
            opcoes.push({ id: 'cmd_cancelar_fluxo', title: 'Voltar / Desistir' });
            
            const textoMenu = isRemarcacao 
                ? "Vi que você tem estas consultas ativas. Qual delas você gostaria de reagendar?" 
                : "Encontrei estas consultas. Qual delas você deseja cancelar?";
            
            await whatsappService.sendInteractiveMenu(jid, textoMenu, opcoes);
            stateMachine.set(senderNumber, userState);
            return;
        }
    }

    try {
        const agAtualizado = await prisma.agendamento.update({ 
            where: { id: userState.resolvedAppointmentId }, 
            data: { status: isRemarcacao ? 'REMARCADA' : 'CANCELADA' },
            include: { cliente: true, tratamento: true, profissionalSaude: true }
        });
        
        if (isRemarcacao) {
            await automationEngine.dispararAutomacoes('CONSULTA_REMARCADA', agAtualizado);
            await webhookService.dispararEvento('appointment.updated', agAtualizado);
            
            // Template Fixo para Remarcação
            await whatsappService.sendText(jid, "Sua consulta anterior foi suspensa na agenda. Vamos agora escolher um novo horário para você!");
            
            stateMachine.set(senderNumber, { 
                step: 'AGENDAMENTO_COLLECTING_DATE', 
                entities: { treatment: agAtualizado.tratamento.nome }, 
                resolvedTreatment: agAtualizado.tratamento,
                pageData: 0,
                pageHora: 0
            });
            // Delega para o fluxo de agendamento puxar as novas datas
            return processarAgendamento(jid, null, senderNumber, stateMachine, { intent: 'UNKNOWN' }, false, configDb, cliente, isNewPatient);
        } else {
            await automationEngine.dispararAutomacoes('CONSULTA_CANCELADA', agAtualizado);
            await webhookService.dispararEvento('appointment.cancelled', agAtualizado);
            
            // Template Fixo para Cancelamento
            await whatsappService.sendText(jid, "✅ Sua consulta foi cancelada com sucesso no sistema. Agradecemos por nos avisar com antecedência. Esperamos vê-lo em breve!");
            stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
        }
    } catch (error) {
        await whatsappService.sendText(jid, "Tivemos uma dificuldade interna ao processar seu pedido. Tente novamente mais tarde.");
        stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
    }
}

module.exports = { processarCancelamento };