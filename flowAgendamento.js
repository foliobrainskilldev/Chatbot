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
                await sendDelayedText(null, jid, '⚠️ Opção inválida.\nPor favor, escolhe o serviço pelo catálogo.\n\n*(Ou digita 0 para cancelar)*');
                return;
            }
            userState.data.servico = servicoEscolhido;
            userState.step = STEPS.AGENDAMENTO_BARBEIRO;

            const barbeiros = await prisma.barbeiro.findMany();
            let optBarbeiros = barbeiros.map(b => ({ id: b.id.toString(), title: b.nome }));
            optBarbeiros.push({ id: 'qualquer', title: 'Qualquer um' }, { id: '0', title: 'Cancelar' });

            // IA GERA O TEXTO
            const pBarbeiro = `O cliente escolheu ${servicoEscolhido.nome}. Pergunta de forma super natural com qual dos nossos barbeiros ele prefere ser atendido.`;
            const txtBarbeiro = await gerarMensagemNotificacao(pBarbeiro, `Excelente escolha! Com qual barbeiro preferes?`);
            
            await sendInteractiveMenu(null, jid, txtBarbeiro, optBarbeiros);
            break;
        }

        case STEPS.AGENDAMENTO_BARBEIRO: {
            const barbs = await prisma.barbeiro.findMany();
            let barbeiroSelecionado = null;

            if (msg !== 'qualquer') {
                barbeiroSelecionado = barbs.find(b => b.id.toString() === msg);
                if (!barbeiroSelecionado && msg !== '0') {
                    await sendDelayedText(null, jid, '⚠️ Opção inválida.\nPor favor, escolhe um barbeiro clicando num dos botões.\n\n*(Ou digita 0 para cancelar)*');
                    return;
                }
            }

            userState.data.barbeiro = barbeiroSelecionado;
            userState.step = STEPS.AGENDAMENTO_DATA;

            const dias = getProximosDiasUteis(5);
            userState.data.diasDisponiveis = dias;
            let optDias = dias.map(d => ({ id: d, title: d }));
            optDias.push({ id: '0', title: 'Cancelar' });

            // IA GERA O TEXTO
            const pData = `O cliente vai cortar com ${barbeiroSelecionado ? barbeiroSelecionado.nome : 'qualquer um'}. Pede-lhe para selecionar a data do agendamento nos botões.`;
            const txtData = await gerarMensagemNotificacao(pData, `Perfeito! Escolhe a data nos botões abaixo:`);
            
            await sendInteractiveMenu(null, jid, txtData, optDias);
            break;
        }

        case STEPS.AGENDAMENTO_DATA: {
            const diasDisp = userState.data.diasDisponiveis;
            if (!diasDisp.includes(msg)) {
                await sendDelayedText(null, jid, '⚠️ Data inválida. Escolhe nos botões ou digita 0 para cancelar.');
                return;
            }

            userState.data.dataString = msg;
            userState.step = STEPS.AGENDAMENTO_HORA;
            const horasLivres = await getHorariosDisponiveis(prisma, msg, userState.data.servico.duracaoMin, userState.data.barbeiro?.id);

            if (horasLivres.length === 0) {
                userState.step = STEPS.AGENDAMENTO_DATA;
                const semH = await gerarMensagemNotificacao(`Não há horários livres para o dia ${msg}. Pede de forma amável para escolher outra data.`, `Lamento, a agenda está cheia nesse dia. Escolhe outra data:`);
                
                let optDiasRetry = diasDisp.map(d => ({ id: d, title: d }));
                optDiasRetry.push({ id: '0', title: 'Cancelar' });
                await sendInteractiveMenu(null, jid, semH, optDiasRetry);
                return;
            }

            userState.data.horasLivres = horasLivres;
            let optHoras = horasLivres.map(h => ({ id: h, title: h }));
            optHoras.push({ id: '0', title: 'Cancelar' });

            // IA GERA O TEXTO
            const pHora = `O cliente quer cortar no dia ${msg}. Pede para ele escolher o horário exato.`;
            const txtHora = await gerarMensagemNotificacao(pHora, `Ótimo! Para o dia ${msg}, seleciona um dos horários:`);

            await sendInteractiveMenu(null, jid, txtHora, optHoras);
            break;
        }

        case STEPS.AGENDAMENTO_HORA: {
            if (!userState.data.horasLivres.includes(msg)) {
                await sendDelayedText(null, jid, '⚠️ Horário selecionado já não é válido.\nPor favor, seleciona de novo ou digita 0 para cancelar.');
                return;
            }

            userState.data.horaString = msg;
            userState.step = STEPS.AGENDAMENTO_CONFIRMAR;

            const srv = userState.data.servico;
            const brb = userState.data.barbeiro ? userState.data.barbeiro.nome : 'Qualquer um';
            
            // IA GERA A INTRODUÇÃO
            const pConfirma = `O cliente já escolheu tudo. Pede-lhe para confirmar se os dados estão corretos.`;
            const txtIntro = await gerarMensagemNotificacao(pConfirma, `Por favor, confirma os teus dados abaixo:`);
            
            const resumo = `${txtIntro}\n\n✂️ Serviço: ${srv.nome}\n💈 Barbeiro: ${brb}\n📅 Data: ${userState.data.dataString}\n🕑 Hora: ${msg}`;

            await sendInteractiveMenu(null, jid, resumo, [{ id: '1', title: 'Confirmar' }, { id: '0', title: 'Cancelar' }]);
            break;
        }

        case STEPS.AGENDAMENTO_CONFIRMAR: {
            if (msg === '1') {
                const dataHoraDb = parse(`${userState.data.dataString} ${userState.data.horaString}`, 'dd/MM/yyyy HH:mm', new Date());

                await prisma.agendamento.create({
                    data: {
                        dataHora: dataHoraDb, clienteId: senderNumber,
                        servicoId: userState.data.servico.id, barbeiroId: userState.data.barbeiro?.id || null
                    }
                });

                const pSucesso = `O agendamento do cliente foi concluído com sucesso. Redige uma mensagem de celebração/despedida curta informando que o estamos a aguardar e que para voltar ao menu basta enviar 'Menu'.`;
                const txtSucesso = await gerarMensagemNotificacao(pSucesso, `✅ Agendamento Confirmado! Aguardamos por ti.\n(Para voltar ao menu, digita "Menu").`);
                
                await sendDelayedText(null, jid, txtSucesso);
                stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });

            } else if (msg === '0') {
                stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
                await sendDelayedText(null, jid, 'Agendamento abortado com sucesso.');
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
        await sendDelayedText(null, jid, '⚠️ Já tens 2 agendamentos futuros. Cancela um primeiro (opção "Cancelar" do Menu) antes de marcar um novo.');
        return;
    }

    stateMachine.set(senderNumber, { step: STEPS.AGENDAMENTO_SERVICO, data: {} });
    const CATALOG_ID = process.env.CATALOG_ID;
    
    // IA GERA O TEXTO INICIAL DO CATÁLOGO
    const pCat = `O cliente quer iniciar um agendamento. Pede-lhe de forma muito curta para selecionar o serviço abaixo.`;
    const txtCat = await gerarMensagemNotificacao(pCat, "Para começarmos, seleciona o serviço abaixo:");

    const sections = [{
        title: "Cortes e Barboterapia",
        product_items: [
            { product_retailer_id: process.env.PRODUTO_1_ID || "h5fj6325da" },
            { product_retailer_id: process.env.PRODUTO_2_ID || "8pdji0vdor" },
            { product_retailer_id: process.env.PRODUTO_3_ID || "af2o2iuwey" }
        ]
    }];

    try {
        await sendProductList(jid, CATALOG_ID, "Tabela de Serviços ✂️", txtCat, sections);
    } catch (error) {
        const servicos = await prisma.servico.findMany();
        let optServicos = servicos.map(s => ({ id: s.id.toString(), title: s.nome, description: `${s.preco} MT` }));
        optServicos.push({ id: '0', title: 'Cancelar' });
        await sendInteractiveMenu(null, jid, txtCat, optServicos);
    }
}

module.exports = { iniciarAgendamento, handleAgendamento };