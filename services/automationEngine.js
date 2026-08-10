const { prisma } = require('../db');
const whatsappService = require('../whatsappService'); 

async function dispararAutomacoes(tipoGatilho, dados) {
    try {
        const automacoes = await prisma.automacao.findMany({
            where: { gatilho: tipoGatilho, ativo: true }
        });

        // Automação nativa e obrigatória (Baseada no seu pedido)
        if (tipoGatilho === 'CONSULTA_CONFIRMADA') {
            await dispararMensagemConfirmacaoNativa(dados);
        }

        if (automacoes.length === 0) return;

        for (const regra of automacoes) {
            await executarAcao(regra.acao, regra.parametro, dados);
        }
    } catch (error) {
        console.error(`❌ Erro no Automation Engine [${tipoGatilho}]:`, error);
    }
}

// Disparo nativo do sistema formatando a mensagem perfeitamente
async function dispararMensagemConfirmacaoNativa(agendamento) {
    if (!agendamento || !agendamento.clienteId || !agendamento.dataHora) return;
    
    try {
        const dataObj = new Date(agendamento.dataHora);
        const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
        
        const dia = dataObj.getDate();
        const mesStr = meses[dataObj.getMonth()];
        const horaStr = dataObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        
        const msg = `Sua consulta foi agendada para ${dia} de ${mesStr} às ${horaStr}.`;
        
        await whatsappService.sendText(agendamento.clienteId, msg);
        
        await prisma.mensagemIA.create({ 
            data: { role: 'assistant', content: `[Automação do Sistema] ${msg}`, clienteId: agendamento.clienteId, atendenteHumano: false } 
        });
    } catch (error) {
        console.error("Falha ao enviar mensagem de confirmação nativa:", error);
    }
}

async function executarAcao(tipoAcao, parametro, dados) {
    const clienteId = dados.clienteId || dados.id; 
    const numeroCliente = clienteId; 

    switch (tipoAcao) {
        case 'ADD_TAG':
            if (parametro && dados.id) {
                let tagsAtuais = dados.tags ? dados.tags.split(',').map(t => t.trim()) : [];
                if (!tagsAtuais.includes(parametro)) {
                    tagsAtuais.push(parametro);
                    await prisma.cliente.update({
                        where: { id: numeroCliente },
                        data: { tags: tagsAtuais.join(', ') }
                    });
                }
            }
            break;

        case 'NOTIFICAR_ATENDENTE':
            if (global.io) {
                global.io.emit('notificacao_urgente', { 
                    mensagem: parametro || `Atenção necessária para o Lead: ${dados.nome || numeroCliente}` 
                });
            }
            break;

        case 'ENVIAR_FOLLOWUP':
            if (parametro && numeroCliente) {
                const textoFinal = parametro.replace('{{nome}}', dados.nome || 'paciente');
                await whatsappService.sendText(numeroCliente, textoFinal);
                await prisma.mensagemIA.create({ 
                    data: { role: 'assistant', content: `[Automação Follow-up]: ${textoFinal}`, clienteId: numeroCliente, atendenteHumano: false } 
                });
            }
            break;

        case 'ENVIAR_LEMBRETE':
            if (numeroCliente && dados.dataHora) {
                const dataFormatada = new Date(dados.dataHora).toLocaleString('pt-BR');
                const textoLembrete = parametro || `Lembrete: sua consulta está marcada para amanhã às ${new Date(dados.dataHora).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}.`;
                await whatsappService.sendText(numeroCliente, textoLembrete);
                await prisma.mensagemIA.create({ 
                    data: { role: 'assistant', content: `[Automação Lembrete]: ${textoLembrete}`, clienteId: numeroCliente, atendenteHumano: false } 
                });
            }
            break;

        case 'ENVIAR_AVALIACAO':
            if (numeroCliente) {
                const textoAvaliacao = parametro || `Agradecemos sua visita! Responda esta mensagem com uma nota de 1 a 5 para avaliar seu atendimento.`;
                await whatsappService.sendText(numeroCliente, textoAvaliacao);
            }
            break;
    }
}

module.exports = { dispararAutomacoes };