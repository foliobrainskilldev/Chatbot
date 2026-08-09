const { prisma } = require('../db');
const { format } = require('date-fns');
const whatsappService = require('../whatsappService');

async function verEspecialidades(jid) {
    const tratamentos = await prisma.tratamento.findMany({ orderBy: { preco: 'asc' } });
    
    if (tratamentos.length === 0) {
        return await whatsappService.sendText(jid, "Nossas especialidades estão sendo atualizadas. Fale com a recepção.");
    }

    let textoTabela = "*📋 NOSSAS ESPECIALIDADES E CONSULTAS*\n\n";
    tratamentos.forEach(t => {
        textoTabela += `🩺 *${t.nome}* - ${t.preco} MT\n`;
        if (t.descricao) textoTabela += `  _${t.descricao}_\n`;
    });
    textoTabela += "\nPara agendar sua consulta, volte ao menu e selecione 'Agendar Consulta'.";

    await whatsappService.sendText(jid, textoTabela.trim());
    await whatsappService.sendInteractiveMenu(jid, "O que deseja fazer agora?", [
        { id: 'cmd_agendar', title: 'Agendar Consulta' },
        { id: 'cmd_menu', title: 'Voltar ao Menu' }
    ]);
}

async function verMeusAgendamentosClinica(jid, senderNumber) {
    const agendamentos = await prisma.agendamento.findMany({
        where: {
            clienteId: senderNumber,
            status: 'AGENDADO',
            dataHora: { gte: new Date() },
            tratamentoId: { not: null } // ISOLAMENTO: Apenas Clínica
        },
        include: { tratamento: true, profissionalSaude: true },
        orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        return await whatsappService.sendText(jid, "Você não possui consultas médicas futuras agendadas.");
    }

    let texto = "📅 *SUAS PRÓXIMAS CONSULTAS:*\n\n";
    agendamentos.forEach((ag, index) => {
        const nomeProf = ag.profissionalSaude ? ag.profissionalSaude.nome : 'Médico de Plantão';
        texto += `*${index + 1}. ${ag.tratamento.nome}*\n`;
        texto += `🕑 ${format(ag.dataHora, "dd/MM/yyyy 'às' HH:mm")}\n`;
        texto += `👨‍⚕️ Especialista: ${nomeProf}\n\n`;
    });

    await whatsappService.sendText(jid, texto.trim());
    await whatsappService.sendInteractiveMenu(jid, "Precisa desmarcar alguma consulta?", [
        { id: 'cmd_cancelar', title: 'Sim, Cancelar' },
        { id: 'cmd_menu', title: 'Não, Voltar' }
    ]);
}

module.exports = { verEspecialidades, verMeusAgendamentosClinica };