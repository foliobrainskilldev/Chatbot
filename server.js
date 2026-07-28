const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { connectToWhatsApp, solicitarCodigoPareamento, limparSessao, getStatus, getLastQR } = require('./index.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/ping', (req, res) => {
    res.status(200).send('Pong! O bot da barbearia está acordado.');
});

io.on('connection', (socket) => {
    console.log('💻 Painel Web acedido.');
    
    // Envia o estado atual IMEDIATAMENTE quando a pessoa abre o site
    socket.emit('status', getStatus());
    const qr = getLastQR();
    if (qr) socket.emit('qr_code', qr);
    if (getStatus() === 'Conectado ✅') socket.emit('conectado', true);

    socket.on('solicitar_codigo', async (numero) => {
        try {
            const codigo = await solicitarCodigoPareamento(numero);
            socket.emit('codigo_pareamento', codigo);
        } catch (error) {
            console.error("Erro ao gerar código:", error);
            socket.emit('erro', 'Falha ao gerar o código. Garante que digitaste o código do país (ex: 25884...).');
        }
    });

    socket.on('limpar_sessao', async () => {
        await limparSessao();
    });
});

connectToWhatsApp(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Servidor a rodar na porta: ${PORT}`);
});