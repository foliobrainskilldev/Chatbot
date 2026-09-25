const { prisma } = require('./db');
const botBarbearia = require('./barbearia/botEngine'); 
const botClinica = require('./clinica/botEngine');     

const verificarWebhook = (req, res) => {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN ? process.env.VERIFY_TOKEN.trim() : 'barbearia_secreta_2024';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook autorizado pela Meta!');
        res.status(200).send(challenge);
    } else {
        console.log('❌ Falha na verificação do Webhook. Token incorreto.');
        res.sendStatus(403);
    }
};

const processarWebhook = (req, res) => {
    // 1. Libera o WhatsApp Imediatamente para evitar loops de retry
    res.sendStatus(200); 

    (async () => {
        try {
            const body = req.body;
            
            if (!body) return;
            if (!body.object) return;

            let changes = body.entry?.[0]?.changes?.[0]?.value;
            
            if (changes?.statuses) {
                let statusObj = changes.statuses[0];
                if (statusObj.status === 'failed') {
                    console.error('🚨 [ALERTA META API] Entrega bloqueada:', JSON.stringify(statusObj.errors, null, 2));
                }
                return; 
            }
            
            if (changes?.messages?.[0]) {
                const message = changes.messages[0];
                
                const contact = changes.contacts?.[0];
                if (contact?.profile?.name) {
                    message.profile = { name: contact.profile.name };
                }
                
                const configDb = await prisma.configSistema.findUnique({ where: { id: 1 } });
                const modoAtivo = configDb?.modoAtivo || 'BARBEARIA';
                
                // Roteia a mensagem bruta para as máquinas de Fila e Retenção recém-criadas
                if (modoAtivo === 'BARBEARIA') {
                    await botBarbearia.processarMensagemEntrante(message);
                } else if (modoAtivo === 'CLINICA') {
                    await botClinica.processarMensagemEntrante(message);
                }
            } 
        } catch (error) {
            console.error('❌ [ERRO CRÍTICO INTERNO NO HUB WEBHOOK]:', error);
        }
    })();
};

// Quando um atendente assume a conversa ou o banco é reiniciado, 
// ele zera tanto os timers quanto a memória do LLM
function limparMemoriaEstado(telefone = null) {
    if (botBarbearia.limparMemoriaEstado) botBarbearia.limparMemoriaEstado(telefone);
    if (botClinica.limparMemoriaEstado) botClinica.limparMemoriaEstado(telefone);
}

module.exports = {
    verificarWebhook,
    processarWebhook,
    limparMemoriaEstado
};