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
Você é o motor de NLP de um HealthCRM (Clínica Médica).
Sua tarefa é analisar a mensagem do paciente e extrair a intenção (intent) e as entidades (entities).

Intenções permitidas:
- CLINIC_HOURS (horário da clínica)
- CLINIC_LOCATION (localização)
- CLINIC_CONTACT (contato)
- CLINIC_PAYMENT_METHODS (pagamento)
- TREATMENT_LIST (listar tratamentos)
- TREATMENT_INFO (informação sobre serviço)
- TREATMENT_PRICE (preço)
- TREATMENT_DURATION (duração)
- BOOK_APPOINTMENT (marcar consulta ou iniciar agendamento)
- CHECK_UPCOMING_APPOINTMENTS (verificar consultas futuras)
- CHECK_PAST_APPOINTMENTS (verificar consultas passadas)
- RESCHEDULE_APPOINTMENT (remarcar)
- CANCEL_APPOINTMENT (cancelar)
- HUMAN_TRANSFER (falar com atendente humano)
- GREETING (saudação genérica)
- GOODBYE (despedida)
- CONFIRM_APPOINTMENT (usado ESTRITAMENTE quando o usuário confirma positivamente a marcação, ex: "Sim", "Pode confirmar", "Isso mesmo")
- REJECT_APPOINTMENT (usado quando o usuário desiste ou recusa, ex: "Não", "Deixa para lá", "Cancelar operação")
- REQUEST_MORE_TIMES (usado quando o usuário pede mais horários ou opções)
- REQUEST_MORE_DATES (usado quando o usuário pede mais dias ou outras datas)
- SELECT_TIME (quando o usuário informa especificamente uma hora durante o processo, ex: "às 9h", "pode ser as 14")
- SELECT_DATE (quando o usuário informa especificamente uma data, ex: "amanhã", "sexta")
- UNKNOWN (não entendi)

INFORMAÇÃO TEMPORAL IMPORTANTE E FUSO HORÁRIO LOCAL:
Hoje é: ${diaDeHoje}.
Se o usuário mencionar dias relativos ("amanhã", "sexta", "dia 16"), converta a entidade 'date' EXATAMENTE para o formato "DD/MM/YYYY" usando como base a data de hoje.
Se mencionar horas ("10h", "às três da tarde"), converta a entidade 'time' EXATAMENTE para "HH:mm".

MODIFICADORES DE TEMPO:
Se o paciente disser "depois das 10", defina "time": "10:00" e "time_modifier": "after".
Se o paciente disser "antes das 12h", defina o "time" como a hora limite e "time_modifier": "before".
Se o paciente apenas passar a hora, defina "time_modifier": "exact".

Estado atual da conversa (Contexto do Funil): ${JSON.stringify(userState || {})}

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

        const rawContent = response.data.choices[0].message.content;
        return JSON.parse(rawContent);
        
    } catch (error) {
        console.error("❌ [NLP ERRO] Falha ao analisar intenção:", error.response ? JSON.stringify(error.response.data) : error.message);
        return fallbackNLP(mensagem);
    }
}

function fallbackNLP(mensagem) {
    const msg = mensagem.toLowerCase();
    let intent = "UNKNOWN";
    
    if (msg === "sim" || msg.includes("pode confirmar") || msg.includes("confirmo") || msg === "ok") intent = "CONFIRM_APPOINTMENT";
    else if (msg === "não" || msg.includes("desisto")) intent = "REJECT_APPOINTMENT";
    else if (msg.includes("mais") || msg.includes("outros horários") || msg.includes("tem outro")) intent = "REQUEST_MORE_TIMES";
    else if (msg.includes("agendar") || msg.includes("marcar") || msg.includes("dia ") || msg.includes("às ")) intent = "BOOK_APPOINTMENT";
    else if (msg.includes("cancelar consulta") || msg.includes("desmarcar")) intent = "CANCEL_APPOINTMENT";
    else if (msg.includes("remarcar")) intent = "RESCHEDULE_APPOINTMENT";
    else if (msg.includes("preço") || msg.includes("valor") || msg.includes("custa")) intent = "TREATMENT_PRICE";
    else if (msg.includes("humano") || msg.includes("atendente") || msg.includes("pessoa")) intent = "HUMAN_TRANSFER";
    else if (msg.includes("horário") || msg.includes("funcionamento")) intent = "CLINIC_HOURS";
    else if (msg.includes("histórico") || msg.includes("já feita")) intent = "CHECK_PAST_APPOINTMENTS";
    else if (msg === "oi" || msg === "olá" || msg === "boa tarde" || msg === "bom dia" || msg === "boa noite") intent = "GREETING";
    
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
    const isOngoing = historico && historico.length > 0;

    try {
        const prompt = `
Você é ${configDb?.nomeAssistente || 'o assistente virtual'} da clínica ${configDb?.nomeClinica || 'HealthCRM'}.
Tom de voz: ${configDb?.tomDeVoz || 'Profissional e acolhedor'}.

PROTEÇÃO CONTRA ALUCINAÇÃO (REGRA DE OURO - CRÍTICO):
Você está ESTRITAMENTE PROIBIDO de inventar, supor ou criar horários, vagas disponíveis, preços de tratamentos ou condições de pagamento.
Se o usuário perguntar preços, horários ou formas de pagamento, e essa informação NÃO estiver explícita no bloco "DADOS DE CONTEXTO DO CRM", você NÃO PODE inventar números. JAMAIS invente que há vaga "às 09:00" ou que um serviço custa "120 MT". Responda de forma orgânica que precisa consultar o sistema ou a recepção.

REGRAS DE MOEDA E SAUDAÇÃO:
- A moeda da clínica é ${moedaGlobal}. Nunca fale em Reais ou Dólares.
${isOngoing ? "- NUNCA inicie sua resposta com saudações (Bom dia/Olá). Vá DIRETAMENTE ao ponto." : `- Esta é a primeira mensagem. Inicie com uma saudação educada baseada no horário local (${dataHoraAtual}).`}
- Evite repetir o nome do paciente.

INFORMAÇÕES DO PACIENTE:
- Nome: ${contexto.paciente_nome || 'Paciente'}

DADOS DE CONTEXTO DO CRM (USE APENAS ISTO COMO VERDADE ABSOLUTA):
${JSON.stringify(contexto.dados_crm || {}, null, 2)}

Sua tarefa: Leia a mensagem do usuário e responda de forma fluida e conversacional, respeitando as regras acima.
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
        console.error("❌ [GERAÇÃO DE RESPOSTA ERRO]:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        return "Desculpe, tive um pequeno problema ao formular a resposta agora. Você poderia repetir, por favor?";
    }
}

module.exports = { analisarMensagemNLP, gerarRespostaNatural, transcreverAudio };