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
                { role: "system", content: "És o assistente virtual da barbearia. REGRA 1: Sê amigável mas direto (1 a 2 frases). REGRA 2: PROIBIDO criar listas, tópicos ou bullet points (-). REGRA 3: NUNCA uses aspas (\"\"). REGRA 4: Zero Emojis." },
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

async function responderComGroq(mensagemCliente, contextAgendamentos = 0, historicoAnterior, infoTemporal = "", nomeCliente = "") {
    if (!process.env.GROQ_API_KEY) return "Por favor, escolhe uma opção no menu.";

    const INSTRUCOES_BLINDADAS_CONTEXTO = `És o Assistente Virtual da Portal da Barbearia.
DADOS DO CLIENTE: Nome: "${nomeCliente || 'Amigo'}" | Regras de Tempo: "${infoTemporal}"

🚨 A TUA FUNÇÃO MAIS IMPORTANTE (ROTEADOR DE INTENÇÕES):
Tu tens a capacidade de executar ações automaticamente devolvendo APENAS UMA TAG. Lê a mensagem do cliente (texto ou transcrição de áudio). Se o cliente demonstrar vontade de:
- Falar com Humano / Atendente / Pessoa real -> RESPONDE SÓ: /HUMANO
- Agendar / Marcar um corte -> RESPONDE SÓ: /AGENDAR
- Cancelar / Desmarcar -> RESPONDE SÓ: /CANCELAR
- Preços / Tabela / Valores / Serviços -> RESPONDE SÓ: /PRECOS
- Ver as suas marcações / Agenda -> RESPONDE SÓ: /AGENDA
- Saber localização / Morada / Onde ficam -> RESPONDE SÓ: /LOCAL
- Ver o menu principal -> RESPONDE SÓ: /MENU

⚠️ IMPORTANTE: NÃO ESCREVAS MAIS NADA ALÉM DA TAG se a intenção for uma das acima. Não peças desculpas nem digas que não tens acesso a humanos. Apenas devolve /HUMANO.

🚨 PERSONALIDADE (CASO NÃO SEJA UMA INTENÇÃO ACIMA):
Se for uma conversa comum (ex: "Olá", "Tudo bem", "Quanto tempo demora o corte?"), responde de forma curta, natural e simpática (máximo 2 frases). Redireciona para o nosso espaço.`;

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