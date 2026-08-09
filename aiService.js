const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

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

/**
 * Função vital: Descobre o que o cliente quer através de NLP e classifica em tags
 */
async function classificarIntencao(textoCliente) {
    if (!process.env.GROQ_API_KEY) return "DUVIDA";
    const prompt = `Analise a mensagem do paciente e classifique a intenção em APENAS UMA das TAGS abaixo. 
    Responda ESTRITAMENTE com a TAG.
    TAGS DISPONÍVEIS:
    AGENDAR (quer marcar consulta, agendar horário, fazer avaliação)
    PRECOS (quer saber valores, custos)
    HUMANO (quer falar com atendente, pessoa real, doutor)
    CANCELAR (quer desmarcar consulta, remarcar, cancelar)
    DUVIDA (informações de localização, horário, tratamentos gerais, faq)
    
    Mensagem do paciente: "${textoCliente}"`;

    try {
        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [{ role: "system", content: prompt }],
            temperature: 0.1, max_tokens: 10
        });
        return resposta.choices[0]?.message?.content.trim().toUpperCase() || "DUVIDA";
    } catch (erro) { 
        return "DUVIDA"; 
    }
}

async function responderComContextoIA(mensagemCliente, historicoAnterior, configSistema, tratamentos) {
    if (!process.env.GROQ_API_KEY) throw new Error("IA Desconectada");

    let listaTratamentos = tratamentos.map(t => `- ${t.nome}: ${t.preco ? 'R$ ' + t.preco : 'Preço sob avaliação'}. Detalhes: ${t.descricao}`).join("\n");

    const systemInstrucoes = `
Você é ${configSistema.nomeAssistente}, um assistente virtual altamente profissional de uma Clínica.
Tom de voz: ${configSistema.tomDeVoz}.
Objetivo: ${configSistema.objetivos}.
NUNCA USE EMOJIS NO DASHBOARD, MAS VOCÊ PODE USAR NO WHATSAPP COM O CLIENTE.
REGRA DE PREÇOS: Nunca invente preços. Baseie-se APENAS na tabela. Se depender de avaliação, diga: "Esse procedimento possui valor definido após avaliação. Posso solicitar um agendamento para você."
REGRA MÉDICA: Não dê diagnósticos, não prometa resultados.
FAQ DA CLÍNICA: ${configSistema.faq || 'Nenhuma FAQ cadastrada.'}
REGRAS EXTRAS: ${configSistema.regrasExtrasIA || 'Nenhuma regra extra.'}
TRATAMENTOS DISPONÍVEIS:
${listaTratamentos}

Você deve ajudar o cliente. Se ele quiser agendar, responda pedindo qual especialidade e passe a bola para a intenção.
`;

    try {
        const msgs = [{ role: "system", content: systemInstrucoes }];
        if (historicoAnterior) {
            historicoAnterior.forEach(linha => {
                let contentClean = linha.content || "";
                if (contentClean.includes('| Texto: ')) contentClean = contentClean.split('| Texto: ')[1].trim();
                msgs.push({ role: linha.role, content: contentClean });
            });
        }
        msgs.push({ role: "user", content: mensagemCliente });

        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-70b-versatile", messages: msgs, temperature: 0.2, max_tokens: 400 
        });
        
        return resposta.choices[0]?.message?.content || "Desculpe, não consegui processar sua solicitação agora.";
    } catch (erro) {
        return "Desculpe, nossos sistemas de IA estão reiniciando. Aguarde um momento."; 
    }
}

module.exports = { classificarIntencao, responderComContextoIA, transcreverAudioPorUrl };