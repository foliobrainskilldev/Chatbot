const { prisma } = require('../db');
const aiService = require('../aiService');
const whatsappService = require('../whatsappService');

async function processarDuvidas(jid, textoProcessado, senderNumber, userState, nlpResult, configDb, historico, cliente, isNewPatient) {
    let dadosCrmContexto = {};
    const intent = nlpResult?.intent || "unknown";

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

    if (intent === 'treatment.price' || intent === 'treatment.info' || intent === 'treatment.duration' || intent === 'treatment.faq') {
        const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO' }});
        
        if (nlpResult?.entities?.treatment) {
            const search = nlpResult.entities.treatment.toLowerCase();
            const match = tratamentos.find(t => t.nome.toLowerCase().includes(search));
            if (match) {
                dadosCrmContexto.tratamento_solicitado = match;
            } else {
                dadosCrmContexto.tratamentos_cadastrados_no_catalogo = tratamentos.map(t => ({ nome: t.nome, preco: t.preco, tipoPreco: t.tipoPreco, info: t.informacoesIA }));
            }
        } else {
            dadosCrmContexto.tratamentos_cadastrados_no_catalogo = tratamentos.map(t => ({ nome: t.nome, preco: t.preco, tipoPreco: t.tipoPreco, info: t.informacoesIA }));
        }
    } else if (intent === 'treatment.list') {
        const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO' }});
        dadosCrmContexto.catologo_servicos = tratamentos.map(t => ({ nome: t.nome, categoria: t.categoria }));
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

    // INJEÇÃO DE CONTEXTO: Avisar a LLM se o paciente pausou um agendamento
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