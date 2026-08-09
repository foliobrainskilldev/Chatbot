const { prisma } = require('./db');
const { getProximosDiasUteis, getHorariosDisponiveis } = require('./dateUtils');
const { parse } = require('date-fns');
const whatsappService = require('./whatsappService');

const STEPS_CLINICA = {
    AGENDAMENTO_TRATAMENTO: 'CLINICA_AG_TRATAMENTO',
    AGENDAMENTO_MEDICO: 'CLINICA_AG_MEDICO',
    AGENDAMENTO_DATA: 'CLINICA_AG_DATA',
    AGENDAMENTO_HORA: 'CLINICA_AG_HORA',
    AGENDAMENTO_CONFIRMAR: 'CLINICA_AG_CONFIRMAR'
};

async function iniciarAgendamentoClinica(jid, senderNumber, stateMachine, menuPrincipalStep) {
    const agendamentos = await prisma.agendamento.count({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }
    });

    if (agendamentos >= 2) {
        await whatsappService.sendText(jid, '⚠️ O limite de agendamentos pendentes por paciente foi atingido. Por favor, cancele ou aguarde sua próxima consulta.');
        return;
    }

    stateMachine.set(senderNumber, { step: STEPS_CLINICA.AGENDAMENTO_TRATAMENTO, data: {} });
    
    const tratamentos = await prisma.tratamento.findMany();
    if (tratamentos.length === 0) {
        await whatsappService.sendText(jid, 'Sem especialidades médicas disponíveis no sistema no momento.');
        stateMachine.set(senderNumber, { step: menuPrincipalStep, data: {} });
        return;
    }

    let optTratamentos = tratamentos.map(t => ({
        id: `trat_${t.id}`,
        title: t.nome,
        description: `Duração: ${t.duracaoMin} min`
    }));
    optTratamentos.push({ id: '0', title: 'Cancelar' });
    
    await whatsappService.sendInteractiveMenu(jid, "Qual consulta, especialidade ou tratamento deseja agendar?", optTratamentos);
}

async function handleAgendamentoClinica(jid, textMessage, senderNumber, stateMachine, menuPrincipalStep) {
    const userState = stateMachine.get(senderNumber);
    const step = userState.step;
    let msg = textMessage.trim();

    if (msg === '0') {
        stateMachine.set(senderNumber, { step: menuPrincipalStep, data: {} });
        await whatsappService.sendText(jid, 'Operação cancelada. Voltamos ao menu principal da clínica.');
        return;
    }

    switch (step) {
        case STEPS_CLINICA.AGENDAMENTO_TRATAMENTO: {
            const idTrat = msg.replace('trat_', '');
            const tratamentoDb = await prisma.tratamento.findUnique({ where: { id: parseInt(idTrat) } });
            
            if (!tratamentoDb) {
                await whatsappService.sendText(jid, '⚠️ Escolha inválida. Tente novamente ou digite 0 para cancelar.');
                return;
            }
            
            userState.data.tratamento = tratamentoDb;
            userState.step = STEPS_CLINICA.AGENDAMENTO_MEDICO;
            
            const medicos = await prisma.profissionalSaude.findMany();
            let optMedicos = medicos.map(m => ({
                id: `med_${m.id}`, title: m.nome, description: m.especialidade
            }));
            optMedicos.push({ id: 'med_qualquer', title: 'Sem Preferência' }, { id: '0', title: 'Cancelar' });
            
            await whatsappService.sendInteractiveMenu(jid, "Tem preferência por algum médico(a)/profissional?", optMedicos);
            break;
        }

        case STEPS_CLINICA.AGENDAMENTO_MEDICO: {
            if (msg !== 'med_qualquer') {
                const idMed = msg.replace('med_', '');
                const medicoDb = await prisma.profissionalSaude.findUnique({ where: { id: parseInt(idMed) } });
                if (!medicoDb && msg !== '0') {
                    await whatsappService.sendText(jid, '⚠️ Profissional inválido.');
                    return;
                }
                userState.data.medico = medicoDb;
            }
            
            userState.step = STEPS_CLINICA.AGENDAMENTO_DATA;
            const dias = getProximosDiasUteis(7);
            userState.data.diasDisponiveis = dias;
            
            let optDias = dias.map(d => ({ id: d, title: d }));
            optDias.push({ id: '0', title: 'Cancelar' });
            
            await whatsappService.sendInteractiveMenu(jid, "Para quando gostaria de agendar sua consulta?", optDias);
            break;
        }

        case STEPS_CLINICA.AGENDAMENTO_DATA: {
            if (!userState.data.diasDisponiveis.includes(msg)) {
                await whatsappService.sendText(jid, '⚠️ Data inválida. Digite 0 para cancelar.');
                return;
            }
            userState.data.dataString = msg;
            userState.step = STEPS_CLINICA.AGENDAMENTO_HORA;
            
            // Note que aqui passamos `null` no barbeiro e `userState.data.medico?.id` no profissional de saúde
            const horasLivres = await getHorariosDisponiveis(msg, userState.data.tratamento.duracaoMin, null, userState.data.medico?.id);
            
            if (horasLivres.length === 0) {
                userState.step = STEPS_CLINICA.AGENDAMENTO_DATA;
                let optDias = userState.data.diasDisponiveis.map(d => ({ id: d, title: d }));
                optDias.push({ id: '0', title: 'Cancelar' });
                await whatsappService.sendInteractiveMenu(jid, "A agenda está cheia neste dia. Por favor, escolha outra data:", optDias);
                return;
            }
            
            userState.data.horasLivres = horasLivres;
            let optHoras = horasLivres.map(h => ({ id: h, title: h }));
            optHoras.push({ id: '0', title: 'Cancelar' });
            
            await whatsappService.sendInteractiveMenu(jid, "Perfeito! Selecione o horário desejado:", optHoras);
            break;
        }

        case STEPS_CLINICA.AGENDAMENTO_HORA: {
            if (!userState.data.horasLivres.includes(msg)) {
                await whatsappService.sendText(jid, '⚠️ Horário inválido.');
                return;
            }
            
            userState.data.horaString = msg;
            userState.step = STEPS_CLINICA.AGENDAMENTO_CONFIRMAR;
            
            const tr = userState.data.tratamento;
            const med = userState.data.medico ? userState.data.medico.nome : 'Médico de Plantão';
            const resumo = `*Confirmação de Consulta Médica:*\n\n🩺 Consulta: ${tr.nome}\n👨‍⚕️ Especialista: ${med}\n📅 Data: ${userState.data.dataString}\n🕒 Hora: ${msg}`;
            
            await whatsappService.sendInteractiveMenu(jid, resumo, [
                { id: '1', title: 'Confirmar Consulta' }, 
                { id: '0', title: 'Cancelar Tudo' }
            ]);
            break;
        }

        case STEPS_CLINICA.AGENDAMENTO_CONFIRMAR: {
            if (msg === '1' || msg === 'Confirmar Consulta') {
                const dataHoraDb = parse(`${userState.data.dataString} ${userState.data.horaString}`, 'dd/MM/yyyy HH:mm', new Date());
                
                await prisma.agendamento.create({
                    data: {
                        dataHora: dataHoraDb,
                        clienteId: senderNumber,
                        tratamentoId: userState.data.tratamento.id,
                        profissionalSaudeId: userState.data.medico?.id || null,
                        status: 'AGENDADO'
                    }
                });
                
                await prisma.cliente.update({ where: { id: senderNumber }, data: { leadStatus: 'AGENDADO' } });
                await whatsappService.sendText(jid, "✅ Consulta marcada com sucesso! Você receberá um lembrete antes do horário.");
            } else {
                await whatsappService.sendText(jid, "Procedimento abortado.");
            }
            
            stateMachine.set(senderNumber, { step: menuPrincipalStep, data: {} });
            break;
        }
    }
}

module.exports = {
    iniciarAgendamentoClinica,
    handleAgendamentoClinica,
    STEPS_CLINICA
};