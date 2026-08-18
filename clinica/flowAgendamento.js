const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const { getHorariosDisponiveis, getProximosDiasUteis, humanizarData } = require('../dateUtils');
const automationEngine = require('../services/automationEngine');
const webhookService = require('../services/webhookService');

function formatarMoeda(valor, moeda) {
    if (!valor) return '';
    const v = parseFloat(valor);
    if (moeda === 'R$') return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (moeda === '$') return `$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${moeda}`;
}

async function processarAgendamento(jid, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, cliente, isNewPatient) {
    let userState = stateMachine.get(senderNumber) || { step: 'IDLE', entities: {} };
    const intent = nlpResult.intent;
    const entities = nlpResult.entities || {};

    // 0. CANCELAMENTOS E RETROCESSOS DO FUNIL
    if (intent === 'REJECT_APPOINTMENT') {
        stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
        await whatsappService.sendText(jid, 'Sem problemas. O processo de agendamento foi cancelado. Posso ajudar em mais alguma coisa?');
        return;
    }
    
    if (intent === 'CHANGE_TREATMENT') {
        userState.resolvedTreatment = null; userState.resolvedDate = null; userState.resolvedTime = null;
        userState.entities.treatment = null; userState.step = 'AGENDAMENTO_COLLECTING_TREATMENT';
    } else if (intent === 'CHANGE_DATE') {
        userState.resolvedDate = null; userState.resolvedTime = null;
        userState.entities.date = null; userState.step = 'AGENDAMENTO_COLLECTING_DATE';
    } else if (intent === 'CHANGE_TIME') {
        userState.resolvedTime = null; userState.entities.time = null;
        userState.step = 'AGENDAMENTO_AWAITING_TIME';
    }

    if (userState.step === 'IDLE' || userState.step === 'CANCELAMENTO_AWAITING_SELECTION') {
        userState = {
            step: 'AGENDAMENTO_COLLECTING_TREATMENT',
            entities: {},
            timeFilter: null,
            availableTimes: null,
            timeIndex: 0,
            pageData: 0,
            resolvedTreatment: null,
            resolvedDate: null,
            resolvedTime: null
        };
    }

    userState.entities = { ...userState.entities, ...entities };

    // EXTRAÇÃO MANUAL DE FILTRO CASO A NLP FALHE
    let extractedTime = entities.time;
    let extractedModifier = entities.time_modifier;

    if (intent === 'REQUEST_SPECIFIC_TIME' && !extractedTime) {
        const timeMatch = textoProcessado.match(/(?:depois|após) das (\d{1,2})/i);
        if (timeMatch) { extractedTime = `${timeMatch[1].padStart(2, '0')}:00`; extractedModifier = 'after'; }
        
        const timeStartingMatch = textoProcessado.match(/(?:a partir) das (\d{1,2})/i);
        if (timeStartingMatch) { extractedTime = `${timeStartingMatch[1].padStart(2, '0')}:00`; extractedModifier = 'starting'; }
        
        const timeBeforeMatch = textoProcessado.match(/(?:antes) das (\d{1,2})/i);
        if (timeBeforeMatch) { extractedTime = `${timeBeforeMatch[1].padStart(2, '0')}:00`; extractedModifier = 'before'; }
    }

    // SALVA FILTRO NA MEMÓRIA MESMO SEM TER TRATAMENTO AINDA
    if (extractedTime && (intent === 'REQUEST_SPECIFIC_TIME' || intent === 'SELECT_TIME' || intent === 'BOOK_APPOINTMENT')) {
        userState.timeFilter = { time: extractedTime, modifier: extractedModifier || 'exact' };
        userState.availableTimes = null; 
        userState.timeIndex = 0;
        userState.resolvedTime = null;
    }

    if (intent === 'SELECT_TREATMENT' && entities.treatment_id) userState.resolvedTreatment = await prisma.tratamento.findUnique({ where: { id: parseInt(entities.treatment_id) }});
    if (intent === 'SELECT_DATE' && entities.date) userState.resolvedDate = entities.date;
    if (intent === 'SELECT_TIME' && entities.time) userState.resolvedTime = entities.time;

    // 1. EXTRAÇÃO DO TRATAMENTO
    if (!userState.resolvedTreatment) {
        let searchedButNotFound = false;
        if (entities.treatment) {
            const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO', podeAgendarIA: true }});
            const search = entities.treatment.toLowerCase();
            const match = tratamentos.find(t => t.nome.toLowerCase().includes(search));
            if (match) userState.resolvedTreatment = match;
            else searchedButNotFound = true;
        }
        
        if (!userState.resolvedTreatment) {
            const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO', podeAgendarIA: true }});
            if (tratamentos.length === 0) {
                await whatsappService.sendText(jid, 'Nossa agenda online está fechada para novos procedimentos. Vou transferir você para a recepção.');
                stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
                return;
            }
            
            let introText = "Temos vários tratamentos disponíveis. Escolha uma categoria para continuar:";
            if (searchedButNotFound) {
                introText = `Não encontrei o tratamento "${entities.treatment}". Por favor, escolha uma das opções abaixo:`;
            } else if (userState.timeFilter || intent === 'REQUEST_SPECIFIC_TIME') {
                introText = "Claro, posso verificar os horários disponíveis para você! Mas como cada procedimento tem um tempo de duração diferente, preciso saber primeiro: qual tratamento você gostaria de agendar?";
            } else if (entities.date || intent === 'SELECT_DATE') {
                introText = `Posso olhar a agenda para essa data com certeza! Qual tratamento você gostaria de realizar?`;
            } else if (userState.step === 'AGENDAMENTO_COLLECTING_TREATMENT') {
                introText = `Para que eu possa consultar a agenda, só preciso que me diga qual o tratamento desejado. Pode digitar o nome ou escolher na lista:`;
            }

            const moedaGlobal = configDb?.moeda || 'MT';
            const rows = tratamentos.slice(0, 10).map(t => ({ 
                id: `trat_${t.id}`, title: t.nome.substring(0, 24), description: t.preco ? `Valor: ${formatarMoeda(t.preco, moedaGlobal)}` : 'Consulte valor' 
            }));
            
            await whatsappService.sendInteractiveList(jid, introText, "Ver opções", [{ title: "Especialidades", rows: rows }]);
            userState.step = 'AGENDAMENTO_COLLECTING_TREATMENT';
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // 2. EXTRAÇÃO DA DATA
    if (!userState.resolvedDate) {
        const diasValidos = await getProximosDiasUteis(14); 

        if (intent === 'REQUEST_MORE_DATES') userState.pageData++;
        else if (entities.date) {
            const matchDia = diasValidos.find(d => d === entities.date || d.includes(entities.date));
            if (matchDia) userState.resolvedDate = matchDia;
            else await whatsappService.sendText(jid, `A agenda para a data solicitada (${entities.date}) está indisponível. Vamos ver as próximas opções.`);
        }
        
        if (!userState.resolvedDate) {
            const start = userState.pageData * 2;
            const chunk = diasValidos.slice(start, start + 2);
            const hasMore = start + 2 < diasValidos.length;

            if (chunk.length === 0) {
                userState.pageData = 0; 
                return processarAgendamento(jid, null, senderNumber, stateMachine, {intent: 'UNKNOWN'}, false, configDb, cliente, isNewPatient);
            }

            let saudacao = userState.pageData === 0 
                ? `Vou verificar os horários para ${userState.resolvedTreatment.nome}.\n\nTenho estes dias mais próximos disponíveis:`
                : `Aqui estão mais opções de dias:`;
                
            if (userState.timeFilter && userState.pageData === 0) {
                saudacao = `Para verificar a disponibilidade a partir das ${userState.timeFilter.time}, preciso saber o dia. Para quando seria?`;
            }

            let optDias = chunk.map(d => ({ id: `data_${d}`, title: humanizarData(d).curto }));
            if (hasMore) optDias.push({ id: 'ver_mais_data', title: 'Ver mais datas' });

            await whatsappService.sendInteractiveMenu(jid, saudacao, optDias);
            userState.step = 'AGENDAMENTO_COLLECTING_DATE';
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // 3. EXTRAÇÃO DA HORA E FILTRAGEM
    if (!userState.resolvedTime) {
        
        const dateH = humanizarData(userState.resolvedDate); // Datas humanizadas
        
        if (!userState.availableTimes) {
            const horasLivres = await getHorariosDisponiveis(userState.resolvedDate, userState.resolvedTreatment.duracaoMin, null);
            let filtradas = [...horasLivres];
            
            if (userState.timeFilter && userState.timeFilter.time) {
                const reqTime = userState.timeFilter.time;
                if (userState.timeFilter.modifier === 'after') filtradas = filtradas.filter(h => h > reqTime);
                else if (userState.timeFilter.modifier === 'starting') filtradas = filtradas.filter(h => h >= reqTime);
                else if (userState.timeFilter.modifier === 'before') filtradas = filtradas.filter(h => h < reqTime);
            }
            userState.availableTimes = filtradas;
            userState.timeIndex = 0;
        }

        if (intent === 'SELECT_TIME' && extractedTime) {
            if (userState.availableTimes.includes(extractedTime)) {
                userState.resolvedTime = extractedTime;
            } else {
                await whatsappService.sendText(jid, `Infelizmente não encontrei esse horário livre. Veja o que tenho disponível:`);
                userState.entities.time = null;
            }
        }

        if (intent === 'REQUEST_MORE_TIMES') {
            if (userState.timeIndex >= userState.availableTimes.length) {
                await whatsappService.sendText(jid, `Estes são os últimos horários disponíveis para esse dia. Qual deles você prefere?`);
                return; 
            }
        }

        if (!userState.resolvedTime) {
            if (userState.availableTimes.length === 0) {
                await whatsappService.sendText(jid, `Para esse critério que você pediu, não encontrei vagas para ${dateH.curto}.`);
                userState.timeFilter = null; 
                userState.availableTimes = null; 
                userState.step = 'AGENDAMENTO_COLLECTING_DATE';
                return processarAgendamento(jid, null, senderNumber, stateMachine, {intent: 'UNKNOWN'}, false, configDb, cliente, isNewPatient);
            }

            const chunk = userState.availableTimes.slice(userState.timeIndex, userState.timeIndex + 2);
            const hasMore = (userState.timeIndex + 2) < userState.availableTimes.length;

            let optHoras = chunk.map(h => ({ id: `hora_${h}`, title: h }));
            if (hasMore) optHoras.push({ id: 'ver_mais_hora', title: 'Ver mais horários' });

            let textoApresentacao = "";
            if (userState.timeIndex === 0) {
                if (userState.timeFilter) textoApresentacao = `Sim, para ${dateH.curto}, encontrei estas vagas que atendem ao seu horário:`;
                else textoApresentacao = `Encontrei estes horários livres para ${dateH.curto}:`;
            } else {
                if (!hasMore) textoApresentacao = `Estes são os últimos horários disponíveis para esse dia. Qual prefere?`;
                else textoApresentacao = `Claro. Além desses, também tenho:`;
            }

            await whatsappService.sendInteractiveMenu(jid, textoApresentacao, optHoras);
            
            userState.timeIndex += 2; 
            userState.step = 'AGENDAMENTO_AWAITING_TIME';
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // 4. CONFIRMAÇÃO EXATA (Resumo Humanizado)
    if (userState.step !== 'AGENDAMENTO_AWAITING_CONFIRMATION') {
        const dateH = humanizarData(userState.resolvedDate);
        const resumo = `Perfeito. Só confirmando antes de reservar:\n\n🩺 ${userState.resolvedTreatment.nome}\n📅 ${dateH.longo}\n🕐 ${userState.resolvedTime}\n\nPosso confirmar esse horário para você?`;
        await whatsappService.sendInteractiveMenu(jid, resumo, [
            { id: 'cmd_confirmar_reserva', title: 'Confirmar' }, 
            { id: 'cmd_cancelar_fluxo', title: 'Escolher outro' }
        ]);
        userState.step = 'AGENDAMENTO_AWAITING_CONFIRMATION';
        stateMachine.set(senderNumber, userState);
        return;
    }
    
    // 5. AÇÃO FINALIZADA DE FORMA DETERMINÍSTICA
    if (intent === 'CONFIRM_APPOINTMENT') {
        const [dia, mes, ano] = userState.resolvedDate.split('/');
        const [hora, min] = userState.resolvedTime.split(':');
        const fusoOffset = configDb?.fusoHorario === 'America/Sao_Paulo' ? '-03:00' : '+02:00';
        const dataHoraDb = new Date(`${ano}-${mes}-${dia}T${hora}:${min}:00${fusoOffset}`);

        const horasLivresNow = await getHorariosDisponiveis(userState.resolvedDate, userState.resolvedTreatment.duracaoMin, null);
        if(!horasLivresNow.includes(userState.resolvedTime)) {
             await whatsappService.sendText(jid, `Ops, alguém acabou de ocupar esse horário. Vamos escolher outro.`);
             userState.resolvedTime = null;
             userState.step = 'AGENDAMENTO_AWAITING_TIME';
             stateMachine.set(senderNumber, userState);
             return processarAgendamento(jid, null, senderNumber, stateMachine, {intent: 'UNKNOWN'}, false, configDb, cliente, isNewPatient);
        }

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
        
        const dateH = humanizarData(userState.resolvedDate);
        const msgSucesso = `✅ *Consulta Confirmada!*\n\nSua consulta de *${userState.resolvedTreatment.nome}* está agendada para *${dateH.longo}* às *${userState.resolvedTime}*.\n\nEsperamos por você! Se precisar reagendar ou tiver alguma dúvida, basta enviar uma mensagem.`;
        
        await whatsappService.sendText(jid, msgSucesso);
        await prisma.mensagemIA.create({ data: { role: 'assistant', content: `[AÇÃO SISTEMA] ${msgSucesso}`, clienteId: senderNumber, atendenteHumano: false } });

        await automationEngine.dispararAutomacoes('CONSULTA_CRIADA', novoAgendamento);
        await webhookService.dispararEvento('appointment.created', novoAgendamento);
        
        stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
    } else {
        await whatsappService.sendText(jid, 'Ainda estou aguardando sua confirmação. Posso agendar esse horário ou prefere trocar?');
    }
}

module.exports = { processarAgendamento };