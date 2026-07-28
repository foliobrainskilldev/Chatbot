const { prisma } = require('./db');
const { format } = require('date-fns');

async function verPrecosEServicos(sock, jid) {
    const servicos = await prisma.servico.findMany();
    let texto = `📋 *Nossos Serviços e Preços:*\n\n`;
    
    servicos.forEach(s => {
        texto += `✂️ *${s.nome}*\n💰 Preço: ${s.preco} MT\n⏱️ Duração: ${s.duracaoMin} min\n\n`;
    });
    
    await sock.sendMessage(jid, { text: texto });
}

async function verMeusAgendamentos(sock, jid, senderNumber) {
    const agendamentos = await prisma.agendamento.findMany({
        where: { 
            clienteId: senderNumber, 
            status: 'AGENDADO',
            dataHora: { gte: new Date() } // Apenas futuros
        },
        include: { servico: true, barbeiro: true },
        orderBy: { dataHora: 'asc' }
    });

    if (agendamentos.length === 0) {
        await sock.sendMessage(jid, { text: 'Não tens nenhum agendamento futuro no momento. 🗓️' });
        return;
    }

    let texto = `📅 *Os teus próximos agendamentos:*\n\n`;
    agendamentos.forEach((ag, index) => {
        const dataStr = format(ag.dataHora, 'dd/MM/yyyy às HH:mm');
        const barbeiroNome = ag.barbeiro ? ag.barbeiro.nome : 'Qualquer um';
        texto += `*${index + 1}.* ${ag.servico.nome}\n🕑 Data: ${dataStr}\n💈 Barbeiro: ${barbeiroNome}\n\n`;
    });

    await sock.sendMessage(jid, { text: texto });
}

module.exports = { verPrecosEServicos, verMeusAgendamentos };