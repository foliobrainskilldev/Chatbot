const { prisma } = require('./db');
const botBarbearia = require('./barbearia/botEngine'); // Motor exclusivo da Barbearia
const botClinica = require('./clinica/botEngine');     // Motor exclusivo da Clínica

const verificarWebhook = (req, res) => {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'barbearia_secreta_2024';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook autorizado com sucesso pela Meta!');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
};

const processarWebhook = (req, res) => {
    res.sendStatus(200); // Exigência da Meta: Responder 200 IMEDIATAMENTE
    (async () => {
        try {
            const body = req.body;
            if (body.object) {
                let changes = body.entry?.[0]?.changes?.[0]?.value;
                if (changes?.messages?.[0]) {
                    const message = changes.messages[0];
                    
                    // ===============================================
                    // INTERCEPTOR ISOLADOR: Descobre qual Nicho rodar
                    // ===============================================
                    const configDb = await prisma.configSistema.findFirst();
                    const modoAtivo = configDb?.modoAtivo || 'BARBEARIA';
                    
                    if (modoAtivo === 'BARBEARIA') {
                        await botBarbearia.processarMensagemEntrante(message);
                    } else if (modoAtivo === 'CLINICA') {
                        await botClinica.processarMensagemEntrante(message);
                    }
                } 
            }
        } catch (error) {
            console.error('❌ ERRO INTERNO NO PROCESSAMENTO DO WEBHOOK:', error);
        }
    })();
};

function limparMemoriaEstado() {
    if(botBarbearia.limparMemoriaEstado) botBarbearia.limparMemoriaEstado();
    if(botClinica.limparMemoriaEstado) botClinica.limparMemoriaEstado();
}

module.exports = {
    verificarWebhook,
    processarWebhook,
    limparMemoriaEstado
};