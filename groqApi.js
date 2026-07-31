const { OpenAI } = require('openai');

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY || "SEM_CHAVE", 
    baseURL: "https://api.groq.com/openai/v1",
});

// Nova função para extrair SOMENTE o nome caso o cliente responda com frases longas
async function extrairNomeComGroq(textoCliente) {
    if (!process.env.GROQ_API_KEY) return "IGNORAR";

    try {
        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: "O utilizador está a responder como gostaria de ser chamado. A tua única função é extrair o PRIMEIRO NOME dele. Se ele disser 'O meu nome é Acácio', 'Podes me chamar de João' ou 'Sou a Maria', respondes SÓ com o nome ('Acácio', 'João', 'Maria'). Se ele disser algo que CLARAMENTE NÃO É UM NOME (ex: 'menu', 'agendar', 'quero marcar', 'ola'), responde EXATAMENTE com a palavra: IGNORAR." },
                { role: "user", content: textoCliente }
            ],
            temperature: 0.1,
            max_tokens: 15
        });
        return resposta.choices[0]?.message?.content.trim() || "IGNORAR";
    } catch (erro) {
        return "IGNORAR";
    }
}

async function responderComGroq(mensagemCliente, contextAgendamentos = 0, historicoAnterior, statusRetorno = "NOVO", nomeCliente = "") {
    
    if (!process.env.GROQ_API_KEY) return "Infelizmente estarei cego momentaneamente, avança pelo menu.";

    const INSTRUCOES_BLINDADAS_CONTEXTO = `És o Assistente Virtual Inteligente de uma Barbearia em Moçambique.
Objetivo: Acionar comandos ocultos ou conversar de forma extremamente natural e humana.

NOME DO CLIENTE: "${nomeCliente || 'Amigo'}"
ESTADO TEMPORAL DESTE CLIENTE AGORA: "${statusRetorno}"

REGRA DE SAUDAÇÕES E CONTINUAÇÕES:
1. Trata o cliente pelo seu nome (${nomeCliente}) de vez em quando, para manteres a empatia, mas sem pareceres repetitivo.
2. SE for "RETORNO_MESMO_DIA": O cliente já esteve a falar contigo HOJE. É proibido dizer "Bom dia/tarde". Sê contínuo: "O que mais te posso ajudar?", "Diz lá, ${nomeCliente}".
3. SE for "RETORNO_OUTRO_DIA": Cumprimenta de forma calorosa.
4. NÃO SEJAS ROBÓTICO. 

🚨 REGRAS DE COMANDOS DE SISTEMA (MUITO IMPORTANTE):
Se o cliente demonstrar intenção de fazer alguma das ações abaixo, tens de responder EXATAMENTE E APENAS com a palavra-chave correspondente.
NÃO ACRESCENTES MAIS NADA! Nenhuma frase extra, nenhuma pontuação!

- Intenção de falar com um ATENDENTE, HUMANO ou PESSOA REAL -> Responde SÓ: /HUMANO
- Intenção de CANCELAR uma marcação -> Responde SÓ: /CANCELAR
- Intenção de MARCAR ou AGENDAR -> Responde SÓ: /AGENDAR
- Intenção de ver PREÇOS ou SERVIÇOS -> Responde SÓ: /PRECOS
- Intenção de ver as HORAS MARCADAS -> Responde SÓ: /AGENDA
- Intenção de saber a LOCALIZAÇÃO -> Responde SÓ: /LOCAL

Lembrança final: O cliente tem ${contextAgendamentos} marcações ativas. NUNCA digas que vais "chamar alguém" por texto normal, responde APENAS com /HUMANO para o sistema atuar.`;

    try {
        const constructMessagesFlowEngineLpu = [
            { role: "system", content: INSTRUCOES_BLINDADAS_CONTEXTO }
        ];

        if (historicoAnterior && historicoAnterior.length > 0) {
            historicoAnterior.forEach(linhaOld => {
                if(linhaOld.content) {
                    constructMessagesFlowEngineLpu.push({ role: linhaOld.role, content: linhaOld.content });
                }
            });
        }
        
        constructMessagesFlowEngineLpu.push({ role: "user", content: mensagemCliente });

        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant", 
            messages: constructMessagesFlowEngineLpu,
            temperature: 0.2, 
            max_tokens: 250 
        });
        
        return resposta.choices[0]?.message?.content || "/MENU";

    } catch (erro) {
        console.error("❌ ERRO NA CHAMADA GROQ:", erro.message);
        return "Tivemos uma pequena falha de ligação, mas digita 'Menu' para acederes aos botões de segurança!"; 
    }
}

module.exports = { responderComGroq, extrairNomeComGroq };