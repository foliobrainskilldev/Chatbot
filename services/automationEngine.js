const { prisma } = require('../db');
const whatsappService = require('../whatsappService'); // Seu serviço de envio WA

/**
 * Função global para processar automações cadastradas no banco
 * @param {String} tipoGatilho - Ex: 'NOVO_LEAD', 'LEAD_QUENTE', 'CONSULTA_CONFIRMADA'
 * @param {Object} dados - Instância do Cliente ou Agendamento afetado
 */
async function dispararAutomacoes(tipoGatilho, dados) {
    try {
        // Busca regras ativas para o gatilho disparado
        const automacoes = await prisma.automacao.findMany({
            where: { gatilho: tipoGatilho, ativo: true }
        });

        if (automacoes.length === 0) return;

        for (const regra of automacoes) {
            await executarAcao(regra.acao, regra.parametro, dados);
        }
    } catch (error) {
        console.error(`❌ Erro no Automation Engine [${tipoGatilho}]:`, error);
    }
}

async function executarAcao(tipoAcao, parametro, dados) {
    const clienteId = dados.clienteId || dados.id; // Funciona para Agendamento ou Cliente
    const numeroCliente = clienteId; 

    switch (tipoAcao) {
        case 'ADD_TAG':
            if (parametro && dados.id) {
                // Atualiza o Cliente concatenando a nova Tag
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
            // Dispara WebSockets para avisar o Front-end
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
                // Salva a mensagem no histórico do Inbox
                await prisma.mensagemIA.create({ 
                    data: { role: 'assistant', content: `[Automação Follow-up]: ${textoFinal}`, clienteId: numeroCliente, atendenteHumano: false } 
                });
            }
            break;

        case 'ENVIAR_LEMBRETE':
            // Exclusivo para quando `dados` é um Agendamento
            if (numeroCliente && dados.dataHora) {
                const dataFormatada = new Date(dados.dataHora).toLocaleString('pt-BR');
                const textoLembrete = parametro || `Lembrete: Sua consulta está confirmada para ${dataFormatada}.`;
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