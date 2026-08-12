const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const { getHorariosDisponiveis, getProximosDiasUteis } = require('../dateUtils');
const { parse } = require('date-fns');
const aiService = require('../aiService');
const automationEngine = require('../services/automationEngine');
const webhookService = require('../services/webhookService');

async function processarAgendamento(jid, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, cliente, isNewPatient) {
    let userState = stateMachine.get(senderNumber) || { step: 'IDLE', intent: 'appointment.create', entities: {} };
    userState.step = 'AGENDAMENTO';
    
    // Inicializar os controles de paginação se não existirem
    userState.pageData = userState.pageData || 0;
    userState.pageHora = userState.pageHora || 0;
    
    if (textoProcessado === '0') {
        stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
        await whatsappService.sendText(jid, 'O processo de agendamento foi cancelado.');
        return;
    }

    const agendamentosPendentes = await prisma.agendamento.count({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }
    });
    if (agendamentosPendentes >= (configDb.agendamentoLimiteSimultaneo || 2)) {
        await whatsappService.sendText(jid, 'Você já atingiu o limite de consultas ativas. Aguarde as atuais ou cancele alguma para prosseguir.');
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
            
            // Usar Lista Interativa para exibir os tratamentos (suporta até 10 itens perfeitamente)
            const rows = tratamentos.slice(0, 10).map(t => ({ 
                id: `trat_${t.id}`, 
                title: t.nome.substring(0, 24), 
                description: t.preco ? `Preço: ${t.preco}` : 'Consulte valor' 
            }));
            const sections = [{ title: "Especialidades", rows: rows }];
            
            await whatsappService.sendInteractiveList(jid, "Temos diversos tratamentos disponíveis. Toque no botão abaixo para abrir a lista e escolher a especialidade:", "Ver Tratamentos", sections);
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // SLOT 2: DATA (Com Paginação 2 botões + 1 Ver Mais)
    if (!userState.resolvedDate) {
        const diasValidos = await getProximosDiasUteis(14); // Pega 14 dias para termos margem de paginação
        
        // Interpreta os Botões/Cliques
        if (isInteractive && textoProcessado.startsWith('data_')) {
            const dataEscolhida = textoProcessado.replace('data_', '');
            if (diasValidos.includes(dataEscolhida)) userState.resolvedDate = dataEscolhida;
            else await whatsappService.sendText(jid, 'A data escolhida está inválida ou a clínica não opera nesse dia.');
        } 
        // Interpreta Textos Livres e Áudios (NLP)
        else if (userState.entities.date) {
            const matchDia = diasValidos.find(d => d === userState.entities.date || d.includes(userState.entities.date));
            if (matchDia) {
                userState.resolvedDate = matchDia;
            } else {
                await whatsappService.sendText(jid, `A data que você pediu (${userState.entities.date}) não está disponível em nossa agenda. Por favor, escolha outra:`);
                userState.entities.date = null; // Limpa para perguntar de novo
            }
        }
        
        if (!userState.resolvedDate) {
            if (textoProcessado === 'ver_mais_data') userState.pageData++;
            
            const start = userState.pageData * 2;
            const chunk = diasValidos.slice(start, start + 2);
            const hasMore = start + 2 < diasValidos.length;

            if (chunk.length === 0) {
                userState.pageData = 0; // Volta para a primeira página se acabar
                return processarAgendamento(jid, null, senderNumber, stateMachine, nlpResult, false, configDb, cliente, isNewPatient);
            }

            let optDias = chunk.map(d => ({ id: `data_${d}`, title: d }));
            if (hasMore) optDias.push({ id: 'ver_mais_data', title: 'Ver mais datas' });
            else optDias.push({ id: '0', title: 'Cancelar' });

            await whatsappService.sendInteractiveMenu(jid, "Certo! Para qual destas datas disponíveis você prefere? (Você também pode digitar/enviar áudio, ex: 'Sexta que vem')", optDias);
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // SLOT 3: HORA (Com Paginação 2 botões + 1 Ver Mais)
    if (!userState.resolvedTime) {
        const horasLivres = await getHorariosDisponiveis(userState.resolvedDate, userState.resolvedTreatment.duracaoMin, null);
        
        if (horasLivres.length === 0) {
            userState.resolvedDate = null; 
            stateMachine.set(senderNumber, userState);
            await whatsappService.sendText(jid, 'Infelizmente a agenda está cheia para esta data. Vamos escolher outro dia.');
            return processarAgendamento(jid, null, senderNumber, stateMachine, nlpResult, false, configDb, cliente, isNewPatient);
        }
        
        if (isInteractive && textoProcessado.startsWith('hora_')) {
            const horaEscolhida = textoProcessado.replace('hora_', '');
            if (horasLivres.includes(horaEscolhida)) userState.resolvedTime = horaEscolhida;
            else await whatsappService.sendText(jid, 'O horário já foi ocupado ou é inválido. Escolha outro.');
        } 
        else if (userState.entities.time) {
            const matchHora = horasLivres.find(h => h === userState.entities.time || h.includes(userState.entities.time));
            if (matchHora) {
                userState.resolvedTime = matchHora;
            } else {
                await whatsappService.sendText(jid, `Infelizmente não temos vaga exata para as ${userState.entities.time}. Veja as opções próximas:`);
                userState.entities.time = null;
            }
        }
        
        if (!userState.resolvedTime) {
            if (textoProcessado === 'ver_mais_hora') userState.pageHora++;
            
            const start = userState.pageHora * 2;
            const chunk = horasLivres.slice(start, start + 2);
            const hasMore = start + 2 < horasLivres.length;

            if (chunk.length === 0) {
                userState.pageHora = 0; // Volta para a primeira página
                return processarAgendamento(jid, null, senderNumber, stateMachine, nlpResult, false, configDb, cliente, isNewPatient);
            }

            let optHoras = chunk.map(h => ({ id: `hora_${h}`, title: h }));
            if (hasMore) optHoras.push({ id: 'ver_mais_hora', title: 'Ver mais horários' });
            else optHoras.push({ id: '0', title: 'Cancelar' });

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
    
    // BACKEND SAVE
    const dataHoraDb = parse(`${userState.resolvedDate} ${userState.resolvedTime}`, 'dd/MM/yyyy HH:mm', new Date());
    const novoAgendamento = await prisma.agendamento.create({
        data: {
            dataHora: dataHoraDb, clienteId: senderNumber, status: 'AGENDADO',
            tratamentoId: userState.resolvedTreatment.id
        },
        include: { cliente: true, tratamento: true }
    });
    
    let updateData = { leadStatus: 'AGENDADO' };
    if (cliente && (!cliente.valorPotencial || cliente.valorPotencial === 0) && userState.resolvedTreatment.preco) {
        updateData.valorPotencial = userState.resolvedTreatment.preco;
    }
    await prisma.cliente.update({ where: { id: senderNumber }, data: updateData });
    
    const contextoIA = {
        paciente_nome: cliente.nome,
        paciente_novo: isNewPatient,
        dados_crm: { agendamento_realizado: novoAgendamento }
    };

    const respostaContexto = await aiService.gerarRespostaNatural(
        "Gere uma mensagem confirmando de forma simpática que a consulta foi criada com sucesso com os detalhes que passei.",
        [],
        contextoIA,
        configDb
    );
    await whatsappService.sendText(jid, respostaContexto);
    
    await automationEngine.dispararAutomacoes('CONSULTA_CRIADA', novoAgendamento);
    await webhookService.dispararEvento('appointment.created', novoAgendamento);
    
    stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
}

module.exports = { processarAgendamento };