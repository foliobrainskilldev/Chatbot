const { prisma } = require('./db');
const botBarbearia = require('./barbearia/botEngine'); 
const botClinica = require('./clinica/botEngine');     

const verificarWebhook = (req, res) => {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'barbearia_secreta_2024';
    
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook autorizado com sucesso pela Meta!');
        res.status(200).send(challenge);
    } else {
        console.warn('❌ Falha na autorização do Webhook. Token incorreto.');
        res.sendStatus(403);
    }
};

const processarWebhook = (req, res) => {
    // É CRUCIAL retornar o 200 OK imediatamente para a Meta,
    // Senão ela acha que o bot caiu e reenvia a mensagem (causando silêncio e loops)
    res.sendStatus(200); 

    (async () => {
        try {
            const body = req.body;
            
            if (body.object) {
                let changes = body.entry?.[0]?.changes?.[0]?.value;
                
                // PREVENÇÃO DE CRASH: Ignora eventos de status (Entregue, Lido)
                if (changes?.statuses) {
                    return; 
                }
                
                if (changes?.messages?.[0]) {
                    const message = changes.messages[0];
                    
                    const configDb = await prisma.configSistema.findUnique({ where: { id: 1 } });
                    const modoAtivo = configDb?.modoAtivo || 'BARBEARIA';
                    
                    if (modoAtivo === 'BARBEARIA') {
                        await botBarbearia.processarMensagemEntrante(message);
                    } else if (modoAtivo === 'CLINICA') {
                        await botClinica.processarMensagemEntrante(message);
                    } else {
                        console.warn(`[AVISO] Modo ativo desconhecido: ${modoAtivo}`);
                    }
                } 
            }
        } catch (error) {
            console.error('❌ ERRO INTERNO NO PROCESSAMENTO DO WEBHOOK:', error);
        }
    })();
};

function limparMemoriaEstado() {
    if (botBarbearia.limparMemoriaEstado) botBarbearia.limparMemoriaEstado();
    if (botClinica.limparMemoriaEstado) botClinica.limparMemoriaEstado();
    console.log('🧹 Memória de estado de todos os robôs limpa com sucesso.');
}

module.exports = {
    verificarWebhook,
    processarWebhook,
    limparMemoriaEstado
};