const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { handleMessage } = require('./messageHandler');
const { iniciarLembretesEFollowUp } = require('./cronJobs');
const crmRoutes = require('./crmRoutes'); 

const app = express();
const server = http.createServer(app); 

// WebSockets para o CRM Multi-Nicho
const io = new Server(server, { cors: { origin: "*" } });
global.io = io; 

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

app.use('/uploads', express.static(uploadsDir));
app.use(express.json());
app.use(cors());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'barbearia_secreta_2024'; // Pode manter, serve apenas para validação Meta

// Rota Base do CRM (Onde o Dashboard frontend vai buscar os dados)
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

app.get('/ping', (req, res) => res.send('Pong! Motor CRM Multi-Nichos (Barbearia/Clínica) Ativo!'));

const PORT = process.env.PORT || 3000;

// Liga os Robôs de Automação (Follow-Up, Lembretes, Avaliações)
iniciarLembretesEFollowUp();

server.listen(PORT, () => console.log(`🚀 Meta API, CRM Multi-Nicho e Automações rodando na porta ${PORT}`));