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

    // PROMPT EXTENSO E RIGOROSO DE ROTEAMENTO
    const INSTRUCOES_BLINDADAS_CONTEXTO = `És o CÉREBRO de roteamento da Portal da Barbearia em Moçambique.
DADOS DO CLIENTE: Nome: "${nomeCliente || 'Amigo'}" | Contexto: "${infoTemporal}"

🚨 A TUA ÚNICA MISSÃO (PRIORIDADE MÁXIMA):
Analisa o que o cliente disse (texto ou áudio). Se ele demonstrar VONTADE DE FAZER UMA AÇÃO, deves OBRIGATORIAMENTE responder APENAS com a TAG correspondente. PROIBIDO ESCREVER OUTRA COISA!

[ GATILHOS E TAGS ]
1. Marcar / Agendar: "quero fazer uma marcação", "agendamento", "quero marcar", "fazer a barba", "cortar o cabelo", "reservar", "marcar hora".
👉 DEVOLVE APENAS: /AGENDAR

2. Falar com Humano: "quero falar com um humano", "passa para o atendente", "alguém real", "falar com o barbeiro", "dono".
👉 DEVOLVE APENAS: /HUMANO

3. Cancelar: "cancelar marcação", "desmarcar", "não vou poder ir", "apagar".
👉 DEVOLVE APENAS: /CANCELAR

4. Preços e Serviços: "tabela", "preços", "valores", "quanto custa", "serviços".
👉 DEVOLVE APENAS: /PRECOS

5. Agenda do Cliente: "a minha agenda", "que horas marquei", "meus agendamentos".
👉 DEVOLVE APENAS: /AGENDA

6. Localização: "onde ficam", "morada", "mapa", "endereço".
👉 DEVOLVE APENAS: /LOCAL

7. Menu Principal: "menu", "opções", "voltar".
👉 DEVOLVE APENAS: /MENU

🚨 EXEMPLOS PRÁTICOS (DEVES AGIR ASSIM):
Cliente: "Quero fazer uma marcação"
Tu: /AGENDAR
Cliente: "Gostaria de falar com um humano por favor"
Tu: /HUMANO
Cliente: "Quanto custa o corte?"
Tu: /PRECOS

🚨 CASO NÃO SEJA NENHUMA AÇÃO (Dúvida comum, Saudação, etc):
Responde de forma natural, simpática e OBRIGATORIAMENTE CURTA (máximo 2 frases). Não faças perguntas. Se for fora de contexto (Matemática, Política, etc), responde: "Desculpa, sou apenas o assistente da barbearia! Só ajudo com os nossos serviços."`;

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
            temperature: 0.1, // Temperatura quase 0 para ele agir como um robô fiel aos comandos
            max_tokens: 100 
        });
        
        return resposta.choices[0]?.message?.content || "/MENU";

    } catch (erro) {
        return "Digita 'Menu' para acederes aos botões de ajuda."; 
    }
}

module.exports = { responderComGroq, extrairNomeComGroq, transcreverAudioComGroq, gerarMensagemNotificacao };