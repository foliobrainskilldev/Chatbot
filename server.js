// --- START OF FILE server.js ---
const express = require('express');
const cors = require('cors');
const http = require('http'); // Novo
const { Server } = require('socket.io'); // Novo
const { handleMessage, stateMachine } = require('./messageHandler');
const { iniciarLembretesEFollowUp } = require('./cronJobs');
const crmRoutes = require('./crmRoutes'); 

const app = express();
const server = http.createServer(app); // Cria o servidor HTTP

// Configura o WebSocket permitindo qualquer origem (CORS)
const io = new Server(server, { cors: { origin: "*" } });
global.io = io; // Torna o WebSocket global para usar nos outros ficheiros

app.use(express.json());
app.use(cors());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'barbearia_secreta_2024';

app.use('/api/crm', crmRoutes);

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
    res.sendStatus(200);
    (async () => {
        try {
            const body = req.body;
            if (body.object) {
                let changes = body.entry?.[0]?.changes?.[0]?.value;
                if (changes?.messages?.[0]) {
                    const message = changes.messages[0];
                    const contact = changes.contacts?.[0]; 
                    await handleMessage(message, contact);
                } 
            }
        } catch (error) {
            console.error('❌ ERRO ASYNC INTERNO NO FLUXO DE REDE:', error);
        }
    })(); 
});

app.get('/ping', (req, res) => res.send('Pong! I.A Engine Livre e Desembaraçada!'));

const PORT = process.env.PORT || 3000;
iniciarLembretesEFollowUp();

// ATENÇÃO: Agora usamos server.listen em vez de app.listen
server.listen(PORT, () => console.log(`🚀 Meta API, CRM e WebSockets a correr na porta ${PORT}`));
// --- END OF FILE server.js ---