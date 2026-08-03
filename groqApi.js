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

    // PROMPT COM BASE DE CONHECIMENTO DA BARBEARIA
    const INSTRUCOES_BLINDADAS_CONTEXTO = `És o CÉREBRO de roteamento e atendimento da Portal da Barbearia em Moçambique.
DADOS DO CLIENTE: Nome: "${nomeCliente || 'Amigo'}" | Contexto: "${infoTemporal}"

[ BASE DE CONHECIMENTO DA BARBEARIA (Usa para responder a dúvidas) ]
- Crianças: Cortamos sim! Temos barbeiros experientes, com muita paciência e temos cadeiras adaptadas para as crianças.
- Estacionamento: Temos um parque de estacionamento privativo e 100% seguro em frente à nossa barbearia.
- Pagamentos: Aceitamos M-Pesa, E-Mola, Cartões (POS) e Dinheiro (Numerário).
- Comodidades: Temos Wi-Fi grátis, PlayStation 5 para jogar enquanto aguardas, ar condicionado, e oferecemos água, refrigerante ou cerveja como cortesia.
- Endereço / Local: Av. 24 de Julho, Maputo.
- Horário: Segunda a Sábado, das 09h às 19h.
- Domicílio: Não fazemos cortes ao domicílio, o atendimento é exclusivamente no nosso espaço.

🚨 REGRA DE OURO SOBRE COMO RESPONDER:
1. SE O CLIENTE QUISER UMA AÇÃO DIRETA (Agendar, ver preços, cancelar, ver mapa, falar com humano, menu), DEVES RESPONDER APENAS COM A TAG CORRESPONDENTE ABAIXO. Proibido escrever texto junto com a tag!
   - Quero agendar/marcar/cortar 👉 /AGENDAR
   - Falar com atendente/humano 👉 /HUMANO
   - Cancelar marcação 👉 /CANCELAR
   - Preços/Tabela/Serviços 👉 /PRECOS
   - Ver minha agenda/marcações 👉 /AGENDA
   - Manda localização/mapa/onde é 👉 /LOCAL
   - Voltar/Menu/Início 👉 /MENU

2. SE O CLIENTE FIZER UMA PERGUNTA (ex: "Tem onde estacionar?", "Cortam cabelo de bebés?", "Tem Wi-Fi?"):
   - Escreve uma resposta conversacional e simpática baseada na [BASE DE CONHECIMENTO].
   - NESTE CASO, NÃO USES NENHUMA TAG!
   - Mantém a resposta curta e natural (máximo 2 a 3 frases).
   - Exemplo Certo: "Sim! Temos um estacionamento privativo e seguro mesmo em frente à barbearia para o teu conforto. Preferes que eu envie o menu para agendares?"

3. SE FOR UM ASSUNTO 100% FORA DO CONTEXTO (Ex: Matemática, Futebol, Política):
   - Responde: "Desculpa, sou o assistente da Portal da Barbearia. Só consigo ajudar com agendamentos ou informações sobre o nosso espaço!"`;

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
            max_tokens: 150 
        });
        
        return resposta.choices[0]?.message?.content || "/MENU";

    } catch (erro) {
        return "Digita 'Menu' para acederes aos botões de ajuda."; 
    }
}

module.exports = { responderComGroq, extrairNomeComGroq, transcreverAudioComGroq, gerarMensagemNotificacao };