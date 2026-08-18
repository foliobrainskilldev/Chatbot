const axios = require('axios');

async function transcreverAudio(audioBuffer) {
    const GROQ_API_KEY = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : null;
    if (!GROQ_API_KEY) return "[Áudio recebido, mas sistema de transcrição offline]";

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

        if (!response.ok) throw new Error("Groq Error");
        const data = await response.json();
        return data.text;
    } catch (error) {
        return "[Áudio Recebido - Não foi possível compreender as palavras]";
    }
}

async function analisarMensagemNLP(mensagem, historico, userState, configDb) {
    const GROQ_API_KEY = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : null;
    if (!GROQ_API_KEY) return fallbackNLP(mensagem);

    const fusoHorario = configDb?.fusoHorario || 'Africa/Maputo';
    const formatterDia = new Intl.DateTimeFormat('pt-BR', { timeZone: fusoHorario, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
    const diaDeHoje = formatterDia.format(new Date());

    try {
        const prompt = `
Você é o motor NLU (Natural Language Understanding) de um sistema de Saúde.
Sua tarefa é analisar a ÚLTIMA MENSAGEM DO USUÁRIO e extrair a intenção e entidades de forma precisa.

Intenções possíveis:
- CLINIC_HOURS, CLINIC_LOCATION, CLINIC_CONTACT, CLINIC_PAYMENT_METHODS
- TREATMENT_LIST, TREATMENT_INFO, TREATMENT_PRICE
- BOOK_APPOINTMENT (quer agendar algo genérico ou específico)
- CHECK_UPCOMING_APPOINTMENTS, RESCHEDULE_APPOINTMENT, CANCEL_APPOINTMENT
- HUMAN_TRANSFER (quer falar com atendente), FRUSTRATION (irritado)
- GREETING, GOODBYE
- CONFIRM_APPOINTMENT (sim, confirme), REJECT_APPOINTMENT (não, cancelar)
- REQUEST_MORE_TIMES, REQUEST_MORE_DATES, REQUEST_SPECIFIC_TIME (ex: "tem depois das 10?")
- SELECT_TIME (ex: "às 9h", "14:00")
- SELECT_DATE (ex: "amanhã", "sexta")
- SELECT_TREATMENT (ex: "quero fazer harmonização facial")
- CHANGE_TREATMENT, CHANGE_DATE, CHANGE_TIME
- ASK_DATE_REFERENCE (que dia é hoje?)
- UNKNOWN (não se encaixa em nada ou fugiu do assunto)

REGRAS CRÍTICAS DE CLASSIFICAÇÃO:
1. Se o usuário pedir "menu", "lista de serviços", "quais procedimentos vocês fazem", classifique OBRIGATORIAMENTE como TREATMENT_LIST.
2. Se o usuário perguntar "que horários vocês tem disponível?", "qual o horário de funcionamento?" de forma genérica (sem especificar que quer agendar), classifique OBRIGATORIAMENTE como CLINIC_HOURS.
3. Se o usuário disser múltiplos dados de agendamento de uma vez (ex: "harmonização na sexta as 10h"), extraia TODAS as entidades (treatment, date, time).
4. Converta 'date' OBRIGATORIAMENTE para o formato de STRING "DD/MM/YYYY".
5. Converta 'time' OBRIGATORIAMENTE para o formato de STRING "HH:mm".
6. TODAS as entidades devem ser devolvidas como texto simples (String). NUNCA array ou object.

Estado do usuário no sistema: ${userState?.step || 'IDLE'}

Responda APENAS com este JSON exato:
{
  "intent": "...",
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
        return fallbackNLP(mensagem);
    }
}

function fallbackNLP(mensagem) {
    const msg = mensagem.toLowerCase();
    let intent = "UNKNOWN";
    
    if (msg === "sim" || msg.includes("confirmo") || msg === "ok") intent = "CONFIRM_APPOINTMENT";
    else if (msg === "não" || msg.includes("desisto") || msg.includes("cancela")) intent = "REJECT_APPOINTMENT";
    else if (msg.includes("menu") || msg.includes("serviços") || msg.includes("procedimentos")) intent = "TREATMENT_LIST";
    else if (msg.includes("horário") || msg.includes("funcionamento") || msg.includes("disponível")) intent = "CLINIC_HOURS";
    else if (msg.includes("depois das") || msg.includes("antes das")) intent = "REQUEST_SPECIFIC_TIME";
    else if (msg.includes("agendar") || msg.includes("marcar")) intent = "BOOK_APPOINTMENT";
    else if (msg.includes("humano") || msg.includes("atendente")) intent = "HUMAN_TRANSFER";
    
    return { intent, confidence: 0.6, entities: {} };
}

async function gerarRespostaNatural(mensagem, historico, contexto, configDb) {
    const GROQ_API_KEY = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : null;
    if (!GROQ_API_KEY) return "No momento não consigo consultar meus dados. Pode aguardar um minuto ou falar com um atendente?";

    const moedaGlobal = configDb?.moeda || 'MT';

    try {
        const prompt = `
Você é ${configDb?.nomeAssistente || 'o assistente virtual'} da clínica ${configDb?.nomeClinica || 'Saúde'}.

REGRA ABSOLUTA DE INTEGRIDADE:
1. NUNCA faça mais de uma pergunta na mesma resposta.
2. FOQUE APENAS NA ÚLTIMA MENSAGEM DO USUÁRIO. Ignore completamente o que foi discutido antes se não for relevante agora.
3. A moeda da clínica é ${moedaGlobal}.
4. NUNCA invente preços ou horários que não estejam fornecidos abaixo.
5. NUNCA crie tabelas (markdown com |). Responda sempre em texto corrido, curto, amigável e natural.
6. Se o paciente perguntar algo que não está nos DADOS DA CLÍNICA, diga que não tem essa informação e ofereça falar com um atendente.

DADOS DA CLÍNICA PARA ESTA RESPOSTA:
${JSON.stringify(contexto.dados_crm || {}, null, 2)}

Sua tarefa: Responda APENAS à dúvida atual com base nos dados fornecidos. Se houver um 'aviso_sistema_prioridade' nos DADOS, você deve segui-lo OBRIGATORIAMENTE, colocando-o como a última frase da sua resposta.
`;

        const messages = [
            { role: "system", content: prompt },
            ...(historico || []).slice(-2), 
            { role: "user", content: mensagem }
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
        return "Desculpe, tive uma dificuldade técnica ao gerar a resposta. Pode repetir?";
    }
}

module.exports = { analisarMensagemNLP, gerarRespostaNatural, transcreverAudio };