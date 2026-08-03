const { prisma } = require('./db');
const { getProximosDiasUteis, getHorariosDisponiveis } = require('./dateUtils');
const { parse } = require('date-fns');
const { sendInteractiveMenu, sendDelayedText } = require('./botUtils');
const { sendProductList } = require('./whatsappApi');
const { gerarMensagemNotificacao } = require('./groqApi');

async function handleAgendamento(sockIgnorado, jid, textMessage, senderNumber, stateMachine, STEPS) {
    const userState = stateMachine.get(senderNumber);
    const step = userState.step;
    const msg = textMessage.trim();

    if (msg === '0') {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await sendDelayedText(null, jid, 'Operação cancelada. A voltar ao menu...');
        return;
    }

    switch (step) {
        case STEPS.AGENDAMENTO_SERVICO: {
            const servicos = await prisma.servico.findMany();
            const servicoEscolhido = servicos.find(s => s.id.toString() === msg);
            if (!servicoEscolhido) {
                await sendDelayedText(null, jid, '⚠️ Escolha inválida. Por favor, tenta novamente no catálogo ou digita 0.');
                return;
            }
            userState.data.servico = servicoEscolhido;
            userState.step = STEPS.AGENDAMENTO_BARBEIRO;

            const barbeiros = await prisma.barbeiro.findMany();
            let optBarbeiros = barbeiros.map(b => ({ id: b.id.toString(), title: b.nome }));
            optBarbeiros.push({ id: 'qualquer', title: 'Qualquer um' }, { id: '0', title: 'Cancelar' });

            const txtBarbeiro = await gerarMensagemNotificacao(`Pergunta de forma simpática com qual barbeiro o cliente prefere cortar. PROIBIDO usar aspas (""). PROIBIDO criar listas (-).`, `Boa escolha! Preferes ser atendido por qual barbeiro?`);
            await sendInteractiveMenu(null, jid, txtBarbeiro, optBarbeiros);
            break;
        }

        case STEPS.AGENDAMENTO_BARBEIRO: {
            const barbs = await prisma.barbeiro.findMany();
            let barbeiroSelecionado = null;
            if (msg !== 'qualquer') {
                barbeiroSelecionado = barbs.find(b => b.id.toString() === msg);
                if (!barbeiroSelecionado && msg !== '0') {
                    await sendDelayedText(null, jid, '⚠️ Escolha inválida. Usa os botões ou digita 0.');
                    return;
                }
            }
            userState.data.barbeiro = barbeiroSelecionado;
            userState.step = STEPS.AGENDAMENTO_DATA;

            const dias = getProximosDiasUteis(5);
            userState.data.diasDisponiveis = dias;
            let optDias = dias.map(d => ({ id: d, title: d }));
            optDias.push({ id: '0', title: 'Cancelar' });

            const txtData = await gerarMensagemNotificacao(`Pede de forma gentil para ele selecionar a data do agendamento nos botões. PROIBIDO usar aspas ("") e PROIBIDO criar listas (-).`, `Perfeito! Escolhe a data nos botões abaixo:`);
            await sendInteractiveMenu(null, jid, txtData, optDias);
            break;
        }

        case STEPS.AGENDAMENTO_DATA: {
            const diasDisp = userState.data.diasDisponiveis;
            if (!diasDisp.includes(msg)) {
                await sendDelayedText(null, jid, '⚠️ Data inválida. Escolhe nos botões ou digita 0.');
                return;
            }

            userState.data.dataString = msg;
            userState.step = STEPS.AGENDAMENTO_HORA;
            const horasLivres = await getHorariosDisponiveis(prisma, msg, userState.data.servico.duracaoMin, userState.data.barbeiro?.id);

            if (horasLivres.length === 0) {
                userState.step = STEPS.AGENDAMENTO_DATA;
                const semH = await gerarMensagemNotificacao(`Informa o cliente de forma amigável que a agenda está cheia nesse dia. PROIBIDO usar aspas ("") e PROIBIDO criar listas (-).`, `Infelizmente, a agenda está cheia para esse dia. Podes escolher outra data?`);
                let optDiasRetry = diasDisp.map(d => ({ id: d, title: d }));
                optDiasRetry.push({ id: '0', title: 'Cancelar' });
                await sendInteractiveMenu(null, jid, semH, optDiasRetry);
                return;
            }

            userState.data.horasLivres = horasLivres;
            let optHoras = horasLivres.map(h => ({ id: h, title: h }));
            optHoras.push({ id: '0', title: 'Cancelar' });

            const txtHora = await gerarMensagemNotificacao(`Pede de forma simpática para o cliente escolher o horário exato. PROIBIDO usar aspas ("") e PROIBIDO criar listas (-).`, `Certo! Para o dia ${msg}, seleciona o horário pretendido:`);
            await sendInteractiveMenu(null, jid, txtHora, optHoras);
            break;
        }

        case STEPS.AGENDAMENTO_HORA: {
            if (!userState.data.horasLivres.includes(msg)) {
                await sendDelayedText(null, jid, '⚠️ Horário selecionado já passou ou é inválido. Tenta novamente ou digita 0.');
                return;
            }

            userState.data.horaString = msg;
            userState.step = STEPS.AGENDAMENTO_CONFIRMAR;

            const srv = userState.data.servico;
            const brb = userState.data.barbeiro ? userState.data.barbeiro.nome : 'Qualquer um';
            const txtIntro = await gerarMensagemNotificacao(`Pede ao cliente para confirmar se os dados do agendamento estão corretos. PROIBIDO usar aspas ("") e PROIBIDO criar listas (-).`, `Estamos quase lá! Por favor, confirma se está tudo certinho:`);
            const resumo = `${txtIntro}\n\n✂️ Serviço: ${srv.nome}\n💈 Barbeiro: ${brb}\n📅 Data: ${userState.data.dataString}\n🕑 Hora: ${msg}`;

            await sendInteractiveMenu(null, jid, resumo, [{ id: '1', title: 'Confirmar' }, { id: '0', title: 'Cancelar' }]);
            break;
        }

        case STEPS.AGENDAMENTO_CONFIRMAR: {
            if (msg === '1') {
                const dataHoraDb = parse(`${userState.data.dataString} ${userState.data.horaString}`, 'dd/MM/yyyy HH:mm', new Date());
                await prisma.agendamento.create({
                    data: { dataHora: dataHoraDb, clienteId: senderNumber, servicoId: userState.data.servico.id, barbeiroId: userState.data.barbeiro?.id || null }
                });

                const txtSucesso = await gerarMensagemNotificacao(`Redige uma mensagem simpática confirmando o agendamento. PROIBIDO usar aspas ("") e PROIBIDO criar listas (-).`, `✅ Agendamento confirmado! Aguardamos a tua visita.\n(Para voltares, digita "Menu").`);
                await sendDelayedText(null, jid, txtSucesso);
                stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
            } else if (msg === '0') {
                stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
                await sendDelayedText(null, jid, 'Agendamento cancelado.');
            }
            break;
        }
    }
}

async function iniciarAgendamento(sockIgnorado, jid, senderNumber, stateMachine, STEPS) {
    const agendamentos = await prisma.agendamento.count({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }
    });

    if (agendamentos >= 2) {
        await sendDelayedText(null, jid, '⚠️ Já tens 2 agendamentos futuros marcados. Podes cancelar um primeiro se precisares de remarcar.');
        return;
    }

    stateMachine.set(senderNumber, { step: STEPS.AGENDAMENTO_SERVICO, data: {} });
    const txtCat = await gerarMensagemNotificacao(`Inicia o agendamento pedindo amigavelmente para selecionar o serviço. PROIBIDO usar aspas ("") e PROIBIDO criar listas (-).`, "Vamos agendar! Escolhe o serviço abaixo que preferes:");

    const sections = [{
        title: "Cortes e Barboterapia",
        product_items: [
            { product_retailer_id: process.env.PRODUTO_1_ID || "h5fj6325da" },
            { product_retailer_id: process.env.PRODUTO_2_ID || "8pdji0vdor" },
            { product_retailer_id: process.env.PRODUTO_3_ID || "af2o2iuwey" }
        ]
    }];

    try {
        await sendProductList(jid, process.env.CATALOG_ID, "Tabela de Serviços ✂️", txtCat, sections);
    } catch (error) {
        const servicos = await prisma.servico.findMany();
        let optServicos = servicos.map(s => ({ id: s.id.toString(), title: s.nome, description: `${s.preco} MT` }));
        optServicos.push({ id: '0', title: 'Cancelar' });
        await sendInteractiveMenu(null, jid, txtCat, optServicos);
    }
}

module.exports = { iniciarAgendamento, handleAgendamento };