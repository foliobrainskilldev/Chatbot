const { prisma } = require('../db');
const whatsappService = require('../whatsappService');
const { getHorariosDisponiveis, getProximosDiasUteis } = require('../../dateUtils');
const aiService = require('../aiService');
const automationEngine = require('../services/automationEngine');
const webhookService = require('../services/webhookService');

function formatarMoeda(valor, moeda) {
    if (!valor) return '';
    const v = parseFloat(valor);
    if (moeda === 'R$') return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (moeda === '$') return `$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${moeda}`;
}

async function processarAgendamento(jid, textoProcessado, senderNumber, stateMachine, nlpResult, isInteractive, configDb, cliente, isNewPatient) {
    let userState = stateMachine.get(senderNumber) || { step: 'IDLE', intent: 'appointment.create', entities: {} };
    userState.step = 'AGENDAMENTO';
    
    userState.pageData = userState.pageData || 0;
    userState.pageHora = userState.pageHora || 0;
    
    // Tratamento de cancelamento interativo ("Escolher outro horário" / "Cancelar")
    if (textoProcessado === '0' || textoProcessado === 'cmd_cancelar_fluxo') {
        stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
        await whatsappService.sendText(jid, 'Sem problemas. O processo de agendamento foi cancelado. Posso ajudar em mais alguma coisa?');
        return;
    }

    const agendamentosPendentes = await prisma.agendamento.count({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } }
    });
    
    if (agendamentosPendentes >= (configDb.agendamentoLimiteSimultaneo || 2)) {
        await whatsappService.sendText(jid, 'Notei que você já tem consultas pendentes no sistema. Se precisar marcar mais de duas ao mesmo tempo, por favor, me avise para eu chamar a recepção!');
        stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
        return;
    }
    
    // 1. RESOLUÇÃO DE TRATAMENTO
    if (!userState.resolvedTreatment) {
        if (isInteractive && textoProcessado.startsWith('trat_')) {
            const idTrat = parseInt(textoProcessado.replace('trat_', ''));
            userState.resolvedTreatment = await prisma.tratamento.findUnique({ where: { id: idTrat }, include: { profissionais: true } });
        } else if (userState.entities.treatment) {
            const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO', podeAgendarIA: true }});
            const search = userState.entities.treatment.toLowerCase();
            const match = tratamentos.find(t => t.nome.toLowerCase().includes(search));
            if (match) {
                userState.resolvedTreatment = await prisma.tratamento.findUnique({ where: { id: match.id }, include: { profissionais: true } });
            }
        }
        
        if (!userState.resolvedTreatment) {
            const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO', podeAgendarIA: true }});
            if (tratamentos.length === 0) {
                await whatsappService.sendText(jid, 'Nossa agenda online está temporariamente fechada para novos procedimentos. Vou transferir você para a recepção.');
                stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
                return;
            }
            
            const moedaGlobal = configDb?.moeda || 'MT';
            const rows = tratamentos.slice(0, 10).map(t => ({ 
                id: `trat_${t.id}`, 
                title: t.nome.substring(0, 24), 
                description: t.preco ? `Valor: ${formatarMoeda(t.preco, moedaGlobal)}` : 'Consulte valor' 
            }));
            const sections = [{ title: "Especialidades", rows: rows }];
            
            await whatsappService.sendInteractiveList(jid, "Temos vários tratamentos disponíveis. Escolha uma categoria para continuar:", "Ver opções", sections);
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // 2. RESOLUÇÃO DE DATA
    if (!userState.resolvedDate) {
        const diasValidos = await getProximosDiasUteis(14); 
        
        if (isInteractive && textoProcessado.startsWith('data_')) {
            const dataEscolhida = textoProcessado.replace('data_', '');
            if (diasValidos.includes(dataEscolhida)) userState.resolvedDate = dataEscolhida;
            else await whatsappService.sendText(jid, 'Essa data já não está disponível em nossa agenda. Vamos escolher outra?');
        } 
        else if (userState.entities.date) {
            const matchDia = diasValidos.find(d => d === userState.entities.date || d.includes(userState.entities.date));
            if (matchDia) {
                userState.resolvedDate = matchDia;
                // Como resolveu organicamente pela NLP, podemos contextualizar fluidamente
                await whatsappService.sendText(jid, `Perfeito, dia ${matchDia}. Deixe-me ver os horários...`);
            } else {
                await whatsappService.sendText(jid, `A agenda para a data solicitada (${userState.entities.date}) está indisponível. Vamos ver as próximas opções.`);
                userState.entities.date = null; 
            }
        }
        
        if (!userState.resolvedDate) {
            if (textoProcessado === 'ver_mais_data') userState.pageData++;
            
            // Limitando a 2 botões para permitir que o WhatsApp adicione o botão de "Ver mais" e fique dentro do limite de 3
            const start = userState.pageData * 2;
            const chunk = diasValidos.slice(start, start + 2);
            const hasMore = start + 2 < diasValidos.length;

            if (chunk.length === 0) {
                userState.pageData = 0; 
                return processarAgendamento(jid, null, senderNumber, stateMachine, nlpResult, false, configDb, cliente, isNewPatient);
            }

            let optDias = chunk.map(d => ({ id: `data_${d}`, title: d }));
            if (hasMore) optDias.push({ id: 'ver_mais_data', title: 'Ver mais datas' });

            const saudacao = userState.pageData === 0 
                ? `Vou verificar os horários para ${userState.resolvedTreatment.nome}.\n\nTenho estes dias mais próximos disponíveis:`
                : `Aqui estão mais opções de dias:`;

            await whatsappService.sendInteractiveMenu(jid, saudacao, optDias);
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // 3. RESOLUÇÃO DE HORA E PREFERÊNCIAS (A Mágica Conversacional)
    if (!userState.resolvedTime) {
        const horasLivres = await getHorariosDisponiveis(userState.resolvedDate, userState.resolvedTreatment.duracaoMin, null);
        
        if (horasLivres.length === 0) {
            userState.resolvedDate = null; 
            stateMachine.set(senderNumber, userState);
            await whatsappService.sendText(jid, `Infelizmente a agenda acabou de encher para o dia ${userState.resolvedDate}. Vamos escolher outro dia?`);
            return processarAgendamento(jid, null, senderNumber, stateMachine, nlpResult, false, configDb, cliente, isNewPatient);
        }
        
        if (isInteractive && textoProcessado.startsWith('hora_')) {
            const horaEscolhida = textoProcessado.replace('hora_', '');
            if (horasLivres.includes(horaEscolhida)) userState.resolvedTime = horaEscolhida;
            else await whatsappService.sendText(jid, 'Ops, alguém acabou de ocupar esse horário. Vamos ver outro.');
        } 
        else if (userState.entities.time) {
            const reqTime = userState.entities.time;
            const modifier = userState.entities.time_modifier || 'exact';
            
            let matchHora;
            
            if (modifier === 'after') {
                matchHora = horasLivres.find(h => h >= reqTime);
            } else if (modifier === 'before') {
                matchHora = [...horasLivres].reverse().find(h => h <= reqTime);
            } else {
                matchHora = horasLivres.find(h => h === reqTime);
                if (!matchHora) matchHora = horasLivres.find(h => h > reqTime);
            }

            if (matchHora) {
                userState.resolvedTime = matchHora;
                if (matchHora !== reqTime) {
                    await whatsappService.sendText(jid, `Não temos exatamente às ${reqTime}, mas o mais próximo que encontrei foi às ${matchHora}.`);
                }
            } else {
                await whatsappService.sendText(jid, `Infelizmente não encontrei horários livres que atendam ao que pediu (${reqTime}). Veja o que tenho disponível:`);
                userState.entities.time = null;
                userState.entities.time_modifier = null;
            }
        }
        
        if (!userState.resolvedTime) {
            if (textoProcessado === 'ver_mais_hora') userState.pageHora++;
            
            const start = userState.pageHora * 2;
            const chunk = horasLivres.slice(start, start + 2);
            const hasMore = start + 2 < horasLivres.length;

            if (chunk.length === 0) {
                userState.pageHora = 0; 
                return processarAgendamento(jid, null, senderNumber, stateMachine, nlpResult, false, configDb, cliente, isNewPatient);
            }

            let optHoras = chunk.map(h => ({ id: `hora_${h}`, title: h }));
            if (hasMore) optHoras.push({ id: 'ver_mais_hora', title: 'Ver mais horários' });

            const textoApresentacao = userState.pageHora === 0
                ? `Encontrei estes horários livres para o dia ${userState.resolvedDate}:`
                : `Ainda no dia ${userState.resolvedDate}, também tenho estas opções:`;

            await whatsappService.sendInteractiveMenu(jid, textoApresentacao, optHoras);
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // 4. CONFIRMAÇÃO HUMANIZADA
    if (!userState.confirmed) {
        if (isInteractive && textoProcessado === 'cmd_confirmar_reserva') {
            userState.confirmed = true;
        } else {
            const resumo = `Perfeito. Só confirmando antes de reservar:\n\n🩺 ${userState.resolvedTreatment.nome}\n📅 ${userState.resolvedDate}\n🕐 ${userState.resolvedTime}\n\nPosso confirmar esse horário para você?`;
            await whatsappService.sendInteractiveMenu(jid, resumo, [
                { id: 'cmd_confirmar_reserva', title: 'Confirmar' }, 
                { id: 'cmd_cancelar_fluxo', title: 'Escolher outro' }
            ]);
            stateMachine.set(senderNumber, userState);
            return;
        }
    }
    
    // 5. EFETIVAÇÃO E COMUNICAÇÃO FINAL
    const [dia, mes, ano] = userState.resolvedDate.split('/');
    const [hora, min] = userState.resolvedTime.split(':');
    const fusoOffset = configDb?.fusoHorario === 'America/Sao_Paulo' ? '-03:00' : '+02:00';
    const dataHoraDb = new Date(`${ano}-${mes}-${dia}T${hora}:${min}:00${fusoOffset}`);

    const novoAgendamento = await prisma.agendamento.create({
        data: {
            dataHora: dataHoraDb, clienteId: senderNumber, status: 'AGENDADO',
            tratamentoId: userState.resolvedTreatment.id
        },
        include: { cliente: true, tratamento: true }
    });
    
    let updateData = { leadStatus: 'AGENDADO' };
    if (cliente && (!cliente.valorPotencial || cliente.valorPotencial === 0) && userState.resolvedTreatment.preco) {
        updateData.valorPotencial = userState.resolvedTreatment.preco;
    }
    await prisma.cliente.update({ where: { id: senderNumber }, data: updateData });
    
    const contextoIA = {
        paciente_nome: cliente.nome,
        paciente_novo: isNewPatient,
        dados_crm: { agendamento_realizado: novoAgendamento }
    };

    const promptDireto = "Gere uma mensagem curta confirmando de forma simpática que a consulta foi agendada. Informe a data e hora. NUNCA use saudações iniciais (Bom dia/Olá) pois já estamos no meio da conversa. Finalize dizendo que se ele precisar alterar, é só chamar.";
    
    const respostaContexto = await aiService.gerarRespostaNatural(
        promptDireto,
        [],
        contextoIA,
        configDb
    );
    await whatsappService.sendText(jid, respostaContexto);
    
    await automationEngine.dispararAutomacoes('CONSULTA_CRIADA', novoAgendamento);
    await webhookService.dispararEvento('appointment.created', novoAgendamento);
    
    stateMachine.set(senderNumber, { step: 'IDLE', intent: null, entities: {} });
}

module.exports = { processarAgendamento };