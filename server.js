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
const server = http.createServer(app);

// ==========================================
// CONFIGURAÇÃO DO WEBSOCKET (REAL-TIME)
// ==========================================
const io = new Server(server, { 
    cors: { 
        origin: "*", // Em produção estrita, mude para o domínio do painel
        methods: ["GET", "POST", "PUT", "DELETE"]
    } 
});
global.io = io; // Disponibiliza globalmente para os controllers

// ==========================================
// MIDDLEWARES DE SEGURANÇA E PARSERS
// ==========================================
app.use(security.securityHeaders);
app.use(cors());
app.use(security.payloadLimit);
app.use(security.urlEncodedLimit);

// ==========================================
// ROTEAMENTO PRINCIPAL
// ==========================================
// O limitador global é aplicado em todas as rotas abaixo desta linha
app.use('/api', security.globalLimiter); 

// O limitador exclusivo para o Webhook da Meta
app.use('/webhook', security.webhookLimiter); 

// Conecta o roteador central (que ramifica Clínica, Barbearia e Webhooks)
app.use('/', routes);

// ==========================================
// HEALTH CHECK (SaaS Status)
// ==========================================
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: "online", 
        timestamp: new Date().toISOString(),
        memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 + " MB"
    });
});

// ==========================================
// INICIALIZAÇÃO & GRACEFUL SHUTDOWN
// ==========================================
const PORT = process.env.PORT || 3000;

async function bootstrap() {
    try {
        await seedDatabase();
        iniciarAutomaçoes(); // Inicia os CRONs de lembretes e follow-ups
        
        server.listen(PORT, () => {
            console.log(`[SYSTEM] API Central SaaS operando na porta ${PORT}`);
            console.log(`[SYSTEM] Proteções ativas: Helmet, Rate-Limit, Memory-Capping`);
        });
    } catch (error) {
        console.error("[ERRO CRÍTICO] Falha ao iniciar servidor:", error);
        process.exit(1);
    }
}

// Graceful Shutdown (Fecha conexões com banco antes de desligar)
process.on('SIGTERM', async () => {
    console.log('[SYSTEM] Sinal SIGTERM recebido. Encerrando processos...');
    await prisma.$disconnect();
    server.close(() => {
        console.log('[SYSTEM] Servidor HTTP encerrado com segurança.');
        process.exit(0);
    });
});

bootstrap();