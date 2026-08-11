const { prisma } = require('./db');
const botBarbearia = require('./barbearia/botEngine'); 
const botClinica = require('./clinica/botEngine');     
const whatsappService = require('./whatsappService'); 

const verificarWebhook = (req, res) => {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'barbearia_secreta_2024';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook autorizado pela Meta!');
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
            if (!body.object) return;

            let changes = body.entry?.[0]?.changes?.[0]?.value;
            
            // 🚨 RASTREADOR DE SILÊNCIO: Captura as rejeições assíncronas da Meta!
            if (changes?.statuses) {
                let statusObj = changes.statuses[0];
                if (statusObj.status === 'failed') {
                    console.error('🚨 [ALERTA META API] O WhatsApp bloqueou a entrega da mensagem! Motivo exato:', JSON.stringify(statusObj.errors, null, 2));
                }
                return; 
            }
            
            if (changes?.messages?.[0]) {
                const message = changes.messages[0];
                console.log(`\n📩 [WEBHOOK] Mensagem do paciente ${message.from} recebida no servidor.`);

                const configDb = await prisma.configSistema.findUnique({ where: { id: 1 } });
                const modoAtivo = configDb?.modoAtivo || 'BARBEARIA';
                console.log(`⚙️ [SISTEMA] Motor Ativo no BD: ${modoAtivo}`);
                
                if (modoAtivo === 'BARBEARIA') {
                    await botBarbearia.processarMensagemEntrante(message);
                } else if (modoAtivo === 'CLINICA') {
                    await botClinica.processarMensagemEntrante(message);
                }
                
                console.log(`🏁 [FIM] Processo concluído com sucesso para: ${message.from}\n`);
            } 
        } catch (error) {
            console.error('❌ [ERRO CRÍTICO INTERNO]:', error);
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