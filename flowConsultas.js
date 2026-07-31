const { prisma } = require('./db');
const { format } = require('date-fns');
const { sendDelayedText, sendInteractiveMenu } = require('./botUtils');

async function verPrecosEServicos(sockIgnorado, jid) {
    const servicos = await prisma.servico.findMany();
    
    // Converte a tabela de texto num Modal (Lista de Botões)
    let optServicos = servicos.map(s => ({
        id: 'srv_' + s.id, // O prefixo srv_ dirá ao bot para iniciar agendamento se o cliente clicar
        title: s.nome,
        description: `${s.preco} MT - ⏱️ ${s.duracaoMin} min`
    }));
    
    optServicos.push({ id: '0', title: 'Voltar ao Menu' });

    await sendInteractiveMenu(null, jid, '📋 *Nossos Serviços e Preços:*\nSe quiseres marcar um destes cortes agora, basta clicares nele! 👇', optServicos);
}

async function verMeusAgendamentos(sockIgnorado, jid, senderNumber) {
    const agendamentos = await prisma.agendamento.findMany({
        where: { clienteId: senderNumber, status: 'AGENDADO', dataHora: { gte: new Date() } },
        include: { servico: true, barbeiro: true },
        orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        await sendDelayedText(null, jid, 'Não tens nenhum agendamento futuro no momento. 🗓️');
        return;
    }

    let texto = `📅 *Os teus próximos agendamentos:*\n\n`;
    agendamentos.forEach((ag, index) => {
        const dataStr = format(ag.dataHora, "dd/MM/yyyy 'às' HH:mm");
        const barbeiroNome = ag.barbeiro ? ag.barbeiro.nome : 'Qualquer um';
        texto += `*${index + 1}.* ${ag.servico.nome}\n🕑 Data: ${dataStr}\n💈 Barbeiro: ${barbeiroNome}\n\n`;
    });

    await sendDelayedText(null, jid, texto);
}

module.exports = { verPrecosEServicos, verMeusAgendamentos };