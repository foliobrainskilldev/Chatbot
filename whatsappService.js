require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const { seedDatabase, prisma } = require('./db');
const { iniciarAutomaçoes } = require('./cronJobs');
const routes = require('./routes');
const security = require('./middlewares/security');

const app = express();

// CORREÇÃO CRÍTICA PARA HOSPEDAGEM (RENDER/HEROKU)
// Diz ao Express para confiar no Proxy do Render.
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

// Logger global para diagnosticar requisições da Meta
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
// Estas rotas ficam ANTES do "app.use('/', routes)" para garantir velocidade máxima.
// =========================================================================

// 1. VERIFICAÇÃO DO WEBHOOK (Usado quando você cadastra a URL no painel da Meta)
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

// 2. RECEBIMENTO DE MENSAGENS
app.post('/webhook', async (req, res) => {
    // 💡 SOLUÇÃO DO TIQUE CINZENTO: Responde 200 OK imediatamente!
    res.sendStatus(200);

    try {
        const body = req.body;

        // FILTRO ANTI-CRASH: Ignora recibos de leitura/entrega. 
        // A Meta envia isso constantemente e não possui "message.from", o que travava seu bot.
        if (body.entry?.[0]?.changes?.[0]?.value?.statuses) {
            return; 
        }

        if (body.object) {
            const changeValue = body.entry?.[0]?.changes?.[0]?.value;
            const message = changeValue?.messages?.[0];
            const contact = changeValue?.contacts?.[0];

            if (message) {
                // Adiciona o nome do perfil (se existir) ao objeto da mensagem
                if (contact) {
                    message.profile = { name: contact.profile?.name };
                }

                // Descobrir qual motor está ativo no Hub Global
                const config = await prisma.configSistema.findFirst();
                const modoAtivo = config?.modoAtivo || 'CLINICA';

                // Roteamento para o motor correspondente
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


// Rotas gerais da aplicação
app.use('/', routes);

// HEALTH CHECK
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
        iniciarAutomaçoes(); 
        
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