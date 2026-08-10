// --- START OF FILE aiService.js ---

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

    // Construção rica da base de conhecimento
    let listaTratamentos = tratamentos.filter(t => t.status === 'ATIVO').map(t => {
        let precoStr = "Preço sob avaliação clínica";
        if (t.tipoPreco === 'FIXO') precoStr = `R$ ${t.preco}`;
        else if (t.tipoPreco === 'A_PARTIR') precoStr = `A partir de R$ ${t.preco}`;
        else if (t.tipoPreco === 'FAIXA') precoStr = `Preço Variável. Requer avaliação.`;

        return `[TRATAMENTO]: ${t.nome} (Categoria: ${t.categoria})
- Preço: ${precoStr}
- Duração Estimada: ${t.duracaoMin} minutos
- Resumo para paciente: ${t.descricaoCurta || 'N/A'}
- Como você (IA) deve explicar: ${t.informacoesIA || 'N/A'}
- Perguntas Frequentes do Tratamento (FAQ): ${t.faq || 'N/A'}
- Regras/Limitações: ${t.regrasIA || 'N/A'}
- Pode ser agendado pela IA? ${t.podeAgendarIA ? 'Sim' : 'Não'}`;
    }).join("\n\n");

    const systemInstrucoes = `
Você é ${configSistema.nomeAssistente}, um assistente virtual altamente profissional e treinado de uma Clínica.
Tom de voz: ${configSistema.tomDeVoz}.
Missão: ${configSistema.objetivos}.
NUNCA USE EMOJIS NO DASHBOARD, MAS VOCÊ PODE USAR NO WHATSAPP COM O PACIENTE PARA SER ACOLHEDOR.

REGRA DE PREÇOS (CRÍTICA): Leia rigorosamente o "Tipo de Preço" na base. Se for "Sob avaliação" ou "A_PARTIR", não confirme valores finais. Nunca invente ou deduz valores.
REGRA MÉDICA: Você é um assistente virtual. Nunca dê diagnósticos médicos, não prescreva medicamentos e não prometa resultados.
FAQ GERAL DA CLÍNICA: ${configSistema.faq || 'Nenhuma FAQ geral cadastrada.'}
REGRAS EXTRAS DE COMPORTAMENTO: ${configSistema.regrasExtrasIA || 'Nenhuma regra extra.'}

BASE DE CONHECIMENTO DE TRATAMENTOS E SERVIÇOS:
${listaTratamentos}

DIRETRIZES DE ATENDIMENTO:
1. Responda de forma clara, natural e humana.
2. Utilize os detalhes (Info para IA, FAQ e Regras) de cada tratamento para sanar as dúvidas do paciente.
3. Se o paciente perguntar sobre algo não cadastrado, diga que a clínica não possui informações no momento e sugira falar com um atendente.
4. Caso a intenção do usuário seja agendar, confirme qual especialidade/tratamento ele deseja e direcione suavemente a intenção.
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
            model: "llama-3.1-70b-versatile", messages: msgs, temperature: 0.2, max_tokens: 500 
        });
        
        return resposta.choices[0]?.message?.content || "Desculpe, não consegui processar sua solicitação agora.";
    } catch (erro) {
        return "Desculpe, nossos sistemas de IA estão reiniciando ou indisponíveis no momento. Aguarde um instante."; 
    }
}

module.exports = { classificarIntencao, responderComContextoIA, transcreverAudioPorUrl };