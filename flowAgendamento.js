const { prisma } = require('./db');
const { getProximosDiasUteis, getHorariosDisponiveis } = require('./dateUtils');
const { parse } = require('date-fns');
const { sendInteractiveMenu, sendDelayedText } = require('./botUtils');

async function handleAgendamento(sock, jid, textMessage, senderNumber, stateMachine, STEPS) {
    const userState = stateMachine.get(senderNumber);
    const step = userState.step;
    const msg = textMessage.trim();

    if (msg.toLowerCase() === '0') {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await sendDelayedText(sock, jid, 'Operação cancelada. A voltar ao menu...');
        return;
    }

    switch (step) {
        case STEPS.AGENDAMENTO_SERVICO:
            const servicos = await prisma.servico.findMany();
            const servicoEscolhido = servicos.find(s => s.id.toString() === msg);
            
            if (!servicoEscolhido) {
                await sendDelayedText(sock, jid, 'Opção inválida.');
                return;
            }
            userState.data.servico = servicoEscolhido;
            userState.step = STEPS.AGENDAMENTO_BARBEIRO;
            
            const barbeiros = await prisma.barbeiro.findMany();
            let optBarbeiros = barbeiros.map(b => ({ id: b.id.toString(), title: b.nome }));
            optBarbeiros.push({ id: 'qualquer', title: 'Qualquer disponível' }, { id: '0', title: '❌ Cancelar' });
            
            await sendInteractiveMenu(sock, jid, 'Ótima escolha! 💈\nCom qual barbeiro preferes?', optBarbeiros);
            break;

        case STEPS.AGENDAMENTO_BARBEIRO:
            const barbs = await prisma.barbeiro.findMany();
            let barbeiroSelecionado = null;
            if (msg !== 'qualquer') barbeiroSelecionado = barbs.find(b => b.id.toString() === msg);
            
            userState.data.barbeiro = barbeiroSelecionado;
            userState.step = STEPS.AGENDAMENTO_DATA;

            const dias = getProximosDiasUteis(5);
            userState.data.diasDisponiveis = dias;
            let optDias = dias.map(d => ({ id: d, title: d }));
            optDias.push({ id: '0', title: '❌ Cancelar' });

            await sendInteractiveMenu(sock, jid, '📅 Escolhe uma data:', optDias);
            break;

        case STEPS.AGENDAMENTO_DATA:
            const diasDisp = userState.data.diasDisponiveis;
            if (!diasDisp.includes(msg)) return;

            userState.data.dataString = msg;
            userState.step = STEPS.AGENDAMENTO_HORA;

            const horasLivres = await getHorariosDisponiveis(prisma, msg, userState.data.servico.duracaoMin, userState.data.barbeiro?.id);

            if (horasLivres.length === 0) {
                userState.step = STEPS.AGENDAMENTO_DATA;
                await sendDelayedText(sock, jid, '⚠️ Sem horários livres neste dia. Escolhe outra data, por favor:');
                return;
            }

            userState.data.horasLivres = horasLivres;
            let optHoras = horasLivres.map(h => ({ id: h, title: h }));
            optHoras.push({ id: '0', title: '❌ Cancelar' });

            await sendInteractiveMenu(sock, jid, `🕑 Horários para ${msg}:`, optHoras);
            break;

        case STEPS.AGENDAMENTO_HORA:
            if (!userState.data.horasLivres.includes(msg)) return;
            
            userState.data.horaString = msg;
            userState.step = STEPS.AGENDAMENTO_CONFIRMAR;

            const srv = userState.data.servico;
            const brb = userState.data.barbeiro ? userState.data.barbeiro.nome : 'Qualquer um';
            const resumo = `📝 *Confirma os dados:*\n\n✂️ Serviço: ${srv.nome}\n💈 Barbeiro: ${brb}\n📅 Data: ${userState.data.dataString}\n🕑 Hora: ${msg}`;
            
            // Aqui tem apenas 2 opções, o WhatsApp vai renderizar os botões lindamente no chat!
            await sendInteractiveMenu(sock, jid, resumo, [
                { id: '1', title: '✅ Confirmar' },
                { id: '0', title: '❌ Cancelar' }
            ]);
            break;

        case STEPS.AGENDAMENTO_CONFIRMAR:
            if (msg === '1') {
                const dataHoraString = `${userState.data.dataString} ${userState.data.horaString}`;
                const dataHoraDb = parse(dataHoraString, 'dd/MM/yyyy HH:mm', new Date());

                await prisma.agendamento.create({
                    data: {
                        dataHora: dataHoraDb,
                        clienteId: senderNumber,
                        servicoId: userState.data.servico.id,
                        barbeiroId: userState.data.barbeiro?.id || null
                    }
                });

                await sendDelayedText(sock, jid, '✅ *Confirmado!*\nObrigado pela preferência. Para voltares ao menu, digita "Menu".');
                stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
            }
            break;
    }
}

async function iniciarAgendamento(sock, jid, senderNumber, stateMachine, STEPS) {
    const agendamentos = await prisma.agendamento.count({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }
    });

    if (agendamentos >= 2) {
        await sendDelayedText(sock, jid, '⚠️ Já tens 2 agendamentos futuros. Cancela um antes de marcar outro.');
        return;
    }

    const servicos = await prisma.servico.findMany();
    let optServicos = servicos.map(s => ({ id: s.id.toString(), title: s.nome, description: `${s.preco} MT` }));
    optServicos.push({ id: '0', title: '❌ Cancelar' });

    stateMachine.set(senderNumber, { step: STEPS.AGENDAMENTO_SERVICO, data: {} });
    await sendInteractiveMenu(sock, jid, '✂️ Qual serviço pretendes?', optServicos);
}

module.exports = { iniciarAgendamento, handleAgendamento };