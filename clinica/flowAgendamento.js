// clinica/flowAgendamento.js
const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const { getHorariosDisponiveis, getProximosDiasUteis } = require('../dateUtils');
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
        await whatsappService.sendText(jid, 'Sem problemas. O processo de agendamento foi cancelado. Posso ajudar em mais alguma coisa?');
        return;
    }

    if (userState.step === 'IDLE' || userState.step === 'CANCELAMENTO_AWAITING_SELECTION') {
        userState.step = 'AGENDAMENTO_COLLECTING_TREATMENT';
        userState.pageData = 0;
        userState.pageHora = 0;
        userState.resolvedTreatment = null;
        userState.resolvedDate = null;
        userState.resolvedTime = null;
    }

    userState.entities = { ...userState.entities, ...entities };

    if (intent === 'SELECT_TREATMENT' && entities.treatment_id) {
        userState.resolvedTreatment = await prisma.tratamento.findUnique({ where: { id: parseInt(entities.treatment_id) }});
    }
    if (intent === 'SELECT_DATE' && entities.date) userState.resolvedDate = entities.date;
    if (intent === 'SELECT_TIME' && entities.time) userState.resolvedTime = entities.time;

    // 1. EXTRAÇÃO DO TRATAMENTO
    if (!userState.resolvedTreatment) {
        if (entities.treatment) {
            const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO', podeAgendarIA: true }});
            const search = entities.treatment.toLowerCase();
            const match = tratamentos.find(t => t.nome.toLowerCase().includes(search));
            if (match) userState.resolvedTreatment = match;
        }
        
        if (!userState.resolvedTreatment) {
            const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO', podeAgendarIA: true }});
            const moedaGlobal = configDb?.moeda || 'MT';
            const rows = tratamentos.slice(0, 10).map(t => ({ 
                id: `trat_${t.id}`, 
                title: t.nome.substring(0, 24), 
                description: t.preco ? `Valor: ${formatarMoeda(t.preco, moedaGlobal)}` : 'Consulte valor' 
            }));
            const sections = [{ title: "Especialidades", rows: rows }];
            
            await whatsappService.sendInteractiveList(jid, "Temos vários tratamentos disponíveis. Escolha uma categoria para continuar:", "Ver opções", sections);
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
            if (matchDia) {
                userState.resolvedDate = matchDia;
            } else {
                await whatsappService.sendText(jid, `A agenda para a data solicitada (${entities.date}) está indisponível. Vamos ver as próximas opções.`);
                userState.entities.date = null; 
            }
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
                ? `Vou verificar os horários para ${userState.resolvedTreatment.nome}.\n\nTenho estes dias mais próximos disponíveis:`
                : `Aqui estão mais opções de dias:`;

            await whatsappService.sendInteractiveMenu(jid, saudacao, optDias);
            userState.step = 'AGENDAMENTO_COLLECTING_DATE';
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // 3. EXTRAÇÃO DA HORA E FILTRAGEM (O SEGREDO DO "DEPOIS DAS 10")
    if (!userState.resolvedTime) {
        const horasLivres = await getHorariosDisponiveis(userState.resolvedDate, userState.resolvedTreatment.duracaoMin, null);
        let listaHorasExibir = [...horasLivres];

        if (horasLivres.length === 0) {
            userState.resolvedDate = null; 
            stateMachine.set(senderNumber, userState);
            await whatsappService.sendText(jid, `Infelizmente a agenda acabou de encher para o dia ${userState.resolvedDate}. Vamos escolher outro dia?`);
            return processarAgendamento(jid, textoProcessado, senderNumber, stateMachine, {intent: 'UNKNOWN'}, false, configDb, cliente, isNewPatient);
        }
        
        if (intent === 'REQUEST_MORE_TIMES') {
            userState.pageHora++;
        } 
        else if (intent === 'REQUEST_SPECIFIC_TIME' && entities.time) {
            const modifier = entities.time_modifier;
            if (modifier === 'after') {
                listaHorasExibir = horasLivres.filter(h => h >= entities.time);
            } else if (modifier === 'before') {
                listaHorasExibir = horasLivres.filter(h => h <= entities.time);
            }
            userState.pageHora = 0; // Reseta a página para mostrar os resultados do filtro
        }
        else if (entities.time && intent === 'SELECT_TIME') {
            const matchHora = horasLivres.find(h => h === entities.time);
            if (matchHora) {
                userState.resolvedTime = matchHora;
            } else {
                await whatsappService.sendText(jid, `Infelizmente não encontrei esse horário livre. Veja o que tenho disponível:`);
                userState.entities.time = null;
            }
        }
        
        if (!userState.resolvedTime) {
            const start = userState.pageHora * 2;
            const chunk = listaHorasExibir.slice(start, start + 2);
            const hasMore = start + 2 < listaHorasExibir.length;

            if (chunk.length === 0) {
                if (listaHorasExibir.length === 0) {
                    await whatsappService.sendText(jid, `Para esse critério que você pediu, não encontrei vagas neste dia.`);
                    userState.entities.time = null; // Limpa para mostrar todos da próxima vez
                    userState.pageHora = 0;
                    return processarAgendamento(jid, textoProcessado, senderNumber, stateMachine, {intent: 'UNKNOWN'}, false, configDb, cliente, isNewPatient);
                } else {
                    userState.pageHora = 0; 
                    return processarAgendamento(jid, textoProcessado, senderNumber, stateMachine, {intent: 'UNKNOWN'}, false, configDb, cliente, isNewPatient);
                }
            }

            let optHoras = chunk.map(h => ({ id: `hora_${h}`, title: h }));
            if (hasMore) optHoras.push({ id: 'ver_mais_hora', title: 'Ver mais horários' });

            let textoApresentacao = userState.pageHora === 0
                ? `Encontrei estes horários livres para o dia ${userState.resolvedDate}:`
                : `Claro. Além desses, também tenho:`;

            // Personaliza texto se usou modificador
            if (intent === 'REQUEST_SPECIFIC_TIME' && entities.time) {
                textoApresentacao = `Sim, para esse horário encontrei estas vagas:`;
            }

            await whatsappService.sendInteractiveMenu(jid, textoApresentacao, optHoras);
            userState.step = 'AGENDAMENTO_AWAITING_TIME';
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // 4. CONFIRMAÇÃO EXATA
    if (userState.step !== 'AGENDAMENTO_AWAITING_CONFIRMATION') {
        const resumo = `Perfeito. Só confirmando antes de reservar:\n\n🩺 ${userState.resolvedTreatment.nome}\n📅 ${userState.resolvedDate}\n🕐 ${userState.resolvedTime}\n\nPosso confirmar esse horário para você?`;
        await whatsappService.sendInteractiveMenu(jid, resumo, [
            { id: 'cmd_confirmar_reserva', title: 'Confirmar' }, 
            { id: 'cmd_cancelar_fluxo', title: 'Escolher outro' }
        ]);
        userState.step = 'AGENDAMENTO_AWAITING_CONFIRMATION';
        stateMachine.set(senderNumber, userState);
        return;
    }
    
    // 5. AÇÃO FINALIZADA DE FORMA DETERMINÍSTICA (HARDCODED SUCCESS)
    if (intent === 'CONFIRM_APPOINTMENT') {
        const [dia, mes, ano] = userState.resolvedDate.split('/');
        const [hora, min] = userState.resolvedTime.split(':');
        const fusoOffset = configDb?.fusoHorario === 'America/Sao_Paulo' ? '-03:00' : '+02:00';
        const dataHoraDb = new Date(`${ano}-${mes}-${dia}T${hora}:${min}:00${fusoOffset}`);

        // Verificação final de segurança atômica
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
        
        // TEMPLATE FIXO DE CONFIRMAÇÃO (Fim da Alucinação da IA)
        const msgSucesso = `✅ *Consulta Confirmada!*\n\nSua consulta de *${userState.resolvedTreatment.nome}* está agendada para *${userState.resolvedDate}* às *${userState.resolvedTime}*.\n\nEsperamos por você! Se precisar reagendar ou tiver alguma dúvida, basta enviar uma mensagem.`;
        
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