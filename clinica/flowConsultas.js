const { prisma } = require('../db');
const aiService = require('../aiService');
const whatsappService = require('../whatsappService');

async function processarDuvidas(jid, textoProcessado, senderNumber, userState, nlpResult, configDb, historico, cliente, isNewPatient) {
    let dadosCrmContexto = {};
    const intent = nlpResult?.intent || "unknown";

    // 1. SEMPRE carregamos o histórico de consultas reais do paciente para a IA ter memória impecável
    try {
        const historicoAgendamentos = await prisma.agendamento.findMany({
            where: { clienteId: senderNumber, tratamentoId: { not: null } },
            include: { tratamento: true, profissionalSaude: true },
            orderBy: { dataHora: 'desc' },
            take: 5 // Traz as 5 últimas (incluindo canceladas, realizadas, e futuras)
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

    // 2. Montar contexto complementar baseado na intenção
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
        // greeting, goodbye, unknown...
        dadosCrmContexto.dados_basicos = { nome_clinica: configDb?.nomeClinica || "Clínica", faq: configDb?.faq || "" };
    }

    // 3. Montar o envelope de contexto para a IA
    const contextoIA = {
        paciente_nome: cliente.nome || 'Paciente',
        paciente_novo: isNewPatient,
        dados_crm: dadosCrmContexto
    };

    // Gera a resposta natural
    const respostaIA = await aiService.gerarRespostaNatural(textoProcessado, historico, contextoIA, configDb);
    
    // Grava localmente o histórico
    await prisma.mensagemIA.create({ data: { role: 'assistant', content: respostaIA, clienteId: senderNumber } });
    
    await whatsappService.sendText(jid, respostaIA);
}

module.exports = { processarDuvidas };