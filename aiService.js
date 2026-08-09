const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Sem configurações simuladas, obriga a possuir a variável real em produção
const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY, 
    baseURL: "https://api.groq.com/openai/v1",
});

async function transcreverAudioComIA(audioBuffer) {
    if (!process.env.GROQ_API_KEY) throw new Error("Chave Groq Ausente");
    
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
        console.error("Falha ao transcrever áudio na IA:", erro);
        return "";
    } finally {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    }
}

async function extrairNomeComIA(textoCliente) {
    if (!process.env.GROQ_API_KEY) return "IGNORAR";
    try {
        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: "Extraia APENAS o primeiro nome da frase a seguir. Se não for um nome ou você não tiver certeza, responda estritamente com a palavra: IGNORAR. Não use pontuação." },
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

async function gerarMensagemNotificacaoIA(promptInstrucao, fallbackText) {
    if (!process.env.GROQ_API_KEY) return fallbackText;
    try {
        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: "Você é o assistente virtual automático da empresa. Seja amigável, direto e extremamente conciso (1 frase). PROIBIDO criar listas e PROIBIDO usar Emojis." },
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

async function responderComContextoIA(mensagemCliente, historicoAnterior, systemPromptOpcional = "", nomeCliente = "") {
    if (!process.env.GROQ_API_KEY) throw new Error("IA Desconectada");

    // Trava Absoluta contra Invenção de Comandos (Alucinação LLaMA)
    const blindagemDeIntencoes = `
        REGRA ABSOLUTA DE INTENÇÕES:
        Se você decidir executar uma ação para o cliente, VOCÊ SÓ PODE RETORNAR UMA DAS TAGS ABAIXO. É ESTRITAMENTE PROIBIDO INVENTAR OUTRAS TAGS (COMO /VAGAR, /MARCAR, /AJUDA).
        - Quero agendar 👉 /AGENDAR
        - Falar com atendente 👉 /HUMANO
        - Cancelar 👉 /CANCELAR
        - Ver Preços 👉 /PRECOS
        - Ver minha agenda 👉 /AGENDA
        - Onde fica o local 👉 /LOCAL
        - Ver Menu principal 👉 /MENU
        
        Se a requisição do usuário NÃO for uma ação direta equivalente a essas tags, RESPONDA COM UM TEXTO NORMAL E CONVERSACIONAL respondendo a dúvida do cliente. Nunca misture texto com as tags. Ou você devolve APENAS a tag, ou responde conversando livremente.
    `;

    const systemInstrucoes = `${systemPromptOpcional}\n\nNome do Cliente atual: ${nomeCliente}.\n${blindagemDeIntencoes}`;

    try {
        const constructMessagesFlowEngine = [{ role: "system", content: systemInstrucoes }];
        
        if (historicoAnterior && historicoAnterior.length > 0) {
            historicoAnterior.forEach(linhaOld => {
                if(linhaOld.content) {
                    let contentClean = linhaOld.content;
                    if (contentClean.includes('| Transcrição: ')) contentClean = contentClean.split('| Transcrição: ')[1].trim();
                    else if (contentClean.includes('[MEDIA:')) contentClean = "(Mídia visual/documento processado anteriormente)";
                    constructMessagesFlowEngine.push({ role: linhaOld.role, content: contentClean });
                }
            });
        }
        
        constructMessagesFlowEngine.push({ role: "user", content: mensagemCliente });

        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant", 
            messages: constructMessagesFlowEngine,
            temperature: 0.1, // Quase determinístico para evitar devaneios
            max_tokens: 250 
        });
        
        return resposta.choices[0]?.message?.content || "/MENU";

    } catch (erro) {
        console.error("Erro na resposta conversacional da IA:", erro);
        return "/MENU"; // Em caso de pane total na Groq, invoca o menu visual para resgate
    }
}

module.exports = { 
    responderComContextoIA, 
    extrairNomeComIA, 
    transcreverAudioComIA, 
    gerarMensagemNotificacaoIA 
};