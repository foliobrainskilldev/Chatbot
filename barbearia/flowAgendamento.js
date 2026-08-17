// barbearia/flowAgendamento.js
const { prisma } = require('../db');
const { getProximosDiasUteis, getHorariosDisponiveis } = require('../dateUtils');
const whatsappService = require('../whatsappService');

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

    if (userState.step === 'IDLE' || userState.step === 'CANCELAMENTO_AWAITING_SELECTION') {
        userState.step = 'AGENDAMENTO_COLLECTING_SERVICE';
        userState.pageData = 0;
        userState.pageHora = 0;
        userState.resolvedService = null;
        userState.resolvedBarber = null;
        userState.resolvedDate = null;
        userState.resolvedTime = null;
    }

    userState.entities = { ...userState.entities, ...entities };

    if (intent === 'SELECT_TREATMENT' && entities.treatment_id) {
        userState.resolvedService = await prisma.servico.findUnique({ where: { id: parseInt(entities.treatment_id) }});
    }
    if (intent === 'SELECT_PROFESSIONAL' && entities.professional_id) {
        if (entities.professional_id === 'qualquer') userState.resolvedBarber = { id: null, nome: 'Qualquer Barbeiro' };
        else userState.resolvedBarber = await prisma.barbeiro.findUnique({ where: { id: parseInt(entities.professional_id) }});
    }
    if (intent === 'SELECT_DATE' && entities.date) userState.resolvedDate = entities.date;
    if (intent === 'SELECT_TIME' && entities.time) userState.resolvedTime = entities.time;

    // 1. SERVIÇO
    if (!userState.resolvedService) {
        if (entities.treatment) {
            const servicos = await prisma.servico.findMany();
            const search = entities.treatment.toLowerCase();
            const match = servicos.find(s => s.nome.toLowerCase().includes(search));
            if (match) userState.resolvedService = match;
        }
        
        if (!userState.resolvedService) {
            const servicos = await prisma.servico.findMany();
            if (servicos.length === 0) {
                await whatsappService.sendText(jid, 'Nenhum serviço de barbearia disponível no momento.');
                stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
                return;
            }
            
            const moedaGlobal = configDb?.moeda || 'MT';
            const rows = servicos.slice(0, 10).map(s => ({ 
                id: `srv_${s.id}`, 
                title: s.nome.substring(0, 24), 
                description: s.preco ? `Valor: ${formatarMoeda(s.preco, moedaGlobal)}` : 'Consulte valor' 
            }));
            const sections = [{ title: "Serviços", rows: rows }];
            
            await whatsappService.sendInteractiveList(jid, "Vamos agendar o seu corte! Escolha o serviço que deseja:", "Ver opções", sections);
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
                return processarAgendamento(jid, textoProcessado, senderNumber, stateMachine, {intent: 'UNKNOWN'}, false, configDb, cliente, isNewPatient);
            }

            let optDias = chunk.map(d => ({ id: `data_${d}`, title: d }));
            if (hasMore) optDias.push({ id: 'ver_mais_data', title: 'Ver mais datas' });

            const saudacao = userState.pageData === 0 
                ? `Tenho estes dias mais próximos disponíveis para ${userState.resolvedService.nome}:`
                : `Aqui estão mais opções de dias:`;

            await whatsappService.sendInteractiveMenu(jid, saudacao, optDias);
            userState.step = 'AGENDAMENTO_COLLECTING_DATE';
            stateMachine.set(senderNumber, userState);
            return;
        }
    }

    // 4. HORA
    if (!userState.resolvedTime) {
        const horasLivres = await getHorariosDisponiveis(userState.resolvedDate, userState.resolvedService.duracaoMin, userState.resolvedBarber.id, 'BARBEARIA');
        
        if (horasLivres.length === 0) {
            userState.resolvedDate = null; 
            stateMachine.set(senderNumber, userState);
            await whatsappService.sendText(jid, `Infelizmente a agenda encheu para o dia ${userState.resolvedDate}. Vamos escolher outro dia?`);
            return processarAgendamento(jid, textoProcessado, senderNumber, stateMachine, {intent: 'UNKNOWN'}, false, configDb, cliente, isNewPatient);
        }
        
        if (intent === 'REQUEST_MORE_TIMES') userState.pageHora++;
        else if (entities.time) {
            const reqTime = entities.time;
            const modifier = entities.time_modifier || 'exact';
            
            let matchHora;
            if (modifier === 'after') matchHora = horasLivres.find(h => h >= reqTime);
            else if (modifier === 'before') matchHora = [...horasLivres].reverse().find(h => h <= reqTime);
            else matchHora = horasLivres.find(h => h === reqTime) || horasLivres.find(h => h > reqTime);

            if (matchHora) {
                userState.resolvedTime = matchHora;
            } else {
                await whatsappService.sendText(jid, `Não encontrei esse horário. Veja o que tenho disponível:`);
                userState.entities.time = null;
            }
        }
        
        if (!userState.resolvedTime) {
            const start = userState.pageHora * 2;
            const chunk = horasLivres.slice(start, start + 2);
            const hasMore = start + 2 < horasLivres.length;

            if (chunk.length === 0) {
                userState.pageHora = 0; 
                return processarAgendamento(jid, textoProcessado, senderNumber, stateMachine, {intent: 'UNKNOWN'}, false, configDb, cliente, isNewPatient);
            }

            let optHoras = chunk.map(h => ({ id: `hora_${h}`, title: h }));
            if (hasMore) optHoras.push({ id: 'ver_mais_hora', title: 'Ver mais horários' });

            const textoApresentacao = userState.pageHora === 0 ? `Horários livres para o dia ${userState.resolvedDate}:` : `Além desses, tenho:`;

            await whatsappService.sendInteractiveMenu(jid, textoApresentacao, optHoras);
            userState.step = 'AGENDAMENTO_AWAITING_TIME';
            stateMachine.set(senderNumber, userState);
            return;
        }
    }

    // 5. CONFIRMAÇÃO E BOOKING
    if (userState.step !== 'AGENDAMENTO_AWAITING_CONFIRMATION') {
        const resumo = `*Resumo da Reserva*\n✂️ Serviço: ${userState.resolvedService.nome}\n💈 Profissional: ${userState.resolvedBarber.nome}\n📅 Data: ${userState.resolvedDate}\n🕐 Hora: ${userState.resolvedTime}\n\nPosso confirmar esse horário para você?`;
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
        
        await whatsappService.sendText(jid, `Consulta confirmada! ✅\nSua reserva de *${userState.resolvedService.nome}* está agendada para *${userState.resolvedDate}* às *${userState.resolvedTime}*.\nEsperamos por você!`);
        
        stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
    } else {
        await whatsappService.sendText(jid, 'Ainda estou aguardando sua confirmação. Posso agendar esse horário ou prefere trocar?');
    }
}

module.exports = { processarAgendamento };