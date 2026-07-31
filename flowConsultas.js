const { prisma } = require('./db');
const { format } = require('date-fns');
const { sendDelayedText } = require('./botUtils');

async function verPrecosEServicos(sockIgnorado, jid) {
    const servicos = await prisma.servico.findMany();
    let texto = `📋 *Nossos Serviços e Preços:*\n\n`;
    
    servicos.forEach(s => {
        texto += `✂️ *${s.nome}*\n💰 Preço: ${s.preco} MT\n⏱️ Duração: ${s.duracaoMin} min\n\n`;
    });
    
    await sendDelayedText(null, jid, texto);
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
        // Envolvemos o 'às' em ' ' para isolar o termo ao Date-fns
        const dataStr = format(ag.dataHora, "dd/MM/yyyy 'às' HH:mm");
        const barbeiroNome = ag.barbeiro ? ag.barbeiro.nome : 'Qualquer um';
        texto += `*${index + 1}.* ${ag.servico.nome}\n🕑 Data: ${dataStr}\n💈 Barbeiro: ${barbeiroNome}\n\n`;
    });

    await sendDelayedText(null, jid, texto);
}

module.exports = { verPrecosEServicos, verMeusAgendamentos };