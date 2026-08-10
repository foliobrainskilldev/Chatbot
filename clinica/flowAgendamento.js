// --- START OF FILE flowAgendamento.js ---

const { prisma } = require('../db');
const { getProximosDiasUteis, getHorariosDisponiveis } = require('../dateUtils');
const { parse } = require('date-fns');
const whatsappService = require('../whatsappService');
const webhookService = require('../services/webhookService');
const automationEngine = require('../services/automationEngine'); // IMPORT MOTOR DE AUTOMAÇÃO

async function iniciarAgendamentoClinica(jid, senderNumber, stateMachine, STEPS) {
    const agendamentosPendentes = await prisma.agendamento.count({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }
    });

    if (agendamentosPendentes >= 2) {
        await whatsappService.sendText(jid, 'Você já possui limite de agendamentos pendentes. Por favor, aguarde suas consultas atuais ou contate a recepção para suporte.');
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        return;
    }

    stateMachine.set(senderNumber, { step: STEPS.AGENDAMENTO_TRATAMENTO, data: {} });
    
    const tratamentos = await prisma.tratamento.findMany({ 
        where: { status: 'ATIVO', podeAgendarIA: true } 
    });

    if (tratamentos.length === 0) {
        await whatsappService.sendText(jid, 'Nossas especialidades no momento requerem avaliação ou contato humano prévio para agendamento. Estou lhe transferindo para a recepção.');
        await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        return;
    }

    let optTratamentos = tratamentos.slice(0, 9).map(t => ({ id: `trat_${t.id}`, title: t.nome.substring(0, 24) }));
    optTratamentos.push({ id: '0', title: 'Cancelar' });
    
    await whatsappService.sendInteractiveMenu(jid, "Maravilha! Qual especialidade ou tratamento deseja agendar? (Selecione na lista)", optTratamentos);
}

async function handleAgendamentoClinica(jid, textMessage, senderNumber, stateMachine, STEPS) {
    const userState = stateMachine.get(senderNumber);
    const step = userState.step;
    let msg = textMessage.trim();

    if (msg === '0') {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await whatsappService.sendText(jid, 'Agendamento cancelado com sucesso. Se precisar de algo, estarei aqui.');
        return;
    }

    switch (step) {
        case STEPS.AGENDAMENTO_TRATAMENTO: {
            const idTrat = msg.replace('trat_', '');
            
            const tratamentoDb = await prisma.tratamento.findUnique({ 
                where: { id: parseInt(idTrat) },
                include: { profissionais: true }
            });
            
            if (!tratamentoDb || tratamentoDb.status !== 'ATIVO') {
                return await whatsappService.sendText(jid, 'Opção inválida ou serviço indisponível. Digite 0 para cancelar.');
            }
            
            userState.data.tratamento = tratamentoDb;
            userState.step = STEPS.AGENDAMENTO_MEDICO;
            
            let medicos = await prisma.profissionalSaude.findMany();
            
            if (tratamentoDb.profissionais && tratamentoDb.profissionais.length > 0) {
                const profIdsHabilitados = tratamentoDb.profissionais.map(p => p.id);
                medicos = medicos.filter(m => profIdsHabilitados.includes(m.id));
            }

            if (medicos.length === 0) {
                userState.data.medico = null; 
                userState.step = STEPS.AGENDAMENTO_DATA;
                return avancarParaData(jid, senderNumber, userState, STEPS);
            }

            let optMedicos = medicos.slice(0, 8).map(m => ({ id: `med_${m.id}`, title: m.nome.substring(0, 24), description: m.especialidade }));
            optMedicos.push({ id: 'med_qualquer', title: 'Sem Preferência' }, { id: '0', title: 'Cancelar' });
            
            await whatsappService.sendInteractiveMenu(jid, "Você tem preferência por algum especialista?", optMedicos);
            break;
        }
        case STEPS.AGENDAMENTO_MEDICO: {
            if (msg !== 'med_qualquer') {
                const idMed = msg.replace('med_', '');
                const medicoDb = await prisma.profissionalSaude.findUnique({ where: { id: parseInt(idMed) } });
                if (medicoDb) userState.data.medico = medicoDb;
            }
            
            await avancarParaData(jid, senderNumber, userState, STEPS);
            break;
        }
        case STEPS.AGENDAMENTO_DATA: {
            if (!userState.data.diasDisponiveis.includes(msg)) return await whatsappService.sendText(jid, 'Data inválida.');
            
            userState.data.dataString = msg;
            userState.step = STEPS.AGENDAMENTO_HORA;
            
            const horasLivres = await getHorariosDisponiveis(msg, userState.data.tratamento.duracaoMin, userState.data.medico?.id);
            
            if (horasLivres.length === 0) {
                userState.step = STEPS.AGENDAMENTO_DATA;
                let optDias = userState.data.diasDisponiveis.map(d => ({ id: d, title: d }));
                optDias.push({ id: '0', title: 'Cancelar' });
                return await whatsappService.sendInteractiveMenu(jid, "Nossa agenda está cheia nesta data. Por favor, escolha outro dia:", optDias);
            }
            
            userState.data.horasLivres = horasLivres;
            let optHoras = horasLivres.slice(0, 9).map(h => ({ id: h, title: h }));
            optHoras.push({ id: '0', title: 'Cancelar' });
            
            await whatsappService.sendInteractiveMenu(jid, "Selecione o horário disponível de sua preferência:", optHoras);
            break;
        }
        case STEPS.AGENDAMENTO_HORA: {
            if (!userState.data.horasLivres.includes(msg)) return await whatsappService.sendText(jid, 'Horário indisponível.');
            
            userState.data.horaString = msg;
            userState.step = STEPS.AGENDAMENTO_CONFIRMAR;
            
            const precoExibicao = userState.data.tratamento.tipoPreco === 'SOB_AVALIACAO' ? 'Sob Avaliação Clínica' : (userState.data.tratamento.preco ? `R$ ${userState.data.tratamento.preco}` : 'Variável');
            
            const resumo = `Resumo da Consulta:\n\n🩺 Tratamento: ${userState.data.tratamento.nome}\n💰 Preço Base: ${precoExibicao}\n👨‍⚕️ Especialista: ${userState.data.medico?.nome || 'De Plantão'}\n📅 Data: ${userState.data.dataString} às ${msg}\n\nPodemos confirmar?`;
            
            await whatsappService.sendInteractiveMenu(jid, resumo, [{ id: '1', title: 'Confirmar' }, { id: '0', title: 'Cancelar' }]);
            break;
        }
        case STEPS.AGENDAMENTO_CONFIRMAR: {
            if (msg === '1') {
                const dataHoraDb = parse(`${userState.data.dataString} ${userState.data.horaString}`, 'dd/MM/yyyy HH:mm', new Date());
                
                const novoAgendamento = await prisma.agendamento.create({
                    data: {
                        dataHora: dataHoraDb, clienteId: senderNumber, status: 'AGENDADO',
                        tratamentoId: userState.data.tratamento.id, profissionalSaudeId: userState.data.medico?.id || null
                    },
                    include: { cliente: true, tratamento: true }
                });
                
                const leadAlterado = await prisma.cliente.update({ 
                    where: { id: senderNumber }, 
                    data: { leadStatus: 'AGENDADO' } 
                });

                await whatsappService.sendText(jid, "Consulta e horário reservados com sucesso! Você receberá nosso lembrete automático antes da consulta. Obrigado!");
                
                // GATILHOS EXECUTADOS
                await webhookService.dispararEvento('appointment.created', { agendamento: novoAgendamento, lead: leadAlterado });
                await automationEngine.dispararAutomacoes('CONSULTA_CRIADA', novoAgendamento);
            } else {
                await whatsappService.sendText(jid, 'Processo cancelado.');
            }
            stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
            break;
        }
    }
}

async function avancarParaData(jid, senderNumber, userState, STEPS) {
    userState.step = STEPS.AGENDAMENTO_DATA;
    const dias = await getProximosDiasUteis(7);
    userState.data.diasDisponiveis = dias;
    
    let optDias = dias.slice(0, 9).map(d => ({ id: d, title: d }));
    optDias.push({ id: '0', title: 'Cancelar' });
    
    await whatsappService.sendInteractiveMenu(jid, "Para qual data você gostaria de agendar?", optDias);
}

module.exports = { iniciarAgendamentoClinica, handleAgendamentoClinica };