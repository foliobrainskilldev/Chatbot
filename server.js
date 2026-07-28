const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { connectToWhatsApp, solicitarCodigoPareamento } = require('./index.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Rota principal (O Painel Web)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// NOVO: Rota para o UptimeRobot (impede o Render de adormecer o bot)
app.get('/ping', (req, res) => {
    res.status(200).send('Pong! O bot da barbearia está acordado.');
});

io.on('connection', (socket) => {
    socket.on('solicitar_codigo', async (numero) => {
        try {
            const codigo = await solicitarCodigoPareamento(numero);
            socket.emit('codigo_pareamento', codigo);
        } catch (error) {
            console.error("Erro ao gerar código de pareamento:", error);
            socket.emit('erro', 'Não foi possível gerar o código. Verifica se o número está correto.');
        }
    });
});

connectToWhatsApp(io);

// ATUALIZAÇÃO RENDER: Usar process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n=========================================`);
    console.log(`🌐 Servidor a rodar na porta: ${PORT}`);
    console.log(`=========================================\n`);
});