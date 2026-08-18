// aiService.js
const axios = require('axios');

async function transcreverAudio(audioBuffer) {
    const GROQ_API_KEY = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : null;
    if (!GROQ_API_KEY) {
        console.warn("⚠️ [WHISPER] GROQ_API_KEY ausente.");
        return "[Áudio recebido, mas sistema de transcrição offline]";
    }

    try {
        const blob = new Blob([audioBuffer], { type: 'audio/ogg' });
        const formData = new FormData();
        formData.append('file', blob, 'audio.ogg');
        formData.append('model', 'whisper-large-v3-turbo'); 
        formData.append('language', 'pt'); 
        formData.append('response_format', 'json');

        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
            body: formData
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Groq Error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        return data.text;
    } catch (error) {
        console.error("❌ [WHISPER ERRO] Falha ao transcrever áudio:", error.message);
        return "[Áudio Recebido - Não foi possível compreender as palavras]";
    }
}

async function analisarMensagemNLP(mensagem, historico, userState, configDb) {
    const GROQ_API_KEY = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : null;
    
    if (!GROQ_API_KEY) {
        console.warn("⚠️ [NLP] GROQ_API_KEY não configurada no .env. Usando fallback básico.");
        return fallbackNLP(mensagem);
    }

    const fusoHorario = configDb?.fusoHorario || 'Africa/Maputo';
    const formatterDia = new Intl.DateTimeFormat('pt-BR', { timeZone: fusoHorario, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
    const diaDeHoje = formatterDia.format(new Date());

    try {
        const prompt = `
Você é o motor de NLU (Natural Language Understanding) de um HealthCRM.
Sua tarefa é analisar a mensagem do paciente e extrair a intenção (intent) e as entidades (entities).

Intenções permitidas:
- CLINIC_HOURS (perguntas sobre horário de funcionamento)
- CLINIC_LOCATION (onde fica, endereço)
- CLINIC_CONTACT (telefone, contato)
- CLINIC_PAYMENT_METHODS (pagamento)
- TREATMENT_LIST (quais serviços fazem)
- TREATMENT_INFO (informação sobre serviço)
- TREATMENT_PRICE (preço)
- BOOK_APPOINTMENT (quer marcar consulta, agendar)
- CHECK_UPCOMING_APPOINTMENTS (quando é minha consulta)
- RESCHEDULE_APPOINTMENT (quero mudar o dia, remarcar uma que já existe)
- CANCEL_APPOINTMENT (quero cancelar, desistir da consulta)
- HUMAN_TRANSFER (falar com atendente humano)
- FRUSTRATION (paciente irritado, "você não entende", "que saco")
- GREETING (saudação genérica)
- GOODBYE (despedida)
- CONFIRM_APPOINTMENT (sim, pode confirmar, isso mesmo, ok)
- REJECT_APPOINTMENT (não, deixa pra lá, não quero)
- REQUEST_MORE_TIMES (tem outros horários? tem mais tarde?)
- REQUEST_MORE_DATES (tem outros dias? e semana que vem?)
- REQUEST_SPECIFIC_TIME (tem depois das 10? pode ser às 14h? antes do almoço?)
- SELECT_TIME (às 9h, as 14:00, as duas da tarde)
- SELECT_DATE (amanhã, sexta, dia 20)
- CHANGE_TREATMENT (quero mudar o tratamento, escolhi errado)
- CHANGE_DATE (quero mudar o dia/data)
- CHANGE_TIME (quero mudar a hora)
- UNKNOWN (não entendi)

INFORMAÇÃO TEMPORAL E FUSO HORÁRIO:
Hoje é: ${diaDeHoje}.
Sempre que mencionar dias relativos ("amanhã", "sexta"), converta a entidade 'date' EXATAMENTE para o formato "DD/MM/YYYY" usando como base hoje.
Sempre que mencionar horas ("10h", "três da tarde"), converta a entidade 'time' EXATAMENTE para "HH:mm".

MODIFICADORES DE TEMPO (CRÍTICO PARA REQUEST_SPECIFIC_TIME):
"depois das 10" -> "time": "10:00", "time_modifier": "after".
"antes das 12h" -> "time": "12:00", "time_modifier": "before".
"hora exata" -> "time_modifier": "exact".

Estado atual (Funil): ${userState?.step || 'IDLE'}

Responda APENAS com um JSON válido no formato exato:
{
  "intent": "...",
  "confidence": 0.95,
  "entities": {
    "treatment": "...",
    "date": "DD/MM/YYYY",
    "time": "HH:mm",
    "time_modifier": "after|before|exact"
  }
}
`;

        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "openai/gpt-oss-120b",
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: mensagem }
            ],
            temperature: 0,
            response_format: { type: "json_object" }
        }, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` }
        });

        return JSON.parse(response.data.choices[0].message.content);
        
    } catch (error) {
        console.error("❌ [NLP ERRO] Falha ao analisar intenção:", error.message);
        return fallbackNLP(mensagem);
    }
}

function fallbackNLP(mensagem) {
    const msg = mensagem.toLowerCase();
    let intent = "UNKNOWN";
    
    if (msg === "sim" || msg.includes("pode confirmar") || msg.includes("confirmo") || msg === "ok") intent = "CONFIRM_APPOINTMENT";
    else if (msg === "não" || msg.includes("desisto") || msg.includes("deixa pra lá")) intent = "REJECT_APPOINTMENT";
    else if (msg.includes("depois das") || msg.includes("antes das")) intent = "REQUEST_SPECIFIC_TIME";
    else if (msg.includes("mais") || msg.includes("outros horários") || msg.includes("tem outro")) intent = "REQUEST_MORE_TIMES";
    else if (msg.includes("mudar o dia") || msg.includes("outra data")) intent = "CHANGE_DATE";
    else if (msg.includes("mudar a hora") || msg.includes("outro horário")) intent = "CHANGE_TIME";
    else if (msg.includes("agendar") || msg.includes("marcar") || msg.includes("dia ") || msg.includes("às ")) intent = "BOOK_APPOINTMENT";
    else if (msg.includes("cancelar consulta") || msg.includes("desmarcar")) intent = "CANCEL_APPOINTMENT";
    else if (msg.includes("remarcar")) intent = "RESCHEDULE_APPOINTMENT";
    else if (msg.includes("preço") || msg.includes("valor")) intent = "TREATMENT_PRICE";
    else if (msg.includes("humano") || msg.includes("atendente") || msg.includes("pessoa")) intent = "HUMAN_TRANSFER";
    else if (msg.includes("histórico") || msg.includes("já feita")) intent = "CHECK_PAST_APPOINTMENTS";
    else if (msg === "oi" || msg === "olá" || msg === "boa tarde" || msg === "bom dia") intent = "GREETING";
    
    return { intent, confidence: 0.6, entities: {} };
}

async function gerarRespostaNatural(mensagem, historico, contexto, configDb) {
    const GROQ_API_KEY = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : null;

    if (!GROQ_API_KEY) {
        return "Recebi sua mensagem, mas meu sistema inteligente está offline. Como posso ajudar de forma objetiva?";
    }

    const fusoHorario = configDb?.fusoHorario || 'Africa/Maputo';
    const moedaGlobal = configDb?.moeda || 'MT';
    const formatter = new Intl.DateTimeFormat('pt-BR', { 
        timeZone: fusoHorario,
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const dataHoraAtual = formatter.format(new Date());

    try {
        const prompt = `
Você é ${configDb?.nomeAssistente || 'o assistente virtual'} da clínica ${configDb?.nomeClinica || 'HealthCRM'}.
Tom de voz: ${configDb?.tomDeVoz || 'Profissional e acolhedor'}.

PROTEÇÃO CONTRA ALUCINAÇÃO (REGRA DE OURO - CRÍTICO):
Você está ESTRITAMENTE PROIBIDO de inventar horários, vagas disponíveis, preços de tratamentos ou se a consulta foi marcada.
Se o usuário perguntar preços ou horários de funcionamento, baseie-se APENAS nos dados fornecidos abaixo.

REGRAS DE MOEDA E SAUDAÇÃO:
- A moeda da clínica é ${moedaGlobal}. Nunca fale em Reais ou Dólares.
- NUNCA inicie sua resposta com saudações (Bom dia/Olá) se já estiver no meio da conversa.

INFORMAÇÕES DO PACIENTE:
- Nome: ${contexto.paciente_nome || 'Paciente'}

DADOS DE CONTEXTO DO CRM (USE APENAS ISTO COMO VERDADE ABSOLUTA):
${JSON.stringify(contexto.dados_crm || {}, null, 2)}

Sua tarefa: Formule uma resposta conversacional e gentil que entregue a informação solicitada acima.
`;

        const rawMessages = [
            ...(historico || []),
            { role: "user", content: mensagem }
        ];

        const mergedMessages = [];
        let lastRole = null;

        for (const msg of rawMessages) {
            const currentRole = msg.role;
            const currentContent = msg.content || "";
            if (currentContent.trim() === "") continue;

            if (currentRole === lastRole) {
                mergedMessages[mergedMessages.length - 1].content += `\n${currentContent}`;
            } else {
                mergedMessages.push({ role: currentRole, content: currentContent });
                lastRole = currentRole;
            }
        }

        if (mergedMessages.length > 0 && mergedMessages[0].role === 'assistant') mergedMessages.shift(); 

        const messages = [
            { role: "system", content: prompt },
            ...mergedMessages
        ];

        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "openai/gpt-oss-120b",
            messages: messages,
            temperature: 0.2
        }, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error("❌ [GERAÇÃO DE RESPOSTA ERRO]:", error.message);
        return "Desculpe, tive um problema ao formular a resposta agora. Pode repetir?";
    }
}

module.exports = { analisarMensagemNLP, gerarRespostaNatural, transcreverAudio };