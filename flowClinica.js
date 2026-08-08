const { prisma } = require('./db');
const { sendDelayedText, sendInteractiveMenu, sendDelayedLocation } = require('./botUtils');
const { responderComGroq, extrairNomeComGroq } = require('./groqApi');

const STEPS_CLINICA = {
    MENU_PRINCIPAL: 'MENU_CLINICA',
    PEDIR_NOME: 'PEDIR_NOME_CLINICA',
    MARCAR_CONSULTA_TRATAMENTO: 'CLINICA_TRATAMENTO',
    MARCAR_CONSULTA_MEDICO: 'CLINICA_MEDICO',
    // ... os passos de data e hora reaproveitaremos futuramente os utilitários
};

async function enviarMenuClinica(jid) {
    const textoMenu = `Como podemos cuidar da sua saúde hoje? Selecione uma opção:`;
    await sendInteractiveMenu(null, jid, textoMenu, [
        { id: 'clinica_agendar', title: 'Agendar Consulta', description: 'Ver horários e especialidades' },
        { id: 'clinica_tratamentos', title: 'Tratamentos e Valores', description: 'Lista de procedimentos' },
        { id: 'clinica_duvidas', title: 'Tirar Dúvidas (FAQ)', description: 'Convênios, preparos, etc.' },
        { id: 'clinica_local', title: 'Endereço e Horários', description: 'Onde estamos localizados' },
        { id: 'clinica_humano', title: 'Falar com Atendente', description: 'Urgências e Secretaria' }
    ]);
}

async function handleClinicaMessage(jid, textMessage, displayMessage, senderNumber, cliente, stateMachine, configDb, periodoDia, foraDoExpediente) {
    let userState = stateMachine.get(senderNumber) || { step: STEPS_CLINICA.MENU_PRINCIPAL, data: {} };
    userState.lastActive = Date.now();
    const msgLower = textMessage.trim().toLowerCase();

    // Guardamos tudo no CRM
    const novaMensagem = await prisma.mensagemIA.create({
        data: { role: 'user', content: displayMessage, clienteId: senderNumber }
    });

    // Qualificação do Lead CRM (Sempre que falar algo, garantimos que não está mais como "NOVO" cego)
    if (cliente.leadStatus === 'NOVO') {
        await prisma.cliente.update({ where: { id: senderNumber }, data: { leadStatus: 'EM_CONVERSA' } });
    }

    if (['menu', 'início', 'voltar', '0'].includes(msgLower)) {
        userState.step = STEPS_CLINICA.MENU_PRINCIPAL;
        stateMachine.set(senderNumber, userState);
        await enviarMenuClinica(jid);
        return;
    }

    if (!cliente.nome || cliente.nome === 'Sem Nome') {
        if (userState.step !== STEPS_CLINICA.PEDIR_NOME) {
            userState.step = STEPS_CLINICA.PEDIR_NOME;
            stateMachine.set(senderNumber, userState);
            const msgSaudacao = `${periodoDia}! Bem-vindo à nossa Clínica. Sou o assistente virtual.\nPor favor, digite o seu *Primeiro Nome* para começarmos:`;
            await prisma.mensagemIA.create({ data: { role: 'assistant', content: msgSaudacao, clienteId: senderNumber } });
            await sendDelayedText(null, jid, msgSaudacao);
            return;
        } else {
            const nomeExtraido = await extrairNomeComGroq(textMessage);
            const nomeFinal = nomeExtraido !== 'IGNORAR' ? nomeExtraido : textMessage.split(' ')[0];
            await prisma.cliente.update({ where: { id: senderNumber }, data: { nome: nomeFinal } });
            cliente.nome = nomeFinal;
            userState.step = STEPS_CLINICA.MENU_PRINCIPAL;
            stateMachine.set(senderNumber, userState);
            
            await sendDelayedText(null, jid, `Obrigado, ${nomeFinal}!`);
            await enviarMenuClinica(jid);
            return;
        }
    }

    // Botões globais da Clínica
    const isGlobalBtn = textMessage.startsWith('clinica_');
    if (isGlobalBtn) {
        userState.step = STEPS_CLINICA.MENU_PRINCIPAL;
        stateMachine.set(senderNumber, userState);

        if (textMessage === 'clinica_agendar') {
            await prisma.cliente.update({ where: { id: senderNumber }, data: { interesse: 'Agendamento' } });
            // Aqui integraremos a função de agendamento (similar à barbearia, mas com médicos)
            await sendDelayedText(null, jid, "A iniciar agendamento médico... (Flow em construção)");
        } else if (textMessage === 'clinica_tratamentos') {
            const tratamentos = await prisma.tratamento.findMany();
            let txt = "*Nossos Tratamentos e Valores Básicos:*\n\n";
            tratamentos.forEach(t => txt += `- *${t.nome}*: ${t.preco} MT\n  _${t.descricao}_\n\n`);
            txt += "Digite 'Agendar' para marcar uma consulta, ou 'Menu' para voltar.";
            await sendDelayedText(null, jid, txt);
        } else if (textMessage === 'clinica_local') {
            await sendDelayedText(null, jid, "📍 Nossa clínica fica na Av. Principal, Maputo.\nAtendemos das 08h às 18h.");
            await sendDelayedLocation(jid, -25.9744, 32.5885, "Clínica Saúde", "Av. Principal, Maputo");
        } else if (textMessage === 'clinica_humano') {
            await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true, leadStatus: 'QUALIFICADO' } });
            await sendDelayedText(null, jid, 'A transferir para a recepção da clínica. Aguarde, por favor.\n(Digite *#sair* para cancelar)');
            if (global.io) global.io.emit('atualizar_fila');
        } else if (textMessage === 'clinica_duvidas') {
            await sendDelayedText(null, jid, "Pode fazer a sua pergunta! (Ex: 'Aceitam plano X?', 'Preciso fazer jejum para exame?')");
        }
        return;
    }

    // IA Conversacional restrita para a clínica (Regra rígida contra Diagnósticos)
    const historicoCru = await prisma.mensagemIA.findMany({ where: { clienteId: senderNumber }, orderBy: { criadoEm: 'desc' }, take: 5 });
    const historicoAnterior = historicoCru.filter(msg => msg.id !== novaMensagem.id).reverse();
    
    // Configura o prompt da clínica dinamicamente
    const promptClinica = `
        És o assistente da Clínica. Nome: ${cliente.nome}.
        ${configDb.ignorarDiagnosticos ? 'REGRA MÉDICA ABSOLUTA: NUNCA, SOB HIPÓTESE ALGUMA, dê diagnósticos, sugira remédios ou avalie sintomas. Se o paciente disser que tem dor ou relatar sintomas, responda APENAS: "Por questões de segurança e ética médica, não posso avaliar sintomas por aqui. Por favor, digite /HUMANO para falar com a enfermagem ou /AGENDAR para marcar uma consulta."' : ''}
        
        Se o cliente pedir para marcar, devolva: /AGENDAR
        Falar com recepção: /HUMANO
        Onde fica/Horário: /LOCAL
        Preços: /TRATAMENTOS
        
        Responda dúvidas de forma curta e simpática. Sem formatação complexa.
    `;

    // Aqui usamos o Groq (O GroqApi precisará de uma leve atualização no próximo lote para receber o Prompt Dinâmico, por enquanto passamos no parâmetro infoTemporal)
    const respostaIA = await responderComGroq(textMessage, 0, historicoAnterior, promptClinica, cliente.nome);
    const intent = respostaIA.trim().toUpperCase();

    if (intent.includes('/AGENDAR')) {
        await sendDelayedText(null, jid, "A iniciar agendamento... (Em construção)");
    } else if (intent.includes('/HUMANO')) {
        await prisma.cliente.update({ where: { id: senderNumber }, data: { falarHumano: true, tags: 'triagem_necessaria' } });
        await sendDelayedText(null, jid, 'A transferir para a recepção da clínica. Aguarde.');
        if (global.io) global.io.emit('atualizar_fila');
    } else if (intent.includes('/LOCAL')) {
        await sendDelayedText(null, jid, "📍 Nossa clínica fica na Av. Principal, Maputo.");
    } else if (intent.includes('/TRATAMENTOS')) {
        await sendDelayedText(null, jid, "Selecione 'Tratamentos' no Menu para ver a lista.");
    } else if (intent.includes('/MENU')) {
        await enviarMenuClinica(jid);
    } else {
        await prisma.mensagemIA.create({ data: { role: 'assistant', content: respostaIA, clienteId: senderNumber } });
        await sendDelayedText(null, jid, respostaIA);
    }
}

module.exports = { handleClinicaMessage, STEPS_CLINICA };