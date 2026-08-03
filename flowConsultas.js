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
    const txtTabela = "Podes ver os nossos serviços e preços aqui em baixo:";
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
        await sendProductList(jid, process.env.CATALOG_ID, "Tabela de Serviços ✂️", txtTabela, sections);
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
        await sendInteractiveMenu(null, jid, txtTabela, optServicos);
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
        const txtVazio = "Não tens nenhum agendamento futuro marcado connosco no momento.";
        await sendDelayedText(null, jid, txtVazio);
        return;
    }

    const txtIntro = "📅 *Os teus próximos agendamentos:*";
    let texto = `${txtIntro}\n\n`;
    agendamentos.forEach((ag, index) => {
        texto += `*${index + 1}.* ${ag.servico.nome}\n🕑 ${format(ag.dataHora, "dd/MM 'às' HH:mm")}\n💈 ${ag.barbeiro ? ag.barbeiro.nome : 'Qualquer'}\n\n`;
    });

    await sendDelayedText(null, jid, texto.trim());
}

module.exports = {
    verPrecosEServicos,
    verMeusAgendamentos
};