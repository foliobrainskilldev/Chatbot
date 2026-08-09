const { prisma } = require('../db');
const { getProximosDiasUteis, getHorariosDisponiveis } = require('../dateUtils');
const { parse } = require('date-fns');
const whatsappService = require('../whatsappService');

async function iniciarAgendamentoClinica(jid, senderNumber, stateMachine, STEPS) {
    const agendamentos = await prisma.agendamento.count({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }
    });

    if (agendamentos >= 2) {
        await whatsappService.sendText(jid, '⚠️ Você já possui consultas futuras. Aguarde o atendimento ou cancele para marcar outra.');
        return;
    }

    stateMachine.set(senderNumber, { step: STEPS.AGENDAMENTO_TRATAMENTO, data: {} });
    
    // Busca apenas na tabela de tratamentos clínicos
    const tratamentos = await prisma.tratamento.findMany();
    if (tratamentos.length === 0) {
        await whatsappService.sendText(jid, 'Sem especialidades cadastradas no momento.');
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        return;
    }

    let optTratamentos = tratamentos.map(t => ({ id: `trat_${t.id}`, title: t.nome }));
    optTratamentos.push({ id: '0', title: 'Cancelar' });
    
    await whatsappService.sendInteractiveMenu(jid, "Qual especialidade ou consulta deseja agendar?", optTratamentos);
}

async function handleAgendamentoClinica(jid, textMessage, senderNumber, stateMachine, STEPS) {
    const userState = stateMachine.get(senderNumber);
    const step = userState.step;
    let msg = textMessage.trim();

    if (msg === '0') {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await whatsappService.sendText(jid, 'Operação cancelada. Voltamos ao menu principal.');
        return;
    }

    switch (step) {
        case STEPS.AGENDAMENTO_TRATAMENTO: {
            const idTrat = msg.replace('trat_', '');
            const tratamentoDb = await prisma.tratamento.findUnique({ where: { id: parseInt(idTrat) } });
            
            if (!tratamentoDb) return await whatsappService.sendText(jid, '⚠️ Escolha inválida. Digite 0 para cancelar.');
            
            userState.data.tratamento = tratamentoDb;
            userState.step = STEPS.AGENDAMENTO_MEDICO;
            
            const medicos = await prisma.profissionalSaude.findMany();
            let optMedicos = medicos.map(m => ({ id: `med_${m.id}`, title: m.nome, description: m.especialidade }));
            optMedicos.push({ id: 'med_qualquer', title: 'Sem Preferência' }, { id: '0', title: 'Cancelar' });
            
            await whatsappService.sendInteractiveMenu(jid, "Tem preferência por algum médico(a)?", optMedicos);
            break;
        }
        case STEPS.AGENDAMENTO_MEDICO: {
            if (msg !== 'med_qualquer') {
                const idMed = msg.replace('med_', '');
                const medicoDb = await prisma.profissionalSaude.findUnique({ where: { id: parseInt(idMed) } });
                if (medicoDb) userState.data.medico = medicoDb;
            }
            
            userState.step = STEPS.AGENDAMENTO_DATA;
            const dias = getProximosDiasUteis(7); // Clínica permite agendar mais pra frente
            userState.data.diasDisponiveis = dias;
            
            let optDias = dias.map(d => ({ id: d, title: d }));
            optDias.push({ id: '0', title: 'Cancelar' });
            
            await whatsappService.sendInteractiveMenu(jid, "Para quando gostaria de agendar a consulta?", optDias);
            break;
        }
        case STEPS.AGENDAMENTO_DATA: {
            if (!userState.data.diasDisponiveis.includes(msg)) return await whatsappService.sendText(jid, '⚠️ Data inválida.');
            
            userState.data.dataString = msg;
            userState.step = STEPS.AGENDAMENTO_HORA;
            
            // Aqui passamos null pro barbeiro, e o ID médico pro último argumento de getHorariosDisponiveis
            const horasLivres = await getHorariosDisponiveis(msg, userState.data.tratamento.duracaoMin, null, userState.data.medico?.id);
            
            if (horasLivres.length === 0) {
                userState.step = STEPS.AGENDAMENTO_DATA;
                let optDias = userState.data.diasDisponiveis.map(d => ({ id: d, title: d }));
                optDias.push({ id: '0', title: 'Cancelar' });
                return await whatsappService.sendInteractiveMenu(jid, "A agenda está cheia. Por favor, escolha outra data:", optDias);
            }
            
            userState.data.horasLivres = horasLivres;
            let optHoras = horasLivres.map(h => ({ id: h, title: h }));
            optHoras.push({ id: '0', title: 'Cancelar' });
            
            await whatsappService.sendInteractiveMenu(jid, "Selecione o horário desejado:", optHoras);
            break;
        }
        case STEPS.AGENDAMENTO_HORA: {
            if (!userState.data.horasLivres.includes(msg)) return await whatsappService.sendText(jid, '⚠️ Horário inválido.');
            
            userState.data.horaString = msg;
            userState.step = STEPS.AGENDAMENTO_CONFIRMAR;
            
            const resumo = `*Confirmação:*\n🩺 Consulta: ${userState.data.tratamento.nome}\n👨‍⚕️ Médico: ${userState.data.medico?.nome || 'De Plantão'}\n📅 Data: ${userState.data.dataString} às ${msg}`;
            await whatsappService.sendInteractiveMenu(jid, resumo, [{ id: '1', title: 'Confirmar' }, { id: '0', title: 'Cancelar' }]);
            break;
        }
        case STEPS.AGENDAMENTO_CONFIRMAR: {
            if (msg === '1') {
                const dataHoraDb = parse(`${userState.data.dataString} ${userState.data.horaString}`, 'dd/MM/yyyy HH:mm', new Date());
                
                await prisma.agendamento.create({
                    data: {
                        dataHora: dataHoraDb, clienteId: senderNumber, status: 'AGENDADO',
                        tratamentoId: userState.data.tratamento.id, profissionalSaudeId: userState.data.medico?.id || null
                    }
                });
                await prisma.cliente.update({ where: { id: senderNumber }, data: { leadStatus: 'AGENDADO' } });
                await whatsappService.sendText(jid, "✅ Consulta marcada com sucesso! Você receberá um lembrete.");
            }
            stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
            break;
        }
    }
}

module.exports = { iniciarAgendamentoClinica, handleAgendamentoClinica };