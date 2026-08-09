const { prisma } = require('../db');
const { format } = require('date-fns');
const whatsappService = require('../whatsappService');

async function verPrecosEServicos(jid) {
    const servicos = await prisma.servico.findMany({ orderBy: { preco: 'asc' } });
    
    if (servicos.length === 0) {
        return await whatsappService.sendText(jid, "Nossa tabela de preços está sendo atualizada. Fale com um atendente.");
    }

    let textoTabela = "*📋 NOSSA TABELA DE SERVIÇOS E PREÇOS*\n\n";
    servicos.forEach(s => {
        textoTabela += `✂️ *${s.nome}* - ${s.preco} MT\n`;
    });
    textoTabela += "\nPara agendar, basta voltar ao menu e selecionar 'Agendar Corte'.";

    await whatsappService.sendText(jid, textoTabela.trim());
    await whatsappService.sendInteractiveMenu(jid, "O que deseja fazer agora?", [
        { id: 'cmd_agendar', title: 'Agendar Corte' },
        { id: 'cmd_menu', title: 'Voltar ao Menu' }
    ]);
}

async function verMeusAgendamentos(jid, senderNumber) {
    const agendamentos = await prisma.agendamento.findMany({
        where: {
            clienteId: senderNumber,
            status: 'AGENDADO',
            dataHora: { gte: new Date() },
            servicoId: { not: null } // ISOLAMENTO: Apenas Barbearia
        },
        include: { servico: true, barbeiro: true },
        orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        return await whatsappService.sendText(jid, "Você não possui nenhum agendamento futuro marcado na barbearia.");
    }

    let texto = "📅 *OS SEUS PRÓXIMOS AGENDAMENTOS:*\n\n";
    agendamentos.forEach((ag, index) => {
        const nomeProf = ag.barbeiro ? ag.barbeiro.nome : 'Qualquer Profissional';
        texto += `*${index + 1}. ${ag.servico.nome}*\n`;
        texto += `🕑 ${format(ag.dataHora, "dd/MM/yyyy 'às' HH:mm")}\n`;
        texto += `💈 Profissional: ${nomeProf}\n\n`;
    });

    await whatsappService.sendText(jid, texto.trim());
    await whatsappService.sendInteractiveMenu(jid, "Precisa desmarcar algum horário?", [
        { id: 'cmd_cancelar', title: 'Sim, Cancelar' },
        { id: 'cmd_menu', title: 'Não, Voltar' }
    ]);
}

module.exports = { verPrecosEServicos, verMeusAgendamentos };