const axios = require('axios');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function analisarMensagemNLP(mensagem, historico, userState) {
    if (!OPENAI_API_KEY) {
        console.warn("⚠️ [NLP] OPENAI_API_KEY não configurada. Usando fallback baseado em regras.");
        return fallbackNLP(mensagem);
    }

    try {
        const prompt = `
Você é o motor de NLP de um HealthCRM (Clínica Médica).
Sua tarefa é analisar a mensagem do paciente e extrair a intenção (intent) e as entidades (entities).

Intenções permitidas:
- clinic.hours (horário de funcionamento)
- clinic.location (localização)
- clinic.contact (contato)
- clinic.payment_methods (pagamento)
- treatment.list (listar tratamentos)
- treatment.info (informação de tratamento)
- treatment.price (preço de tratamento)
- treatment.duration (duração)
- treatment.faq (dúvidas gerais sobre tratamento)
- appointment.create (marcar consulta)
- appointment.check (verificar consultas)
- appointment.reschedule (remarcar)
- appointment.cancel (cancelar)
- human.transfer (falar com atendente)
- greeting (saudação)
- goodbye (despedida)
- unknown (não entendi)

Entidades para extrair (se presentes):
- treatment (nome do tratamento)
- date (data, ex: "amanhã", "sexta-feira", "15/10")
- time (horário, ex: "15h", "de manhã")
- professional (nome do médico/profissional)

Estado atual da conversa: ${JSON.stringify(userState)}

Responda APENAS com um JSON válido no formato exato:
{
  "intent": "...",
  "confidence": 0.95,
  "entities": {
    "treatment": "...",
    "date": "...",
    "time": "...",
    "professional": "..."
  }
}
`;

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: mensagem }
            ],
            temperature: 0,
            response_format: { type: "json_object" }
        }, {
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
        });

        const result = JSON.parse(response.data.choices[0].message.content);
        return result;
    } catch (error) {
        console.error("❌ [NLP] Erro na API da OpenAI:", error.message);
        return fallbackNLP(mensagem);
    }
}

function fallbackNLP(mensagem) {
    const msg = mensagem.toLowerCase();
    let intent = "unknown";
    if (msg.includes("agendar") || msg.includes("marcar")) intent = "appointment.create";
    else if (msg.includes("cancelar")) intent = "appointment.cancel";
    else if (msg.includes("preço") || msg.includes("valor") || msg.includes("custa")) intent = "treatment.price";
    else if (msg.includes("humano") || msg.includes("atendente")) intent = "human.transfer";
    else if (msg.includes("horário") || msg.includes("horas")) intent = "clinic.hours";
    else if (msg.includes("onde") || msg.includes("local")) intent = "clinic.location";
    
    return {
        intent,
        confidence: 0.6,
        entities: {}
    };
}

async function gerarRespostaNatural(mensagem, historico, contexto, configDb) {
    if (!OPENAI_API_KEY) {
        return "Recebi sua mensagem, mas meu motor de IA está temporariamente indisponível. Como posso ajudar de forma simples?";
    }

    try {
        const prompt = `
Você é ${configDb?.nomeAssistente || 'o assistente virtual'} da clínica ${configDb?.nomeClinica || 'HealthCRM'}.
Tom de voz: ${configDb?.tomDeVoz || 'Profissional e acolhedor'}.
Estilo: ${configDb?.estiloComunicacao || 'Respostas curtas e objetivas'}.
Formalidade: ${configDb?.formalidade || 'Sempre tratar por Senhor/Senhora'}.

Regras:
1. NUNCA invente preços, horários ou diagnósticos.
2. Use os DADOS DE CONTEXTO fornecidos abaixo para basear sua resposta.
3. Se a informação não estiver no contexto, diga que não tem essa informação no momento e ofereça transferência para um humano.

DADOS DE CONTEXTO (Vindos do Banco de Dados Operacional):
${JSON.stringify(contexto, null, 2)}

Responda à mensagem do usuário de forma natural e conversacional.
`;

        const messages = [
            { role: "system", content: prompt },
            ...historico.map(h => ({ role: h.role, content: h.content })),
            { role: "user", content: mensagem }
        ];

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini",
            messages: messages,
            temperature: 0.7
        }, {
            headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error("❌ [IA] Erro ao gerar resposta natural:", error.message);
        return "Desculpe, tive um pequeno problema técnico ao formular a resposta. Poderia repetir?";
    }
}

module.exports = {
    analisarMensagemNLP,
    gerarRespostaNatural
};