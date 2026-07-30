const express = require('express');
const { handleMessage } = require('./messageHandler');

const app = express();
app.use(express.json());

// Token de verificação que vais definir na Meta e no Render
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'barbearia_secreta_2024';

// 1. Rota GET para a Meta verificar o Webhook
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook verificado pela Meta!');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// 2. Rota POST onde chegam as mensagens dos clientes
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object) {
        if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0]) {
            const message = body.entry[0].changes[0].value.messages[0];
            const contact = body.entry[0].changes[0].value.contacts[0];
            
            // Passa a mensagem para a nossa inteligência
            await handleMessage(message, contact);
        }
        res.sendStatus(200);
    } else {
        res.sendStatus(404);
    }
});

app.get('/ping', (req, res) => res.send('Bot da Barbearia (API Oficial) está vivo!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Servidor Webhook a rodar na porta: ${PORT}\n`);
});