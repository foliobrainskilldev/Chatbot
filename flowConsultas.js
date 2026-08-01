// --- START OF FILE flowConsultas.js ---
const { prisma } = require('./db');
const { format } = require('date-fns');
const { sendDelayedText } = require('./botUtils');
const { sendProductList } = require('./whatsappApi'); 

async function verPrecosEServicos(sockIgnorado, jid) {
    // ⚠️ ATENÇÃO: Substitui pelo ID real do teu Catálogo
    const MEU_CATALOGO_ID ="1074870258211819"; 

    // Estrutura das secções com os teus IDs reais da Meta
    const sections = [
        {
            title: "Cortes e Barboterapia",
            product_items: [
                { product_retailer_id: "h5fj6325da" }, // Panque
                { product_retailer_id: "af2o2iuwey" }, // Corte e Barba
                { product_retailer_id: "8pdji0vdor" }  // Barba
            ]
        }
    ];

    await sendProductList(
        jid, 
        MEU_CATALOGO_ID, 
        "Tabela de Serviços ✂️", 
        "Clica abaixo em 'Ver Produtos' para explorares as nossas opções, fotos e preços! \nPara agendares, basta ADICIONAR AO CARRINHO e enviar para nós aqui no chat.",
        sections
    );
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
// --- END OF FILE flowConsultas.js ---