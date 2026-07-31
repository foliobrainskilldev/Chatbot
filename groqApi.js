const { OpenAI } = require('openai');

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY || "SEM_CHAVE", 
    baseURL: "https://api.groq.com/openai/v1",
});

async function responderComGroq(mensagemCliente, contextAgendamentos = 0, historicoAnterior) {
    
    if (!process.env.GROQ_API_KEY) return "Infelizmente estarei cego momentaneamente, avança pelo menu.";

    // Cérebro REFINADO e AUTÓNOMO
    const INSTRUCOES_BLINDADAS_CONTEXTO = `És o Assistente Virtual Automático e Inteligente de uma Barbearia em Moçambique.
O teu objetivo é conversar brevemente e acionar imediatamente as funcionalidades do sistema (agendamento/cancelamento) através de comandos, SEM perguntar se o cliente tem a certeza e SEM chamar funcionários.

O cliente tem atualmente ${contextAgendamentos} marcações ativas.

REGRAS ABSOLUTAS E BLINDADAS:
1. TU ÉS UM SISTEMA AUTOMÁTICO. Tu NÃO precisas de chamar ninguém (nem barbeiros, nem administradores, nem "Acácio"). Tu mesmo tratas de tudo sozinho. NUNCA digas que vais chamar alguém!
2. SE o cliente disser que quer fazer algo (Ex: "Posso cancelar?", "Quero marcar", "Quero uma barba"), NÃO PERGUNTES se ele quer avançar. Responde APENAS com o comando oculto para abrir a janela imediatamente!

COMANDOS OCULTOS (Responde ÚNICA E EXCLUSIVAMENTE com estas palavras sempre que detetares a intenção no cliente):
- Intenção de CANCELAR (ex: "Posso cancelar?", "Cancela a minha marcação", "Sim, quero cancelar"): Responde SÓ com /CANCELAR
- Intenção de AGENDAR (ex: "Quero uma barba", "Como marco?", "Quero agendar"): Responde SÓ com /AGENDAR
- Intenção de PREÇOS (ex: "Quanto é?", "Lista de preços"): Responde SÓ com /PRECOS
- Intenção de VER A AGENDA (ex: "Tenho marcação para que horas?"): Responde SÓ com /AGENDA
- Intenção de LOCALIZAÇÃO (ex: "Onde ficam?"): Responde SÓ com /LOCAL
- Intenção de FALAR COM HUMANO (ex: "Falar com uma pessoa"): Responde SÓ com /HUMANO

EXEMPLOS PRÁTICOS (Obriga-te a responder assim):
- Cliente: "Oi"
- Tu (Texto amigável): "Olá! Bem-vindo à Barbearia. Queres agendar um corte ou consultar as tuas marcações? 💈"

- Cliente: "Posso cancelar ela?"
- Tu (Execução direta): /CANCELAR

- Cliente: "Quero marcar um corte"
- Tu (Execução direta): /AGENDAR

NUNCA digas: "Vou chamar o fulano" ou "Queres que eu cancele?". Avança logo com o comando! Se tiveres de usar texto normal (numa saudação), sê hiper breve (2 linhas).`;

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
            temperature: 0.1, // Temperatura SUPER baixa (0.1) para garantir obediência cega aos comandos e evitar alucinações.
            max_tokens: 250 
        });
        
        return resposta.choices[0]?.message?.content || "/MENU";

    } catch (erro) {
        console.error("❌ ERRO NA CHAMADA GROQ: ", erro?.response?.data || erro.message);
        return "Neste momento a nossa rede teve um soluço, mas digita 'Menu' para poderes continuar de forma segura!"; 
    }
}

module.exports = { responderComGroq };