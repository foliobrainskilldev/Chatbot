const { prisma } = require('./db');
const botBarbearia = require('./barbearia/botEngine'); 
const botClinica = require('./clinica/botEngine');     
const whatsappService = require('./whatsappService'); // Importado para mandar avisos de emergência

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
    res.sendStatus(200); 

    (async () => {
        try {
            const body = req.body;
            
            if (body.object) {
                let changes = body.entry?.[0]?.changes?.[0]?.value;
                if (changes?.statuses) return; 
                
                if (changes?.messages?.[0]) {
                    const message = changes.messages[0];
                    
                    const configDb = await prisma.configSistema.findUnique({ where: { id: 1 } });
                    const modoAtivo = configDb?.modoAtivo || 'BARBEARIA';
                    
                    if (modoAtivo === 'BARBEARIA') {
                        await botBarbearia.processarMensagemEntrante(message);
                    } else if (modoAtivo === 'CLINICA') {
                        await botClinica.processarMensagemEntrante(message);
                    }
                } 
            }
        } catch (error) {
            console.error('❌ ERRO INTERNO NO WEBHOOK ROOT:', error.message);
            // ESCUDO FINAL: Tenta notificar o utilizador no WhatsApp caso o sistema rebente
            try {
                let senderNumber = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
                if (senderNumber) {
                    await whatsappService.sendText(senderNumber, "⚠️ Olá! O meu sistema está a reiniciar ou com falha de conexão. Volto a estar disponível em breves instantes.");
                }
            } catch(e) {}
        }
    })();
};

function limparMemoriaEstado() {
    if (botBarbearia.limparMemoriaEstado) botBarbearia.limparMemoriaEstado();
    if (botClinica.limparMemoriaEstado) botClinica.limparMemoriaEstado();
}

module.exports = {
    verificarWebhook,
    processarWebhook,
    limparMemoriaEstado
};