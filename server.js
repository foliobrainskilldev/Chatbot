const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const routes = require('./routes');
const { iniciarAutomaçoes } = require('./cronJobs');
const { seedDatabase } = require('./db');

const app = express();
const server = http.createServer(app);

// Configuração do WebSocket totalmente aberto para o Frontend externo
const io = new Server(server, { 
    cors: { 
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"]
    } 
});
global.io = io; // Disponibiliza o Socket globalmente

// Diretório de Uploads reais de mídia do WhatsApp
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Serve APENAS as mídias estaticamente para as imagens/áudios funcionarem no Frontend
app.use('/uploads', express.static(uploadsDir));

// Middlewares essenciais para a API pura
app.use(express.json());
app.use(cors()); // Permite que o Frontend em outro domínio consuma esta API

// Rota de Teste de Vida da API
app.get('/ping', (req, res) => {
    res.status(200).json({ 
        status: "online", 
        message: "Pong! Motor CRM Multi-Nichos Ativo e Operante como API pura!" 
    });
});

// Conectar as Rotas Principais e Webhook
app.use('/', routes);

const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
    try {
        await seedDatabase();
        iniciarAutomaçoes();
        console.log(`🚀 API Central e Webhook iniciados com sucesso na porta ${PORT}`);
    } catch (error) {
        console.error("❌ Erro fatal ao iniciar servidor:", error);
    }
});