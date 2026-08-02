const {
    prisma
} = require('./db');
const {
    getProximosDiasUteis,
    getHorariosDisponiveis
} = require('./dateUtils');
const {
    parse
} = require('date-fns');
const {
    sendInteractiveMenu,
    sendDelayedText
} = require('./botUtils');
const {
    sendProductList
} = require('./whatsappApi');

async function handleAgendamento(sockIgnorado, jid, textMessage, senderNumber, stateMachine, STEPS) {
    const userState = stateMachine.get(senderNumber);
    const step = userState.step;
    const msg = textMessage.trim();

    if (msg === '0') {
        stateMachine.set(senderNumber, {
            step: STEPS.MENU_PRINCIPAL,
            data: {}
        });
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
            let optBarbeiros = barbeiros.map(b => ({
                id: b.id.toString(),
                title: b.nome
            }));
            optBarbeiros.push({
                id: 'qualquer',
                title: 'Qualquer um'
            }, {
                id: '0',
                title: 'Cancelar'
            });

            await sendInteractiveMenu(null, jid, 'Ótima escolha! 💈\nCom qual barbeiro preferes?', optBarbeiros);
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
            let optDias = dias.map(d => ({
                id: d,
                title: d
            }));
            optDias.push({
                id: '0',
                title: 'Cancelar'
            });

            await sendInteractiveMenu(null, jid, '📅 Escolhe uma data para o corte:', optDias);
            break;
        }

        case STEPS.AGENDAMENTO_DATA: {
            const diasDisp = userState.data.diasDisponiveis;
            if (!diasDisp.includes(msg)) {
                await sendDelayedText(null, jid, '⚠️ Data inválida.\nPor favor, escolhe uma data clicando num dos botões.\n\n*(Ou digita 0 para cancelar)*');
                return;
            }

            userState.data.dataString = msg;
            userState.step = STEPS.AGENDAMENTO_HORA;

            const horasLivres = await getHorariosDisponiveis(prisma, msg, userState.data.servico.duracaoMin, userState.data.barbeiro?.id);

            if (horasLivres.length === 0) {
                userState.step = STEPS.AGENDAMENTO_DATA;
                await sendDelayedText(null, jid, '⚠️ Peço desculpa, mas já não temos horários livres neste dia.\n\nEscolhe outra data:');

                let optDiasRetry = diasDisp.map(d => ({
                    id: d,
                    title: d
                }));
                optDiasRetry.push({
                    id: '0',
                    title: 'Cancelar'
                });
                await sendInteractiveMenu(null, jid, '📅 Escolhe uma nova data:', optDiasRetry);
                return;
            }

            userState.data.horasLivres = horasLivres;
            let optHoras = horasLivres.map(h => ({
                id: h,
                title: h
            }));
            optHoras.push({
                id: '0',
                title: 'Cancelar'
            });

            await sendInteractiveMenu(null, jid, `🕑 Horários para ${msg}:`, optHoras);
            break;
        }

        case STEPS.AGENDAMENTO_HORA: {
            if (!userState.data.horasLivres.includes(msg)) {
                await sendDelayedText(null, jid, '⚠️ Horário selecionado já não é válido.\nPor favor, seleciona de novo.\n\n*(Ou digita 0 para cancelar)*');
                return;
            }

            userState.data.horaString = msg;
            userState.step = STEPS.AGENDAMENTO_CONFIRMAR;

            const srv = userState.data.servico;
            const brb = userState.data.barbeiro ? userState.data.barbeiro.nome : 'Qualquer um';
            const resumo = `📝 *Confirma os dados:*\n\n✂️ Serviço: ${srv.nome}\n💈 Barbeiro: ${brb}\n📅 Data: ${userState.data.dataString}\n🕑 Hora: ${msg}`;

            await sendInteractiveMenu(null, jid, resumo, [{
                    id: '1',
                    title: 'Confirmar'
                },
                {
                    id: '0',
                    title: 'Cancelar'
                }
            ]);
            break;
        }

        case STEPS.AGENDAMENTO_CONFIRMAR: {
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

                await sendDelayedText(null, jid, '✅ *Agendamento Confirmado!*\n\nMuito obrigado pela preferência, aguardamos por ti.\n(Para voltares ao menu principal basta enviar "Menu")');
                stateMachine.set(senderNumber, {
                    step: STEPS.MENU_PRINCIPAL,
                    data: {}
                });

            } else if (msg === '0') {
                stateMachine.set(senderNumber, {
                    step: STEPS.MENU_PRINCIPAL,
                    data: {}
                });
                await sendDelayedText(null, jid, 'Processo abortado com sucesso.');
            } else {
                await sendDelayedText(null, jid, '⚠️ Por favor, clica no botão Confirmar ou Cancelar.\n\n*(Ou digita 0)*');
            }
            break;
        }
    }
}

async function iniciarAgendamento(sockIgnorado, jid, senderNumber, stateMachine, STEPS) {
    const agendamentos = await prisma.agendamento.count({
        where: {
            clienteId: senderNumber,
            status: 'AGENDADO',
            dataHora: {
                gte: new Date()
            }
        }
    });

    if (agendamentos >= 2) {
        await sendDelayedText(null, jid, '⚠️ Já tens 2 agendamentos futuros.\nPara não comprometer a nossa agenda, cancela um primeiro (opção "Cancelar" do Menu) antes de marcar um novo.');
        return;
    }

    stateMachine.set(senderNumber, {
        step: STEPS.AGENDAMENTO_SERVICO,
        data: {}
    });

    const CATALOG_ID = process.env.CATALOG_ID;
    const sections = [{
        title: "Cortes e Barboterapia",
        product_items: [{
                product_retailer_id: process.env.PRODUTO_1_ID || "h5fj6325da"
            },
            {
                product_retailer_id: process.env.PRODUTO_2_ID || "8pdji0vdor"
            },
            {
                product_retailer_id: process.env.PRODUTO_3_ID || "af2o2iuwey"
            }
        ]
    }];

    try {
        await sendProductList(jid, CATALOG_ID, "Tabela de Serviços ✂️", "SELECIONE o serviço abaixo", sections);
    } catch (error) {
        const servicos = await prisma.servico.findMany();
        let optServicos = servicos.map(s => ({
            id: s.id.toString(),
            title: s.nome,
            description: `${s.preco} MT`
        }));
        optServicos.push({
            id: '0',
            title: 'Cancelar'
        });
        await sendInteractiveMenu(null, jid, 'SELECIONE o serviço abaixo', optServicos);
    }
}

module.exports = {
    iniciarAgendamento,
    handleAgendamento
};