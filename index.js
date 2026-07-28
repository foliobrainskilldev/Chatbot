const { default: makeWASocket, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const { prisma, seedDatabase } = require('./db');
const usePrismaAuthState = require('./usePrismaAuthState');
const { handleMessage } = require('./messageHandler');

let sock;

async function connectToWhatsApp(io) {
    await seedDatabase();
    
    // Substituímos a função local pela que guarda no Banco de Dados Postgres
    const { state, saveCreds } = await usePrismaAuthState(prisma);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome') 
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            try {
                const qrImage = await qrcode.toDataURL(qr);
                io.emit('qr_code', qrImage);
            } catch (err) {
                console.error("Erro ao gerar QR Code", err);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            io.emit('status', 'Desconectado ❌');
            if (shouldReconnect) {
                connectToWhatsApp(io);
            } else {
                console.log('❌ Sessão terminada pelo utilizador (Logged Out).');
                // Se o cliente deslogou no telemóvel, limpamos as credenciais do banco
                await prisma.sessaoBaileys.deleteMany(); 
                io.emit('status', 'Sessão encerrada. Reinicie o servidor.');
            }
        } else if (connection === 'open') {
            io.emit('status', 'Conectado ✅');
            io.emit('conectado', true); 
            console.log('✅ Bot conectado e pronto a operar no WhatsApp!');
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
    if (!sock) throw new Error("O sistema do WhatsApp ainda não arrancou.");
    const numeroLimpo = numero.replace(/[^0-9]/g, '');
    const codigo = await sock.requestPairingCode(numeroLimpo);
    return codigo;
}

module.exports = { connectToWhatsApp, solicitarCodigoPareamento };