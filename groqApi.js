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
                { role: "system", content: "És um assistente virtual automático. Sê amigável mas direto (1 a 2 frases). PROIBIDO criar listas. Zero Emojis." },
                { role: "user", content: promptInstrucao }
            ],
            temperature: 0.2, 
            max_tokens: 70
        });
        return resposta.choices[0]?.message?.content.trim() || fallbackText;
    } catch (erro) {
        return fallbackText;
    }
}

// ATUALIZADO: Agora aceita o systemPromptOpcional (O Cérebro Flexível)
async function responderComGroq(mensagemCliente, contextAgendamentos = 0, historicoAnterior, systemPromptOpcional = "", nomeCliente = "") {
    if (!process.env.GROQ_API_KEY) return "Por favor, escolha uma opção no menu.";

    // Se não passarem um prompt (ex: chamadas antigas da barbearia), mantemos o original
    const promptPadraoBarbearia = `És o CÉREBRO de roteamento da Portal da Barbearia. NUNCA saias da personagem. Nome do Cliente: "${nomeCliente}". Contexto Temporal: ${systemPromptOpcional}.
[ BASE DA BARBEARIA ] Aceitamos crianças, temos estacionamento, M-Pesa, Wi-Fi, PS5. Seg a Sáb 09h às 19h. Av. 24 de Julho.
REGRA: 
1. Se quiser agendar 👉 /AGENDAR
2. Falar com atendente 👉 /HUMANO
3. Cancelar 👉 /CANCELAR
4. Preços 👉 /PRECOS
5. Local 👉 /LOCAL
6. Voltar 👉 /MENU
7. Assuntos fora de contexto 👉 "Desculpa, sou apenas o assistente da barbearia! Só consigo ajudar com agendamentos e informações sobre o nosso espaço."
Se for dúvida da base de conhecimento, responda naturalmente SEM TAG.`;

    const systemInstrucoes = systemPromptOpcional && systemPromptOpcional.includes('És o assistente') 
        ? systemPromptOpcional 
        : promptPadraoBarbearia;

    try {
        const constructMessagesFlowEngine = [{ role: "system", content: systemInstrucoes }];
        
        if (historicoAnterior && historicoAnterior.length > 0) {
            historicoAnterior.forEach(linhaOld => {
                if(linhaOld.content) {
                    let contentClean = linhaOld.content;
                    if (contentClean.includes('| Transcrição: ')) contentClean = contentClean.split('| Transcrição: ')[1].trim();
                    else if (contentClean.includes('[MEDIA:')) contentClean = "(Mídia enviada pelo utilizador)";
                    constructMessagesFlowEngine.push({ role: linhaOld.role, content: contentClean });
                }
            });
        }
        
        constructMessagesFlowEngine.push({ role: "user", content: mensagemCliente });

        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant", 
            messages: constructMessagesFlowEngine,
            temperature: 0.1, 
            max_tokens: 200 
        });
        
        return resposta.choices[0]?.message?.content || "/MENU";

    } catch (erro) {
        return "Digita 'Menu' para acederes aos botões de ajuda."; 
    }
}

module.exports = { responderComGroq, extrairNomeComGroq, transcreverAudioComGroq, gerarMensagemNotificacao };