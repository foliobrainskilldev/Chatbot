const { prisma } = require('../db');
const { format } = require('date-fns');
const whatsappService = require('../whatsappService');
const automationEngine = require('../services/automationEngine');
const webhookService = require('../services/webhookService');
const aiService = require('../aiService');
const { processarAgendamento } = require('./flowAgendamento');

async function processarCancelamento(jid, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, isRemarcacao = false) {
    let userState = stateMachine.get(senderNumber) || { step: 'CANCELAMENTO', intent: isRemarcacao ? 'appointment.reschedule' : 'appointment.cancel', entities: {} };
    userState.step = 'CANCELAMENTO';
    
    if (textoProcessado === '0') {
        stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
        await whatsappService.sendText(jid, 'A operação de cancelamento/remarcação foi abortada.');
        return;
    }

    let agendamentos = await prisma.agendamento.findMany({
        where: { clienteId: senderNumber, status: { in: ['AGENDADO', 'CONFIRMADA'] }, dataHora: { gte: new Date() }, tratamentoId: { not: null } },
        include: { tratamento: true },
        orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        const resp = await aiService.gerarRespostaNatural("Avise gentilmente o paciente que ele não possui consultas futuras pendentes cadastradas no sistema.", [], {}, configDb);
        await whatsappService.sendText(jid, resp);
        stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
        return;
    }

    // NOVO: Filtra usando as entidades do NLP (Ex: Se o paciente disse "cancelar a limpeza")
    if (userState.entities && agendamentos.length > 1) {
        if (userState.entities.treatment) {
            const search = userState.entities.treatment.toLowerCase();
            const filtrados = agendamentos.filter(ag => ag.tratamento.nome.toLowerCase().includes(search));
            if (filtrados.length > 0) agendamentos = filtrados;
        }
    }

    // SLOT: Seleção da consulta alvo
    if (!userState.resolvedAppointmentId) {
        if (isInteractive && textoProcessado.startsWith('canc_')) {
            userState.resolvedAppointmentId = parseInt(textoProcessado.replace('canc_', ''));
        } else if (agendamentos.length === 1) {
            // Preenchimento Automático se houver apenas uma consulta (ou se o NLP filtrou para 1)
            userState.resolvedAppointmentId = agendamentos[0].id;
        } else {
            let opcoes = agendamentos.slice(0, 9).map(ag => ({ id: `canc_${ag.id}`, title: ag.tratamento.nome.substring(0, 24), description: format(ag.dataHora, 'dd/MM/yyyy HH:mm') }));
            opcoes.push({ id: '0', title: 'Voltar ao Menu' });
            const textoMenu = isRemarcacao ? "Encontrei estas consultas. Qual delas você precisa reagendar?" : "Encontrei estas consultas. Qual delas deseja cancelar?";
            await whatsappService.sendInteractiveMenu(jid, textoMenu, opcoes);
            stateMachine.set(senderNumber, userState);
            return;
        }
    }

    // AÇÃO EXECUTADA PELO BACKEND
    try {
        const agAtualizado = await prisma.agendamento.update({ 
            where: { id: userState.resolvedAppointmentId }, 
            data: { status: isRemarcacao ? 'REMARCADA' : 'CANCELADA' },
            include: { cliente: true, tratamento: true, profissionalSaude: true }
        });
        
        if (isRemarcacao) {
            await automationEngine.dispararAutomacoes('CONSULTA_REMARCADA', agAtualizado);
            await webhookService.dispararEvento('appointment.updated', agAtualizado);
            
            const resp = await aiService.gerarRespostaNatural("Avise que a consulta antiga foi suspensa e que agora vocês vão escolher juntos um novo horário.", [], {}, configDb);
            await whatsappService.sendText(jid, resp);
            
            // Troca o StateMachine para o Modo Agendamento, forçando a mesma especialidade
            stateMachine.set(senderNumber, { 
                step: 'AGENDAMENTO', 
                intent: 'appointment.create', 
                entities: { treatment: agAtualizado.tratamento.nome }, 
                resolvedTreatment: agAtualizado.tratamento 
            });
            return processarAgendamento(jid, null, senderNumber, stateMachine, { intent: 'appointment.create' }, false, configDb);
        } else {
            await automationEngine.dispararAutomacoes('CONSULTA_CANCELADA', agAtualizado);
            await webhookService.dispararEvento('appointment.cancelled', agAtualizado);
            
            const resp = await aiService.gerarRespostaNatural("Confirme que a consulta foi efetivamente cancelada na agenda do sistema.", [], { consulta_cancelada: agAtualizado }, configDb);
            await whatsappService.sendText(jid, resp);
            stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
        }
    } catch (error) {
        await whatsappService.sendText(jid, "Tivemos uma dificuldade interna ao processar seu pedido. Tente novamente mais tarde.");
        stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
    }
}

module.exports = { processarCancelamento };