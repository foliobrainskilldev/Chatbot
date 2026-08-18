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
Sua tarefa é classificar a intenção (intent) e extrair entidades (entities). 
Se houver múltiplas informações (ex: "harmonização amanhã às 10"), extraia TODAS elas.

Intenções permitidas:
- CLINIC_HOURS (horário de funcionamento da clínica)
- CLINIC_LOCATION (endereço, onde fica)
- CLINIC_CONTACT (telefone, contato)
- CLINIC_PAYMENT_METHODS (pagamento, convênio)
- TREATMENT_LIST (quais serviços oferecem)
- TREATMENT_INFO (informações sobre um serviço ou perguntas como "aceitam crianças?", "dói?")
- TREATMENT_PRICE (quanto custa, preço)
- BOOK_APPOINTMENT (quer marcar consulta, agendar)
- CHECK_UPCOMING_APPOINTMENTS (perguntando sobre uma consulta já marcada)
- RESCHEDULE_APPOINTMENT (remarcar)
- CANCEL_APPOINTMENT (cancelar consulta)
- HUMAN_TRANSFER (falar com atendente humano)
- FRUSTRATION (paciente irritado, "você não entende")
- GREETING (saudação genérica)
- GOODBYE (despedida)
- CONFIRM_APPOINTMENT (sim, pode confirmar, isso mesmo, ok)
- REJECT_APPOINTMENT (não, deixa pra lá, não quero)
- REQUEST_MORE_TIMES (tem outros horários? quais mais? e depois?)
- REQUEST_MORE_DATES (tem outros dias? e semana que vem?)
- REQUEST_SPECIFIC_TIME (perguntando DISPONIBILIDADE de um horário, ex: "tem depois das 10?", "pode ser às 14?")
- SELECT_TIME (às 9h, as 14:00, as duas da tarde)
- SELECT_DATE (amanhã, sexta, dia 20)
- CHANGE_TREATMENT (mudar tratamento)
- CHANGE_DATE (mudar o dia)
- CHANGE_TIME (mudar a hora)
- ASK_DATE_REFERENCE (que dia é amanhã?, amanhã cai que dia?)
- UNKNOWN (não entendi)

REGRAS DE TEMPO:
Hoje é: ${diaDeHoje}.
Converta 'date' para "DD/MM/YYYY".
Converta 'time' OBRIGATORIAMENTE para "HH:mm" (ex: 10 horas vira 10:00).

MODIFICADORES DE TEMPO:
"depois das 10" ou "após as 10" -> "time": "10:00", "time_modifier": "after".
"a partir das 10" -> "time": "10:00", "time_modifier": "starting".
"antes das 12h" -> "time": "12:00", "time_modifier": "before".
"às 10", "para as 10" (hora exata) -> "time_modifier": "exact".

Estado atual (Funil): ${userState?.step || 'IDLE'}

Responda APENAS com JSON:
{
  "intent": "...",
  "confidence": 0.95,
  "entities": {
    "treatment": "...",
    "date": "DD/MM/YYYY",
    "time": "HH:mm",
    "time_modifier": "after|starting|before|exact"
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
    else if (msg.includes("que dia é") || msg.includes("dia é amanhã")) intent = "ASK_DATE_REFERENCE";
    else if (msg.includes("depois das") || msg.includes("antes das") || msg.includes("partir das")) intent = "REQUEST_SPECIFIC_TIME";
    else if (msg.includes("quais mais") || msg.includes("mais horários") || msg.includes("tem outro")) intent = "REQUEST_MORE_TIMES";
    else if (msg.includes("mudar o dia") || msg.includes("outra data")) intent = "CHANGE_DATE";
    else if (msg.includes("mudar a hora") || msg.includes("outro horário")) intent = "CHANGE_TIME";
    else if (msg.includes("agendar") || msg.includes("marcar") || msg.includes("dia ") || msg.includes("às ")) intent = "BOOK_APPOINTMENT";
    else if (msg.includes("cancelar consulta") || msg.includes("desmarcar")) intent = "CANCEL_APPOINTMENT";
    else if (msg.includes("remarcar")) intent = "RESCHEDULE_APPOINTMENT";
    else if (msg.includes("preço") || msg.includes("valor")) intent = "TREATMENT_PRICE";
    else if (msg.includes("humano") || msg.includes("atendente") || msg.includes("pessoa") || msg.includes("entendendo")) intent = "HUMAN_TRANSFER";
    else if (msg.includes("histórico") || msg.includes("minha consulta")) intent = "CHECK_UPCOMING_APPOINTMENTS";
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

    try {
        const prompt = `
Você é ${configDb?.nomeAssistente || 'o assistente virtual'} da clínica ${configDb?.nomeClinica || 'HealthCRM'}.

REGRA ABSOLUTA:
Você está ESTRITAMENTE PROIBIDO de inventar horários da agenda, preços ou confirmar consultas.
Se o usuário perguntar preços, endereço ou horários, baseie-se APENAS nos dados fornecidos abaixo.
A moeda é ${moedaGlobal}. Nunca fale em Reais ou Dólares.

INFORMAÇÕES DO PACIENTE:
- Nome: ${contexto.paciente_nome || 'Paciente'}

DADOS DA CLÍNICA PARA RESPONDER À DÚVIDA:
${JSON.stringify(contexto.dados_crm || {}, null, 2)}

Sua tarefa: Formule uma resposta conversacional curta que entregue a informação solicitada. 
MUITO IMPORTANTE: Seja direto. Responda EXCLUSIVAMENTE à dúvida atual do paciente. Não repita informações sobre tratamentos, preços ou consultas a menos que o paciente tenha perguntado isso na última mensagem. Se houver um AVISO DE PRIORIDADE no contexto, inclua-o organicamente no final.
`;

        const rawMessages = [...(historico || []), { role: "user", content: mensagem }];
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