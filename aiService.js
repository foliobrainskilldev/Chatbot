const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const { format } = require('date-fns');

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY || "chave_ausente", 
    baseURL: "https://api.groq.com/openai/v1",
});

async function transcreverAudioPorUrl(audioUrl) {
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'chave_ausente' || !audioUrl) {
        console.warn("⚠️ [AI SERVICE] Transcrição ignorada: Chave da GROQ ausente.");
        return "";
    }
    
    const tempFilePath = path.join(os.tmpdir(), `audio_${Date.now()}.ogg`);
    
    try {
        console.log("🎙️ [AI SERVICE] Baixando áudio para transcrição...");
        const response = await axios.get(audioUrl, { responseType: 'stream' });
        const writer = fs.createWriteStream(tempFilePath);
        response.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log("🧠 [AI SERVICE] Enviando áudio para Whisper (Groq)...");
        const transcricao = await groq.audio.transcriptions.create({
            file: fs.createReadStream(tempFilePath),
            model: "whisper-large-v3-turbo", 
            language: "pt", 
        });
        return transcricao.text;
    } catch (erro) {
        console.error("❌ [ERRO AI TRANSCRIÇÃO]:", erro.message);
        return "[Áudio inaudível]";
    } finally {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    }
}

async function analisarMensagemNLP(textoCliente, historico, estadoAtual) {
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'chave_ausente') {
        console.warn("⚠️ [AI SERVICE] Chave GROQ ausente. NLP bypassado.");
        return { intent: "unknown", confidence: 0, entities: {} };
    }

    const hoje = format(new Date(), 'dd/MM/yyyy');
    const prompt = `Você é o analisador NLP de um HealthCRM. 
Extraia a intenção, a confiança (0.0 a 1.0) e as entidades (treatment, professional, date, time).
Hoje é ${hoje}. Responda APENAS com um JSON válido.
Intenções: clinic.hours, clinic.location, treatment.list, appointment.create, appointment.cancel, human.transfer, greeting, unknown.`;

    try {
        console.log("🧠 [AI SERVICE] Analisando Intenção (NLP)...");
        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: textoCliente || "[Mensagem de mídia/vazia]" }
            ],
            temperature: 0.1,
            response_format: { type: "json_object" }
        });
        
        return JSON.parse(resposta.choices[0]?.message?.content || "{}");
    } catch (erro) {
        console.error("❌ [ERRO AI NLP Groq]:", erro.message);
        return { intent: "unknown", confidence: 0, entities: {} };
    }
}

async function gerarRespostaNatural(textoCliente, historico, dadosContexto, configSistema) {
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'chave_ausente') {
        console.error("❌ [ERRO AI SERVICE] Tentativa de gerar resposta sem API Key configurada!");
        return "Desculpe, o motor de Inteligência Artificial está desconectado no momento.";
    }

    const assistenteNome = configSistema?.nomeAssistente || "Assistente";
    const clinicaNome = configSistema?.nomeClinica || "Clínica";
    
    const systemInstrucoes = `Você é ${assistenteNome}, assistente virtual da ${clinicaNome}.
REGRA: Use EXATAMENTE os dados fornecidos no contexto: ${JSON.stringify(dadosContexto)}`;

    try {
        const msgs = [{ role: "system", content: systemInstrucoes }];
        let lastRole = "system";

        if (historico && historico.length > 0) {
            historico.forEach(linha => {
                let content = linha.content || "[Mídia Recebida]";
                if (content.includes('| Texto: ')) content = content.split('| Texto: ')[1].trim();
                if (!content) content = "[Mídia Recebida]";

                if (linha.role === lastRole) {
                    msgs[msgs.length - 1].content += `\n${content}`;
                } else {
                    msgs.push({ role: linha.role, content: content });
                    lastRole = linha.role;
                }
            });
        }
        
        let textoFinal = textoCliente || "[Mídia]";
        if (lastRole !== "user") {
            msgs.push({ role: "user", content: textoFinal });
        }

        console.log("🧠 [AI SERVICE] Gerando resposta humanizada...");
        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-70b-versatile",
            messages: msgs,
            temperature: 0.3,
            max_tokens: 400 
        });
        
        return resposta.choices[0]?.message?.content || "Desculpe, não consegui formular a resposta.";
    } catch (erro) {
        console.error("❌ [ERRO AI GERAÇÃO DE RESPOSTA]:", erro.response ? erro.response.data : erro.message);
        return "Desculpe, meus servidores estão muito ocupados agora. Pode repetir a mensagem?"; 
    }
}

module.exports = { transcreverAudioPorUrl, analisarMensagemNLP, gerarRespostaNatural };