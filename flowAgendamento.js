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
                await sendDelayedText(null, jid, '⚠️ Inválido. Por favor, clica na opção do catálogo.');
                return;
            }
            userState.data.servico = servicoEscolhido;
            userState.step = STEPS.AGENDAMENTO_BARBEIRO;

            const barbeiros = await prisma.barbeiro.findMany();
            let optBarbeiros = barbeiros.map(b => ({ id: b.id.toString(), title: b.nome }));
            optBarbeiros.push({ id: 'qualquer', title: 'Qualquer um' }, { id: '0', title: 'Cancelar' });

            const txtBarbeiro = await gerarMensagemNotificacao(`Diz APENAS: "Excelente! Com qual barbeiro preferes ser atendido? Escolhe num dos botões abaixo:"`, `Excelente! Com qual barbeiro preferes ser atendido? Escolhe abaixo:`);
            await sendInteractiveMenu(null, jid, txtBarbeiro, optBarbeiros);
            break;
        }

        case STEPS.AGENDAMENTO_BARBEIRO: {
            const barbs = await prisma.barbeiro.findMany();
            let barbeiroSelecionado = null;
            if (msg !== 'qualquer') {
                barbeiroSelecionado = barbs.find(b => b.id.toString() === msg);
                if (!barbeiroSelecionado && msg !== '0') {
                    await sendDelayedText(null, jid, '⚠️ Inválido. Por favor, clica num dos botões.');
                    return;
                }
            }
            userState.data.barbeiro = barbeiroSelecionado;
            userState.step = STEPS.AGENDAMENTO_DATA;

            const dias = getProximosDiasUteis(5);
            userState.data.diasDisponiveis = dias;
            let optDias = dias.map(d => ({ id: d, title: d }));
            optDias.push({ id: '0', title: 'Cancelar' });

            const txtData = await gerarMensagemNotificacao(`Diz APENAS: "Certo! Agora, clica num dos botões para escolher a data:"`, `Certo! Agora, clica num dos botões para escolher a data:`);
            await sendInteractiveMenu(null, jid, txtData, optDias);
            break;
        }

        case STEPS.AGENDAMENTO_DATA: {
            const diasDisp = userState.data.diasDisponiveis;
            if (!diasDisp.includes(msg)) {
                await sendDelayedText(null, jid, '⚠️ Inválido. Clica num dos botões.');
                return;
            }

            userState.data.dataString = msg;
            userState.step = STEPS.AGENDAMENTO_HORA;
            const horasLivres = await getHorariosDisponiveis(prisma, msg, userState.data.servico.duracaoMin, userState.data.barbeiro?.id);

            if (horasLivres.length === 0) {
                userState.step = STEPS.AGENDAMENTO_DATA;
                const semH = await gerarMensagemNotificacao(`Diz APENAS: "Agenda cheia neste dia. Clica noutra data nos botões:"`, `Agenda cheia. Escolhe outra data nos botões:`);
                let optDiasRetry = diasDisp.map(d => ({ id: d, title: d }));
                optDiasRetry.push({ id: '0', title: 'Cancelar' });
                await sendInteractiveMenu(null, jid, semH, optDiasRetry);
                return;
            }

            userState.data.horasLivres = horasLivres;
            let optHoras = horasLivres.map(h => ({ id: h, title: h }));
            optHoras.push({ id: '0', title: 'Cancelar' });

            const txtHora = await gerarMensagemNotificacao(`Diz APENAS: "Selecione o horário desejado nos botões abaixo:"`, `Selecione o horário desejado nos botões abaixo:`);
            await sendInteractiveMenu(null, jid, txtHora, optHoras);
            break;
        }

        case STEPS.AGENDAMENTO_HORA: {
            if (!userState.data.horasLivres.includes(msg)) {
                await sendDelayedText(null, jid, '⚠️ Horário selecionado já passou ou é inválido. Clica num botão válido.');
                return;
            }

            userState.data.horaString = msg;
            userState.step = STEPS.AGENDAMENTO_CONFIRMAR;

            const srv = userState.data.servico;
            const brb = userState.data.barbeiro ? userState.data.barbeiro.nome : 'Qualquer um';
            const txtIntro = await gerarMensagemNotificacao(`Diz APENAS: "Por favor, verifica os dados e clica em Confirmar:"`, `Por favor, verifica os dados e clica em Confirmar:`);
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

                const txtSucesso = await gerarMensagemNotificacao(`Diz APENAS: "✅ Agendamento Confirmado! Aguardamos por ti."`, `✅ Agendamento Confirmado! Aguardamos por ti.`);
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
        await sendDelayedText(null, jid, '⚠️ Tens 2 agendamentos futuros. Cancela um antes de marcar.');
        return;
    }

    stateMachine.set(senderNumber, { step: STEPS.AGENDAMENTO_SERVICO, data: {} });
    const txtCat = await gerarMensagemNotificacao(`Diz APENAS: "Para começarmos, por favor clica no botão abaixo para escolher o serviço:"`, "Para começarmos, clica no botão abaixo para escolher o serviço:");

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