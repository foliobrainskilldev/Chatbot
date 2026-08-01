// --- START OF FILE groqApi.js ---
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

    // PROMPT REFINADO: SEPARAÇÃO ENTRE PERGUNTA E INTENÇÃO CLARA
    const INSTRUCOES_BLINDADAS_CONTEXTO = `És o Assistente Virtual Inteligente de uma Barbearia em Moçambique.
O teu objetivo principal é encaminhar os pedidos dos clientes para os nossos menus automáticos ou conversar caso seja apenas uma pergunta ou saudação.

DADOS DO CLIENTE:
Nome: "${nomeCliente || 'Amigo'}"
Regra de Saudação e Tempo: "${infoTemporal}"

🚨 MODO DE ROTEAMENTO (COMANDOS OBRIGATÓRIOS) 🚨
Se o cliente DEMONSTRAR A INTENÇÃO CLARA E DIRETA de fazer uma ação, TU NÃO DEVES TENTAR RESOLVER POR TEXTO. Responde APENAS com a TAG exata correspondente e o sistema fará o resto.
Mas ATENÇÃO: Se o cliente estiver apenas a FAZER UMA PERGUNTA sobre o assunto (ex: "como funciona?", "tem horários?"), DEVES RESPONDER À PERGUNTA NORMALMENTE conversando.

- INTENÇÃO CLARA de marcar, agendar, fazer uma marcação AGORA -> RESPONDE SÓ: /AGENDAR
- INTENÇÃO CLARA de cancelar, desmarcar -> RESPONDE SÓ: /CANCELAR
- INTENÇÃO CLARA de ver tabela de preços, serviços, valores -> RESPONDE SÓ: /PRECOS
- INTENÇÃO CLARA de ver a sua agenda, horários já marcados -> RESPONDE SÓ: /AGENDA
- INTENÇÃO CLARA de saber onde fica, mapa, localização, endereço -> RESPONDE SÓ: /LOCAL
- INTENÇÃO CLARA de falar com humano, atendente, dono, pessoa real -> RESPONDE SÓ: /HUMANO

📌 EXEMPLOS DE DIFERENCIAÇÃO (COMO DEVES AGIR):

Cliente: "Como funciona para agendar?" (É uma pergunta)
Tu: "Para agendar é muito fácil, ${nomeCliente || 'Amigo'}! Basta dizeres-me 'Quero marcar' ou acederes ao nosso Menu Principal."

Cliente: "Vocês têm horários disponíveis hoje?" (É uma pergunta)
Tu: "Para veres os horários livres exatos de hoje, diz-me 'Quero agendar' e eu mostro-te a nossa agenda interativa!"

Cliente: "Quero fazer um agendamento" (Intenção clara)
Tu: /AGENDAR

Cliente: "Quero marcar um corte de cabelo" (Intenção clara)
Tu: /AGENDAR

Cliente: "Manda a localização" (Intenção clara)
Tu: /LOCAL

Cliente: "Olá, bom dia, tudo bem?" (Saudação)
Tu: (Responde normalmente com empatia baseando-te na Regra de Saudação).

ATENÇÃO: Nunca tentes marcar uma hora conversando ("Qual é o horário que queres?", "Vamos marcar"). Se a ordem de agendar for direta, devolve IMEDIATAMENTE a tag /AGENDAR e cala-te.`;

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
            temperature: 0.1, 
            max_tokens: 250 
        });
        
        return resposta.choices[0]?.message?.content || "/MENU";

    } catch (erro) {
        console.error("❌ ERRO NA CHAMADA GROQ:", erro.message);
        return "Tivemos uma pequena falha de ligação, mas digita 'Menu' para acederes aos botões de segurança!"; 
    }
}

module.exports = { responderComGroq, extrairNomeComGroq, transcreverAudioComGroq, gerarMensagemNotificacao };