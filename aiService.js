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

async function analisarMensagemNLP(mensagem, historico, userState) {
    const GROQ_API_KEY = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : null;
    
    if (!GROQ_API_KEY) {
        console.warn("⚠️ [NLP] GROQ_API_KEY não configurada no .env. Usando fallback básico.");
        return fallbackNLP(mensagem);
    }

    // Passar o dia exato para conversão de datas relativas (amanhã, sexta, etc)
    const formatterDia = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
    const diaDeHoje = formatterDia.format(new Date());

    try {
        const prompt = `
Você é o motor de NLP de um HealthCRM (Clínica Médica).
Sua tarefa é analisar a mensagem do paciente e extrair a intenção (intent) e as entidades (entities).

Intenções permitidas:
- clinic.hours (horário)
- clinic.location (localização)
- clinic.contact (contato)
- clinic.payment_methods (pagamento)
- treatment.list (listar tratamentos)
- treatment.info (informação)
- treatment.price (preço)
- treatment.duration (duração)
- appointment.create (marcar consulta)
- appointment.check (verificar futuras)
- appointment.history (verificar passadas ou canceladas)
- appointment.reschedule (remarcar)
- appointment.cancel (cancelar)
- human.transfer (falar com atendente)
- greeting (saudação)
- goodbye (despedida)
- unknown (não entendi)

INFORMAÇÃO TEMPORAL IMPORTANTE:
Hoje é: ${diaDeHoje}.
Se o usuário mencionar dias relativos ("amanhã", "sexta", "dia 16"), converta a entidade 'date' EXATAMENTE para o formato "DD/MM/YYYY". Ex: "15/08/2026".
Se mencionar horas ("10h", "às três da tarde"), converta a entidade 'time' EXATAMENTE para "HH:mm". Ex: "10:00", "15:00".

Estado atual da conversa (Contexto): ${JSON.stringify(userState || {})}

Responda APENAS com um JSON válido no formato exato:
{
  "intent": "...",
  "confidence": 0.95,
  "entities": {
    "treatment": "...",
    "date": "DD/MM/YYYY",
    "time": "HH:mm"
  }
}
`;

        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
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
    let intent = "unknown";
    if (msg.includes("agendar") || msg.includes("marcar") || msg.includes("dia ") || msg.includes("às ")) intent = "appointment.create";
    else if (msg.includes("cancelar")) intent = "appointment.cancel";
    else if (msg.includes("preço") || msg.includes("valor")) intent = "treatment.price";
    else if (msg.includes("humano") || msg.includes("atendente")) intent = "human.transfer";
    else if (msg.includes("horário")) intent = "clinic.hours";
    else if (msg.includes("histórico") || msg.includes("já feita")) intent = "appointment.history";
    else if (msg === "oi" || msg === "olá") intent = "greeting";
    
    return { intent, confidence: 0.6, entities: {} };
}

async function gerarRespostaNatural(mensagem, historico, contexto, configDb) {
    const GROQ_API_KEY = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : null;

    if (!GROQ_API_KEY) {
        return "Recebi sua mensagem, mas meu sistema inteligente está offline. Como posso ajudar de forma objetiva?";
    }

    const fusoHorario = configDb?.fusoHorario || 'Africa/Maputo';
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
Estilo: ${configDb?.estiloComunicacao || 'Respostas curtas e objetivas'}.
Formalidade: ${configDb?.formalidade || 'Sempre tratar por Senhor/Senhora'}.

CONSCIÊNCIA TEMPORAL:
- A data e hora atual no sistema é: ${dataHoraAtual}.
- Baseie-se nesse horário para responder "Bom dia" (00h-11h59), "Boa tarde" (12h-17h59) ou "Boa noite" (18h-23h59).

INFORMAÇÕES DO PACIENTE:
- Nome: ${contexto.paciente_nome || 'Paciente'}
- Tipo: ${contexto.paciente_novo ? 'Novo Paciente (Dê as boas vindas)' : 'Paciente Recorrente (Trate com familiaridade, sem dar boas vindas genéricas)'}.

REGRAS OBRIGATÓRIAS DE CONTEXTO:
1. Você recebe abaixo os DADOS DE CONTEXTO extraídos do CRM. Use EXCLUSIVAMENTE estes dados.
2. NUNCA diga que não tem acesso a consultas se a informação estiver no contexto. 
3. Se a informação não constar no contexto, ofereça transferência para a recepção.

DADOS DE CONTEXTO DO CRM (USE ESTES DADOS PARA RESPONDER):
${JSON.stringify(contexto.dados_crm || {}, null, 2)}

Sua tarefa: Leia a mensagem do usuário e responda de forma natural, amigável e conversacional, aplicando as regras.
`;

        const messages = [
            { role: "system", content: prompt },
            ...(historico || []).map(h => ({ role: h.role, content: h.content })),
            { role: "user", content: mensagem }
        ];

        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: messages,
            temperature: 0.6
        }, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        return "Desculpe, tive um pequeno problema ao formular a resposta agora. Você poderia repetir, por favor?";
    }
}

module.exports = { analisarMensagemNLP, gerarRespostaNatural, transcreverAudio };