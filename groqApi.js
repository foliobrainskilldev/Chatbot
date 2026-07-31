const { OpenAI } = require('openai');

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY || "SEM_CHAVE", 
    baseURL: "https://api.groq.com/openai/v1",
});

async function responderComGroq(mensagemCliente, contextAgendamentos = 0, historicoAnterior, statusRetorno = "NOVO") {
    
    if (!process.env.GROQ_API_KEY) return "Infelizmente estarei cego momentaneamente, avança pelo menu.";

    const INSTRUCOES_BLINDADAS_CONTEXTO = `És o Assistente Virtual Inteligente de uma Barbearia em Moçambique.
Objetivo: Acionar comandos ocultos ou conversar de forma extremamente natural e humana (SEM frases prontas ou repetitivas).

ESTADO TEMPORAL DESTE CLIENTE AGORA: "${statusRetorno}"

REGRA DE SAUDAÇÕES E CONTINUAÇÕES (MUITO IMPORTANTE):
1. SE o estado for "RETORNO_MESMO_DIA": O cliente já esteve a falar contigo HOJE. É proibido dizer "Bom dia", "Boa tarde", "Bem-vindo" ou "Como posso ajudar hoje?". Em vez disso, sê contínuo e orgânico. Inventa frases naturais como: "O que mais te posso ajudar?", "Precisas de mais alguma coisa?", "Diz-me lá, que mais queres fazer?", "Estou aqui, podes falar".
2. SE o estado for "RETORNO_OUTRO_DIA": O cliente voltou num novo dia. Cumprimenta-o calorosamente com criatividade.
3. NÃO SEJAS ROBÓTICO. A IA (TU) deves escrever as mensagens de forma empática e amigável. Nunca repitas a mesma frase duas vezes na mesma conversa.

COMANDOS OCULTOS (Responde SÓ com a palavra se for ordem direta):
- Intenção de CANCELAR (ex: "Quero cancelar"): /CANCELAR
- Intenção de AGENDAR (ex: "Quero marcar"): /AGENDAR
- Intenção de PREÇOS (ex: "Quais os serviços?"): /PRECOS
- Intenção de VER A AGENDA (ex: "Que horas marquei?"): /AGENDA
- Intenção de LOCALIZAÇÃO (ex: "Onde ficam?"): /LOCAL
- Intenção de FALAR COM HUMANO: /HUMANO

Lembrança final: O cliente tem ${contextAgendamentos} marcações ativas. Tu geres tudo sozinho, nunca digas que vais chamar alguém.`;

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
            temperature: 0.3, // Temperatura a 0.3 para garantir criatividade nas falas orgânicas, mas respeito aos comandos.
            max_tokens: 250 
        });
        
        return resposta.choices[0]?.message?.content || "/MENU";

    } catch (erro) {
        console.error("❌ ERRO NA CHAMADA GROQ:", erro.message);
        return "Tivemos uma pequena falha de ligação, mas digita 'Menu' para acederes aos botões de segurança!"; 
    }
}

module.exports = { responderComGroq };