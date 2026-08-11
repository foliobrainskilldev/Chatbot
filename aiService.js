const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const { format } = require('date-fns');

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY, 
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
        return "[Áudio inaudível ou erro de transcrição]";
    } finally {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    }
}

async function analisarMensagemNLP(textoCliente, historico, estadoAtual) {
    if (!process.env.GROQ_API_KEY) return { intent: "unknown", confidence: 0, entities: {} };

    const hoje = format(new Date(), 'dd/MM/yyyy');
    const prompt = `Você é o analisador NLP central de um HealthCRM.
Sua tarefa é analisar a mensagem do paciente e extrair a intenção, a confiança (0.0 a 1.0) e as entidades.
Hoje é ${hoje}. Calcule datas relativas baseadas no dia de hoje.

Intenções permitidas:
- clinic.hours
- clinic.location
- clinic.contact
- clinic.payment_methods
- treatment.list
- treatment.info
- treatment.price
- treatment.faq
- appointment.create
- appointment.check
- appointment.reschedule
- appointment.cancel
- human.transfer
- greeting
- goodbye
- unknown

Entidades a extrair (apenas se mencionadas explicitamente):
- treatment: nome do tratamento/procedimento
- professional: nome do médico/doutor
- date: data no formato exato DD/MM/YYYY
- time: horário no formato exato HH:mm

Estado atual da conversa: ${JSON.stringify(estadoAtual)}
Mensagem atual do paciente: "${textoCliente}"

Você deve responder APENAS com um objeto JSON válido.`;

    try {
        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [{ role: "system", content: prompt }],
            temperature: 0.1,
            response_format: { type: "json_object" }
        });
        
        // Proteção para caso o Llama "alucine" o formato JSON
        const content = resposta.choices[0]?.message?.content || "{}";
        return JSON.parse(content);
    } catch (erro) {
        console.error("Erro no NLP JSON Parse. Fazendo Fallback Seguro.", erro);
        return { intent: "unknown", confidence: 0, entities: {} };
    }
}

async function gerarRespostaNatural(textoCliente, historico, dadosContexto, configSistema) {
    if (!process.env.GROQ_API_KEY) return "Desculpe, nossos sistemas de IA estão reiniciando ou indisponíveis no momento.";

    const systemInstrucoes = `Você é ${configSistema.nomeAssistente}, assistente virtual oficial da ${configSistema.nomeClinica}.
Idioma: ${configSistema.idioma}. Tom de voz: ${configSistema.tomDeVoz}. Estilo: ${configSistema.estiloComunicacao}.

REGRA DE OURO: 
Use EXATAMENTE os dados fornecidos no contexto abaixo para responder. NÃO INVENTE preços, NÃO INVENTE horários, NÃO FAÇA diagnósticos.
Se a informação não estiver no contexto, diga que não sabe no momento.

DADOS REAIS RECUPERADOS DO BANCO (USE ISSO):
${JSON.stringify(dadosContexto, null, 2)}

Responda diretamente à dúvida do paciente.`;

    try {
        const msgs = [{ role: "system", content: systemInstrucoes }];
        if (historico && historico.length > 0) {
            historico.forEach(linha => {
                let contentClean = linha.content || "";
                if (contentClean.includes('| Texto: ')) contentClean = contentClean.split('| Texto: ')[1].trim();
                msgs.push({ role: linha.role, content: contentClean });
            });
        }
        msgs.push({ role: "user", content: textoCliente });

        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-70b-versatile",
            messages: msgs,
            temperature: 0.3,
            max_tokens: 400 
        });
        
        return resposta.choices[0]?.message?.content || "Desculpe, não consegui processar a informação adequadamente agora.";
    } catch (erro) {
        return "Desculpe, meus servidores estão ocupados. Volte a tentar em instantes."; 
    }
}

module.exports = { 
    transcreverAudioPorUrl, 
    analisarMensagemNLP, 
    gerarRespostaNatural 
};