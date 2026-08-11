const { prisma } = require('../db');
const aiService = require('../aiService');
const whatsappService = require('../whatsappService');

async function processarDuvidas(jid, textoProcessado, senderNumber, userState, nlpResult, configDb, historico) {
    let dadosContexto = {};
    const intent = nlpResult?.intent || "unknown";

    // Constrói o contexto baseado unicamente na intenção exata identificada pelo NLP
    if (intent === 'treatment.price' || intent === 'treatment.info' || intent === 'treatment.duration' || intent === 'treatment.faq') {
        const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO' }});
        
        if (nlpResult?.entities?.treatment) {
            const search = nlpResult.entities.treatment.toLowerCase();
            const match = tratamentos.find(t => t.nome.toLowerCase().includes(search));
            if (match) {
                dadosContexto.tratamento_solicitado = match;
            } else {
                dadosContexto.tratamentos_cadastrados_no_catalogo = tratamentos.map(t => ({ nome: t.nome, preco: t.preco, tipoPreco: t.tipoPreco, info: t.informacoesIA }));
            }
        } else {
            dadosContexto.tratamentos_cadastrados_no_catalogo = tratamentos.map(t => ({ nome: t.nome, preco: t.preco, tipoPreco: t.tipoPreco, info: t.informacoesIA }));
        }
    } else if (intent === 'treatment.list') {
        const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO' }});
        dadosContexto.catologo_servicos = tratamentos.map(t => ({ nome: t.nome, categoria: t.categoria }));
    } else if (intent === 'appointment.check') {
        const agendamentos = await prisma.agendamento.findMany({
            where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() }, tratamentoId: { not: null } },
            include: { tratamento: true, profissionalSaude: true },
            orderBy: { dataHora: 'asc' }
        });
        dadosContexto.consultas_futuras_encontradas = agendamentos.map(ag => ({ dataHora: ag.dataHora, tratamento: ag.tratamento?.nome, medico: ag.profissionalSaude?.nome || "Plantonista" }));
    } else if (intent === 'clinic.hours' || intent === 'clinic.location' || intent === 'clinic.contact' || intent === 'clinic.payment_methods') {
        dadosContexto.dados_operacionais = {
            horarios: configDb?.horarioFuncionamento || "Segunda a Sexta",
            endereco: configDb?.endereco || "Endereço cadastrado",
            telefone: configDb?.telefone || "",
            faq: configDb?.faq || ""
        };
    } else {
        // Intenções gerais: greeting, goodbye, unknown.
        dadosContexto.dados_basicos = { nome_clinica: configDb?.nomeClinica || "Clínica", faq: configDb?.faq || "" };
    }

    // Gera a resposta natural unindo a Pergunta do Paciente + Restrições + Dados DB
    const respostaIA = await aiService.gerarRespostaNatural(textoProcessado, historico, dadosContexto, configDb);
    
    // Grava localmente o histórico do bot para ele não se perder nas próximas mensagens
    await prisma.mensagemIA.create({ data: { role: 'assistant', content: respostaIA, clienteId: senderNumber } });
    
    await whatsappService.sendText(jid, respostaIA);
}

module.exports = { processarDuvidas };