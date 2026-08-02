// --- START OF FILE server.js ---
const express = require('express');
const cors = require('cors');
const { handleMessage } = require('./messageHandler');
const { iniciarLembretesEFollowUp } = require('./cronJobs');
const crmRoutes = require('./crmRoutes'); // Novo import de rotas para o CRM

const app = express();
app.use(express.json());

// Permite requisições de outros domínios (Frontend do CRM)
app.use(cors());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'barbearia_secreta_2024';

// Rotas do CRM separadas (Todas terão o prefixo /api/crm)
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
app.listen(PORT, () => console.log(`🚀 Meta API e LPU (Groq) Acordada na porta ${PORT}`));