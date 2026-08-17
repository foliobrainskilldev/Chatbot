// barbearia/flowConsultas.js
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

    if (intent === 'TREATMENT_PRICE' || intent === 'TREATMENT_INFO' || intent === 'TREATMENT_LIST') {
        const servicos = await prisma.servico.findMany();
        if (servicos.length === 0) {
            return await whatsappService.sendText(jid, "Nossa tabela de preços está sendo atualizada. Fale com um atendente.");
        }

        let textoTabela = "*📋 NOSSA TABELA DE SERVIÇOS E PREÇOS*\n\n";
        servicos.forEach(s => {
            const precoFormatado = s.preco ? formatarMoeda(s.preco, moedaGlobal) : 'Sob Consulta';
            textoTabela += `✂️ *${s.nome}* - ${precoFormatado}\n`;
        });

        if (userState && userState.step.startsWith('AGENDAMENTO_')) {
            textoTabela += "\nNotei que você estava no meio de um agendamento. Se quiser continuar e concluir sua reserva, basta selecionar o botão abaixo.";
            await whatsappService.sendText(jid, textoTabela.trim());
            await whatsappService.sendInteractiveMenu(jid, "Deseja continuar de onde parou?", [
                { id: 'cmd_agendar', title: 'Continuar Agendamento' },
                { id: 'cmd_cancelar_fluxo', title: 'Cancelar Tudo' }
            ]);
        } else {
            textoTabela += "\nPara agendar, basta voltar ao menu e selecionar 'Agendar Corte'.";
            await whatsappService.sendText(jid, textoTabela.trim());
            await whatsappService.sendInteractiveMenu(jid, "O que deseja fazer agora?", [
                { id: 'cmd_agendar', title: 'Agendar Corte' },
                { id: 'cmd_cancelar_fluxo', title: 'Nenhuma das opções' }
            ]);
        }
        return;
    }

    if (intent === 'CHECK_UPCOMING_APPOINTMENTS') {
        const agendamentos = await prisma.agendamento.findMany({
            where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() }, servicoId: { not: null } },
            include: { servico: true, barbeiro: true },
            orderBy: { dataHora: 'asc' }
        });

        if (agendamentos.length === 0) return await whatsappService.sendText(jid, "Você não possui nenhum agendamento futuro marcado na barbearia.");

        let texto = "📅 *OS SEUS PRÓXIMOS AGENDAMENTOS:*\n\n";
        agendamentos.forEach((ag, index) => {
            const nomeProf = ag.barbeiro ? ag.barbeiro.nome : 'Qualquer Profissional';
            texto += `*${index + 1}. ${ag.servico.nome}*\n`;
            texto += `🕑 ${format(ag.dataHora, "dd/MM/yyyy 'às' HH:mm")}\n`;
            texto += `💈 Profissional: ${nomeProf}\n\n`;
        });

        await whatsappService.sendText(jid, texto.trim());
        return;
    }

    // Fallback de conversação se a intenção for genérica
    let dadosCrmContexto = { dados_basicos: { nome_clinica: configDb?.nomeClinica || "Barbearia", faq: configDb?.faq || "" }};
    const contextoIA = { paciente_nome: cliente.nome || 'Cliente', paciente_novo: isNewPatient, dados_crm: dadosCrmContexto };
    const respostaIA = await aiService.gerarRespostaNatural(textoProcessado, historico, contextoIA, configDb);
    
    await prisma.mensagemIA.create({ data: { role: 'assistant', content: respostaIA, clienteId: senderNumber } });
    await whatsappService.sendText(jid, respostaIA);
}

module.exports = { processarDuvidas };