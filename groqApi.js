const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY || "SEM_CHAVE", 
    baseURL: "https://api.groq.com/openai/v1",
});

async function transcreverAudioComGroq(audioBuffer) {
    if (!process.env.GROQ_API_KEY) return "";
    const tempFilePath = path.join(os.tmpdir(), `audio_bot_${Date.now()}.ogg`);
    fs.writeFileSync(tempFilePath, audioBuffer);

    try {
        const resposta = await groq.audio.transcriptions.create({
            file: fs.createReadStream(tempFilePath),
            model: "whisper-large-v3-turbo", 
            language: "pt", 
        });
        return resposta.text;
    } catch (erro) {
        console.error("❌ ERRO NA TRANSCRIÇÃO DE ÁUDIO:", erro.message);
        return "";
    } finally {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    }
}

async function extrairNomeComGroq(textoCliente) {
    if (!process.env.GROQ_API_KEY) return "IGNORAR";
    try {
        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: "O utilizador está a responder como gostaria de ser chamado. A tua única função é extrair o PRIMEIRO NOME dele. Se ele disser 'O meu nome é Acácio', 'Podes me chamar de João' ou 'Sou a Maria', respondes SÓ com o nome ('Acácio', 'João', 'Maria'). Se ele disser algo que CLARAMENTE NÃO É UM NOME (ex: 'menu', 'agendar', 'quero marcar', 'ola'), responde EXATAMENTE com a palavra: IGNORAR." },
                { role: "user", content: textoCliente }
            ],
            temperature: 0.1,
            max_tokens: 15
        });
        return resposta.choices[0]?.message?.content.trim() || "IGNORAR";
    } catch (erro) {
        return "IGNORAR";
    }
}

async function gerarMensagemNotificacao(promptInstrucao, fallbackText) {
    if (!process.env.GROQ_API_KEY) return fallbackText;
    
    try {
        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: "És o assistente virtual da barbearia. A tua função é redigir uma mensagem curta, amigável e direta para o cliente, baseada nas instruções recebidas. REGRA ABSOLUTA E INQUEBRÁVEL: NÃO USE NENHUM EMOJI EM HIPÓTESE ALGUMA. A mensagem deve ser apenas texto puro." },
                { role: "user", content: promptInstrucao }
            ],
            temperature: 0.4, 
            max_tokens: 100
        });
        return resposta.choices[0]?.message?.content.trim() || fallbackText;
    } catch (erro) {
        console.error("❌ ERRO AO GERAR NOTIFICAÇÃO:", erro.message);
        return fallbackText;
    }
}

async function responderComGroq(mensagemCliente, contextAgendamentos = 0, historicoAnterior, infoTemporal = "", nomeCliente = "") {
    if (!process.env.GROQ_API_KEY) return "Infelizmente estarei cego momentaneamente, avança pelo menu.";

    // PROMPT BLINDADO - REGRAS RÍGIDAS DE ESCOPO E ROTAS
    const INSTRUCOES_BLINDADAS_CONTEXTO = `És o Assistente Virtual Inteligente da "Portal da Barbearia" em Moçambique.
O teu objetivo principal é encaminhar os pedidos dos clientes para os nossos menus automáticos ou conversar caso seja uma pergunta estritamente relacionada à barbearia.

DADOS DO CLIENTE:
Nome: "${nomeCliente || 'Amigo'}"
Regras de Contexto: "${infoTemporal}"

🚨 REGRA DE OURO (FORA DE ESCOPO - ASSUNTOS PROIBIDOS):
Tu és APENAS um assistente de barbearia. Se o cliente fizer perguntas sobre:
- Matemática ou cálculos (ex: Quanto é 50-7)
- Conhecimentos gerais, curiosidades ou celebridades (ex: Quem é o mais rico do mundo)
- Política, programação, história ou qualquer assunto que NÃO SEJA sobre cortes, barba, horários, preços ou endereço da barbearia...
TU ÉS OBRIGADO A RECUSAR EDUCADAMENTE E NÃO RESPONDER À PERGUNTA DELE.
Exemplo de resposta obrigatória para fora de escopo: "Desculpa, mas eu sou apenas o assistente virtual da barbearia! Só consigo ajudar com agendamentos, preços, cortes de cabelo e dúvidas sobre o nosso espaço. Como posso ajudar com o teu visual hoje?"

🚨 MODO DE ROTEAMENTO (COMANDOS OBRIGATÓRIOS):
Se o cliente DEMONSTRAR A INTENÇÃO CLARA E DIRETA de fazer uma ação, NÃO TENTES RESOLVER POR TEXTO. Responde APENAS com a TAG exata correspondente e o sistema fará o resto.
Se o cliente estiver apenas a FAZER UMA PERGUNTA sobre o assunto (ex: "como funciona?", "tem horários?"), responde à pergunta conversando (respeitando a regra de escopo).

- INTENÇÃO CLARA de marcar, agendar, fazer uma marcação AGORA -> RESPONDE SÓ: /AGENDAR
- INTENÇÃO CLARA de cancelar, desmarcar -> RESPONDE SÓ: /CANCELAR
- INTENÇÃO CLARA de ver tabela de preços, serviços, valores -> RESPONDE SÓ: /PRECOS
- INTENÇÃO CLARA de ver a sua agenda, horários já marcados -> RESPONDE SÓ: /AGENDA
- INTENÇÃO CLARA de saber onde fica, mapa, localização, endereço -> RESPONDE SÓ: /LOCAL
- INTENÇÃO CLARA de falar com humano, atendente, dono, pessoa real -> RESPONDE SÓ: /HUMANO`;

    try {
        const constructMessagesFlowEngineLpu = [
            { role: "system", content: INSTRUCOES_BLINDADAS_CONTEXTO }
        ];

        if (historicoAnterior && historicoAnterior.length > 0) {
            historicoAnterior.forEach(linhaOld => {
                if(linhaOld.content) {
                    constructMessagesFlowEngineLpu.push({ role: linhaOld.role, content: linhaOld.content });
                }
            });
        }
        
        constructMessagesFlowEngineLpu.push({ role: "user", content: mensagemCliente });

        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant", 
            messages: constructMessagesFlowEngineLpu,
            temperature: 0.1, // Temperatura baixa para evitar alucinações e manter foco nas regras
            max_tokens: 250 
        });
        
        return resposta.choices[0]?.message?.content || "/MENU";

    } catch (erro) {
        console.error("❌ ERRO NA CHAMADA GROQ:", erro.message);
        return "Tivemos uma pequena falha de ligação, mas digita 'Menu' para acederes aos botões de segurança!"; 
    }
}

module.exports = { responderComGroq, extrairNomeComGroq, transcreverAudioComGroq, gerarMensagemNotificacao };