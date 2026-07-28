const { prisma } = require('./db');
const { getProximosDiasUteis, getHorariosDisponiveis } = require('./dateUtils');
const { parse, format } = require('date-fns');

async function handleAgendamento(sock, jid, textMessage, senderNumber, stateMachine, STEPS) {
    const userState = stateMachine.get(senderNumber);
    const step = userState.step;
    const msg = textMessage.trim();

    if (msg.toLowerCase() === '0') {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await sock.sendMessage(jid, { text: 'Operação cancelada. A voltar ao menu...' });
        return;
    }

    switch (step) {
        case STEPS.AGENDAMENTO_SERVICO:
            const servicos = await prisma.servico.findMany();
            const servicoEscolhido = servicos[parseInt(msg) - 1];
            if (!servicoEscolhido) {
                await sock.sendMessage(jid, { text: 'Opção inválida. Escolhe um número da lista ou 0 para cancelar.' });
                return;
            }
            userState.data.servico = servicoEscolhido;
            userState.step = STEPS.AGENDAMENTO_BARBEIRO;
            
            const barbeiros = await prisma.barbeiro.findMany();
            let txtBarb = `Ótima escolha! 💈\nCom qual barbeiro pretendes cortar?\n\n`;
            barbeiros.forEach((b, i) => txtBarb += `${i + 1}️⃣ - ${b.nome}\n`);
            txtBarb += `${barbeiros.length + 1}️⃣ - Qualquer disponível\n\n0️⃣ - Cancelar`;
            
            await sock.sendMessage(jid, { text: txtBarb });
            break;

        case STEPS.AGENDAMENTO_BARBEIRO:
            const barbs = await prisma.barbeiro.findMany();
            const indexBarb = parseInt(msg) - 1;
            if (msg !== '0' && indexBarb !== barbs.length && !barbs[indexBarb]) {
                await sock.sendMessage(jid, { text: 'Opção inválida. Tenta novamente.' });
                return;
            }
            
            userState.data.barbeiro = indexBarb === barbs.length ? null : barbs[indexBarb];
            userState.step = STEPS.AGENDAMENTO_DATA;

            const dias = getProximosDiasUteis(5);
            userState.data.diasDisponiveis = dias;
            let txtData = `📅 Escolhe uma data:\n\n`;
            dias.forEach((d, i) => txtData += `${i + 1}️⃣ - ${d}\n`);
            txtData += `\n0️⃣ - Cancelar`;

            await sock.sendMessage(jid, { text: txtData });
            break;

        case STEPS.AGENDAMENTO_DATA:
            const diasDisp = userState.data.diasDisponiveis;
            const dataEscolhida = diasDisp[parseInt(msg) - 1];
            if (!dataEscolhida) {
                await sock.sendMessage(jid, { text: 'Data inválida.' });
                return;
            }
            userState.data.dataString = dataEscolhida;
            userState.step = STEPS.AGENDAMENTO_HORA;

            const horasLivres = await getHorariosDisponiveis(
                prisma, dataEscolhida, userState.data.servico.duracaoMin, userState.data.barbeiro?.id
            );

            if (horasLivres.length === 0) {
                userState.step = STEPS.AGENDAMENTO_DATA;
                await sock.sendMessage(jid, { text: '⚠️ Pedimos desculpa, mas não há horários livres neste dia para este serviço.\nPor favor, escolhe outra data:' });
                return;
            }

            userState.data.horasLivres = horasLivres;
            let txtHora = `🕑 Horários disponíveis para ${dataEscolhida}:\n\n`;
            horasLivres.forEach((h, i) => txtHora += `${i + 1}️⃣ - ${h}\n`);
            txtHora += `\n0️⃣ - Cancelar`;

            await sock.sendMessage(jid, { text: txtHora });
            break;

        case STEPS.AGENDAMENTO_HORA:
            const horaEscolhida = userState.data.horasLivres[parseInt(msg) - 1];
            if (!horaEscolhida) {
                await sock.sendMessage(jid, { text: 'Horário inválido.' });
                return;
            }
            userState.data.horaString = horaEscolhida;
            userState.step = STEPS.AGENDAMENTO_CONFIRMAR;

            const srv = userState.data.servico;
            const brb = userState.data.barbeiro ? userState.data.barbeiro.nome : 'Qualquer um';
            const resumo = `📝 *Confirma os dados do Agendamento:*\n\n✂️ Serviço: ${srv.nome} (${srv.preco} MT)\n💈 Barbeiro: ${brb}\n📅 Data: ${userState.data.dataString}\n🕑 Hora: ${horaEscolhida}\n\n1️⃣ - Confirmar\n0️⃣ - Cancelar`;
            
            await sock.sendMessage(jid, { text: resumo });
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

                await sock.sendMessage(jid, { text: '✅ *Agendamento Confirmado com sucesso!*\nMuito obrigado pela preferência, aguardamos por ti. Para voltar ao menu principal, basta digitar "Menu".' });
                stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
            } else {
                await sock.sendMessage(jid, { text: 'Opção inválida. Digita 1 para Confirmar ou 0 para Cancelar.' });
            }
            break;
    }
}

async function iniciarAgendamento(sock, jid, senderNumber, stateMachine, STEPS) {
    // Regra: Máximo de 2 agendamentos futuros
    const agendamentosFuturos = await prisma.agendamento.count({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }
    });

    if (agendamentosFuturos >= 2) {
        await sock.sendMessage(jid, { text: '⚠️ Atenção: Já tens 2 agendamentos futuros.\nPara marcar um novo, por favor cancela um dos existentes (Opção 4 do Menu).' });
        return;
    }

    const servicos = await prisma.servico.findMany();
    let texto = `✂️ *Qual serviço pretendes agendar?*\n\n`;
    servicos.forEach((s, i) => {
        texto += `${i + 1}️⃣ - ${s.nome} (${s.preco} MT)\n`;
    });
    texto += `\n0️⃣ - Cancelar`;

    stateMachine.set(senderNumber, { step: STEPS.AGENDAMENTO_SERVICO, data: {} });
    await sock.sendMessage(jid, { text: texto });
}

module.exports = { iniciarAgendamento, handleAgendamento };