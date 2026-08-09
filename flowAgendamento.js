const { prisma } = require('./db');
const { getProximosDiasUteis, getHorariosDisponiveis } = require('./dateUtils');
const { parse } = require('date-fns');
const whatsappService = require('./whatsappService');

async function iniciarAgendamento(jid, senderNumber, stateMachine, STEPS) {
    // Validação real: Limitar a 2 agendamentos futuros para evitar spam na agenda
    const agendamentos = await prisma.agendamento.count({
        where: {
            clienteId: senderNumber,
            status: 'AGENDADO',
            dataHora: { gte: new Date() }
        }
    });

    if (agendamentos >= 2) {
        await whatsappService.sendText(jid, '⚠️ Já possui 2 agendamentos futuros marcados. Por favor, cancele um deles primeiro se precisar remarcar.');
        return;
    }

    stateMachine.set(senderNumber, { step: STEPS.AGENDAMENTO_SERVICO, data: {} });
    
    // Busca os serviços reais do banco de dados
    const servicos = await prisma.servico.findMany();
    if (servicos.length === 0) {
        await whatsappService.sendText(jid, 'Neste momento não temos serviços cadastrados no sistema. Tente novamente mais tarde.');
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        return;
    }

    const txtCat = "Vamos agendar! Escolha o serviço abaixo:";
    let optServicos = servicos.map(s => ({
        id: `srv_${s.id}`,
        title: s.nome,
        description: `${s.preco} MT`
    }));
    optServicos.push({ id: '0', title: 'Cancelar' });

    await whatsappService.sendInteractiveMenu(jid, txtCat, optServicos);
}

async function handleAgendamento(jid, textMessage, senderNumber, stateMachine, STEPS) {
    const userState = stateMachine.get(senderNumber);
    const step = userState.step;
    let msg = textMessage.trim();

    if (msg === '0') {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await whatsappService.sendText(jid, 'Operação cancelada. Voltamos ao menu principal.');
        return;
    }

    switch (step) {
        case STEPS.AGENDAMENTO_SERVICO: {
            const servicoId = msg.replace('srv_', '');
            const servicoEscolhido = await prisma.servico.findUnique({ where: { id: parseInt(servicoId) } });
            
            if (!servicoEscolhido) {
                await whatsappService.sendText(jid, '⚠️ Escolha inválida. Por favor, selecione uma opção válida nos botões ou digite 0 para cancelar.');
                return;
            }
            
            userState.data.servico = servicoEscolhido;
            userState.step = STEPS.AGENDAMENTO_BARBEIRO;

            const barbeiros = await prisma.barbeiro.findMany();
            let optBarbeiros = barbeiros.map(b => ({
                id: `barb_${b.id}`,
                title: b.nome
            }));
            optBarbeiros.push({ id: 'barb_qualquer', title: 'Qualquer um' });
            optBarbeiros.push({ id: '0', title: 'Cancelar' });

            await whatsappService.sendInteractiveMenu(jid, "Boa escolha! Prefere ser atendido por qual profissional?", optBarbeiros);
            break;
        }

        case STEPS.AGENDAMENTO_BARBEIRO: {
            let barbeiroSelecionado = null;
            
            if (msg !== 'barb_qualquer' && msg !== 'qualquer') {
                const barbId = msg.replace('barb_', '');
                barbeiroSelecionado = await prisma.barbeiro.findUnique({ where: { id: parseInt(barbId) } });
                
                if (!barbeiroSelecionado && msg !== '0') {
                    await whatsappService.sendText(jid, '⚠️ Profissional inválido. Use os botões ou digite 0 para cancelar.');
                    return;
                }
            }
            
            userState.data.barbeiro = barbeiroSelecionado;
            userState.step = STEPS.AGENDAMENTO_DATA;

            const dias = getProximosDiasUteis(5);
            userState.data.diasDisponiveis = dias;
            
            let optDias = dias.map(d => ({ id: d, title: d }));
            optDias.push({ id: '0', title: 'Cancelar' });

            await whatsappService.sendInteractiveMenu(jid, "Perfeito! Escolha a data nos botões abaixo:", optDias);
            break;
        }

        case STEPS.AGENDAMENTO_DATA: {
            const diasDisp = userState.data.diasDisponiveis;
            if (!diasDisp.includes(msg)) {
                await whatsappService.sendText(jid, '⚠️ Data inválida. Escolha nos botões ou digite 0 para cancelar.');
                return;
            }

            userState.data.dataString = msg;
            userState.step = STEPS.AGENDAMENTO_HORA;
            
            const horasLivres = await getHorariosDisponiveis(msg, userState.data.servico.duracaoMin, userState.data.barbeiro?.id);

            if (horasLivres.length === 0) {
                userState.step = STEPS.AGENDAMENTO_DATA; // Volta um passo
                let optDiasRetry = diasDisp.map(d => ({ id: d, title: d }));
                optDiasRetry.push({ id: '0', title: 'Cancelar' });
                
                await whatsappService.sendInteractiveMenu(jid, "Infelizmente, a agenda está cheia para esse dia. Pode escolher outra data?", optDiasRetry);
                return;
            }

            userState.data.horasLivres = horasLivres;
            let optHoras = horasLivres.map(h => ({ id: h, title: h }));
            optHoras.push({ id: '0', title: 'Cancelar' });

            await whatsappService.sendInteractiveMenu(jid, `Certo! Para o dia ${msg}, selecione o horário pretendido:`, optHoras);
            break;
        }

        case STEPS.AGENDAMENTO_HORA: {
            if (!userState.data.horasLivres.includes(msg)) {
                await whatsappService.sendText(jid, '⚠️ Horário selecionado já passou ou é inválido. Tente novamente ou digite 0.');
                return;
            }

            userState.data.horaString = msg;
            userState.step = STEPS.AGENDAMENTO_CONFIRMAR;

            const srv = userState.data.servico;
            const brb = userState.data.barbeiro ? userState.data.barbeiro.nome : 'Qualquer um';
            const resumo = `*Estamos quase lá!*\nPor favor, confirme se está tudo correto:\n\n✂️ Serviço: ${srv.nome}\n💈 Profissional: ${brb}\n📅 Data: ${userState.data.dataString}\n🕑 Hora: ${msg}`;

            await whatsappService.sendInteractiveMenu(jid, resumo, [
                { id: '1', title: 'Confirmar Agendamento' }, 
                { id: '0', title: 'Cancelar Tudo' }
            ]);
            break;
        }

        case STEPS.AGENDAMENTO_CONFIRMAR: {
            if (msg === '1' || msg === 'Confirmar Agendamento') {
                const dataHoraDb = parse(`${userState.data.dataString} ${userState.data.horaString}`, 'dd/MM/yyyy HH:mm', new Date());
                
                await prisma.agendamento.create({
                    data: {
                        dataHora: dataHoraDb,
                        clienteId: senderNumber,
                        servicoId: userState.data.servico.id,
                        barbeiroId: userState.data.barbeiro?.id || null,
                        status: 'AGENDADO'
                    }
                });

                // Atualiza o CRM (Qualifica o Lead como "AGENDADO")
                await prisma.cliente.update({
                    where: { id: senderNumber },
                    data: { leadStatus: 'AGENDADO' }
                });

                await whatsappService.sendText(jid, "✅ Agendamento confirmado com sucesso! Lhe enviaremos um lembrete antes do horário. Aguardamos sua visita.");
                stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
            } else {
                stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
                await whatsappService.sendText(jid, 'Agendamento cancelado.');
            }
            break;
        }
    }
}

module.exports = {
    iniciarAgendamento,
    handleAgendamento
};