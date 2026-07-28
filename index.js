const { default: makeWASocket, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const { prisma, seedDatabase } = require('./db');
const usePrismaAuthState = require('./usePrismaAuthState');
const { handleMessage } = require('./messageHandler');

// Variáveis globais para manter o estado da conexão para o painel web
let sock;
let currentStatus = 'A arrancar o sistema... ⏳';
let lastQR = null;
let ioInstance;

async function connectToWhatsApp(io) {
    ioInstance = io;
    
    // Assegura que temos serviços e barbeiros na base de dados
    await seedDatabase();
    
    // Substituímos a função local pela que guarda no Banco de Dados Postgres (Render)
    const { state, saveCreds } = await usePrismaAuthState(prisma);

    // Inicialização do socket do Baileys
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        // O Browser precisa ser Chrome no Mac/Linux para o código de pareamento funcionar na última versão
        browser: Browsers.macOS('Chrome'), 
        generateHighQualityLinkPreview: true
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Se houver um QR Code novo, converte para imagem e envia para o painel web
        if (qr) {
            try {
                lastQR = await qrcode.toDataURL(qr);
                currentStatus = 'A aguardar QR Code ou Código de Pareamento 📱';
                if (ioInstance) {
                    ioInstance.emit('qr_code', lastQR);
                    ioInstance.emit('status', currentStatus);
                }
            } catch (err) {
                console.error("Erro ao gerar QR Code", err);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            if (shouldReconnect) {
                currentStatus = 'Conexão perdida. A reconectar... 🔄';
                if (ioInstance) ioInstance.emit('status', currentStatus);
                
                // Tenta reconectar após 5 segundos
                setTimeout(() => connectToWhatsApp(ioInstance), 5000);
            } else {
                currentStatus = 'Sessão encerrada ou inválida ❌. Limpe a sessão no painel!';
                if (ioInstance) ioInstance.emit('status', currentStatus);
                
                console.log('❌ Sessão terminada pelo utilizador (Logged Out).');
                // Se o cliente deslogou no telemóvel, limpamos as credenciais do banco
                await prisma.sessaoBaileys.deleteMany(); 
            }
        } else if (connection === 'open') {
            currentStatus = 'Conectado ✅';
            lastQR = null; // Limpa o QR Code da memória
            
            if (ioInstance) {
                ioInstance.emit('status', currentStatus);
                ioInstance.emit('conectado', true); 
            }
            console.log('✅ Bot conectado e pronto a operar no WhatsApp!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Escuta novas mensagens
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        // Ignora mensagens enviadas pelo próprio bot ou sem conteúdo
        if (!msg.message || msg.key.fromMe) return;
        
        await handleMessage(sock, msg);
    });
}

// Função para gerar o código de pareamento por número de telefone
async function solicitarCodigoPareamento(numero) {
    if (!sock) throw new Error("O bot ainda não iniciou completamente.");
    
    // Remove tudo que não seja número (incluindo o sinal de + e espaços)
    const numeroLimpo = numero.replace(/[^0-9]/g, '');
    
    // TRUQUE VITAL: O Baileys precisa de um atraso de 2 segundos antes de pedir o código (Nova Regra do WhatsApp)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const codigo = await sock.requestPairingCode(numeroLimpo);
    return codigo;
}

// Função segura para limpar a sessão em caso de erro fatal
async function limparSessao() {
    console.log("A limpar sessão a pedido do utilizador...");
    
    try {
        // Apagamos todas as credenciais corrompidas do PostgreSQL
        await prisma.sessaoBaileys.deleteMany();
    } catch (e) {
        console.error("Erro ao limpar banco de dados", e);
    }
    
    // Forçamos o encerramento da aplicação (process.exit). 
    // O Render (ou outro serviço cloud) vai reiniciar a aplicação automaticamente com a base limpa!
    process.exit(1); 
}

// Funções utilitárias para o Servidor Web (Express) saber o que mostrar a novos visitantes
const getStatus = () => currentStatus;
const getLastQR = () => lastQR;

module.exports = { 
    connectToWhatsApp, 
    solicitarCodigoPareamento, 
    limparSessao, 
    getStatus, 
    getLastQR 
};