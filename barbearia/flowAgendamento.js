const { prisma } = require('../db');
const { getProximosDiasUteis, getHorariosDisponiveis } = require('../dateUtils');
const { parse } = require('date-fns');
const whatsappService = require('../whatsappService');

function formatarMoeda(valor, moeda) {
    if (!valor) return '';
    const v = parseFloat(valor);
    if (moeda === 'R$') return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (moeda === '$') return `$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${moeda}`;
}

async function iniciarAgendamento(jid, senderNumber, stateMachine, STEPS, configDb) {
    const agendamentos = await prisma.agendamento.count({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }
    });

    if (agendamentos >= 2) {
        await whatsappService.sendText(jid, '⚠️ Você já possui 2 horários pendentes. Cancele um deles primeiro para marcar outro.');
        return;
    }

    stateMachine.set(senderNumber, { step: STEPS.AGENDAMENTO_SERVICO, data: {} });
    
    // Busca apenas na tabela pertinente ao nicho
    const servicos = await prisma.servico.findMany();
    if (servicos.length === 0) {
        await whatsappService.sendText(jid, 'Nenhum serviço de barbearia disponível no momento.');
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        return;
    }

    const moedaGlobal = configDb?.moeda || 'MT';
    
    let optServicos = servicos.map(s => ({ 
        id: `srv_${s.id}`, 
        title: s.nome.substring(0, 24), 
        description: s.preco ? formatarMoeda(s.preco, moedaGlobal) : 'Sob Consulta' 
    }));
    optServicos.push({ id: '0', title: 'Cancelar' });

    await whatsappService.sendInteractiveMenu(jid, "Vamos agendar! Escolha o serviço abaixo:", optServicos);
}

async function handleAgendamento(jid, textMessage, senderNumber, stateMachine, STEPS, configDb) {
    const userState = stateMachine.get(senderNumber);
    const step = userState.step;
    let msg = textMessage.trim();

    if (msg === '0') {
        stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
        await whatsappService.sendText(jid, 'Operação cancelada. Voltamos ao menu.');
        return;
    }

    switch (step) {
        case STEPS.AGENDAMENTO_SERVICO: {
            const servicoId = msg.replace('srv_', '');
            const servicoEscolhido = await prisma.servico.findUnique({ where: { id: parseInt(servicoId) } });
            
            if (!servicoEscolhido) return await whatsappService.sendText(jid, '⚠️ Escolha inválida. Digite 0 para cancelar.');
            
            userState.data.servico = servicoEscolhido;
            userState.step = STEPS.AGENDAMENTO_BARBEIRO;

            const barbeiros = await prisma.barbeiro.findMany();
            let optBarbeiros = barbeiros.map(b => ({ id: `barb_${b.id}`, title: b.nome }));
            optBarbeiros.push({ id: 'barb_qualquer', title: 'Qualquer um' }, { id: '0', title: 'Cancelar' });

            await whatsappService.sendInteractiveMenu(jid, "Prefere ser atendido por qual profissional?", optBarbeiros);
            break;
        }
        case STEPS.AGENDAMENTO_BARBEIRO: {
            if (msg !== 'barb_qualquer') {
                const barbId = msg.replace('barb_', '');
                const barbeiroSelecionado = await prisma.barbeiro.findUnique({ where: { id: parseInt(barbId) } });
                if (barbeiroSelecionado) userState.data.barbeiro = barbeiroSelecionado;
            }
            
            userState.step = STEPS.AGENDAMENTO_DATA;
            const dias = await getProximosDiasUteis(5);
            userState.data.diasDisponiveis = dias;
            
            let optDias = dias.map(d => ({ id: d, title: d }));
            optDias.push({ id: '0', title: 'Cancelar' });

            await whatsappService.sendInteractiveMenu(jid, "Escolha a data nos botões abaixo:", optDias);
            break;
        }
        case STEPS.AGENDAMENTO_DATA: {
            if (!userState.data.diasDisponiveis.includes(msg)) return await whatsappService.sendText(jid, '⚠️ Data inválida.');
            
            userState.data.dataString = msg;
            userState.step = STEPS.AGENDAMENTO_HORA;
            
            const horasLivres = await getHorariosDisponiveis(msg, userState.data.servico.duracaoMin, userState.data.barbeiro?.id);

            if (horasLivres.length === 0) {
                userState.step = STEPS.AGENDAMENTO_DATA;
                let optDias = userState.data.diasDisponiveis.map(d => ({ id: d, title: d }));
                optDias.push({ id: '0', title: 'Cancelar' });
                return await whatsappService.sendInteractiveMenu(jid, "Agenda cheia neste dia. Escolha outra data:", optDias);
            }

            userState.data.horasLivres = horasLivres;
            let optHoras = horasLivres.map(h => ({ id: h, title: h }));
            optHoras.push({ id: '0', title: 'Cancelar' });

            await whatsappService.sendInteractiveMenu(jid, `Selecione o horário para ${msg}:`, optHoras);
            break;
        }
        case STEPS.AGENDAMENTO_HORA: {
            if (!userState.data.horasLivres.includes(msg)) return await whatsappService.sendText(jid, '⚠️ Horário inválido.');

            userState.data.horaString = msg;
            userState.step = STEPS.AGENDAMENTO_CONFIRMAR;

            const resumo = `*Resumo*\n✂️ Serviço: ${userState.data.servico.nome}\n💈 Profissional: ${userState.data.barbeiro?.nome || 'Qualquer um'}\n📅 Data: ${userState.data.dataString} às ${msg}`;
            await whatsappService.sendInteractiveMenu(jid, resumo, [{ id: '1', title: 'Confirmar' }, { id: '0', title: 'Cancelar' }]);
            break;
        }
        case STEPS.AGENDAMENTO_CONFIRMAR: {
            if (msg === '1') {
                const dataHoraDb = parse(`${userState.data.dataString} ${userState.data.horaString}`, 'dd/MM/yyyy HH:mm', new Date());
                
                await prisma.agendamento.create({
                    data: {
                        dataHora: dataHoraDb, clienteId: senderNumber, status: 'AGENDADO',
                        servicoId: userState.data.servico.id, barbeiroId: userState.data.barbeiro?.id || null
                    }
                });
                await prisma.cliente.update({ where: { id: senderNumber }, data: { leadStatus: 'AGENDADO' } });
                await whatsappService.sendText(jid, "✅ Agendamento confirmado com sucesso!");
            }
            stateMachine.set(senderNumber, { step: STEPS.MENU_PRINCIPAL, data: {} });
            break;
        }
    }
}

module.exports = { iniciarAgendamento, handleAgendamento };