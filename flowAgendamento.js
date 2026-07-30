const { prisma } = require('./db');
const { getProximosDiasUteis, getHorariosDisponiveis } = require('./dateUtils');
const { parse } = require('date-fns');
const { sendInteractiveMenu, sendDelayedText } = require('./botUtils');

async function handleAgendamento(sockIgnorado, jid, textMessage, senderNumber, stateMachine, STEPS) {
    const userState = stateMachine.get(senderNumber);
    const step = userState.step;
    const msg = textMessage.trim();

    // Comandos globais de Cancelamento
    if (msg.toLowerCase() === '0') {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await sendDelayedText(null, jid, 'Operação cancelada. A voltar ao menu...');
        return;
    }

    switch (step) {
        case STEPS.AGENDAMENTO_SERVICO: {
            const servicos = await prisma.servico.findMany();
            const servicoEscolhido = servicos.find(s => s.id.toString() === msg);
            
            if (!servicoEscolhido) {
                await sendDelayedText(null, jid, 'Opção inválida. Por favor, seleciona o serviço clicando nas opções.');
                return;
            }
            userState.data.servico = servicoEscolhido;
            userState.step = STEPS.AGENDAMENTO_BARBEIRO;
            
            const barbeiros = await prisma.barbeiro.findMany();
            
            // Textos otimizados (Meta impõe max 20 caracteres nos botões)
            let optBarbeiros = barbeiros.map(b => ({ id: b.id.toString(), title: b.nome }));
            optBarbeiros.push({ id: 'qualquer', title: 'Qualquer um' }, { id: '0', title: 'Cancelar' });
            
            await sendInteractiveMenu(null, jid, 'Ótima escolha! 💈\nCom qual barbeiro preferes?', optBarbeiros);
            break;
        }

        case STEPS.AGENDAMENTO_BARBEIRO: {
            const barbs = await prisma.barbeiro.findMany();
            let barbeiroSelecionado = null;
            
            if (msg !== 'qualquer') {
                barbeiroSelecionado = barbs.find(b => b.id.toString() === msg);
                if (!barbeiroSelecionado && msg !== '0') {
                    await sendDelayedText(null, jid, 'Por favor, seleciona um barbeiro da lista fornecida.');
                    return;
                }
            }
            
            userState.data.barbeiro = barbeiroSelecionado;
            userState.step = STEPS.AGENDAMENTO_DATA;

            const dias = getProximosDiasUteis(5);
            userState.data.diasDisponiveis = dias;
            let optDias = dias.map(d => ({ id: d, title: d }));
            optDias.push({ id: '0', title: 'Cancelar' });

            await sendInteractiveMenu(null, jid, '📅 Escolhe uma data para o corte:', optDias);
            break;
        }

        case STEPS.AGENDAMENTO_DATA: {
            const diasDisp = userState.data.diasDisponiveis;
            if (!diasDisp.includes(msg)) {
                await sendDelayedText(null, jid, 'Data inválida. Clica no botão para escolher a data.');
                return;
            }

            userState.data.dataString = msg;
            userState.step = STEPS.AGENDAMENTO_HORA;

            const horasLivres = await getHorariosDisponiveis(prisma, msg, userState.data.servico.duracaoMin, userState.data.barbeiro?.id);

            if (horasLivres.length === 0) {
                userState.step = STEPS.AGENDAMENTO_DATA; // Mantém a pessoa nesta fase para pedir outra
                await sendDelayedText(null, jid, '⚠️ Peço desculpa, mas já não temos horários livres neste dia.\n\nEscolhe outra data:');
                
                let optDiasRetry = diasDisp.map(d => ({ id: d, title: d }));
                optDiasRetry.push({ id: '0', title: 'Cancelar' });
                await sendInteractiveMenu(null, jid, '📅 Escolhe uma nova data:', optDiasRetry);
                return;
            }

            userState.data.horasLivres = horasLivres;
            let optHoras = horasLivres.map(h => ({ id: h, title: h }));
            optHoras.push({ id: '0', title: 'Cancelar' });

            await sendInteractiveMenu(null, jid, `🕑 Horários para ${msg}:`, optHoras);
            break;
        }

        case STEPS.AGENDAMENTO_HORA: {
            if (!userState.data.horasLivres.includes(msg)) {
                 await sendDelayedText(null, jid, 'Horário selecionado já não é válido.');
                 return;
            }
            
            userState.data.horaString = msg;
            userState.step = STEPS.AGENDAMENTO_CONFIRMAR;

            const srv = userState.data.servico;
            const brb = userState.data.barbeiro ? userState.data.barbeiro.nome : 'Qualquer um';
            const resumo = `📝 *Confirma os dados:*\n\n✂️ Serviço: ${srv.nome}\n💈 Barbeiro: ${brb}\n📅 Data: ${userState.data.dataString}\n🕑 Hora: ${msg}`;
            
            await sendInteractiveMenu(null, jid, resumo, [
                { id: '1', title: 'Confirmar' },
                { id: '0', title: 'Cancelar' }
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
                stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
                
            } else if (msg === '0') {
                stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
                await sendDelayedText(null, jid, 'Processo abortado com sucesso.');
            } else {
                await sendDelayedText(null, jid, 'Por favor, clica no botão Confirmar ou Cancelar.');
            }
            break;
        }
    }
}

async function iniciarAgendamento(sockIgnorado, jid, senderNumber, stateMachine, STEPS) {
    // Restringe limites por questões logísticas 
    const agendamentos = await prisma.agendamento.count({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }
    });

    if (agendamentos >= 2) {
        await sendDelayedText(null, jid, '⚠️ Já tens 2 agendamentos futuros.\nPara não comprometer a nossa agenda, cancela um primeiro (opção "Cancelar" do Menu) antes de marcar um novo.');
        return;
    }

    const servicos = await prisma.servico.findMany();
    
    // Convertido perfeitamente para ler Menu ou Botões Rápidos via Cloud API
    let optServicos = servicos.map(s => ({ id: s.id.toString(), title: s.nome, description: `${s.preco} MT` }));
    optServicos.push({ id: '0', title: 'Cancelar' });

    stateMachine.set(senderNumber, { step: STEPS.AGENDAMENTO_SERVICO, data: {} });
    await sendInteractiveMenu(null, jid, '✂️ Que tipo de serviço desejas agendar hoje?', optServicos);
}

module.exports = { iniciarAgendamento, handleAgendamento };