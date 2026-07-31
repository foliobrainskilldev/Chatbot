const express = require('express');
const { handleMessage } = require('./messageHandler');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'barbearia_secreta_2024';

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook autorizado com sucesso pela Meta!');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', (req, res) => {
    
    // REGRA DE OURO ANTI-DUPLICAÇÃO E LOOPS DA META FACEBOOK:
    // Devemos despachar já o ACK '200 OK' de regresso para aliviar as API DELES instantaneamente.
    res.sendStatus(200);

    // Fazemos todo o processo pesado por TRÁS ASYNC livremente da tela de fundo!
    (async () => {
        try {
            const body = req.body;
            if (body.object) {
                let changes = body.entry?.[0]?.changes?.[0]?.value;

                if (changes?.messages?.[0]) {
                    const message = changes.messages[0];
                    const contact = changes.contacts?.[0]; // Dica Oculta para raptar o perfil 

                    console.log(`✅ MSG Captada de ${message.from}. Trâmite Livre...`);
                    await handleMessage(message, contact);
                } 
            }
        } catch (error) {
            console.error('❌ ERRO ASYNC INTERNO NO FLUXO DE REDE:', error);
        }
    })(); // O async chama e afasta p\ o Limbo a fila p\ Wapp! 🚀
});

app.get('/ping', (req, res) => res.send('Pong! I.A Engine Livre e Desembaraçada!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Meta API e LPU (Groq) Acordada na ${PORT}`));