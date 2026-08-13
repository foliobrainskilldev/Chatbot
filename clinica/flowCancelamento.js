const { prisma } = require('../db');
const { format } = require('date-fns');
const whatsappService = require('../whatsappService');
const automationEngine = require('../services/automationEngine');
const webhookService = require('../services/webhookService');
const aiService = require('../aiService');
const { processarAgendamento } = require('./flowAgendamento');

async function processarCancelamento(jid, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, isRemarcacao = false, cliente, isNewPatient) {
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
        const contextoFake = { paciente_nome: cliente.nome, paciente_novo: isNewPatient, dados_crm: { aviso: "O paciente não possui consultas futuras pendentes." } };
        const msgAusencia = "Avise gentilmente o paciente que ele não possui consultas futuras pendentes cadastradas no sistema. NUNCA use saudações como 'Bom dia/Olá', vá direto ao ponto e não repita o nome do paciente para não soar artificial.";
        
        const resp = await aiService.gerarRespostaNatural(msgAusencia, [], contextoFake, configDb);
        await whatsappService.sendText(jid, resp);
        stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
        return;
    }

    if (userState.entities && agendamentos.length > 1) {
        if (userState.entities.treatment) {
            const search = userState.entities.treatment.toLowerCase();
            const filtrados = agendamentos.filter(ag => ag.tratamento.nome.toLowerCase().includes(search));
            if (filtrados.length > 0) agendamentos = filtrados;
        }
    }

    if (!userState.resolvedAppointmentId) {
        if (isInteractive && textoProcessado.startsWith('canc_')) {
            userState.resolvedAppointmentId = parseInt(textoProcessado.replace('canc_', ''));
        } else if (agendamentos.length === 1) {
            userState.resolvedAppointmentId = agendamentos[0].id;
        } else {
            let opcoes = agendamentos.slice(0, 9).map(ag => ({ id: `canc_${ag.id}`, title: ag.tratamento.nome.substring(0, 24), description: format(ag.dataHora, 'dd/MM/yyyy HH:mm') }));
            opcoes.push({ id: '0', title: 'Voltar ao Menu' });
            const textoMenu = isRemarcacao ? "Encontrei estas consultas ativas. Qual delas você precisa reagendar?" : "Encontrei estas consultas. Qual delas deseja cancelar?";
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
            
            const promptRemarcacao = "Avise que a consulta antiga foi suspensa e que agora vocês vão escolher juntos um novo horário. IMPORTANTE: Vá direto ao ponto, NÃO use saudações iniciais (Bom dia/Olá) e evite repetir o nome do paciente.";
            const resp = await aiService.gerarRespostaNatural(promptRemarcacao, [], contextoIA, configDb);
            await whatsappService.sendText(jid, resp);
            
            stateMachine.set(senderNumber, { 
                step: 'AGENDAMENTO', 
                intent: 'appointment.create', 
                entities: { treatment: agAtualizado.tratamento.nome }, 
                resolvedTreatment: agAtualizado.tratamento 
            });
            return processarAgendamento(jid, null, senderNumber, stateMachine, { intent: 'appointment.create' }, false, configDb, cliente, isNewPatient);
        } else {
            await automationEngine.dispararAutomacoes('CONSULTA_CANCELADA', agAtualizado);
            await webhookService.dispararEvento('appointment.cancelled', agAtualizado);
            
            const promptCancelamento = "Confirme que a consulta foi efetivamente cancelada na agenda do sistema baseando-se no JSON do CRM. IMPORTANTE: Vá direto ao ponto, NÃO use saudações iniciais (Bom dia/Olá) e evite repetir o nome do paciente.";
            const resp = await aiService.gerarRespostaNatural(promptCancelamento, [], contextoIA, configDb);
            await whatsappService.sendText(jid, resp);
            stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
        }
    } catch (error) {
        await whatsappService.sendText(jid, "Tivemos uma dificuldade interna ao processar seu pedido. Tente novamente mais tarde.");
        stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
    }
}

module.exports = { processarCancelamento };