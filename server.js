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

// ADICIONADO: Logger global para diagnosticar se a requisição da Meta chega no Render
app.use((req, res, next) => {
    if (req.method === 'POST' && req.url.includes('/webhook')) {
        console.log(`[INCOMING REQUEST] IP: ${req.ip} | Method: ${req.method} | URL: ${req.url}`);
    }
    next();
});

// LIMITADORES DE REQUISIÇÃO
app.use('/api', security.globalLimiter); 
app.use('/webhook', security.webhookLimiter); 

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