// clinica/flowAgendamento.js
const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const { getHorariosDisponiveis, getProximosDiasUteis } = require('../dateUtils');
const aiService = require('../aiService');
const automationEngine = require('../services/automationEngine');
const webhookService = require('../services/webhookService');

const normalizeStr = (str) => str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : '';

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

    if (textoProcessado === '0' || textoProcessado === 'cmd_cancelar_fluxo' || normalizeStr(textoProcessado) === 'cancelar' || intent === 'REJECT_APPOINTMENT') {
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

    // Atribuição Rápida Via Botões
    if (intent === 'SELECT_TREATMENT' && entities.treatment_id) {
        userState.resolvedTreatment = await prisma.tratamento.findUnique({ where: { id: parseInt(entities.treatment_id) }});
    }
    if (intent === 'SELECT_DATE' && entities.date) {
        userState.resolvedDate = entities.date;
    }
    if (intent === 'SELECT_TIME' && entities.time) {
        userState.resolvedTime = entities.time;
    }

    // 1. EXTRAÇÃO DO TRATAMENTO (Com Resiliência Fuzzy Match)
    if (!userState.resolvedTreatment) {
        let msgFeedback = "";

        if (entities.treatment) {
            const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO', podeAgendarIA: true }});
            const search = normalizeStr(entities.treatment);
            
            const match = tratamentos.find(t => {
                const n = normalizeStr(t.nome);
                if (n.includes(search) || search.includes(n)) return true;
                const searchWords = search.split(' ').filter(w => w.length > 3);
                return searchWords.some(w => n.includes(w));
            });

            if (match) {
                userState.resolvedTreatment = match;
            } else {
                msgFeedback = `Desculpe, não localizei o procedimento "${entities.treatment}" no nosso catálogo.\n\n`;
                userState.entities.treatment = null; 
            }
        }

        if (!userState.resolvedTreatment) {
            const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO', podeAgendarIA: true }});
            if (tratamentos.length === 0) {
                await whatsappService.sendText(jid, 'Nossa agenda online está temporariamente fechada para novos procedimentos. Vou transferir você para a recepção.');
                stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
                return;
            }
            
            const moedaGlobal = configDb?.moeda || 'MT';
            const rows = tratamentos.slice(0, 10).map(t => ({ 
                id: `trat_${t.id}`, 
                title: t.nome.substring(0, 24), 
                description: t.preco ? `Valor: ${formatarMoeda(t.preco, moedaGlobal)}` : 'Consulte valor' 
            }));
            const sections = [{ title: "Especialidades", rows: rows }];
            
            let introText = msgFeedback ? msgFeedback : "Temos vários tratamentos disponíveis. Escolha uma categoria para continuar:";
            if (!msgFeedback && (intent === 'GREETING' || intent === 'UNKNOWN') && !isInteractive) {
                 introText = "Olá! Para continuarmos o seu agendamento, por favor, escolha um dos nossos serviços abaixo:";
            }
            
            await whatsappService.sendInteractiveList(jid, introText, "Ver opções", sections);
            userState.step = 'AGENDAMENTO_COLLECTING_TREATMENT';
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // 2. EXTRAÇÃO DA DATA
    if (!userState.resolvedDate) {
        const diasValidos = await getProximosDiasUteis(14); 

        if (intent === 'REQUEST_MORE_DATES') {
            userState.pageData++;
        } 
        else if (entities.date) {
            const matchDia = diasValidos.find(d => d === entities.date || d.includes(entities.date));
            if (matchDia) {
                userState.resolvedDate = matchDia;
            } else {
                await whatsappService.sendText(jid, `A agenda para a data solicitada (${entities.date}) está indisponível ou já passou. Vamos ver as próximas opções.`);
                userState.entities.date = null; 
            }
        }
        
        if (!userState.resolvedDate) {
            const start = userState.pageData * 2;
            const chunk = diasValidos.slice(start, start + 2);
            const hasMore = start + 2 < diasValidos.length;

            if (chunk.length === 0) {
                userState.pageData = 0; 
                return processarAgendamento(jid, null, senderNumber, stateMachine, {intent:'UNKNOWN', entities:{}}, false, configDb, cliente, isNewPatient);
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
    
    // 3. EXTRAÇÃO DA HORA E VERIFICAÇÃO DE DISPONIBILIDADE
    if (!userState.resolvedTime) {
        const horasLivres = await getHorariosDisponiveis(userState.resolvedDate, userState.resolvedTreatment.duracaoMin, null);
        
        if (horasLivres.length === 0) {
            userState.resolvedDate = null; 
            stateMachine.set(senderNumber, userState);
            await whatsappService.sendText(jid, `Infelizmente a agenda acabou de encher para o dia ${userState.resolvedDate}. Vamos escolher outro dia?`);
            return processarAgendamento(jid, null, senderNumber, stateMachine, {intent:'UNKNOWN', entities:{}}, false, configDb, cliente, isNewPatient);
        }
        
        if (intent === 'REQUEST_MORE_TIMES') {
            userState.pageHora++;
        } 
        else if (entities.time) {
            const reqTime = entities.time;
            const modifier = entities.time_modifier || 'exact';
            
            let matchHora;
            if (modifier === 'after') matchHora = horasLivres.find(h => h >= reqTime);
            else if (modifier === 'before') matchHora = [...horasLivres].reverse().find(h => h <= reqTime);
            else {
                matchHora = horasLivres.find(h => h === reqTime);
                if (!matchHora) matchHora = horasLivres.find(h => h > reqTime);
            }

            if (matchHora) {
                userState.resolvedTime = matchHora;
                if (matchHora !== reqTime) {
                    await whatsappService.sendText(jid, `Não temos exatamente às ${reqTime}, mas o mais próximo que encontrei foi às ${matchHora}.`);
                }
            } else {
                await whatsappService.sendText(jid, `Infelizmente não encontrei horários livres que atendam ao que pediu (${reqTime}). Veja o que tenho disponível:`);
                userState.entities.time = null;
                userState.entities.time_modifier = null;
            }
        }
        
        if (!userState.resolvedTime) {
            const start = userState.pageHora * 2;
            const chunk = horasLivres.slice(start, start + 2);
            const hasMore = start + 2 < horasLivres.length;

            if (chunk.length === 0) {
                userState.pageHora = 0; 
                return processarAgendamento(jid, null, senderNumber, stateMachine, {intent:'UNKNOWN', entities:{}}, false, configDb, cliente, isNewPatient);
            }

            let optHoras = chunk.map(h => ({ id: `hora_${h}`, title: h }));
            if (hasMore) optHoras.push({ id: 'ver_mais_hora', title: 'Ver mais horários' });

            const textoApresentacao = userState.pageHora === 0
                ? `Encontrei estes horários livres para o dia ${userState.resolvedDate}:`
                : `Claro. Além desses, também tenho:`;

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
    
    // 5. AÇÃO FINALIZADA
    if (intent === 'CONFIRM_APPOINTMENT' || intent === 'BOOK_APPOINTMENT') {
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
             return processarAgendamento(jid, null, senderNumber, stateMachine, {intent:'UNKNOWN', entities:{}}, false, configDb, cliente, isNewPatient);
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
        
        const msgSucesso = `Consulta confirmada! ✅\n\nSua consulta de *${userState.resolvedTreatment.nome}* está agendada para *${userState.resolvedDate}* às *${userState.resolvedTime}*.\n\nEsperamos por você!`;
        
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