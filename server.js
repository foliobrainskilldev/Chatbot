const express = require('express');
const { handleMessage } = require('./messageHandler');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'barbearia_secreta_2024';

// 1. Rota para o Facebook Verificar o nosso site (A funcionar a 100% pelos teus testes)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook autorizado com sucesso pela Meta!');
        res.status(200).send(challenge);
    } else {
        console.error('❌ Falha na autorização do Webhook!');
        res.sendStatus(403);
    }
});

// 2. Rota POST Onde Ocorre a Magia (AGORA COM LOGS COMPLETOS)
app.post('/webhook', async (req, res) => {
    // 🔥 RAIO-X: Isto vai disparar mal o Render receba sequer 1 pixel do Facebook
    console.log('\n================ 📥 WEBHOOK ACIONADO ================');
    
    const body = req.body;
    
    // Mostra TUDO o que o Facebook mandou sem filtrar (Ótimo para descobrirmos os erros)
    console.dir(body, { depth: null });

    if (body.object) {
        // Tentamos entrar de forma segura nas camadas chatas da META JSON 
        try {
            let changes = body.entry?.[0]?.changes?.[0]?.value;

            if (changes?.messages?.[0]) {
                const message = changes.messages[0];
                const contact = changes.contacts?.[0];
                
                console.log(`✅ Nova mensagem do n.º [${message.from}]. Encaminhando para os Fluxos...`);
                await handleMessage(message, contact);

            } else if (changes?.statuses?.[0]) {
                const s = changes.statuses[0];
                console.log(`ℹ️ [META AVISO] - Status: Mensagem enviada a ${s.recipient_id} está -> ${s.status}`);
            } else {
                console.log('⚠️ [META AVISO] - Chegou algo diferente (Pode ser Erro de Política da META. Olhe o log cru acima!)');
            }

        } catch (error) {
            console.error('❌ ERRO CRÍTICO A LER O PACOTE DA META:', error);
        }
        
        // TEMOS de mandar sempre um OK rápido à Meta. Senão eles repetem envios mil vezes até tu seres Banido do teste!
        res.sendStatus(200);
    } else {
        console.log('❌ Pedido Inválido (Nem veio do whatsapp aparentemente!)');
        res.sendStatus(404);
    }
});

app.get('/ping', (req, res) => res.send('Pong! Motor vivo.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n==============================================`);
    console.log(`🚀 [RADAR ATIVADO] API Meta ativa na porta ${PORT}`);
    console.log(`==============================================\n`);
});