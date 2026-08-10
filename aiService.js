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
    HUMANO (quer falar com atendente, pessoa real, doutor, reclamação)
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

    let listaTratamentos = tratamentos.filter(t => t.status === 'ATIVO').map(t => {
        let precoStr = "Preço sob avaliação clínica";
        if (t.tipoPreco === 'FIXO') precoStr = `R$ ${t.preco}`;
        else if (t.tipoPreco === 'A_PARTIR') precoStr = `A partir de R$ ${t.preco}`;
        else if (t.tipoPreco === 'FAIXA') precoStr = `Preço Variável. Requer avaliação.`;

        return `[TRATAMENTO]: ${t.nome} (Categoria: ${t.categoria})
- Preço: ${precoStr}
- Duração Estimada: ${t.duracaoMin} minutos
- Info para IA: ${t.informacoesIA || 'N/A'}
- Regras/Limitações: ${t.regrasIA || 'N/A'}`;
    }).join("\n\n");

    const systemInstrucoes = `
Você é ${configSistema.nomeAssistente}, o assistente virtual oficial da ${configSistema.nomeClinica || 'Clínica'}.
Idioma base: ${configSistema.idioma || 'Português (Brasil)'}.
Tom de voz: ${configSistema.tomDeVoz}.
Estilo de Comunicação: ${configSistema.estiloComunicacao || 'Equilibrado'}.
Nível de Formalidade: ${configSistema.formalidade || 'Profissional'}.

OBJETIVOS PRINCIPAIS: ${configSistema.objetivos || 'Atender pacientes e agendar consultas'}.
PERMISSÕES DA IA: ${configSistema.permissoes || 'Responder dúvidas'}.

REGRA DE PREÇOS (CRÍTICA): Se o preço for "Sob avaliação" ou "A_PARTIR", não confirme valores finais.
REGRAS EXTRAS PERSONALIZADAS: ${configSistema.regrasExtrasIA || 'Nenhuma regra extra.'}
FAQ GERAL DA CLÍNICA: ${configSistema.faq || 'Nenhuma FAQ cadastrada.'}

PROTEÇÕES INVIOLÁVEIS DO SISTEMA:
1. NUNCA invente informações, horários ou preços que não estejam no seu contexto.
2. NUNCA faça diagnóstico médico, não prescreva medicamentos nem prometa resultados clínicos.
3. Se a pergunta for complexa ou médica, oriente a consultar com um especialista.
4. Se o usuário demonstrar extrema insatisfação, disser um palavrão ou solicitar falar com um humano e você tiver a regra de transferência ativada, use a diretriz correta.

CATÁLOGO DE TRATAMENTOS:
${listaTratamentos}

Lembre-se: aja como um humano prestativo, usando os dados fornecidos.
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