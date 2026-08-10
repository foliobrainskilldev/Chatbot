const { prisma } = require('../db');
const whatsappService = require('../whatsappService'); 
const axios = require('axios'); // Para Webhooks extras

// Sistema em memória para evitar Loops Infinitos (Cooldown)
// Impede que a mesma automação rode para o mesmo cliente repetidamente em curtos períodos
const executionCache = new Map();

async function dispararAutomacoes(tipoGatilho, dados) {
    try {
        const automacoes = await prisma.automacao.findMany({
            where: { gatilho: tipoGatilho, ativo: true }
        });

        // Hardcoded System Native Disparos (Segurança Base)
        if (tipoGatilho === 'CONSULTA_CONFIRMADA') {
            await dispararMensagemConfirmacaoNativa(dados);
        }

        if (automacoes.length === 0) return;

        for (const regra of automacoes) {
            const clienteId = dados.clienteId || dados.id; 
            if (!clienteId) continue; // Alvo inválido

            // 1. Avaliador de Condições (SE)
            if (!avaliarCondicoes(regra.condicoes, dados)) {
                continue; // Não passou nos filtros
            }

            // 2. Proteção contra Loop (Cooldown de 60 Segundos)
            const cacheKey = `auto_${regra.id}_cliente_${clienteId}`;
            const lastExec = executionCache.get(cacheKey);
            if (lastExec && (Date.now() - lastExec < 60000)) {
                console.warn(`[Automations Loop Protect] Regra ${regra.id} bloqueada para ${clienteId}. Frequência muito alta.`);
                continue; 
            }
            executionCache.set(cacheKey, Date.now());

            // 3. Gerenciamento de Tempo / Atraso (AGUARDAR)
            if (regra.atraso > 0) {
                // Coloca na Fila para ser executado no Futuro via CronJob
                try {
                    const dataAgendada = new Date(Date.now() + (regra.atraso * 60000));
                    await prisma.filaAutomacao.create({
                        data: {
                            automacaoId: regra.id,
                            clienteId: clienteId,
                            dadosPayload: JSON.stringify(dados),
                            dataAgendada: dataAgendada,
                            status: 'AGUARDANDO'
                        }
                    });
                } catch (e) {
                    console.error("Erro ao inserir na Fila de Automação (Tabela ausente?):", e.message);
                }
            } else {
                // Executar Imediatamente
                await executarAcaoEGravarHistorico(regra, clienteId, dados);
            }
        }
    } catch (error) {
        console.error(`❌ Erro no Automation Engine Gatilho [${tipoGatilho}]:`, error);
    }
}

function avaliarCondicoes(condicoesJson, dados) {
    if (!condicoesJson || condicoesJson === '[]') return true;
    
    try {
        const condicoes = JSON.parse(condicoesJson);
        if (condicoes.length === 0) return true;
        
        for (let cond of condicoes) {
            // Extrai a variável correta baseada no objeto de dados recebido (Pode ser um Lead ou Agendamento)
            const valorReal = dados[cond.campo] || (dados.cliente && dados.cliente[cond.campo]) || (dados.tratamento && dados.tratamento.nome);
            const strValorReal = String(valorReal || '').toLowerCase();
            const strCondValor = String(cond.valor || '').toLowerCase();

            if (cond.operador === 'IGUAL' && strValorReal !== strCondValor) return false;
            if (cond.operador === 'DIFERENTE' && strValorReal === strCondValor) return false;
            if (cond.operador === 'CONTEM' && !strValorReal.includes(strCondValor)) return false;
        }
        return true; 
    } catch (e) {
        console.warn("Erro ao avaliar condição JSON:", e);
        return false; // Por segurança, não executa se o JSON falhar
    }
}

async function executarAcaoEGravarHistorico(regra, clienteId, dados) {
    let sucesso = true;
    let msgDetalhe = '';

    try {
        await executarAcaoReal(regra.acao, regra.parametro, clienteId, dados);
        msgDetalhe = 'Ação concluída.';
        
        // Atualiza contador da regra
        await prisma.automacao.update({
            where: { id: regra.id },
            data: { execucoes: { increment: 1 } }
        });
    } catch (error) {
        sucesso = false;
        msgDetalhe = error.message.substring(0, 200);
        console.error(`[Automação Falha] Regra ${regra.id}:`, error.message);
    }

    // Gravar no Log de Histórico
    try {
        await prisma.automacaoHistorico.create({
            data: {
                automacaoId: regra.id,
                clienteId: clienteId,
                resultado: sucesso ? 'SUCESSO' : 'FALHA',
                detalhes: msgDetalhe
            }
        });
    } catch (e) {
        // Silenciar erro caso a tabela não exista ainda.
    }
}

async function executarAcaoReal(tipoAcao, parametro, clienteId, dados) {
    const nomeLead = dados.nome || (dados.cliente ? dados.cliente.nome : '') || 'Paciente';
    const numCliente = clienteId; 

    switch (tipoAcao) {
        // --- AÇÕES DE WHATSAPP ---
        case 'ENVIAR_MENSAGEM':
            if (parametro && numCliente) {
                // Motor de Replace de Variáveis
                let txtFinal = parametro.replace(/{{nome}}/g, nomeLead);
                if (dados.dataHora) {
                    const dataObj = new Date(dados.dataHora);
                    txtFinal = txtFinal.replace(/{{data}}/g, dataObj.toLocaleDateString('pt-BR'));
                    txtFinal = txtFinal.replace(/{{hora}}/g, dataObj.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}));
                }
                
                await whatsappService.sendText(numCliente, txtFinal);
                
                // Grava no Chat para o Atendente ver
                await prisma.mensagemIA.create({ 
                    data: { role: 'assistant', content: `[Automação]: ${txtFinal}`, clienteId: numCliente, atendenteHumano: false } 
                });
            }
            break;

        case 'ENVIAR_IMAGEM':
        case 'ENVIAR_AUDIO':
            if (parametro && numCliente) {
                const type = tipoAcao === 'ENVIAR_IMAGEM' ? 'image' : 'audio';
                await whatsappService.sendMediaUrl(numCliente, type, parametro, "");
                await prisma.mensagemIA.create({ 
                    data: { role: 'assistant', content: `[Automação MEDIA:${type}] ${parametro}`, clienteId: numCliente, atendenteHumano: false } 
                });
            }
            break;

        // --- AÇÕES DE CRM ---
        case 'ADD_TAG':
            if (parametro && numCliente) {
                const cliente = await prisma.cliente.findUnique({ where: { id: numCliente } });
                if (cliente) {
                    let tagsArray = cliente.tags ? cliente.tags.split(',').map(t => t.trim()) : [];
                    if (!tagsArray.includes(parametro)) {
                        tagsArray.push(parametro);
                        await prisma.cliente.update({ where: { id: numCliente }, data: { tags: tagsArray.join(', ') } });
                    }
                }
            }
            break;

        case 'REMOVE_TAG':
            if (parametro && numCliente) {
                const cliente = await prisma.cliente.findUnique({ where: { id: numCliente } });
                if (cliente && cliente.tags) {
                    let tagsArray = cliente.tags.split(',').map(t => t.trim());
                    tagsArray = tagsArray.filter(t => t !== parametro);
                    await prisma.cliente.update({ where: { id: numCliente }, data: { tags: tagsArray.join(', ') } });
                }
            }
            break;

        case 'ALTERAR_ETAPA':
            if (parametro && numCliente) {
                await prisma.cliente.update({ where: { id: numCliente }, data: { leadStatus: parametro } });
            }
            break;

        case 'ALTERAR_RESPONSAVEL':
            if (parametro && numCliente) {
                const respId = parseInt(parametro);
                if(!isNaN(respId)) {
                    await prisma.cliente.update({ where: { id: numCliente }, data: { responsavelId: respId } });
                }
            }
            break;

        // --- AÇÕES IA E ATENDIMENTO ---
        case 'PAUSAR_IA':
            if (numCliente) await prisma.cliente.update({ where: { id: numCliente }, data: { falarHumano: true } });
            break;

        case 'ATIVAR_IA':
            if (numCliente) await prisma.cliente.update({ where: { id: numCliente }, data: { falarHumano: false } });
            break;

        case 'NOTIFICAR_ATENDENTE':
            if (global.io) {
                global.io.emit('notificacao_urgente', { mensagem: parametro || `Atenção: Ação necessária para ${nomeLead}` });
            }
            break;

        // --- INTEGRAÇÕES ---
        case 'ENVIAR_WEBHOOK':
            if (parametro) {
                await axios.post(parametro, { event: 'automacao_disparada', data: dados }, { timeout: 3000 });
            }
            break;
            
        default:
            throw new Error(`Ação desconhecida: ${tipoAcao}`);
    }
}

// Disparo nativo de segurança (Existente)
async function dispararMensagemConfirmacaoNativa(agendamento) {
    if (!agendamento || !agendamento.clienteId || !agendamento.dataHora) return;
    try {
        const dataObj = new Date(agendamento.dataHora);
        const txt = `Sua consulta foi agendada para ${dataObj.toLocaleDateString('pt-BR')} às ${dataObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        await whatsappService.sendText(agendamento.clienteId, txt);
    } catch (error) {}
}

module.exports = { dispararAutomacoes, executarAcaoEGravarHistorico };