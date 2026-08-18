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

function normalizeTime(t) {
    if (!t || t === 'undefined' || t === 'null') return null;
    let match = String(t).match(/(\d{1,2})[:hH](\d{2})/);
    if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
    match = String(t).match(/(\d{1,2})/);
    if (match) return `${match[1].padStart(2, '0')}:00`;
    return String(t);
}

async function processarAgendamento(jid, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, cliente, isNewPatient) {
    let userState = stateMachine.get(senderNumber) || { step: 'IDLE', entities: {} };
    const intent = nlpResult.intent;
    const entities = nlpResult.entities || {};

    if (intent === 'REJECT_APPOINTMENT' || intent === 'CANCEL_APPOINTMENT') {
        stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
        await whatsappService.sendText(jid, 'Tudo bem! O processo de agendamento foi cancelado. Como posso te ajudar agora?');
        return;
    }

    if (intent === 'CHANGE_TREATMENT') {
        userState.resolvedTreatment = null; userState.resolvedProfissional = null; userState.resolvedDate = null; userState.resolvedTime = null;
        userState.entities.treatment = null; userState.step = 'AGENDAMENTO_COLLECTING_TREATMENT';
    } else if (intent === 'CHANGE_DATE' || intent === 'REQUEST_MORE_DATES') {
        userState.resolvedDate = null; userState.resolvedTime = null;
        userState.entities.date = null; userState.step = 'AGENDAMENTO_COLLECTING_DATE';
    } else if (intent === 'CHANGE_TIME' || intent === 'REQUEST_MORE_TIMES' || intent === 'REQUEST_SPECIFIC_TIME') {
        userState.resolvedTime = null; userState.entities.time = null;
        userState.step = 'AGENDAMENTO_AWAITING_TIME';
    }

    if (userState.step === 'IDLE' || userState.step === 'CANCELAMENTO_AWAITING_SELECTION') {
        userState = {
            step: 'AGENDAMENTO_COLLECTING_TREATMENT',
            entities: {}, timeFilter: null, availableTimes: null, timeIndex: 0, pageData: 0,
            resolvedTreatment: null, resolvedProfissional: null, resolvedDate: null, resolvedTime: null,
            needsTimeValidation: false
        };
    }

    userState.entities = { ...userState.entities, ...entities };

    // Fallback manual de segurança para extrair data e hora se a IA falhar
    if (!userState.entities.date) {
        const dateMatch = textoProcessado.match(/dia (\d{1,2})/i);
        if (dateMatch) userState.entities.date = dateMatch[1].padStart(2, '0');
    }
    if (!userState.entities.time) {
        const timeMatch = textoProcessado.match(/(?:às|as|ás) (\d{1,2})(?:h| horas|:\d{2})?/i);
        if (timeMatch) userState.entities.time = `${timeMatch[1].padStart(2, '0')}:00`;
    }

    let extractedTime = userState.entities.time ? normalizeTime(String(userState.entities.time)) : null;
    let extractedModifier = userState.entities.time_modifier ? String(userState.entities.time_modifier) : 'exact';

    if (intent === 'REQUEST_SPECIFIC_TIME' && !extractedTime) {
        if (textoProcessado.match(/(?:depois|após) das (\d{1,2})/i)) { extractedTime = `${textoProcessado.match(/(?:depois|após) das (\d{1,2})/i)[1].padStart(2, '0')}:00`; extractedModifier = 'after'; }
        else if (textoProcessado.match(/(?:a partir) das (\d{1,2})/i)) { extractedTime = `${textoProcessado.match(/(?:a partir) das (\d{1,2})/i)[1].padStart(2, '0')}:00`; extractedModifier = 'starting'; }
        else if (textoProcessado.match(/(?:antes) das (\d{1,2})/i)) { extractedTime = `${textoProcessado.match(/(?:antes) das (\d{1,2})/i)[1].padStart(2, '0')}:00`; extractedModifier = 'before'; }
    }

    if (extractedTime && !userState.resolvedTime) {
        userState.timeFilter = { time: extractedTime, modifier: extractedModifier };
        userState.availableTimes = null; 
        userState.timeIndex = 0;
    }

    if (intent === 'SELECT_TREATMENT' && entities.treatment_id) userState.resolvedTreatment = await prisma.tratamento.findUnique({ where: { id: parseInt(entities.treatment_id) }});
    if (intent === 'SELECT_PROFESSIONAL' && entities.professional_id) {
        if (entities.professional_id === 'qualquer') userState.resolvedProfissional = { id: null, nome: 'Qualquer Profissional' };
        else userState.resolvedProfissional = await prisma.profissionalSaude.findUnique({ where: { id: parseInt(entities.professional_id) }});
    }
    
    if (userState.entities.date && !userState.resolvedDate) {
        const searchDate = String(userState.entities.date);
        const diasValidos = await getProximosDiasUteis(30);
        const matchDia = diasValidos.find(d => d === searchDate || d.includes(searchDate) || d.startsWith(searchDate.padStart(2, '0') + '/'));
        if (matchDia) userState.resolvedDate = matchDia;
    }
    
    if (userState.entities.time && !userState.resolvedTime) {
        userState.resolvedTime = normalizeTime(String(userState.entities.time));
        userState.needsTimeValidation = true; 
    }

    // 1. TRATAMENTO
    if (!userState.resolvedTreatment) {
        let searchedButNotFound = false;
        if (userState.entities.treatment) {
            const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO', podeAgendarIA: true }});
            const search = String(userState.entities.treatment).toLowerCase();
            const match = tratamentos.find(t => t.nome.toLowerCase().includes(search));
            if (match) userState.resolvedTreatment = match;
            else searchedButNotFound = true;
        }
        
        if (!userState.resolvedTreatment) {
            const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO', podeAgendarIA: true }});
            if (tratamentos.length === 0) {
                await whatsappService.sendText(jid, 'Não temos procedimentos disponíveis para agendamento automático no momento.');
                stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
                return;
            }
            
            if (searchedButNotFound) {
                let introText = `Não encontrei o tratamento solicitado. Por favor, escolha uma das opções cadastradas abaixo:`;
                const moedaGlobal = configDb?.moeda || 'MT';
                const rows = tratamentos.slice(0, 10).map(t => ({ 
                    id: `trat_${t.id}`, title: t.nome.substring(0, 24), description: t.preco ? `Valor: ${formatarMoeda(t.preco, moedaGlobal)}` : 'Consulte valor' 
                }));
                await whatsappService.sendInteractiveList(jid, introText, "Ver procedimentos", [{ title: "Tratamentos", rows: rows }]);
            } else {
                let introText = "Claro, vamos iniciar o seu agendamento! Qual procedimento você deseja realizar?";
                if (userState.timeFilter || intent === 'REQUEST_SPECIFIC_TIME' || intent === 'REQUEST_MORE_TIMES') {
                    introText = "Consigo olhar os horários livres sim! Mas como cada procedimento tem um tempo de duração, eu preciso saber primeiro: qual tratamento você quer agendar?";
                } else if (userState.resolvedDate) {
                    introText = `Perfeito, posso olhar a agenda para essa data! Qual procedimento vamos agendar?`;
                }
                await whatsappService.sendText(jid, introText);
            }

            userState.step = 'AGENDAMENTO_COLLECTING_TREATMENT';
            stateMachine.set(senderNumber, userState);
            return;
        }
    }

    // 2. PROFISSIONAL DA SAÚDE
    if (!userState.resolvedProfissional) {
        const profissionais = await prisma.profissionalSaude.findMany();
        if (profissionais.length > 0) {
            let optProfs = profissionais.slice(0, 8).map(p => ({ id: `prof_${p.id}`, title: `Dr(a). ${p.nome.substring(0, 13)}` }));
            optProfs.push({ id: 'prof_qualquer', title: 'Qualquer profissional' });

            await whatsappService.sendInteractiveMenu(jid, "Você tem preferência por algum profissional específico ou pode ser qualquer um da equipe?", optProfs.slice(0, 3)); 
            userState.step = 'AGENDAMENTO_COLLECTING_PROFESSIONAL';
            stateMachine.set(senderNumber, userState);
            return;
        } else {
            userState.resolvedProfissional = { id: null, nome: 'Equipe Médica' };
        }
    }

    // 3. DATA
    if (!userState.resolvedDate) {
        const diasValidos = await getProximosDiasUteis(14); 

        if (intent === 'REQUEST_MORE_DATES') userState.pageData++;
        
        if (!userState.resolvedDate) {
            const start = userState.pageData * 2;
            const chunk = diasValidos.slice(start, start + 2);
            const hasMore = start + 2 < diasValidos.length;

            if (chunk.length === 0) {
                userState.pageData = 0; 
                await whatsappService.sendText(jid, `A agenda para as datas próximas está cheia. Quer tentar outro procedimento?`);
                stateMachine.set(senderNumber, { step: 'IDLE', entities: {} });
                return;
            }

            let saudacao = userState.pageData === 0 
                ? `Tenho estes dias mais próximos disponíveis para ${userState.resolvedTreatment.nome}:`
                : `Aqui estão mais opções de dias:`;

            if (userState.timeFilter && userState.pageData === 0) saudacao = `Para verificar a disponibilidade que você pediu, para qual dia seria a sua consulta?`;

            let optDias = chunk.map(d => ({ id: `data_${d}`, title: humanizarData(d).curto }));
            if (hasMore) optDias.push({ id: 'ver_mais_data', title: 'Ver mais datas' });

            await whatsappService.sendInteractiveMenu(jid, saudacao, optDias);
            userState.step = 'AGENDAMENTO_COLLECTING_DATE';
            stateMachine.set(senderNumber, userState);
            return;
        }
    }

    // 4. HORA E FILTRAGEM
    if (!userState.resolvedTime || userState.needsTimeValidation) {
        const dateH = humanizarData(userState.resolvedDate);
        
        if (!userState.availableTimes) {
            const horasLivres = await getHorariosDisponiveis(userState.resolvedDate, userState.resolvedTreatment.duracaoMin, userState.resolvedProfissional.id, 'CLINICA');
            let filtradas = [...horasLivres];
            let hasExactConflict = false;
            
            if (userState.timeFilter && userState.timeFilter.time) {
                const reqTime = normalizeTime(String(userState.timeFilter.time));
                const modifier = String(userState.timeFilter.modifier);

                if (modifier === 'after') filtradas = filtradas.filter(h => h > reqTime);
                else if (modifier === 'starting') filtradas = filtradas.filter(h => h >= reqTime);
                else if (modifier === 'before') filtradas = filtradas.filter(h => h < reqTime);
                else if (modifier === 'exact') {
                    if (filtradas.includes(reqTime)) {
                        userState.resolvedTime = reqTime; 
                        userState.timeFilter = null;
                        userState.needsTimeValidation = false;
                    } else {
                        hasExactConflict = true;
                        userState.timeFilter = null;
                    }
                }
            }
            
            userState.availableTimes = filtradas;
            userState.timeIndex = 0;
            userState.hasExactConflict = hasExactConflict;
        }

        if (userState.resolvedTime && userState.needsTimeValidation) {
            if (userState.availableTimes.includes(userState.resolvedTime)) {
                userState.needsTimeValidation = false;
            } else {
                await whatsappService.sendText(jid, `O horário de ${userState.resolvedTime} não está disponível para ${dateH.curto}. Veja as opções livres:`);
                userState.resolvedTime = null;
                userState.entities.time = null;
                userState.needsTimeValidation = false;
            }
        }

        if (!userState.resolvedTime) {
            if (userState.availableTimes.length === 0) {
                await whatsappService.sendText(jid, `Infelizmente não encontrei vagas para os critérios que você pediu em ${dateH.curto}. Vamos tentar outra data?`);
                userState.timeFilter = null; 
                userState.availableTimes = null; 
                userState.hasExactConflict = false;
                userState.resolvedDate = null;
                userState.entities.date = null;
                userState.step = 'AGENDAMENTO_COLLECTING_DATE';
                stateMachine.set(senderNumber, userState);
                return processarAgendamento(jid, null, senderNumber, stateMachine, {intent: 'UNKNOWN'}, false, configDb, cliente, isNewPatient);
            }

            if (intent === 'REQUEST_MORE_TIMES') {
                if (userState.timeIndex >= userState.availableTimes.length) {
                    await whatsappService.sendText(jid, `Estes são os últimos horários disponíveis para esse dia. Qual deles você prefere?`);
                    return; 
                }
            }

            const chunk = userState.availableTimes.slice(userState.timeIndex, userState.timeIndex + 2);
            const hasMore = (userState.timeIndex + 2) < userState.availableTimes.length;

            let optHoras = chunk.map(h => ({ id: `hora_${h}`, title: h }));
            if (hasMore) optHoras.push({ id: 'ver_mais_hora', title: 'Ver mais horários' });

            let textoApresentacao = "";
            if (userState.timeIndex === 0) {
                if (userState.hasExactConflict) {
                    textoApresentacao = `${dateH.curto} às ${entities.time || 'esse horário'} não está disponível. Estes são os horários mais próximos:`;
                    userState.hasExactConflict = false;
                } else if (userState.timeFilter) {
                    textoApresentacao = `Para ${dateH.curto}, encontrei estas vagas que atendem ao seu horário:`;
                } else {
                    textoApresentacao = `Horários livres para ${dateH.curto}:`;
                }
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
        const resumo = `*Resumo da Consulta*\n🩺 Procedimento: ${userState.resolvedTreatment.nome}\n👨‍⚕️ Profissional: ${userState.resolvedProfissional.nome}\n📅 Data: ${dateH.longo}\n🕐 Hora: ${userState.resolvedTime}\n\nPosso confirmar esse horário para você?`;
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

        const horasLivresNow = await getHorariosDisponiveis(userState.resolvedDate, userState.resolvedTreatment.duracaoMin, userState.resolvedProfissional.id, 'CLINICA');
        if(!horasLivresNow.includes(userState.resolvedTime)) {
             await whatsappService.sendText(jid, `Ops, alguém acabou de ocupar esse horário enquanto conversávamos. Vamos escolher outro.`);
             userState.resolvedTime = null;
             userState.step = 'AGENDAMENTO_AWAITING_TIME';
             stateMachine.set(senderNumber, userState);
             return processarAgendamento(jid, null, senderNumber, stateMachine, {intent: 'UNKNOWN'}, false, configDb, cliente, isNewPatient);
        }

        await prisma.agendamento.create({
            data: {
                dataHora: dataHoraDb, clienteId: senderNumber, status: 'AGENDADO',
                tratamentoId: userState.resolvedTreatment.id, profissionalSaudeId: userState.resolvedProfissional.id
            }
        });
        
        await prisma.cliente.update({ where: { id: senderNumber }, data: { leadStatus: 'AGENDADO' } });
        
        const dateH = humanizarData(userState.resolvedDate);
        await whatsappService.sendText(jid, `✅ *Consulta Confirmada!*\n\nSua reserva de *${userState.resolvedTreatment.nome}* está agendada para *${dateH.longo}* às *${userState.resolvedTime}*.\n\nUm lembrete será enviado quando a data estiver próxima. Esperamos por você!`);
        
        stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
    } else {
        await whatsappService.sendText(jid, 'Para finalizarmos, você confirma o agendamento acima? (Responda Sim ou Não)');
    }
}

module.exports = { processarAgendamento };