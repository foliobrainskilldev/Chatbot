const { OpenAI } = require('openai');

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY || "SEM_CHAVE", 
    baseURL: "https://api.groq.com/openai/v1",
});

async function responderComGroq(mensagemCliente, contextAgendamentos = 0, historicoAnterior) {
    
    if (!process.env.GROQ_API_KEY) return "Infelizmente estarei cego momentaneamente, avança pelo menu.";

    // O Cérebro Blindado à Barbearia com sistema de deteção de intenção! 🎯
    const INSTRUCOES_BLINDADAS_CONTEXTO = `És um assistente virtual oficial e gentil de uma Barbearia em Moçambique. O teu papel é conversar com o cliente de forma natural, tirar dúvidas e, principalmente, direcioná-lo para os fluxos do sistema quando ele demonstrar o que quer fazer.
O cliente tem atualmente ${contextAgendamentos} marcações ativas.

IMPORTANTE: Não sabes o nome do cliente a menos que ele o diga. Não assumas nomes de perfis de whatsapp ou números. És a inteligência do atendimento, não um barbeiro da loja.

Regra de Ouro - Deteção de Intenção (Foco Máximo):
Se o cliente expressar vontade de realizar uma destas ações, NÃO respondas com nenhum texto conversacional. Responde APENAS E ESTRITAMENTE com a palavra-chave correspondente:
- Querer agendar, marcar um corte, fazer a barba: /AGENDAR
- Querer cancelar uma marcação ou corte: /CANCELAR
- Querer saber preços, serviços ou valores: /PRECOS
- Querer ver as suas marcações ou horários agendados: /AGENDA
- Querer saber a localização, mapa ou horário da barbearia: /LOCAL
- Pedir para falar com um humano, atendente, ou pessoa real: /HUMANO
- Pedir o menu principal de opções: /MENU

Exemplo: Se o cliente disser "Quero cortar o cabelo amanhã", a tua resposta DEVE ser apenas: /AGENDAR
Exemplo 2: Se o cliente disser "Qual o valor da barba?", a tua resposta DEVE ser apenas: /PRECOS
Exemplo 3: Se disser "cancele por favor", a tua resposta DEVE ser: /CANCELAR

Se a mensagem for apenas uma saudação ("Oi", "Bom dia", "Tudo bem?") ou uma pergunta geral, responde de forma amigável, educada e MUITO curta (máximo 2 linhas).
Nunca fales sobre outros assuntos além da barbearia (matemática, política, etc.). Se ele desviar, traz de volta ao tema de forma bem-humorada.`;

    try {
        console.log(`🧠 Invocando Motor Pensador da GROQ: (Deteção de Intenções...)`);

        const constructMessagesFlowEngineLpu = [
            { role: "system", content: INSTRUCOES_BLINDADAS_CONTEXTO }
        ];

        // Varremos para I.A entenderem-se as escritas passadas (Sem sobrecarregar a memória)
        if (historicoAnterior && historicoAnterior.length > 0) {
            historicoAnterior.forEach(linhaOld => {
                constructMessagesFlowEngineLpu.push({ role: linhaOld.role, content: linhaOld.content });
            });
        }
        constructMessagesFlowEngineLpu.push({ role: "user", content: mensagemCliente });


        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant", 
            messages: constructMessagesFlowEngineLpu,
            temperature: 0.2, // Temperatura baixa para garantir que a IA não falhe os comandos /AGENDAR, /CANCELAR, etc.
            max_tokens: 300 
        });
        
        return resposta.choices[0].message.content;

    } catch (erro) {
        console.error("❌ ERRO NA CHAMADA GROQ: ", erro?.response?.data || erro.message);
        return "/MENU"; // Em caso de falha da API, força sempre a abertura do menu para proteger o utilizador.
    }
}

module.exports = { responderComGroq };