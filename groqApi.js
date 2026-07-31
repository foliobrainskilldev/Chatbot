const { OpenAI } = require('openai');

const groq = new OpenAI({
    // Lê a tua Chave API e puxa direto à rede deles
    apiKey: process.env.GROQ_API_KEY || "SEM_CHAVE", 
    baseURL: "https://api.groq.com/openai/v1",
});

const INSTRUCOES_BARBEARIA = `
És o atendente virtual super gentil, profissional e moçambicano da nossa Barbearia.
Utiliza português de Moçambique de forma conversacional e super humana.
Estas são as tuas diretrizes fundamentais:

1. Se alguém saudar (Olá, Bom dia, Boa tarde), saúdas de volta, perguntas como podes ajudar e relembras como somos gratos por o receber!
2. O nosso Menu: Corte (500 MT / 30 min), Barba (300 MT / 20 min) e Corte+Barba (700 MT / 50 min). Horário: Segunda a Sábado, das 09:00 às 19:00. 
3. Não tens permissões para marcar no sistema sozinho. A nossa API visual trata disso. 
4. PORTANTO: Se alguém fizer perguntas querendo *MARCAR*, *VER SERVIÇOS*, *CANCELAR*, remata sempre instruindo: diga que basta mandar a palavra exacta "Menu" neste chat e o seu quadro de funções surge abaixo de imediato! 
5. Dá respostas rápidas e objectivas! Não fiques dando muros textuais gigantes.
`;

async function responderComGroq(mensagemCliente) {
    
    // Verificação "Raio-X":
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY.trim() === "") {
        console.error("🚨 ERRO GRAVE DA IA: A chave 'GROQ_API_KEY' não está configurada no Render! Lê-se Vazia.");
        return "Neste exato segundo a nossa recepção perdeu a rede... Digita 'Menu'!";
    }

    try {
        console.log("🤖 A processar o pedido na Llama (Groq LPU)...");
        const resposta = await groq.chat.completions.create({
            // Atualizei o nome do modelo para as APIs ultra novas gratuitas!
            model: "llama-3.1-8b-instant", 
            messages: [
                { role: "system", content: INSTRUCOES_BARBEARIA },
                { role: "user", content: mensagemCliente }
            ],
            temperature: 0.6,
            max_tokens: 300 
        });

        console.log("✅ Groq respondeu perfeitamente ao contexto!");
        return resposta.choices[0].message.content;
        
    } catch (erro) {
        // Agora vou EXIGIR ver o Erro exato no teu log render:
        console.error("❌ ERRO NA CHAMADA GROQ: ", erro?.response?.data || erro.message);
        return "Neste exato segundo a nossa recepção perdeu a rede e peço desculpa! Mas podes continuar digitando apenas a palavra 'Menu' que nosso sistema cuidará das vossas marcações tranquilamente! 🙏🏽💈";
    }
}

module.exports = { responderComGroq };