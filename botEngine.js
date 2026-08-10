// --- START OF FILE botEngine.js ---

const { prisma } = require('./db');
const botBarbearia = require('./barbearia/botEngine'); // Motor exclusivo da Barbearia
const botClinica = require('./clinica/botEngine');     // Motor exclusivo da Clínica

const verificarWebhook = (req, res) => {
    // Token de verificação configurado no painel da Meta Developers
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
    // Exigência estrita da Meta: O servidor DEVE responder 200 OK imediatamente,
    // caso contrário a Meta acha que o servidor caiu e bloqueia o envio.
    res.sendStatus(200); 

    // O processamento da mensagem rola em background (assíncrono) para não prender a resposta
    (async () => {
        try {
            const body = req.body;
            
            if (body.object) {
                let changes = body.entry?.[0]?.changes?.[0]?.value;
                
                if (changes?.messages?.[0]) {
                    const message = changes.messages[0];
                    
                    // ===============================================
                    // INTERCEPTOR ISOLADOR: Descobre qual Nicho rodar
                    // Lê a configuração no banco em tempo real para não precisar reiniciar o Node
                    // ===============================================
                    const configDb = await prisma.configSistema.findUnique({ where: { id: 1 } });
                    const modoAtivo = configDb?.modoAtivo || 'BARBEARIA';
                    
                    console.log(`[ROTEAMENTO META] Direcionando mensagem de ${message.from} para o motor: ${modoAtivo}`);
                    
                    // Direciona a mensagem processada para o motor especialista do Nicho
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
            console.error('❌ ERRO INTERNO NO PROCESSAMENTO DO WEBHOOK (MOTOR RAIZ):', error);
        }
    })();
};

// Limpa a memória de estado (mapeamento de quem está em qual passo de agendamento)
// Útil caso o administrador formate o sistema via Painel Hub
function limparMemoriaEstado() {
    if (botBarbearia.limparMemoriaEstado) {
        botBarbearia.limparMemoriaEstado();
    }
    if (botClinica.limparMemoriaEstado) {
        botClinica.limparMemoriaEstado();
    }
    console.log('🧹 Memória de estado de todos os robôs limpa com sucesso.');
}

module.exports = {
    verificarWebhook,
    processarWebhook,
    limparMemoriaEstado
};