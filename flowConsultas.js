const { prisma } = require('./db');
const { format } = require('date-fns');
const whatsappService = require('./whatsappService');

async function verPrecosEServicos(jid) {
    // Busca os serviços de Barbearia
    const servicos = await prisma.servico.findMany({ orderBy: { preco: 'asc' } });
    
    // Busca tratamentos de Clínica (SaaS Multiuso)
    const tratamentos = await prisma.tratamento.findMany({ orderBy: { preco: 'asc' } });

    if (servicos.length === 0 && tratamentos.length === 0) {
        return await whatsappService.sendText(jid, "A nossa tabela de preços está sendo atualizada. Fale com um atendente humano para mais informações.");
    }

    let textoTabela = "*📋 NOSSA TABELA DE SERVIÇOS E PREÇOS*\n\n";

    if (servicos.length > 0) {
        textoTabela += "*Serviços Gerais:*\n";
        servicos.forEach(s => {
            textoTabela += `✂️ *${s.nome}* - ${s.preco} MT\n`;
        });
        textoTabela += "\n";
    }

    if (tratamentos.length > 0) {
        textoTabela += "*Especialidades e Tratamentos:*\n";
        tratamentos.forEach(t => {
            textoTabela += `🩺 *${t.nome}* - ${t.preco} MT\n`;
            if (t.descricao) textoTabela += `  _${t.descricao}_\n`;
        });
        textoTabela += "\n";
    }

    textoTabela += "Para agendar, basta voltar ao menu e selecionar 'Agendar Horário'.";

    // Envia primeiro o bloco de texto massivo (para o cliente conseguir ler sem botão estourando)
    await whatsappService.sendText(jid, textoTabela.trim());
    
    // Em seguida, oferece navegação rápida
    await whatsappService.sendInteractiveMenu(jid, "O que deseja fazer agora?", [
        { id: 'cmd_agendar', title: 'Agendar Horário' },
        { id: 'cmd_menu', title: 'Voltar ao Menu' }
    ]);
}

async function verMeusAgendamentos(jid, senderNumber) {
    const agendamentos = await prisma.agendamento.findMany({
        where: {
            clienteId: senderNumber,
            status: 'AGENDADO',
            dataHora: { gte: new Date() }
        },
        include: {
            servico: true,
            barbeiro: true,
            tratamento: true,
            profissionalSaude: true
        },
        orderBy: {
            dataHora: 'asc'
        }
    });

    if (agendamentos.length === 0) {
        return await whatsappService.sendText(jid, "Você não possui nenhum agendamento futuro marcado em nosso sistema no momento.");
    }

    let texto = "📅 *OS SEUS PRÓXIMOS AGENDAMENTOS:*\n\n";
    
    agendamentos.forEach((ag, index) => {
        const nomeSrv = ag.servico ? ag.servico.nome : (ag.tratamento ? ag.tratamento.nome : 'Serviço');
        const nomeProf = ag.barbeiro ? ag.barbeiro.nome : (ag.profissionalSaude ? ag.profissionalSaude.nome : 'Qualquer Profissional');
        
        texto += `*${index + 1}. ${nomeSrv}*\n`;
        texto += `🕑 ${format(ag.dataHora, "dd/MM/yyyy 'às' HH:mm")}\n`;
        texto += `👤 Profissional: ${nomeProf}\n\n`;
    });

    await whatsappService.sendText(jid, texto.trim());
    
    await whatsappService.sendInteractiveMenu(jid, "Precisa desmarcar algum horário?", [
        { id: 'cmd_cancelar', title: 'Sim, Cancelar' },
        { id: 'cmd_menu', title: 'Não, Voltar ao Menu' }
    ]);
}

module.exports = {
    verPrecosEServicos,
    verMeusAgendamentos
};