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
                { role: "system", content: "Extrai APENAS o primeiro nome. Se não for um nome, responde SÓ com a palavra: IGNORAR." },
                { role: "user", content: textoCliente }
            ],
            temperature: 0.1,
            max_tokens: 10
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
                { role: "system", content: "És um assistente de barbearia EXTREMAMENTE OBJETIVO. REGRA 1: As tuas respostas devem ter NO MÁXIMO 1 frase e 15 palavras. REGRA 2: VAI DIRETO AO PONTO. ZERO explicações. REGRA 3: NENHUM EMOJI EM HIPÓTESE ALGUMA." },
                { role: "user", content: promptInstrucao }
            ],
            temperature: 0.2, 
            max_tokens: 50
        });
        return resposta.choices[0]?.message?.content.trim() || fallbackText;
    } catch (erro) {
        return fallbackText;
    }
}

async function responderComGroq(mensagemCliente, contextAgendamentos = 0, historicoAnterior, infoTemporal = "", nomeCliente = "") {
    if (!process.env.GROQ_API_KEY) return "Por favor, escolhe uma opção no menu.";

    const INSTRUCOES_BLINDADAS_CONTEXTO = `És o Assistente Virtual da Portal da Barbearia.
DADOS DO CLIENTE: Nome: "${nomeCliente || 'Amigo'}" | Regras de Tempo: "${infoTemporal}"

🚨 REGRA DE PERSONALIDADE: As tuas respostas devem ser EXTREMAMENTE CURTAS (máximo 20 palavras). Responde diretamente sem justificações.

🚨 FORA DE ESCOPO: Se perguntarem sobre Matemática, Famosos, Política, Tecnologia, etc, recusa IMEDIATAMENTE e de forma MUITO CURTA: "Só falo sobre a barbearia. Como ajudo com o teu visual?"

🚨 MODO DE ROTEAMENTO (COMANDOS OBRIGATÓRIOS):
Intenção de marcar agora -> RESPONDE SÓ: /AGENDAR
Intenção de cancelar -> RESPONDE SÓ: /CANCELAR
Intenção de ver preços -> RESPONDE SÓ: /PRECOS
Intenção de ver a sua agenda -> RESPONDE SÓ: /AGENDA
Intenção de saber endereço/localização -> RESPONDE SÓ: /LOCAL
Intenção de falar com atendente humano -> RESPONDE SÓ: /HUMANO`;

    try {
        const constructMessagesFlowEngineLpu = [{ role: "system", content: INSTRUCOES_BLINDADAS_CONTEXTO }];
        if (historicoAnterior && historicoAnterior.length > 0) {
            historicoAnterior.forEach(linhaOld => {
                if(linhaOld.content) constructMessagesFlowEngineLpu.push({ role: linhaOld.role, content: linhaOld.content });
            });
        }
        constructMessagesFlowEngineLpu.push({ role: "user", content: mensagemCliente });

        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant", 
            messages: constructMessagesFlowEngineLpu,
            temperature: 0.1,
            max_tokens: 150 
        });
        
        return resposta.choices[0]?.message?.content || "/MENU";

    } catch (erro) {
        return "Digita 'Menu' para acederes aos botões de ajuda."; 
    }
}

module.exports = { responderComGroq, extrairNomeComGroq, transcreverAudioComGroq, gerarMensagemNotificacao };