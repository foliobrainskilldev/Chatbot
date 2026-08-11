const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const { getHorariosDisponiveis, getProximosDiasUteis } = require('../dateUtils');
const { parse } = require('date-fns');
const aiService = require('../aiService');
const automationEngine = require('../services/automationEngine');
const webhookService = require('../services/webhookService');

async function processarAgendamento(jid, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb) {
    let userState = stateMachine.get(senderNumber) || { step: 'IDLE', intent: 'appointment.create', entities: {} };
    userState.step = 'AGENDAMENTO';
    
    if (textoProcessado === '0') {
        stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
        await whatsappService.sendText(jid, 'O processo de agendamento foi cancelado.');
        return;
    }

    // VERIFICAÇÃO DE LIMITE DE AGENDAMENTOS
    const agendamentosPendentes = await prisma.agendamento.count({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }
    });
    if (agendamentosPendentes >= (configDb.agendamentoLimiteSimultaneo || 2)) {
        await whatsappService.sendText(jid, 'Você já atingiu o limite de consultas pendentes ativas. Aguarde as atuais ou cancele alguma para prosseguir.');
        stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
        return;
    }
    
    // SLOT 1: TRATAMENTO
    if (!userState.resolvedTreatment) {
        if (isInteractive && textoProcessado.startsWith('trat_')) {
            const idTrat = parseInt(textoProcessado.replace('trat_', ''));
            userState.resolvedTreatment = await prisma.tratamento.findUnique({ where: { id: idTrat }, include: { profissionais: true } });
        } else if (userState.entities.treatment) {
            const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO', podeAgendarIA: true }});
            const search = userState.entities.treatment.toLowerCase();
            const match = tratamentos.find(t => t.nome.toLowerCase().includes(search));
            if (match) {
                userState.resolvedTreatment = await prisma.tratamento.findUnique({ where: { id: match.id }, include: { profissionais: true } });
            }
        }
        
        if (!userState.resolvedTreatment) {
            const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO', podeAgendarIA: true }});
            if (tratamentos.length === 0) {
                await whatsappService.sendText(jid, 'Nossa agenda online está temporariamente fechada para novos procedimentos. Fale com a recepção.');
                stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
                return;
            }
            let optTratamentos = tratamentos.slice(0, 9).map(t => ({ id: `trat_${t.id}`, title: t.nome.substring(0, 24) }));
            optTratamentos.push({ id: '0', title: 'Cancelar' });
            
            await whatsappService.sendInteractiveMenu(jid, "Para qual especialidade ou tratamento você deseja marcar horário?", optTratamentos);
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // SLOT 2: DATA
    if (!userState.resolvedDate) {
        const diasValidos = await getProximosDiasUteis(7);
        
        if (isInteractive && textoProcessado.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
            if (diasValidos.includes(textoProcessado)) userState.resolvedDate = textoProcessado;
            else await whatsappService.sendText(jid, 'Data inválida ou nossa clínica não opera nesse dia.');
        } else if (userState.entities.date) {
            if (diasValidos.includes(userState.entities.date)) {
                userState.resolvedDate = userState.entities.date;
            }
        }
        
        if (!userState.resolvedDate) {
            let optDias = diasValidos.slice(0, 9).map(d => ({ id: d, title: d }));
            optDias.push({ id: '0', title: 'Cancelar' });
            await whatsappService.sendInteractiveMenu(jid, "Certo! Para qual destas datas disponíveis você prefere?", optDias);
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // SLOT 3: HORÁRIO
    if (!userState.resolvedTime) {
        const horasLivres = await getHorariosDisponiveis(userState.resolvedDate, userState.resolvedTreatment.duracaoMin, null);
        
        if (horasLivres.length === 0) {
            userState.resolvedDate = null; 
            stateMachine.set(senderNumber, userState);
            await whatsappService.sendText(jid, 'Infelizmente nossa agenda está cheia ou sem buracos suficientes para este procedimento nesta data. Por favor, vamos tentar outro dia.');
            return processarAgendamento(jid, null, senderNumber, stateMachine, nlpResult, false, configDb);
        }
        
        if (isInteractive && textoProcessado.match(/^\d{2}:\d{2}$/)) {
            if (horasLivres.includes(textoProcessado)) userState.resolvedTime = textoProcessado;
            else await whatsappService.sendText(jid, 'Horário já foi ocupado ou está inválido. Escolha outro.');
        } else if (userState.entities.time) {
            if (horasLivres.includes(userState.entities.time)) userState.resolvedTime = userState.entities.time;
        }
        
        if (!userState.resolvedTime) {
            let optHoras = horasLivres.slice(0, 9).map(h => ({ id: h, title: h }));
            optHoras.push({ id: '0', title: 'Cancelar' });
            await whatsappService.sendInteractiveMenu(jid, `Estes são os horários livres no dia ${userState.resolvedDate}:`, optHoras);
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // CONFIRMAÇÃO FINAL
    if (!userState.confirmed) {
        if (isInteractive && textoProcessado === '1') {
            userState.confirmed = true;
        } else {
            const resumo = `Resumo da Consulta:\n\n🩺 Tratamento: ${userState.resolvedTreatment.nome}\n📅 Data: ${userState.resolvedDate} às ${userState.resolvedTime}\n\nTudo certo para agendarmos no sistema?`;
            await whatsappService.sendInteractiveMenu(jid, resumo, [{ id: '1', title: 'Confirmar Horário' }, { id: '0', title: 'Cancelar' }]);
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // AÇÃO EXECUTADA PELO BACKEND (CRIAR AGENDAMENTO)
    const dataHoraDb = parse(`${userState.resolvedDate} ${userState.resolvedTime}`, 'dd/MM/yyyy HH:mm', new Date());
    const novoAgendamento = await prisma.agendamento.create({
        data: {
            dataHora: dataHoraDb, clienteId: senderNumber, status: 'AGENDADO',
            tratamentoId: userState.resolvedTreatment.id
        },
        include: { cliente: true, tratamento: true }
    });
    
    await prisma.cliente.update({ where: { id: senderNumber }, data: { leadStatus: 'AGENDADO' } });
    
    const respostaContexto = await aiService.gerarRespostaNatural(
        "Gere uma mensagem confirmando de forma simpática que a consulta foi criada com sucesso com os detalhes que passei.",
        [],
        { agendamento_realizado: novoAgendamento },
        configDb
    );
    await whatsappService.sendText(jid, respostaContexto);
    
    // Gatilhos e Eventos
    await automationEngine.dispararAutomacoes('CONSULTA_CRIADA', novoAgendamento);
    await webhookService.dispararEvento('appointment.created', novoAgendamento);
    
    stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
}

module.exports = { processarAgendamento };