// clinica/flowCancelamento.js
const { prisma } = require('../db');
const { format } = require('date-fns');
const whatsappService = require('../whatsappService');
const automationEngine = require('../services/automationEngine');
const webhookService = require('../services/webhookService');
const aiService = require('../aiService');
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
        await whatsappService.sendText(jid, 'Tudo bem, a operação foi interrompida. Como mais posso ajudar hoje?');
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
        const contextoFake = { paciente_nome: cliente.nome, paciente_novo: isNewPatient, dados_crm: { aviso: "O paciente não possui consultas futuras pendentes no sistema." } };
        const msgAusencia = "Alerte de forma leve que o paciente não tem consultas marcadas em aberto na agenda. NUNCA use saudações, vá direto ao ponto.";
        
        const resp = await aiService.gerarRespostaNatural(msgAusencia, [], contextoFake, configDb);
        await whatsappService.sendText(jid, resp);
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
        
        const contextoIA = {
            paciente_nome: cliente.nome,
            paciente_novo: isNewPatient,
            dados_crm: { consulta_alterada: agAtualizado }
        };

        if (isRemarcacao) {
            await automationEngine.dispararAutomacoes('CONSULTA_REMARCADA', agAtualizado);
            await webhookService.dispararEvento('appointment.updated', agAtualizado);
            
            const promptRemarcacao = "Avise o paciente que a consulta antiga foi suspensa. E diga que agora vocês vão escolher um novo horário juntos. NUNCA use saudações. Seja direto e amigável.";
            const resp = await aiService.gerarRespostaNatural(promptRemarcacao, [], contextoIA, configDb);
            await whatsappService.sendText(jid, resp);
            
            stateMachine.set(senderNumber, { 
                step: 'AGENDAMENTO_COLLECTING_DATE', 
                entities: { treatment: agAtualizado.tratamento.nome }, 
                resolvedTreatment: agAtualizado.tratamento,
                pageData: 0,
                pageHora: 0
            });
            return processarAgendamento(jid, null, senderNumber, stateMachine, { intent: 'UNKNOWN' }, false, configDb, cliente, isNewPatient);
        } else {
            await automationEngine.dispararAutomacoes('CONSULTA_CANCELADA', agAtualizado);
            await webhookService.dispararEvento('appointment.cancelled', agAtualizado);
            
            const promptCancelamento = "Confirme gentilmente que a consulta foi cancelada na agenda. Diga que esperamos vê-lo no futuro. Vá direto ao ponto e NÃO use saudações.";
            const resp = await aiService.gerarRespostaNatural(promptCancelamento, [], contextoIA, configDb);
            await whatsappService.sendText(jid, resp);
            stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
        }
    } catch (error) {
        await whatsappService.sendText(jid, "Tivemos uma dificuldade interna ao processar seu pedido. Tente novamente mais tarde.");
        stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
    }
}

module.exports = { processarCancelamento };