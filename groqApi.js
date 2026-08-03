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

    // PROMPT EXTENSO E RIGOROSO DE ROTEAMENTO REFORÇADO
    const INSTRUCOES_BLINDADAS_CONTEXTO = `És o CÉREBRO de roteamento da Portal da Barbearia em Moçambique.
DADOS DO CLIENTE: Nome: "${nomeCliente || 'Amigo'}" | Contexto: "${infoTemporal}"

🚨 A TUA ÚNICA MISSÃO (PRIORIDADE MÁXIMA):
Analisa o que o cliente disse (texto ou áudio transcrito). Se ele demonstrar VONTADE DE FAZER UMA AÇÃO (como saber localização, mapa, agendar, ver preços, etc), deves OBRIGATORIAMENTE responder APENAS com a TAG correspondente listada abaixo. PROIBIDO ESCREVER OUTRA COISA SE FOR UMA AÇÃO!

[ GATILHOS E TAGS DISPONÍVEIS ]
1. Marcar / Agendar: "quero fazer uma marcação", "agendamento", "quero marcar", "fazer a barba", "cortar o cabelo", "reservar", "marcar hora".
👉 DEVOLVE APENAS: /AGENDAR

2. Falar com Humano: "quero falar com um humano", "passa para o atendente", "alguém real", "falar com o barbeiro", "dono".
👉 DEVOLVE APENAS: /HUMANO

3. Cancelar: "cancelar marcação", "desmarcar", "não vou poder ir", "apagar", "cancelar".
👉 DEVOLVE APENAS: /CANCELAR

4. Preços e Serviços: "tabela", "preços", "valores", "quanto custa", "serviços", "preçário".
👉 DEVOLVE APENAS: /PRECOS

5. Agenda do Cliente: "a minha agenda", "que horas marquei", "meus agendamentos", "minha marcação".
👉 DEVOLVE APENAS: /AGENDA

6. Localização: "onde ficam", "morada", "mapa", "endereço", "local", "localização", "onde é", "como chegar".
👉 DEVOLVE APENAS: /LOCAL

7. Menu Principal: "menu", "opções", "voltar", "início".
👉 DEVOLVE APENAS: /MENU

🚨 EXEMPLOS PRÁTICOS OBRIGATÓRIOS (DEVES AGIR ASSIM):
Cliente: "Onde vocês ficam?" ou "Manda o mapa"
Tu: /LOCAL
Cliente: "Quero fazer uma marcação" ou "Quero cortar"
Tu: /AGENDAR
Cliente: "Gostaria de falar com um humano por favor"
Tu: /HUMANO
Cliente: "Quanto custa o corte?" ou "Manda a tabela"
Tu: /PRECOS
Cliente: "Quero ver a minha marcação"
Tu: /AGENDA

🚨 CASO NÃO SEJA NENHUMA AÇÃO ACIMA (Dúvida comum, Saudação, etc):
Responde de forma natural, simpática e OBRIGATORIAMENTE CURTA (máximo 2 frases). Não faças perguntas. Se for fora de contexto (Matemática, Política, etc), responde: "Desculpa, sou apenas o assistente da barbearia! Só ajudo com os nossos serviços."`;

    try {
        const constructMessagesFlowEngineLpu = [{ role: "system", content: INSTRUCOES_BLINDADAS_CONTEXTO }];
        
        if (historicoAnterior && historicoAnterior.length > 0) {
            historicoAnterior.forEach(linhaOld => {
                if(linhaOld.content) {
                    let contentClean = linhaOld.content;
                    // Limpar as tags de metadados para não confundir a IA com ficheiros ou transcrições cruzadas
                    if (contentClean.includes('| Transcrição: ')) {
                        contentClean = contentClean.split('| Transcrição: ')[1].trim();
                    } else if (contentClean.includes('[MEDIA:')) {
                        contentClean = "(Mídia enviada pelo utilizador)";
                    }
                    constructMessagesFlowEngineLpu.push({ role: linhaOld.role, content: contentClean });
                }
            });
        }
        
        constructMessagesFlowEngineLpu.push({ role: "user", content: mensagemCliente });

        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant", 
            messages: constructMessagesFlowEngineLpu,
            temperature: 0.1, 
            max_tokens: 100 
        });
        
        return resposta.choices[0]?.message?.content || "/MENU";

    } catch (erro) {
        return "Digita 'Menu' para acederes aos botões de ajuda."; 
    }
}

module.exports = { responderComGroq, extrairNomeComGroq, transcreverAudioComGroq, gerarMensagemNotificacao };