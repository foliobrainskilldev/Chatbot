require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const { seedDatabase, prisma } = require('./db');
const routes = require('./routes');
const security = require('./middlewares/security');

const app = express();

// CORREÇÃO CRÍTICA PARA HOSPEDAGEM (RENDER/HEROKU)
app.set('trust proxy', 1);

const server = http.createServer(app);

// CONFIGURAÇÃO DO WEBSOCKET
const io = new Server(server, { 
    cors: { 
        origin: "*", 
        methods: ["GET", "POST", "PUT", "DELETE"]
    } 
});
global.io = io; 

// MIDDLEWARES DE SEGURANÇA E PARSERS
app.use(security.securityHeaders);
app.use(cors());
app.use(security.payloadLimit);
app.use(security.urlEncodedLimit);

// Logger global
app.use((req, res, next) => {
    if (req.method === 'POST' && req.url.includes('/webhook')) {
        console.log(`[INCOMING REQUEST] IP: ${req.ip} | Method: ${req.method} | URL: ${req.url}`);
    }
    next();
});

// LIMITADORES DE REQUISIÇÃO
app.use('/api', security.globalLimiter); 
app.use('/webhook', security.webhookLimiter); 

// =========================================================================
// 🚀 ROTAS CRÍTICAS DO WEBHOOK DA META (WHATSAPP)
// =========================================================================
app.get('/webhook', (req, res) => {
    const verify_token = process.env.VERIFY_TOKEN || "healthcrm_token";
    let mode = req.query["hub.mode"];
    let token = req.query["hub.verify_token"];
    let challenge = req.query["hub.challenge"];

    if (mode && token) {
        if (mode === "subscribe" && token === verify_token) {
            console.log("✅ [WEBHOOK] Conexão verificada com sucesso pela Meta!");
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

app.post('/webhook', async (req, res) => {
    // RESPONDE A META IMEDIATAMENTE (EVITA TIQUE CINZENTO)
    res.sendStatus(200);

    try {
        const body = req.body;

        // FILTRO ANTI-CRASH: Ignora recibos de leitura/entrega
        if (body.entry?.[0]?.changes?.[0]?.value?.statuses) {
            return; 
        }

        if (body.object) {
            const changeValue = body.entry?.[0]?.changes?.[0]?.value;
            const message = changeValue?.messages?.[0];
            const contact = changeValue?.contacts?.[0];

            if (message) {
                if (contact) message.profile = { name: contact.profile?.name };

                const config = await prisma.configSistema.findFirst();
                const modoAtivo = config?.modoAtivo || 'CLINICA';

                if (modoAtivo === 'BARBEARIA') {
                    const barbeariaEngine = require('./barbearia/botEngine');
                    barbeariaEngine.processarMensagemEntrante(message);
                } else {
                    const clinicaEngine = require('./clinica/botEngine');
                    clinicaEngine.processarMensagemEntrante(message);
                }
            }
        }
    } catch (error) {
        console.error("❌ [WEBHOOK] Erro crítico ao rotear a mensagem:", error);
    }
});
// =========================================================================

app.use('/', routes);

app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: "online", 
        timestamp: new Date().toISOString(),
        memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 + " MB"
    });
});

const PORT = process.env.PORT || 3000;

async function bootstrap() {
    try {
        await seedDatabase();

        // 💡 SOLUÇÃO: Importação Dinâmica. Isso resolve a "Circular Dependency" e o crash!
        const cronJobs = require('./cronJobs');
        if (cronJobs && typeof cronJobs.iniciarAutomacoes === 'function') {
            cronJobs.iniciarAutomacoes();
        } else if (cronJobs && typeof cronJobs.iniciarAutomaçoes === 'function') {
            cronJobs.iniciarAutomaçoes();
        } else {
            console.warn("⚠️ Função do Cron Job não encontrada. Ignorando e seguindo em frente.");
        }
        
        server.listen(PORT, () => {
            console.log(`[SYSTEM] API Central SaaS operando na porta ${PORT}`);
            console.log(`[SYSTEM] Proteções ativas: Helmet, Rate-Limit, Memory-Capping`);
        });
    } catch (error) {
        console.error("[ERRO CRÍTICO] Falha ao iniciar servidor:", error);
        process.exit(1);
    }
}

process.on('SIGTERM', async () => {
    console.log('[SYSTEM] Sinal SIGTERM recebido. Encerrando processos...');
    await prisma.$disconnect();
    server.close(() => {
        console.log('[SYSTEM] Servidor HTTP encerrado com segurança.');
        process.exit(0);
    });
});

bootstrap();