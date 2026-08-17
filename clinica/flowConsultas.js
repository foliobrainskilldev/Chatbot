const { prisma } = require('../../db');
const aiService = require('../../aiService');
const whatsappService = require('../../whatsappService');

function formatarMoeda(valor, moeda) {
    if (!valor) return '';
    const v = parseFloat(valor);
    if (moeda === 'R$') return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (moeda === '$') return `$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${moeda}`;
}

async function processarDuvidas(jid, textoProcessado, senderNumber, userState, nlpResult, configDb, historico, cliente, isNewPatient) {
    let dadosCrmContexto = {};
    const intent = nlpResult?.intent || "unknown";
    const moedaGlobal = configDb?.moeda || 'MT'; 

    try {
        const historicoAgendamentos = await prisma.agendamento.findMany({
            where: { clienteId: senderNumber, tratamentoId: { not: null } },
            include: { tratamento: true, profissionalSaude: true },
            orderBy: { dataHora: 'desc' },
            take: 5 
        });
        
        if (historicoAgendamentos.length > 0) {
            dadosCrmContexto.historico_consultas_paciente = historicoAgendamentos.map(ag => ({
                id_consulta: ag.id,
                dataHora: ag.dataHora,
                status: ag.status,
                tratamento: ag.tratamento?.nome,
                medico: ag.profissionalSaude?.nome || "Equipe Médica"
            }));
        } else {
            dadosCrmContexto.historico_consultas_paciente = "Este paciente é novo ou não possui nenhuma consulta lançada no sistema.";
        }
    } catch (e) {
        console.error("Aviso: Falha ao carregar histórico de consultas no fluxo de dúvidas.");
    }

    if (intent === 'treatment.price' || intent === 'treatment.info' || intent === 'treatment.duration' || intent === 'treatment.faq' || intent === 'treatment.list') {
        const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO' }});
        
        const mapearTratamento = (t) => ({
            nome: t.nome,
            categoria: t.categoria,
            preco: t.preco ? formatarMoeda(t.preco, moedaGlobal) : 'Sob Avaliação',
            tipoPreco: t.tipoPreco,
            informacoes_adicionais: t.informacoesIA
        });

        if (nlpResult?.entities?.treatment && intent !== 'treatment.list') {
            const search = nlpResult.entities.treatment.toLowerCase();
            const match = tratamentos.find(t => t.nome.toLowerCase().includes(search));
            if (match) {
                dadosCrmContexto.tratamento_solicitado = mapearTratamento(match);
            } else {
                dadosCrmContexto.tratamentos_cadastrados_no_catalogo = tratamentos.map(mapearTratamento);
            }
        } else {
            dadosCrmContexto.tratamentos_cadastrados_no_catalogo = tratamentos.map(mapearTratamento);
        }
    } else if (intent === 'clinic.hours' || intent === 'clinic.location' || intent === 'clinic.contact' || intent === 'clinic.payment_methods') {
        dadosCrmContexto.dados_operacionais = {
            horarios: configDb?.horarioFuncionamento || "Disponibilidade comercial.",
            endereco: configDb?.endereco || "Endereço principal da clínica.",
            telefone: configDb?.telefone || "",
            faq: configDb?.faq || ""
        };
    } else {
        // Conversação orgânica (unknown/greeting/saudação livre)
        dadosCrmContexto.dados_basicos = { nome_clinica: configDb?.nomeClinica || "Clínica", faq: configDb?.faq || "" };
    }

    if (userState && userState.step === 'AGENDAMENTO') {
        dadosCrmContexto.aviso_sistema_prioridade = "INSTRUÇÃO CRÍTICA: O paciente está atualmente no MEIO de um fluxo de agendamento que foi pausado para que você respondesse esta dúvida. Responda de forma orgânica e gentil e, OBRIGATORIAMENTE no final, pergunte se ele deseja retomar a escolha da data ou horário do agendamento.";
    } else if (intent === 'treatment.price' || intent === 'treatment.info') {
        dadosCrmContexto.aviso_sistema_prioridade = "DICA: Após responder a dúvida de forma cordial, pergunte casualmente se o paciente deseja verificar os horários disponíveis para esse procedimento.";
    }

    const contextoIA = {
        paciente_nome: cliente.nome || 'Paciente',
        paciente_novo: isNewPatient,
        dados_crm: dadosCrmContexto
    };

    const respostaIA = await aiService.gerarRespostaNatural(textoProcessado, historico, contextoIA, configDb);
    
    await prisma.mensagemIA.create({ data: { role: 'assistant', content: respostaIA, clienteId: senderNumber } });
    await whatsappService.sendText(jid, respostaIA);
}

module.exports = { processarDuvidas };