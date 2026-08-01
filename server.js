// --- START OF FILE server.js ---
const express = require('express');
const { handleMessage } = require('./messageHandler');
const { prisma } = require('./db');
const { iniciarLembretesEFollowUp } = require('./cronJobs');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'barbearia_secreta_2024';

app.get('/admin', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="pt-PT">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Admin - Barbearia Bot</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f9; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 20px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
                h1 { color: #333; margin-top: 0; }
                p { color: #666; margin-bottom: 30px; line-height: 1.5; }
                button { padding: 15px 30px; background-color: #ff4757; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; font-weight: bold; width: 100%; transition: 0.3s; }
                button:hover { background-color: #ff6b81; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>Painel de Controlo</h1>
                <p>Clica no botao abaixo para formatar o cerebro do Bot.<br><br>Ele vai esquecer <strong>todas as conversas, clientes e agendamentos</strong> para poderes testar como se fosses novo.</p>
                <button onclick="resetarBot()">Resetar Memoria do Bot</button>
            </div>
            <script>
                async function resetarBot() {
                    if(confirm('Tem a certeza absoluta? O bot vai comecar do zero e esquecer toda a gente!')) {
                        try {
                            const response = await fetch('/api/reset', { method: 'POST' });
                            const resultado = await response.text();
                            alert(resultado);
                        } catch(e) {
                            alert('Erro ao resetar a base de dados: ' + e);
                        }
                    }
                }
            </script>
        </body>
        </html>
    `);
});

app.post('/api/reset', async (req, res) => {
    try {
        await prisma.mensagemIA.deleteMany({});
        await prisma.agendamento.deleteMany({});
        await prisma.cliente.deleteMany({});
        console.log("🚨 BANCO DE DADOS RESETADO COM SUCESSO VIA PAINEL ADMIN!");
        res.status(200).send("Memoria do bot apagada com sucesso! Todos os clientes foram esquecidos.");
    } catch(error) {
        console.error("❌ Erro ao resetar DB:", error);
        res.status(500).send("Erro interno ao apagar dados.");
    }
});

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

app.get('/ping', (req, res) => res.send('Pong! I.A Engine Livre e Desembaracada!'));

const PORT = process.env.PORT || 3000;

// INICIA O ROBÔ EM SEGUNDO PLANO PARA LEMBRETES E ABANDONOS
iniciarLembretesEFollowUp();

app.listen(PORT, () => console.log(`🚀 Meta API e LPU (Groq) Acordada na porta ${PORT}`));