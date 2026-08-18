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

    if (intent === 'REJECT_APPOINTMENT') {
        stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
        await whatsappService.sendText(jid, 'Tudo bem! O agendamento foi cancelado. Se precisar de mais alguma coisa, me chame.');
        return;
    }

    if (intent === 'CHANGE_TREATMENT') {
        userState.resolvedService = null; userState.resolvedBarber = null; userState.resolvedDate = null; userState.resolvedTime = null;
        userState.entities.treatment = null; userState.step = 'AGENDAMENTO_COLLECTING_SERVICE';
    } else if (intent === 'CHANGE_DATE') {
        userState.resolvedDate = null; userState.resolvedTime = null;
        userState.entities.date = null; userState.step = 'AGENDAMENTO_COLLECTING_DATE';
    } else if (intent === 'CHANGE_TIME') {
        userState.resolvedTime = null; userState.entities.time = null;
        userState.step = 'AGENDAMENTO_AWAITING_TIME';
    }

    if (userState.step === 'IDLE' || userState.step === 'CANCELAMENTO_AWAITING_SELECTION') {
        userState = {
            step: 'AGENDAMENTO_COLLECTING_SERVICE',
            entities: {},
            timeFilter: null,
            availableTimes: null,
            timeIndex: 0,
            pageData: 0,
            resolvedService: null,
            resolvedBarber: null,
            resolvedDate: null,
            resolvedTime: null
        };
    }

    userState.entities = { ...userState.entities, ...entities };

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

    if (extractedTime && (intent === 'REQUEST_SPECIFIC_TIME' || intent === 'SELECT_TIME' || intent === 'BOOK_APPOINTMENT')) {
        userState.timeFilter = { time: extractedTime, modifier: extractedModifier || 'exact' };
        userState.availableTimes = null; 
        userState.timeIndex = 0;
        userState.resolvedTime = null;
    }

    if (intent === 'SELECT_TREATMENT' && entities.treatment_id) userState.resolvedService = await prisma.servico.findUnique({ where: { id: parseInt(entities.treatment_id) }});
    if (intent === 'SELECT_PROFESSIONAL' && entities.professional_id) {
        if (entities.professional_id === 'qualquer') userState.resolvedBarber = { id: null, nome: 'Qualquer Barbeiro' };
        else userState.resolvedBarber = await prisma.barbeiro.findUnique({ where: { id: parseInt(entities.professional_id) }});
    }
    if (intent === 'SELECT_DATE' && entities.date) userState.resolvedDate = entities.date;
    if (intent === 'SELECT_TIME' && entities.time) userState.resolvedTime = entities.time;

    // 1. SERVIÇO
    if (!userState.resolvedService) {
        let searchedButNotFound = false;
        if (entities.treatment) {
            const servicos = await prisma.servico.findMany();
            const search = entities.treatment.toLowerCase();
            const match = servicos.find(s => s.nome.toLowerCase().includes(search));
            if (match) userState.resolvedService = match;
            else searchedButNotFound = true;
        }
        
        if (!userState.resolvedService) {
            const servicos = await prisma.servico.findMany();
            if (servicos.length === 0) {
                await whatsappService.sendText(jid, 'Nenhum serviço disponível no momento.');
                stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
                return;
            }
            
            let introText = "Vamos agendar o seu corte! Escolha o serviço que deseja:";
            if (searchedButNotFound) introText = `Não encontrei o serviço "${entities.treatment}". Por favor, escolha uma das opções abaixo:`;
            else if (userState.timeFilter || intent === 'REQUEST_SPECIFIC_TIME') {
                introText = "Consigo olhar se tem horário livre sim! Mas como cada serviço tem um tempo de duração, eu preciso saber primeiro: qual serviço você quer?";
            } else if (entities.date || intent === 'SELECT_DATE') {
                introText = `Perfeito, posso olhar a agenda para essa data! Qual serviço vamos agendar?`;
            } else if (userState.step === 'AGENDAMENTO_COLLECTING_SERVICE') {
                introText = `Ainda preciso saber qual é o serviço para olhar a agenda. Pode escolher na lista:`;
            }

            const moedaGlobal = configDb?.moeda || 'MT';
            const rows = servicos.slice(0, 10).map(s => ({ 
                id: `srv_${s.id}`, title: s.nome.substring(0, 24), description: s.preco ? `Valor: ${formatarMoeda(s.preco, moedaGlobal)}` : 'Consulte valor' 
            }));
            
            await whatsappService.sendInteractiveList(jid, introText, "Ver opções", [{ title: "Serviços", rows: rows }]);
            userState.step = 'AGENDAMENTO_COLLECTING_SERVICE';
            stateMachine.set(senderNumber, userState);
            return;
        }
    }

    // 2. BARBEIRO
    if (!userState.resolvedBarber) {
        const barbeiros = await prisma.barbeiro.findMany();
        let optBarbeiros = barbeiros.slice(0, 8).map(b => ({ id: `barb_${b.id}`, title: b.nome }));
        optBarbeiros.push({ id: 'barb_qualquer', title: 'Qualquer um' });

        await whatsappService.sendInteractiveMenu(jid, "Prefere ser atendido por qual profissional?", optBarbeiros.slice(0, 3)); 
        userState.step = 'AGENDAMENTO_COLLECTING_BARBER';
        stateMachine.set(senderNumber, userState);
        return;
    }

    // 3. DATA
    if (!userState.resolvedDate) {
        const diasValidos = await getProximosDiasUteis(14); 

        if (intent === 'REQUEST_MORE_DATES') userState.pageData++;
        else if (entities.date) {
            const matchDia = diasValidos.find(d => d === entities.date || d.includes(entities.date));
            if (matchDia) userState.resolvedDate = matchDia;
            else await whatsappService.sendText(jid, `A agenda para a data solicitada (${entities.date}) está indisponível.`);
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
                ? `Tenho estes dias mais próximos disponíveis para ${userState.resolvedService.nome}:`
                : `Aqui estão mais opções de dias:`;

            if (userState.timeFilter && userState.pageData === 0) {
                saudacao = `Para verificar a disponibilidade a partir das ${userState.timeFilter.time}, para qual dia seria a sua reserva?`;
            }

            let optDias = chunk.map(d => ({ id: `data_${d}`, title: humanizarData(d).curto }));
            if (hasMore) optDias.push({ id: 'ver_mais_data', title: 'Ver mais datas' });

            await whatsappService.sendInteractiveMenu(jid, saudacao, optDias);
            userState.step = 'AGENDAMENTO_COLLECTING_DATE';
            stateMachine.set(senderNumber, userState);
            return;
        }
    }

    // 4. HORA E FILTRAGEM
    if (!userState.resolvedTime) {
        const dateH = humanizarData(userState.resolvedDate);
        
        if (!userState.availableTimes) {
            const horasLivres = await getHorariosDisponiveis(userState.resolvedDate, userState.resolvedService.duracaoMin, userState.resolvedBarber.id, 'BARBEARIA');
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
            if (userState.availableTimes.includes(extractedTime)) userState.resolvedTime = extractedTime;
            else {
                await whatsappService.sendText(jid, `Não encontrei esse horário. Veja o que tenho disponível:`);
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
                else textoApresentacao = `Horários livres para ${dateH.curto}:`;
            } else {
                if (!hasMore) textoApresentacao = `Estes são os últimos horários disponíveis para esse dia. Qual prefere?`;
                else textoApresentacao = `Claro. Além desses, tenho:`;
            }

            await whatsappService.sendInteractiveMenu(jid, textoApresentacao, optHoras);
            userState.timeIndex += 2; 
            userState.step = 'AGENDAMENTO_AWAITING_TIME';
            stateMachine.set(senderNumber, userState);
            return;
        }
    }

    // 5. CONFIRMAÇÃO
    if (userState.step !== 'AGENDAMENTO_AWAITING_CONFIRMATION') {
        const dateH = humanizarData(userState.resolvedDate);
        const resumo = `*Resumo da Reserva*\n✂️ Serviço: ${userState.resolvedService.nome}\n💈 Profissional: ${userState.resolvedBarber.nome}\n📅 Data: ${dateH.longo}\n🕐 Hora: ${userState.resolvedTime}\n\nPosso confirmar esse horário para você?`;
        await whatsappService.sendInteractiveMenu(jid, resumo, [
            { id: 'cmd_confirmar_reserva', title: 'Sim, Confirmar' }, 
            { id: 'cmd_cancelar_fluxo', title: 'Cancelar' }
        ]);
        userState.step = 'AGENDAMENTO_AWAITING_CONFIRMATION';
        stateMachine.set(senderNumber, userState);
        return;
    }

    if (intent === 'CONFIRM_APPOINTMENT' || intent === 'BOOK_APPOINTMENT') {
        const [dia, mes, ano] = userState.resolvedDate.split('/');
        const [hora, min] = userState.resolvedTime.split(':');
        const fusoOffset = configDb?.fusoHorario === 'America/Sao_Paulo' ? '-03:00' : '+02:00';
        const dataHoraDb = new Date(`${ano}-${mes}-${dia}T${hora}:${min}:00${fusoOffset}`);

        const horasLivresNow = await getHorariosDisponiveis(userState.resolvedDate, userState.resolvedService.duracaoMin, userState.resolvedBarber.id, 'BARBEARIA');
        if(!horasLivresNow.includes(userState.resolvedTime)) {
             await whatsappService.sendText(jid, `Ops, alguém acabou de ocupar esse horário. Vamos escolher outro.`);
             userState.resolvedTime = null;
             userState.step = 'AGENDAMENTO_AWAITING_TIME';
             stateMachine.set(senderNumber, userState);
             return processarAgendamento(jid, null, senderNumber, stateMachine, {intent: 'UNKNOWN'}, false, configDb, cliente, isNewPatient);
        }

        await prisma.agendamento.create({
            data: {
                dataHora: dataHoraDb, clienteId: senderNumber, status: 'AGENDADO',
                servicoId: userState.resolvedService.id, barbeiroId: userState.resolvedBarber.id
            }
        });
        await prisma.cliente.update({ where: { id: senderNumber }, data: { leadStatus: 'AGENDADO' } });
        
        const dateH = humanizarData(userState.resolvedDate);
        await whatsappService.sendText(jid, `✅ *Consulta Confirmada!*\n\nSua reserva de *${userState.resolvedService.nome}* está agendada para *${dateH.longo}* às *${userState.resolvedTime}*.\n\nEsperamos por você!`);
        
        stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
    } else {
        await whatsappService.sendText(jid, 'Ainda estou aguardando sua confirmação. Posso agendar esse horário ou prefere trocar?');
    }
}

module.exports = { processarAgendamento };