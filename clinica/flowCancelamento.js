const { prisma } = require('../../db');
const { format } = require('date-fns');
const whatsappService = require('../../whatsappService');
const automationEngine = require('../../services/automationEngine');
const webhookService = require('../../services/webhookService');
const { processarAgendamento } = require('./flowAgendamento');

async function processarCancelamento(jid, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, isRemarcacao = false, cliente, isNewPatient) {
    let userState = stateMachine.get(senderNumber) || { step: 'IDLE', entities: {} };
    const intent = nlpResult.intent;
    const entities = nlpResult.entities || {};
    const isEnglish = configDb?.idioma?.includes('Inglês');

    if (userState.step === 'IDLE') userState.step = 'CANCELAMENTO_AWAITING_SELECTION';
    
    if (intent === 'REJECT_APPOINTMENT') {
        stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
        const msg = isEnglish ? 'Alright, the operation was aborted. How else can I help today?' : 'Tudo bem, a operação foi abortada. Como mais posso ajudar hoje?';
        await whatsappService.sendText(jid, msg);
        return;
    }

    if (intent === 'CANCEL_APPOINTMENT' && entities.appointment_id) userState.resolvedAppointmentId = parseInt(entities.appointment_id);
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
        const msg = isEnglish ? "You have no upcoming appointments scheduled in our system." : "Você não possui consultas futuras marcadas na nossa agenda.";
        await whatsappService.sendText(jid, msg);
        stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
        return;
    }

    if (entities.treatment && agendamentos.length > 1) {
        const search = String(entities.treatment).toLowerCase();
        const filtrados = agendamentos.filter(ag => ag.tratamento.nome.toLowerCase().includes(search));
        if (filtrados.length > 0) agendamentos = filtrados;
    }

    if (!userState.resolvedAppointmentId) {
        if (agendamentos.length === 1) {
            userState.resolvedAppointmentId = agendamentos[0].id;
        } else {
            let opcoes = agendamentos.slice(0, 9).map(ag => ({ id: `canc_${ag.id}`, title: ag.tratamento.nome.substring(0, 24), description: format(ag.dataHora, 'dd/MM/yyyy HH:mm') }));
            opcoes.push({ id: 'cmd_cancelar_fluxo', title: isEnglish ? 'Back / Give up' : 'Voltar / Desistir' });
            
            let textoMenu = "";
            if (isRemarcacao) {
                textoMenu = isEnglish ? "I see you have these active appointments. Which one would you like to reschedule?" : "Vi que você tem estas consultas ativas. Qual delas você gostaria de reagendar?";
            } else {
                textoMenu = isEnglish ? "I found these appointments. Which one do you want to cancel?" : "Encontrei estas consultas. Qual delas você deseja cancelar?";
            }
            
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
            
            const msg = isEnglish ? "Your previous appointment was suspended. Let's choose a new time for you now!" : "Sua consulta anterior foi suspensa na agenda. Vamos agora escolher um novo horário para você!";
            await whatsappService.sendText(jid, msg);
            
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
            
            const msg = isEnglish ? "✅ Your appointment was successfully canceled. Thank you for letting us know in advance. We hope to see you soon!" : "✅ Sua consulta foi cancelada com sucesso no sistema. Agradecemos por nos avisar com antecedência. Esperamos vê-lo em breve!";
            await whatsappService.sendText(jid, msg);
            stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
        }
    } catch (error) {
        const msg = isEnglish ? "We had an internal difficulty processing your request. Please try again later." : "Tivemos uma dificuldade interna ao processar seu pedido. Tente novamente mais tarde.";
        await whatsappService.sendText(jid, msg);
        stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
    }
}

module.exports = { processarCancelamento };