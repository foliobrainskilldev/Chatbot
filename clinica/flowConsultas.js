const { prisma } = require('../db');
const aiService = require('../aiService');
const whatsappService = require('../whatsappService');

function formatarMoeda(valor, moeda) {
    if (!valor) return '';
    const v = parseFloat(valor);
    if (moeda === 'R$') return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (moeda === '$') return `$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} MT`;
}

async function processarDuvidas(jid, textoProcessado, senderNumber, userState, nlpResult, configDb, historico, cliente, isNewPatient) {
    let dadosCrmContexto = {};
    const intent = nlpResult?.intent || "unknown";
    const moedaGlobal = configDb?.moeda || 'MT'; // Pega a moeda configurada no painel

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
                medico: ag.profissionalSaude?.nome || "Plantonista"
            }));
        } else {
            dadosCrmContexto.historico_consultas_paciente = "O paciente não possui nenhuma consulta (futura ou passada) no sistema.";
        }
    } catch (e) {
        console.error("Aviso: Falha ao carregar histórico de consultas no fluxo de dúvidas.");
    }

    if (intent === 'treatment.price' || intent === 'treatment.info' || intent === 'treatment.duration' || intent === 'treatment.faq' || intent === 'treatment.list') {
        const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO' }});
        
        // Mapeia os tratamentos injetando o PREÇO FORMATADO DA CLÍNICA
        const mapearTratamento = (t) => ({
            nome: t.nome,
            categoria: t.categoria,
            preco_sistema: t.preco,
            preco_formatado: t.preco ? formatarMoeda(t.preco, moedaGlobal) : 'Sob Consulta',
            tipoPreco: t.tipoPreco,
            info: t.informacoesIA
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
            horarios: configDb?.horarioFuncionamento || "Segunda a Sexta",
            endereco: configDb?.endereco || "Endereço cadastrado",
            telefone: configDb?.telefone || "",
            faq: configDb?.faq || ""
        };
    } else {
        dadosCrmContexto.dados_basicos = { nome_clinica: configDb?.nomeClinica || "Clínica", faq: configDb?.faq || "" };
    }

    if (userState && userState.step === 'AGENDAMENTO') {
        dadosCrmContexto.aviso_sistema_prioridade = "O paciente está atualmente no meio de um fluxo de agendamento que foi pausado para que você respondesse esta dúvida. Responda a dúvida baseada no catálogo e, obrigatoriamente no final, convide-o a continuar com o agendamento enviando a data desejada.";
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