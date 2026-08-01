// --- START OF FILE flowConsultas.js ---
const { prisma } = require('./db');
const { format } = require('date-fns');
const { sendDelayedText, sendInteractiveMenu } = require('./botUtils');
const { sendProductList } = require('./whatsappApi'); 

async function verPrecosEServicos(sockIgnorado, jid) {
    const CATALOG_ID = process.env.CATALOG_ID;

    // Se o CATALOG_ID não estiver no .env, aciona o Fallback automaticamente (Menu Simples sem Catálogo)
    if (!CATALOG_ID) {
        console.log("⚠️ CATALOG_ID não definido no .env. Enviando lista de serviços do banco de dados (Fallback).");
        await enviarMenuFallback(jid);
        return;
    }

    // Estrutura lendo do .env
    const sections = [
        {
            title: "Cortes e Barboterapia",
            product_items: [
                { product_retailer_id: process.env.PRODUTO_1_ID || "h5fj6325da" }, // Corte de Cabelo
                { product_retailer_id: process.env.PRODUTO_2_ID || "8pdji0vdor" }, // Barba
                { product_retailer_id: process.env.PRODUTO_3_ID || "af2o2iuwey" }  // Corte + Barba
            ]
        }
    ];

    try {
        await sendProductList(
            jid, 
            CATALOG_ID, 
            "Tabela de Serviços ✂️", 
            "Clica abaixo em 'Ver Produtos' para explorares as nossas opções, fotos e preços! \nPara agendares, basta ADICIONAR AO CARRINHO e enviar para nós aqui no chat.",
            sections
        );
    } catch (error) {
        // Se a Meta der erro de (#131009) por causa de produtos não aprovados ou ID errado, o bot salva o atendimento
        console.error("❌ Falha ao enviar catálogo da Meta. Acionando menu de botões alternativo (Fallback)...");
        await enviarMenuFallback(jid);
    }
}

// FUNÇÃO DE EMERGÊNCIA (Caso o catálogo falhe, o bot gera os botões baseados no banco de dados)
async function enviarMenuFallback(jid) {
    const servicos = await prisma.servico.findMany();
    
    let optServicos = servicos.map(s => ({ 
        id: `srv_${s.id}`, 
        title: s.nome, 
        description: `${s.preco} MT` 
    }));
    optServicos.push({ id: '0', title: 'Voltar ao Menu' });

    await sendInteractiveMenu(
        null, 
        jid, 
        '✂️ *Tabela de Serviços e Preços*\n\n(O nosso catálogo de fotos está temporariamente em atualização). \nPor favor, escolhe o serviço desejado na lista abaixo para agendar:', 
        optServicos
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