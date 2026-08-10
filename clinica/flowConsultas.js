// --- START OF FILE flowConsultas.js ---

const { prisma } = require('../db');
const { format } = require('date-fns');
const whatsappService = require('../whatsappService');

async function verEspecialidades(jid) {
    const tratamentos = await prisma.tratamento.findMany({ 
        where: { status: 'ATIVO' },
        orderBy: { categoria: 'asc' } 
    });
    
    if (tratamentos.length === 0) {
        return await whatsappService.sendText(jid, "Nosso catálogo de serviços está sendo atualizado. Por favor, fale com a recepção.");
    }

    let textoTabela = "*📋 NOSSO CATÁLOGO DE ESPECIALIDADES*\n\n";
    let categoriaAtual = "";

    tratamentos.forEach(t => {
        if (t.categoria !== categoriaAtual) {
            categoriaAtual = t.categoria;
            textoTabela += `\n🔹 *${categoriaAtual.toUpperCase()}*\n`;
        }

        let precoStr = "Sob avaliação médica";
        if (t.tipoPreco === 'FIXO') precoStr = `R$ ${t.preco}`;
        else if (t.tipoPreco === 'A_PARTIR') precoStr = `A partir de R$ ${t.preco}`;
        else if (t.tipoPreco === 'FAIXA') precoStr = `Valor Variável (Consultar)`;

        textoTabela += `🩺 *${t.nome}* - ${precoStr}\n`;
        if (t.descricaoCurta) textoTabela += `  _${t.descricaoCurta}_\n`;
    });
    
    textoTabela += "\nPara agendar sua avaliação ou procedimento, volte ao menu e selecione 'Agendar Consulta'.";

    await whatsappService.sendText(jid, textoTabela.trim());
    await whatsappService.sendInteractiveMenu(jid, "Como posso ajudar agora?", [
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
            tratamentoId: { not: null } 
        },
        include: { tratamento: true, profissionalSaude: true },
        orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        return await whatsappService.sendText(jid, "Você não possui consultas médicas futuras agendadas no momento.");
    }

    let texto = "📅 *SUAS PRÓXIMAS CONSULTAS:*\n\n";
    agendamentos.forEach((ag, index) => {
        const nomeProf = ag.profissionalSaude ? ag.profissionalSaude.nome : 'Médico Especialista';
        texto += `*${index + 1}. ${ag.tratamento.nome}*\n`;
        texto += `🕑 ${format(ag.dataHora, "dd/MM/yyyy 'às' HH:mm")}\n`;
        texto += `👨‍⚕️ Especialista: ${nomeProf}\n\n`;
    });

    await whatsappService.sendText(jid, texto.trim());
    await whatsappService.sendInteractiveMenu(jid, "Precisa desmarcar ou alterar alguma consulta?", [
        { id: 'cmd_cancelar', title: 'Sim, Cancelar' },
        { id: 'cmd_menu', title: 'Não, Voltar' }
    ]);
}

module.exports = { verEspecialidades, verMeusAgendamentosClinica };