const { OpenAI } = require('openai');

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY || "SEM_CHAVE", 
    baseURL: "https://api.groq.com/openai/v1",
});

async function responderComGroq(mensagemCliente, nomeUserDb, contextAgendamentos = 0, historicoAnterior) {
    
    if (!process.env.GROQ_API_KEY) return "Infelizmente estarei cega momentaneamente, avança pelo menu.";

    // O Cérebro Blindado à Barbearia com Informações vivas deste Cliente de Cada Vez 🎯 : 
    const INSTRUCOES_BLINDADAS_CONTEXTO = `
És Atendente oficial e gentil moçambicano duma incrível Barbearia Moçambique, foca numa língua local e cordial mas educada do Português Moçambicano, 
**ESTADO INCRÍVEL IMPORTANTE ACTUAL**: O Sr com quem tu estás à papear o celular dele regista chamar-se no Meta App : "${nomeUserDb}". Tu conheces pelo nome. Tem "${contextAgendamentos}" marcações ao todo actuais hoje/amanha ou proxima semanas!
**DIRETRIZ DE BLINDAGEM MÁXIMA DA PERSONALIDADE!:** Se o utilizador inventar de falatórios sobre Matemática Básica/Física Cuântica, Saúde Médicas Pessoalidades Forasteiras sem conexos nulas com Serviços Capilares de Uma Clínica da Barba... TU INTERCEPETA-lo de leve!! Retorce pro centro sem medos e gentilmente avisando p/ o seu percurso : Sendo Um AI Robótico restritíssímo treinado pro corte da Tesouraria Barbária só focaremos ai 😂 . (Ex.. 'Chefe só curto barbas me desculpas não to pesco essa não!' algo engraçado assim..)!! Nunca aceita outro temas!.

*Regras da Rotina p: Se ele referenciar marcar, horários vagas ... remate dizendo para lançarem ai na textbox à literal a palavrinha mágica (sem ser entre aspas ok só): "Menu", e as funcionalidades nativa abrem aos utilizadores a janelinhas !

Não cuspas blocos intensos maçadores textuais imensos sem piedades!. Curta E directa. Põe Smiles 😊 e empolgação`;

    try {
        console.log(`🧠 Invocando Motor Pensador da GROQ: (C/ Historico e Lembretes...)`);

        // Nós Empilhamos em Stack as matriz das "Cestas Mensagens Passadas"! Até As Limitamos a 6 Últimas Só, Para manter velocidade Supersónicas! e custos zeros nas API deles se futuramente aplicados!! 
        const constructMessagesFlowEngineLpu = [
            { role: "system", content: INSTRUCOES_BLINDADAS_CONTEXTO }
        ];

        // Varremos p I.A entenderem-se as escritas que tiveram ai atrás
        if (historicoAnterior && historicoAnterior.length > 0) {
            historicoAnterior.forEach(linhaOld => {
                constructMessagesFlowEngineLpu.push({ role: linhaOld.role, content: linhaOld.content });
            });
        }
        constructMessagesFlowEngineLpu.push({ role: "user", content: mensagemCliente });


        const resposta = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant", 
            messages: constructMessagesFlowEngineLpu,
            temperature: 0.5, // Resposta bastante Lógica, Controlada em Restrição e Conservativa Anti Hallucination !
            max_tokens: 300 
        });
        
        return resposta.choices[0].message.content;

    } catch (erro) {
        console.error("❌ ERRO NA CHAMADA GROQ: ", erro?.response?.data || erro.message);
        return "Neste instante exato ocorreu lapso da rede de comunicações. Para segurança digita somente a palavra 'Menu' 🙏🏽";
    }
}

module.exports = { responderComGroq };