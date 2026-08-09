const { prisma } = require('../db');
const { getProximosDiasUteis, getHorariosDisponiveis } = require('../dateUtils');
const { parse } = require('date-fns');
const whatsappService = require('../whatsappService');
const webhookService = require('../services/webhookService');

async function iniciarAgendamentoClinica(jid, senderNumber, stateMachine, STEPS) {
    const agendamentosPendentes = await prisma.agendamento.count({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }
    });

    if (agendamentosPendentes >= 2) {
        await whatsappService.sendText(jid, 'Você já possui agendamentos pendentes. Por favor, aguarde suas consultas atuais ou contate a recepção para reagendar.');
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        return;
    }

    stateMachine.set(senderNumber, { step: STEPS.AGENDAMENTO_TRATAMENTO, data: {} });
    
    const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO' } });
    if (tratamentos.length === 0) {
        await whatsappService.sendText(jid, 'No momento, nossos tratamentos não estão disponíveis para agendamento online. Vou transferir para a recepção.');
        await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true } });
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        return;
    }

    let optTratamentos = tratamentos.map(t => ({ id: `trat_${t.id}`, title: t.nome }));
    optTratamentos.push({ id: '0', title: 'Cancelar Agendamento' });
    
    await whatsappService.sendInteractiveMenu(jid, "Ótimo! Qual especialidade ou tratamento você deseja agendar?", optTratamentos);
}

async function handleAgendamentoClinica(jid, textMessage, senderNumber, stateMachine, STEPS) {
    const userState = stateMachine.get(senderNumber);
    const step = userState.step;
    let msg = textMessage.trim();

    if (msg === '0') {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await whatsappService.sendText(jid, 'Processo de agendamento cancelado. Se precisar de algo, basta avisar.');
        return;
    }

    switch (step) {
        case STEPS.AGENDAMENTO_TRATAMENTO: {
            const idTrat = msg.replace('trat_', '');
            const tratamentoDb = await prisma.tratamento.findUnique({ where: { id: parseInt(idTrat) } });
            
            if (!tratamentoDb) return await whatsappService.sendText(jid, 'Opção inválida. Digite 0 para cancelar.');
            
            userState.data.tratamento = tratamentoDb;
            userState.step = STEPS.AGENDAMENTO_MEDICO;
            
            const medicos = await prisma.profissionalSaude.findMany();
            let optMedicos = medicos.map(m => ({ id: `med_${m.id}`, title: m.nome, description: m.especialidade }));
            optMedicos.push({ id: 'med_qualquer', title: 'Sem Preferência' }, { id: '0', title: 'Cancelar' });
            
            await whatsappService.sendInteractiveMenu(jid, "Você tem preferência por algum médico(a) ou especialista?", optMedicos);
            break;
        }
        case STEPS.AGENDAMENTO_MEDICO: {
            if (msg !== 'med_qualquer') {
                const idMed = msg.replace('med_', '');
                const medicoDb = await prisma.profissionalSaude.findUnique({ where: { id: parseInt(idMed) } });
                if (medicoDb) userState.data.medico = medicoDb;
            }
            
            userState.step = STEPS.AGENDAMENTO_DATA;
            const dias = getProximosDiasUteis(7);
            userState.data.diasDisponiveis = dias;
            
            let optDias = dias.map(d => ({ id: d, title: d }));
            optDias.push({ id: '0', title: 'Cancelar' });
            
            await whatsappService.sendInteractiveMenu(jid, "Para qual data você gostaria de agendar?", optDias);
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
                return await whatsappService.sendInteractiveMenu(jid, "Nossa agenda está cheia nesta data para esta especialidade. Por favor, escolha outro dia:", optDias);
            }
            
            userState.data.horasLivres = horasLivres;
            let optHoras = horasLivres.map(h => ({ id: h, title: h }));
            optHoras.push({ id: '0', title: 'Cancelar' });
            
            await whatsappService.sendInteractiveMenu(jid, "Selecione o horário disponível de sua preferência:", optHoras);
            break;
        }
        case STEPS.AGENDAMENTO_HORA: {
            if (!userState.data.horasLivres.includes(msg)) return await whatsappService.sendText(jid, 'Horário inválido.');
            
            userState.data.horaString = msg;
            userState.step = STEPS.AGENDAMENTO_CONFIRMAR;
            
            const resumo = `Resumo da Consulta:\n\n🩺 Especialidade: ${userState.data.tratamento.nome}\n👨‍⚕️ Profissional: ${userState.data.medico?.nome || 'De Plantão'}\n📅 Data: ${userState.data.dataString} às ${msg}\n\nPodemos confirmar?`;
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
                    }
                });
                
                const leadAlterado = await prisma.cliente.update({ 
                    where: { id: senderNumber }, 
                    data: { leadStatus: 'AGENDADO' } 
                });

                await whatsappService.sendText(jid, "Consulta confirmada com sucesso! Você receberá um lembrete antes do horário.");
                
                // Automação: Dispara Webhook Externo (Ex: para o RD Station da Clínica)
                await webhookService.dispararEvento('appointment.created', { agendamento: novoAgendamento, lead: leadAlterado });
            } else {
                await whatsappService.sendText(jid, 'Processo cancelado.');
            }
            stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
            break;
        }
    }
}

module.exports = { iniciarAgendamentoClinica, handleAgendamentoClinica };