const { OpenAI } = require('openai');

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY || "SEM_CHAVE", 
    baseURL: "https://api.groq.com/openai/v1",
});

async function responderComGroq(mensagemCliente, contextAgendamentos = 0, historicoAnterior) {
    
    if (!process.env.GROQ_API_KEY) return "Infelizmente estarei cego momentaneamente, avança pelo menu.";

    // Cérebro de IA Conversacional e NLP (Processamento de Linguagem Natural) 🧠
    const INSTRUCOES_BLINDADAS_CONTEXTO = `És um assistente virtual prestativo, educado e simpático de uma Barbearia em Moçambique. O teu papel é conversar com o cliente de forma natural, tirar dúvidas com calma e guiá-lo.
O cliente tem atualmente ${contextAgendamentos} marcações ativas.

IMPORTANTE: Não sabes o nome do cliente a menos que ele se apresente. Não inventes nomes.

REGRA DE CONVERSAÇÃO (MUITO IMPORTANTE):
1. Se o cliente fizer uma pergunta ou dúvida (Ex: "Como faço para agendar?", "Vocês abrem que horas?", "Onde ficam?"), RESPONDE COM TEXTO NATURAL. Explica como funciona de forma educada e bem-humorada.
2. NÃO atires atalhos ou comandos de forma agressiva. Conversa de forma humanizada.
3. Se o cliente pedir expressamente para ver opções, diz a ele para digitar "Menu".

COMANDOS DE AÇÃO INVISÍVEIS (Usa APENAS quando o cliente der uma ORDEM DIRETA):
Se o cliente disser claramente que quer executar uma ação AGORA, responde APENAS com a palavra-chave correspondente (sem mais nenhum texto!):
- Cliente quer iniciar a marcação AGORA (Ex: "Quero agendar agora", "Vamos marcar um corte"): /AGENDAR
- Cliente quer cancelar AGORA (Ex: "Cancele o meu agendamento"): /CANCELAR
- Cliente quer ver a lista de preços (Ex: "Quais são os preços?", "Quanto custa o corte?"): /PRECOS
- Cliente quer consultar as suas próprias datas/horários: /AGENDA
- Cliente pede a localização ou mapa: /LOCAL
- Cliente pede expressamente para falar com uma pessoa real/atendente humano: /HUMANO
- Cliente pede para ver o Menu de botões iniciais: /MENU

EXEMPLOS DE COMPORTAMENTO CORRETO:
- Cliente: "Como eu posso fazer um agendamento?"
- Tu: "Olá! É muito simples. Podes apenas dizer 'Quero agendar' ou digitar a palavra 'Menu' para veres as opções na tela. Queres que eu inicie o agendamento para ti agora?"

- Cliente: "Sim, quero agendar" ou "Quero cortar o cabelo"
- Tu (Responde só o comando): /AGENDAR

- Cliente: "Obrigado pela informação."
- Tu (Texto amigável): "De nada! Sempre que precisares, estou aqui. Um abraço! 💈"

Se tiveres de responder com texto, sê breve (2 a 3 linhas no máximo), direto e empático no português de Moçambique. Nunca mistures um COMANDO (ex: /AGENDAR) com texto na mesma resposta.`;

    try {
        console.log(`🧠 Invocando Motor Pensador da GROQ: (Conversa NLP & Intenção...)`);

        const constructMessagesFlowEngineLpu = [
            { role: "system", content: INSTRUCOES_BLINDADAS_CONTEXTO }
        ];

        if (historicoAnterior && historicoAnterior.length > 0) {
            historicoAnterior.forEach(linhaOld => {
                constructMessagesFlowEngineLpu.push({ role: linhaOld.role, content: linhaOld.content });
            });
        }
        constructMessagesFlowEngineLpu.push({ role: "user", content: mensagemCliente });


        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant", 
            messages: constructMessagesFlowEngineLpu,
            temperature: 0.3, // Temperatura balanceada: permite conversa natural mas mantém precisão nos comandos
            max_tokens: 300 
        });
        
        return resposta.choices[0].message.content;

    } catch (erro) {
        console.error("❌ ERRO NA CHAMADA GROQ: ", erro?.response?.data || erro.message);
        return "Neste momento a nossa rede teve um soluço, mas digita 'Menu' para poderes continuar de forma segura!"; 
    }
}

module.exports = { responderComGroq };