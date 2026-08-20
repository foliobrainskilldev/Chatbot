const { prisma } = require('../../db');
const aiService = require('../../aiService');
const whatsappService = require('../../whatsappService');
const { format } = require('date-fns');

function formatarMoeda(valor, moeda) {
    if (!valor) return '';
    const v = parseFloat(valor);
    if (moeda === 'R$') return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (moeda === '$') return `$ ${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${moeda}`;
}

async function processarDuvidas(jid, textoProcessado, senderNumber, userState, nlpResult, configDb, historico, cliente, isNewPatient) {
    let dadosCrmContexto = {};
    const intent = nlpResult?.intent || "UNKNOWN";
    const moedaGlobal = configDb?.moeda || 'MT'; 
    const isEnglish = configDb?.idioma?.includes('Inglês');

    if (intent === 'CHECK_UPCOMING_APPOINTMENTS' || intent === 'CHECK_PAST_APPOINTMENTS') {
        const agendamentos = await prisma.agendamento.findMany({
            where: { clienteId: senderNumber, status: { in: ['AGENDADO', 'CONFIRMADA'] }, dataHora: { gte: new Date() } },
            include: { tratamento: true, profissionalSaude: true },
            orderBy: { dataHora: 'asc' }
        });

        if (agendamentos.length === 0) {
            const msg = isEnglish ? "You have no upcoming appointments scheduled in the system." : "Você não possui nenhuma consulta futura marcada no sistema.";
            await whatsappService.sendText(jid, msg);
        } else {
            let texto = isEnglish ? "📅 *YOUR UPCOMING APPOINTMENTS:*\n\n" : "📅 *SUAS PRÓXIMAS CONSULTAS:*\n\n";
            agendamentos.forEach((ag, index) => {
                const nomeProf = ag.profissionalSaude ? ag.profissionalSaude.nome : (isEnglish ? 'Medical Team' : 'Equipe Médica');
                const tratNome = ag.tratamento ? ag.tratamento.nome : (isEnglish ? 'Appointment' : 'Consulta');
                texto += `*${index + 1}. ${tratNome}*\n`;
                texto += `🕑 ${format(ag.dataHora, isEnglish ? "MM/dd/yyyy 'at' HH:mm" : "dd/MM/yyyy 'às' HH:mm")}\n`;
                texto += `👨‍⚕️ ${isEnglish ? 'Professional' : 'Profissional'}: ${nomeProf}\n\n`;
            });
            await whatsappService.sendText(jid, texto.trim());
        }

        if (userState && userState.step.startsWith('AGENDAMENTO_')) {
            const msg = isEnglish ? "Returning to our booking... do you want to continue with your reservation?" : "Voltando ao nosso agendamento... deseja continuar com a sua reserva?";
            await whatsappService.sendInteractiveMenu(jid, msg, [
                { id: 'cmd_agendar', title: isEnglish ? 'Continue booking' : 'Continuar agendamento' },
                { id: 'cmd_cancelar_fluxo', title: isEnglish ? 'Cancel' : 'Cancelar' }
            ]);
        }
        return;
    }

    if (intent === 'TREATMENT_LIST') {
        const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO', podeAgendarIA: true }});
        if (tratamentos.length > 0) {
            const rows = tratamentos.slice(0, 10).map(t => ({
                id: `trat_${t.id}`, title: t.nome.substring(0, 24), description: t.preco ? `${isEnglish ? 'Price' : 'Valor'}: ${formatarMoeda(t.preco, moedaGlobal)}` : (isEnglish ? 'Consult price' : 'Consulte valor')
            }));
            const intro = isEnglish ? "Here is our menu of available procedures:" : "Aqui está o nosso menu de procedimentos disponíveis:";
            await whatsappService.sendInteractiveList(jid, intro, isEnglish ? "View Menu" : "Ver Menu", [{ title: isEnglish ? "Treatments" : "Tratamentos", rows: rows }]);
        } else {
            const msg = isEnglish ? "At the moment we have no procedures registered in the automatic catalog." : "No momento não temos procedimentos cadastrados no catálogo automático.";
            await whatsappService.sendText(jid, msg);
        }
        
        if (userState && userState.step.startsWith('AGENDAMENTO_')) {
            const msg = isEnglish ? "Which procedure do you want to perform to continue your booking?" : "Qual procedimento você deseja realizar para continuarmos o seu agendamento?";
            await whatsappService.sendText(jid, msg);
        }
        return;
    }

    const treatmentIntents = ['TREATMENT_PRICE', 'TREATMENT_INFO', 'TREATMENT_DURATION'];
    const clinicIntents = ['CLINIC_HOURS', 'CLINIC_LOCATION', 'CLINIC_CONTACT', 'CLINIC_PAYMENT_METHODS'];

    if (intent === 'ASK_DATE_REFERENCE') {
        const fuso = configDb?.fusoHorario || 'Africa/Maputo';
        const formatterLongo = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'long', day: 'numeric', month: 'long' });
        const hojeObj = new Date();
        const amanhaObj = new Date(hojeObj.getTime() + 86400000);
        
        dadosCrmContexto.calendario_referencia = { hoje: formatterLongo.format(hojeObj), amanha: formatterLongo.format(amanhaObj) };
        dadosCrmContexto.aviso_sistema_prioridade = "Responda à pergunta do usuário usando os dados do 'calendario_referencia' acima.";
    } 
    else if (treatmentIntents.includes(intent)) {
        const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO' }});
        const mapearTratamento = (t) => ({
            nome: t.nome, categoria: t.categoria,
            preco: t.preco ? formatarMoeda(t.preco, moedaGlobal) : 'Sob Avaliação',
            informacoes_adicionais: t.informacoesIA
        });

        if (nlpResult?.entities?.treatment) {
            const search = String(nlpResult.entities.treatment).toLowerCase();
            const match = tratamentos.find(t => t.nome.toLowerCase().includes(search));
            dadosCrmContexto.tratamento_solicitado = match ? mapearTratamento(match) : tratamentos.map(mapearTratamento);
        } else {
            dadosCrmContexto.tratamentos_cadastrados_no_catalogo = tratamentos.map(mapearTratamento);
        }
    } 
    else if (clinicIntents.includes(intent)) {
        dadosCrmContexto.dados_operacionais = {
            horarios: configDb?.horarioFuncionamento || "Disponibilidade comercial padrão.",
            endereco: configDb?.endereco || "Endereço principal da clínica.",
            telefone: configDb?.telefone || "",
            faq: configDb?.faq || ""
        };
    } 
    else {
        dadosCrmContexto.dados_basicos = { nome_clinica: configDb?.nomeClinica || "Clínica", faq: configDb?.faq || "" };
    }

    if (userState && userState.step.startsWith('AGENDAMENTO_')) {
        let passoFaltante = "continuar com o agendamento";
        if (userState.step === 'AGENDAMENTO_COLLECTING_TREATMENT') passoFaltante = isEnglish ? "Which procedure do you want to perform?" : "Qual procedimento você deseja realizar?";
        if (userState.step === 'AGENDAMENTO_COLLECTING_PROFESSIONAL') passoFaltante = isEnglish ? "Do you have a preference for a specific professional?" : "Você tem preferência por algum profissional específico?";
        if (userState.step === 'AGENDAMENTO_COLLECTING_DATE') passoFaltante = isEnglish ? "For which date do you want to book?" : "Para qual data você quer agendar?";
        if (userState.step === 'AGENDAMENTO_AWAITING_TIME') passoFaltante = isEnglish ? "What is the best time for you?" : "Qual o melhor horário para você?";
        
        dadosCrmContexto.aviso_sistema_prioridade = isEnglish 
            ? `The patient is in the middle of a booking. Answer their question very quickly and directly, and at the end, take back control by asking EXACTLY this question so they don't get stuck: "${passoFaltante}"`
            : `O paciente está no meio de um agendamento. Responda à dúvida dele de forma muito rápida e direta e, no final, retome o controle fazendo EXATAMENTE esta pergunta para não prendê-lo no sistema: "${passoFaltante}"`;
    }

    const contextoIA = { paciente_nome: cliente.nome || 'Paciente', dados_crm: dadosCrmContexto };
    const respostaIA = await aiService.gerarRespostaNatural(textoProcessado, historico, contextoIA, configDb);
    
    await prisma.mensagemIA.create({ data: { role: 'assistant', content: respostaIA, clienteId: senderNumber } });
    await whatsappService.sendText(jid, respostaIA);
}

module.exports = { processarDuvidas };