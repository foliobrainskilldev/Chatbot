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
    if (!process.env.GROQ_API_KEY || !audioUrl) return "";
    const tempFilePath = path.join(os.tmpdir(), `audio_${Date.now()}.ogg`);
    
    try {
        const response = await axios.get(audioUrl, { responseType: 'stream' });
        const writer = fs.createWriteStream(tempFilePath);
        response.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        const transcricao = await groq.audio.transcriptions.create({
            file: fs.createReadStream(tempFilePath),
            model: "whisper-large-v3-turbo", 
            language: "pt", 
        });
        return transcricao.text;
    } catch (erro) {
        console.error("Erro na transcrição de áudio:", erro);
        return "[Áudio inaudível]";
    } finally {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    }
}

async function analisarMensagemNLP(textoCliente, historico, estadoAtual) {
    if (!process.env.GROQ_API_KEY) return { intent: "unknown", confidence: 0, entities: {} };

    const hoje = format(new Date(), 'dd/MM/yyyy');
    const prompt = `Você é o analisador NLP de um HealthCRM. 
Extraia a intenção, a confiança (0.0 a 1.0) e as entidades (treatment, professional, date, time).
Hoje é ${hoje}. Responda APENAS com um JSON válido.
Intenções: clinic.hours, clinic.location, treatment.list, appointment.create, appointment.cancel, human.transfer, greeting, unknown.`;

    try {
        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: prompt },
                // CORREÇÃO CRÍTICA: O Groq exige que exista uma mensagem de 'user'
                { role: "user", content: textoCliente || "[Mensagem de mídia/vazia]" }
            ],
            temperature: 0.1,
            response_format: { type: "json_object" }
        });
        
        return JSON.parse(resposta.choices[0]?.message?.content || "{}");
    } catch (erro) {
        console.error("Erro NLP Groq (Bad Request/JSON):", erro.message);
        return { intent: "unknown", confidence: 0, entities: {} };
    }
}

async function gerarRespostaNatural(textoCliente, historico, dadosContexto, configSistema) {
    if (!process.env.GROQ_API_KEY) return "Sistemas de IA indisponíveis no momento.";

    const assistenteNome = configSistema?.nomeAssistente || "Assistente";
    const clinicaNome = configSistema?.nomeClinica || "Clínica";
    
    const systemInstrucoes = `Você é ${assistenteNome}, assistente virtual da ${clinicaNome}.
REGRA: Use EXATAMENTE os dados fornecidos no contexto: ${JSON.stringify(dadosContexto)}`;

    try {
        const msgs = [{ role: "system", content: systemInstrucoes }];
        let lastRole = "system";

        // Organiza o histórico agrupando mensagens consecutivas do mesmo papel (Evita crash do Llama 3)
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
        
        // Se a última mensagem da array não for 'user', adicionamos para manter a lógica exigida
        if (lastRole !== "user") {
            msgs.push({ role: "user", content: textoFinal });
        }

        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-70b-versatile",
            messages: msgs,
            temperature: 0.3,
            max_tokens: 400 
        });
        
        return resposta.choices[0]?.message?.content || "Desculpe, não consegui formular a resposta.";
    } catch (erro) {
        console.error("Erro na Geração de Resposta:", erro.message);
        return "Desculpe, meus servidores estão muito ocupados agora. Pode repetir a mensagem?"; 
    }
}

module.exports = { transcreverAudioPorUrl, analisarMensagemNLP, gerarRespostaNatural };