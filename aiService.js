const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY, 
    baseURL: "https://api.groq.com/openai/v1",
});

async function transcreverAudioComIA(audioBuffer) {
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

async function extrairNomeComIA(textoCliente) {
    if (!process.env.GROQ_API_KEY) return "IGNORAR";
    try {
        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: "Extraia APENAS o primeiro nome da frase a seguir. Se não tiver certeza, responda estritamente: IGNORAR." },
                { role: "user", content: textoCliente }
            ],
            temperature: 0.1, max_tokens: 10
        });
        return resposta.choices[0]?.message?.content.trim() || "IGNORAR";
    } catch (erro) { return "IGNORAR"; }
}

async function gerarMensagemNotificacaoIA(promptInstrucao, fallbackText) {
    if (!process.env.GROQ_API_KEY) return fallbackText;
    try {
        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: "Você é um assistente virtual. Seja direto e muito conciso (1 frase). PROIBIDO emojis." },
                { role: "user", content: promptInstrucao }
            ],
            temperature: 0.2, max_tokens: 50
        });
        return resposta.choices[0]?.message?.content.trim() || fallbackText;
    } catch (erro) { return fallbackText; }
}

async function responderComContextoIA(mensagemCliente, historicoAnterior, systemPromptOpcional = "", nomeCliente = "") {
    if (!process.env.GROQ_API_KEY) throw new Error("IA Desconectada");

    // As tags genéricas que ambos os motores (Barbearia/Clínica) sabem interceptar
    const blindagemDeIntencoes = `
        REGRA ABSOLUTA DE INTENÇÕES:
        Só retorne uma tag abaixo se o usuário pedir AÇÃO. Se for dúvida, responda com texto normal e amigável.
        - Agendar/Marcar 👉 /AGENDAR
        - Falar com atendente 👉 /HUMANO
        - Cancelar 👉 /CANCELAR
        - Ver Preços/Especialidades 👉 /PRECOS
        - Ver agenda/retornos 👉 /AGENDA
        - Menu principal 👉 /MENU
    `;

    const systemInstrucoes = `${systemPromptOpcional}\n\nCliente: ${nomeCliente}.\n${blindagemDeIntencoes}`;

    try {
        const msgs = [{ role: "system", content: systemInstrucoes }];
        if (historicoAnterior) {
            historicoAnterior.forEach(linhaOld => {
                let contentClean = linhaOld.content || "";
                if (contentClean.includes('| Transcrição: ')) contentClean = contentClean.split('| Transcrição: ')[1].trim();
                msgs.push({ role: linhaOld.role, content: contentClean });
            });
        }
        msgs.push({ role: "user", content: mensagemCliente });

        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant", messages: msgs, temperature: 0.1, max_tokens: 250 
        });
        
        return resposta.choices[0]?.message?.content || "/MENU";
    } catch (erro) {
        return "/MENU"; 
    }
}

module.exports = { responderComContextoIA, extrairNomeComIA, transcreverAudioComIA, gerarMensagemNotificacaoIA };