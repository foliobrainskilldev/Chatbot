const {
    prisma
} = require('./db');
const {
    format
} = require('date-fns');
const {
    sendDelayedText,
    sendInteractiveMenu
} = require('./botUtils');
const {
    sendProductList
} = require('./whatsappApi');

async function verPrecosEServicos(sockIgnorado, jid) {
    const CATALOG_ID = process.env.CATALOG_ID;

    const sections = [{
        title: "Cortes e Barboterapia",
        product_items: [{
                product_retailer_id: process.env.PRODUTO_1_ID || "h5fj6325da"
            },
            {
                product_retailer_id: process.env.PRODUTO_2_ID || "8pdji0vdor"
            },
            {
                product_retailer_id: process.env.PRODUTO_3_ID || "af2o2iuwey"
            }
        ]
    }];

    try {
        await sendProductList(jid, CATALOG_ID, "Tabela de Serviços ✂️", "SELECIONE o serviço abaixo", sections);
    } catch (error) {
        const servicos = await prisma.servico.findMany();
        let optServicos = servicos.map(s => ({
            id: `srv_${s.id}`,
            title: s.nome,
            description: `${s.preco} MT`
        }));
        optServicos.push({
            id: '0',
            title: 'Voltar ao Menu'
        });
        await sendInteractiveMenu(null, jid, 'SELECIONE o serviço abaixo', optServicos);
    }
}

async function verMeusAgendamentos(sockIgnorado, jid, senderNumber) {
    const agendamentos = await prisma.agendamento.findMany({
        where: {
            clienteId: senderNumber,
            status: 'AGENDADO',
            dataHora: {
                gte: new Date()
            }
        },
        include: {
            servico: true,
            barbeiro: true
        },
        orderBy: {
            dataHora: 'asc'
        }
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

module.exports = {
    verPrecosEServicos,
    verMeusAgendamentos
};