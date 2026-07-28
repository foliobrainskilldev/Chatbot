const { default: makeWASocket, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const { prisma, seedDatabase } = require('./db');
const usePrismaAuthState = require('./usePrismaAuthState');
const { handleMessage } = require('./messageHandler');

let sock;
let currentStatus = 'A arrancar o sistema... ⏳';
let lastQR = null;
let ioInstance;

async function connectToWhatsApp(io) {
    ioInstance = io;
    await seedDatabase();
    
    const { state, saveCreds } = await usePrismaAuthState(prisma);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        // O Browser precisa ser Chrome no Mac/Linux para o código de pareamento funcionar
        browser: Browsers.macOS('Chrome'), 
        generateHighQualityLinkPreview: true
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            try {
                lastQR = await qrcode.toDataURL(qr);
                currentStatus = 'A aguardar QR Code ou Código de Pareamento 📱';
                io.emit('qr_code', lastQR);
                io.emit('status', currentStatus);
            } catch (err) {
                console.error("Erro ao gerar QR Code", err);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            if (shouldReconnect) {
                currentStatus = 'Conexão perdida. A reconectar... 🔄';
                io.emit('status', currentStatus);
                setTimeout(() => connectToWhatsApp(io), 5000);
            } else {
                currentStatus = 'Sessão encerrada ou inválida ❌. Limpe a sessão!';
                io.emit('status', currentStatus);
                await prisma.sessaoBaileys.deleteMany(); 
            }
        } else if (connection === 'open') {
            currentStatus = 'Conectado ✅';
            io.emit('status', currentStatus);
            io.emit('conectado', true); 
            console.log('✅ Bot conectado e pronto a operar!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        await handleMessage(sock, msg);
    });
}

async function solicitarCodigoPareamento(numero) {
    if (!sock) throw new Error("O bot ainda não iniciou completamente.");
    
    // Remove tudo que não seja número (incluindo o +)
    const numeroLimpo = numero.replace(/[^0-9]/g, '');
    
    // TRUQUE VITAL: O Baileys precisa de um atraso de 2 segundos antes de pedir o código
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const codigo = await sock.requestPairingCode(numeroLimpo);
    return codigo;
}

async function limparSessao() {
    console.log("A limpar sessão a pedido do utilizador...");
    if (sock) {
        try { sock.logout(); } catch(e){}
    }
    await prisma.sessaoBaileys.deleteMany();
    // Força o Render a reiniciar a aplicação com uma base limpa
    process.exit(1); 
}

const getStatus = () => currentStatus;
const getLastQR = () => lastQR;

module.exports = { connectToWhatsApp, solicitarCodigoPareamento, limparSessao, getStatus, getLastQR };