const { prisma } = require('./db');
const { getProximosDiasUteis, getHorariosDisponiveis } = require('./dateUtils');
const { parse, format } = require('date-fns');
const { sendInteractiveMenu, sendDelayedText } = require('./botUtils');

const STEPS_CLINICA_AG = {
    AGENDAMENTO_TRATAMENTO: 'CLINICA_AG_TRATAMENTO',
    AGENDAMENTO_MEDICO: 'CLINICA_AG_MEDICO',
    AGENDAMENTO_DATA: 'CLINICA_AG_DATA',
    AGENDAMENTO_HORA: 'CLINICA_AG_HORA',
    AGENDAMENTO_CONFIRMAR: 'CLINICA_AG_CONFIRMAR',
    CANCELAR_CONSULTA: 'CLINICA_CANCELAR',
    REMARCAR_CONSULTA: 'CLINICA_REMARCAR'
};

async function iniciarAgendamentoClinica(jid, senderNumber, stateMachine, stepBase) {
    stateMachine.set(senderNumber, { step: STEPS_CLINICA_AG.AGENDAMENTO_TRATAMENTO, data: {} });
    
    const tratamentos = await prisma.tratamento.findMany();
    let optTratamentos = tratamentos.map(t => ({
        id: `trat_${t.id}`,
        title: t.nome,
        description: `Duração: ${t.duracaoMin} min`
    }));
    optTratamentos.push({ id: '0', title: 'Cancelar' });
    
    await sendInteractiveMenu(null, jid, "Qual consulta/tratamento deseja agendar?", optTratamentos);
}

async function handleAgendamentoClinica(jid, textMessage, senderNumber, stateMachine, menuPrincipalStep) {
    const userState = stateMachine.get(senderNumber);
    const step = userState.step;
    let msg = textMessage.trim();

    if (msg === '0') {
        stateMachine.set(senderNumber, { step: menuPrincipalStep, data: {} });
        await sendDelayedText(null, jid, 'Operação cancelada. Voltamos ao menu principal.');
        return;
    }

    switch (step) {
        case STEPS_CLINICA_AG.AGENDAMENTO_TRATAMENTO: {
            if (msg.startsWith('trat_')) msg = msg.replace('trat_', '');
            const tratamentoDb = await prisma.tratamento.findUnique({ where: { id: parseInt(msg) } });
            
            if (!tratamentoDb) {
                await sendDelayedText(null, jid, '⚠️ Escolha inválida. Tente novamente ou digite 0.');
                return;
            }
            
            userState.data.tratamento = tratamentoDb;
            userState.step = STEPS_CLINICA_AG.AGENDAMENTO_MEDICO;
            
            const medicos = await prisma.profissionalSaude.findMany();
            let optMedicos = medicos.map(m => ({
                id: `med_${m.id}`, title: m.nome, description: m.especialidade
            }));
            optMedicos.push({ id: 'med_qualquer', title: 'Qualquer um' }, { id: '0', title: 'Cancelar' });
            
            await sendInteractiveMenu(null, jid, "Tem preferência por algum profissional?", optMedicos);
            break;
        }

        case STEPS_CLINICA_AG.AGENDAMENTO_MEDICO: {
            if (msg.startsWith('med_')) msg = msg.replace('med_', '');
            
            if (msg !== 'qualquer') {
                const medicoDb = await prisma.profissionalSaude.findUnique({ where: { id: parseInt(msg) } });
                if (medicoDb) userState.data.medico = medicoDb;
            }
            
            userState.step = STEPS_CLINICA_AG.AGENDAMENTO_DATA;
            const dias = getProximosDiasUteis(5);
            userState.data.diasDisponiveis = dias;
            let optDias = dias.map(d => ({ id: d, title: d }));
            optDias.push({ id: '0', title: 'Cancelar' });
            
            await sendInteractiveMenu(null, jid, "Para quando gostaria de agendar?", optDias);
            break;
        }

        case STEPS_CLINICA_AG.AGENDAMENTO_DATA: {
            if (!userState.data.diasDisponiveis.includes(msg)) {
                await sendDelayedText(null, jid, '⚠️ Data inválida. Digite 0 para cancelar.');
                return;
            }
            userState.data.dataString = msg;
            userState.step = STEPS_CLINICA_AG.AGENDAMENTO_HORA;
            
            // Passa os parâmetros de clínica para a verificação de data
            const horasLivres = await getHorariosDisponiveis(prisma, msg, userState.data.tratamento.duracaoMin, null, userState.data.medico?.id);
            
            if (horasLivres.length === 0) {
                userState.step = STEPS_CLINICA_AG.AGENDAMENTO_DATA;
                let optDias = userState.data.diasDisponiveis.map(d => ({ id: d, title: d }));
                optDias.push({ id: '0', title: 'Cancelar' });
                await sendInteractiveMenu(null, jid, "Agenda cheia neste dia. Escolha outra data:", optDias);
                return;
            }
            
            userState.data.horasLivres = horasLivres;
            let optHoras = horasLivres.map(h => ({ id: h, title: h }));
            optHoras.push({ id: '0', title: 'Cancelar' });
            
            await sendInteractiveMenu(null, jid, "Perfeito! Selecione o horário:", optHoras);
            break;
        }

        case STEPS_CLINICA_AG.AGENDAMENTO_HORA: {
            if (!userState.data.horasLivres.includes(msg)) {
                await sendDelayedText(null, jid, '⚠️ Horário inválido.');
                return;
            }
            userState.data.horaString = msg;
            userState.step = STEPS_CLINICA_AG.AGENDAMENTO_CONFIRMAR;
            
            const tr = userState.data.tratamento;
            const med = userState.data.medico ? userState.data.medico.nome : 'Indiferente';
            const resumo = `*Confirmação de Consulta:*\n\n🩺 Tratamento: ${tr.nome}\n👨‍⚕️ Profissional: ${med}\n📅 Data: ${userState.data.dataString}\n🕒 Hora: ${msg}`;
            
            await sendInteractiveMenu(null, jid, resumo, [{ id: '1', title: 'Confirmar' }, { id: '0', title: 'Cancelar' }]);
            break;
        }

        case STEPS_CLINICA_AG.AGENDAMENTO_CONFIRMAR: {
            if (msg === '1') {
                const dataHoraDb = parse(`${userState.data.dataString} ${userState.data.horaString}`, 'dd/MM/yyyy HH:mm', new Date());
                await prisma.agendamento.create({
                    data: {
                        dataHora: dataHoraDb,
                        clienteId: senderNumber,
                        tratamentoId: userState.data.tratamento.id,
                        profissionalSaudeId: userState.data.medico?.id || null
                    }
                });
                
                // Atualiza o Funil no CRM
                await prisma.cliente.update({ where: { id: senderNumber }, data: { leadStatus: 'AGENDADO' } });

                await sendDelayedText(null, jid, "✅ Consulta marcada com sucesso! Receberá um lembrete antes do horário.");
            }
            stateMachine.set(senderNumber, { step: menuPrincipalStep, data: {} });
            break;
        }
    }
}

async function iniciarCancelamentoClinica(jid, senderNumber, stateMachine, menuPrincipalStep) {
    const agendamentos = await prisma.agendamento.findMany({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() }, tratamentoId: { not: null } },
        include: { tratamento: true }, orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        await sendDelayedText(null, jid, "Não possui consultas agendadas.");
        stateMachine.set(senderNumber, { step: menuPrincipalStep, data: {} });
        return;
    }

    let opcoes = agendamentos.map((ag, i) => ({
        id: String(ag.id), title: ag.tratamento.nome, description: format(ag.dataHora, 'dd/MM HH:mm')
    }));
    opcoes.push({ id: '0', title: 'Voltar' });

    stateMachine.set(senderNumber, { step: STEPS_CLINICA_AG.CANCELAR_CONSULTA, data: { agendamentos } });
    await sendInteractiveMenu(null, jid, "Qual consulta deseja CANCELAR?", opcoes);
}

async function processarCancelamentoClinica(jid, textMessage, senderNumber, stateMachine, menuPrincipalStep) {
    if (textMessage.trim() === '0') {
        stateMachine.set(senderNumber, { step: menuPrincipalStep, data: {} });
        await sendDelayedText(null, jid, 'Operação abortada.');
        return;
    }

    try {
        await prisma.agendamento.update({ where: { id: parseInt(textMessage) }, data: { status: 'CANCELADO' } });
        await sendDelayedText(null, jid, "✅ Consulta cancelada com sucesso.");
    } catch {
        await sendDelayedText(null, jid, "Erro ao cancelar. Tente novamente.");
    }
    stateMachine.set(senderNumber, { step: menuPrincipalStep, data: {} });
}

module.exports = {
    iniciarAgendamentoClinica,
    handleAgendamentoClinica,
    iniciarCancelamentoClinica,
    processarCancelamentoClinica,
    STEPS_CLINICA_AG
};