const { OpenAI } = require('openai');

// Inicializa a conexão exclusiva com a infraestrutura hiper-rápida da Groq!
const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY, 
    baseURL: "https://api.groq.com/openai/v1", // Força o tráfego para a Groq (LPU)
});

const INSTRUCOES_BARBEARIA = `
És o atendente virtual super gentil, profissional e moçambicano da nossa Barbearia.
Utiliza português de Moçambique de forma conversacional e super humana, evitando o típico sotaque "robô".
Estas são as tuas diretrizes fundamentais:

1. Se alguém saudar (Olá, Bom dia, Boa tarde), saúdas de volta, perguntas como podes ajudar e relembras como somos gratos por o receber!
2. O nosso Menu da casa: Corte (500 MT / 30 min), Barba (300 MT / 20 min) e Corte+Barba (700 MT / 50 min). Horário: Segunda a Sábado, das 09:00 às 19:00. Local: Av. 24 de Julho, Maputo.
3. Não tens permissões para marcar no sistema sozinho. A nossa API visual trata de o fazer no background sem espalhafato. 
4. PORTANTO: Se alguém fizer perguntas querendo *MARCAR*, *VER SERVIÇOS*, *CANCELAR*, remata sempre de forma natural o teu texto induzindo ele a que basta introduzir a palavra exata "Menu" ali no chat para accionar as nossas Ferramentas de Selecção seguras! 
5. Dá respostas rápidas de 1 a 3 parágrafos no máximo! Tens um ser humano ansioso de outro lado do Whatsapp.
`;

async function responderComGroq(mensagemCliente) {
    try {
        const resposta = await groq.chat.completions.create({
            // Llama-3-8B é o modelo grátis hiper-rápido do momento na Groq Cloud
            model: "llama3-8b-8192", 
            messages: [
                { role: "system", content: INSTRUCOES_BARBEARIA },
                { role: "user", content: mensagemCliente }
            ],
            temperature: 0.6, // Equilibrado e amigável
            max_tokens: 300 // Para garantir textos curtos e sem custos imprevistos
        });

        return resposta.choices[0].message.content;
    } catch (erro) {
        console.error("❌ ERRO na I.A (Groq): ", erro?.response?.data || erro.message);
        // Resposta elegante para caso os servidores Groq travem!
        return "Neste exato segundo a nossa recepção perdeu a rede e peço desculpa! Mas podes continuar digitando apenas a palavra 'Menu' que nosso sistema cuidará das vossas marcações tranquilamente! 🙏🏽💈";
    }
}

module.exports = { responderComGroq };