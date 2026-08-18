const { prisma } = require('../db');
const { format } = require('date-fns');
const whatsappService = require('../whatsappService');
const aiService = require('../aiService');

function formatarMoeda(valor, moeda) {
    if (!valor) return '';
    const v = parseFloat(valor);
    if (moeda === 'R$') return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (moeda === '$') return `$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${moeda}`;
}

async function processarDuvidas(jid, textoProcessado, senderNumber, userState, nlpResult, configDb, historico, cliente, isNewPatient) {
    const intent = nlpResult?.intent || "UNKNOWN";
    const moedaGlobal = configDb?.moeda || 'MT'; 

    if (intent === 'CHECK_UPCOMING_APPOINTMENTS' || intent === 'CHECK_PAST_APPOINTMENTS') {
        const agendamentos = await prisma.agendamento.findMany({
            where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() }, servicoId: { not: null } },
            include: { servico: true, barbeiro: true },
            orderBy: { dataHora: 'asc' }
        });

        if (agendamentos.length === 0) {
            await whatsappService.sendText(jid, "Você não possui nenhum agendamento futuro marcado na barbearia.");
        } else {
            let texto = "📅 *OS SEUS PRÓXIMOS AGENDAMENTOS:*\n\n";
            agendamentos.forEach((ag, index) => {
                const nomeProf = ag.barbeiro ? ag.barbeiro.nome : 'Qualquer Profissional';
                texto += `*${index + 1}. ${ag.servico.nome}*\n`;
                texto += `🕑 ${format(ag.dataHora, "dd/MM/yyyy 'às' HH:mm")}\n`;
                texto += `💈 Profissional: ${nomeProf}\n\n`;
            });
            await whatsappService.sendText(jid, texto.trim());
        }

        if (userState && userState.step.startsWith('AGENDAMENTO_')) {
            await whatsappService.sendInteractiveMenu(jid, "Voltando ao nosso agendamento... deseja continuar de onde paramos?", [
                { id: 'cmd_agendar', title: 'Continuar agendamento' },
                { id: 'cmd_cancelar_fluxo', title: 'Cancelar' }
            ]);
        }
        return;
    }

    let dadosCrmContexto = {};

    if (intent === 'ASK_DATE_REFERENCE') {
        const fuso = configDb?.fusoHorario || 'Africa/Maputo';
        const formatterLongo = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'long', day: 'numeric', month: 'long' });
        const hojeObj = new Date();
        const amanhaObj = new Date(hojeObj.getTime() + 86400000);
        dadosCrmContexto.calendario_referencia = { hoje: formatterLongo.format(hojeObj), amanha: formatterLongo.format(amanhaObj) };
        dadosCrmContexto.aviso_sistema_prioridade = "Responda à pergunta do usuário sobre datas ou dias da semana usando EXATAMENTE os dados de 'calendario_referencia'. Não invente.";
    } 
    else if (intent === 'TREATMENT_PRICE' || intent === 'TREATMENT_INFO' || intent === 'TREATMENT_LIST') {
        const servicos = await prisma.servico.findMany();
        if (servicos.length === 0) {
            return await whatsappService.sendText(jid, "Nossa tabela de preços está sendo atualizada. Fale com um atendente.");
        }
        dadosCrmContexto.servicos_cadastrados_no_catalogo = servicos.map(s => ({
            nome: s.nome, preco: s.preco ? formatarMoeda(s.preco, moedaGlobal) : 'Sob Avaliação'
        }));
    } else {
        dadosCrmContexto.dados_basicos = { nome_clinica: configDb?.nomeClinica || "Barbearia", faq: configDb?.faq || "" };
    }

    if (userState && userState.step.startsWith('AGENDAMENTO_')) {
        dadosCrmContexto.aviso_sistema_prioridade = `INSTRUÇÃO CRÍTICA: O paciente está atualmente no MEIO de um fluxo de agendamento. Responda à dúvida de forma orgânica e, OBRIGATORIAMENTE no final, pergunte se ele deseja retomar o agendamento de onde parou.`;
    }

    const contextoIA = { paciente_nome: cliente.nome || 'Cliente', paciente_novo: isNewPatient, dados_crm: dadosCrmContexto };
    const respostaIA = await aiService.gerarRespostaNatural(textoProcessado, historico, contextoIA, configDb);
    
    await prisma.mensagemIA.create({ data: { role: 'assistant', content: respostaIA, clienteId: senderNumber } });
    await whatsappService.sendText(jid, respostaIA);
}

module.exports = { processarDuvidas };