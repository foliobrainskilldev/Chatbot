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

    // AÇÃO ESTRITAMENTE DETERMINÍSTICA: Consultar as próprias consultas
    if (intent === 'CHECK_UPCOMING_APPOINTMENTS' || intent === 'CHECK_PAST_APPOINTMENTS') {
        const agendamentos = await prisma.agendamento.findMany({
            where: { clienteId: senderNumber, status: { in: ['AGENDADO', 'CONFIRMADA'] }, dataHora: { gte: new Date() } },
            include: { tratamento: true, profissionalSaude: true },
            orderBy: { dataHora: 'asc' }
        });

        if (agendamentos.length === 0) {
            await whatsappService.sendText(jid, "Você não possui nenhuma consulta futura marcada no sistema.");
        } else {
            let texto = "📅 *SUAS PRÓXIMAS CONSULTAS:*\n\n";
            agendamentos.forEach((ag, index) => {
                const nomeProf = ag.profissionalSaude ? ag.profissionalSaude.nome : 'Equipe Médica';
                const tratNome = ag.tratamento ? ag.tratamento.nome : 'Consulta';
                texto += `*${index + 1}. ${tratNome}*\n`;
                texto += `🕑 ${format(ag.dataHora, "dd/MM/yyyy 'às' HH:mm")}\n`;
                texto += `👨‍⚕️ Profissional: ${nomeProf}\n\n`;
            });
            await whatsappService.sendText(jid, texto.trim());
        }

        if (userState && userState.step.startsWith('AGENDAMENTO_')) {
            await whatsappService.sendInteractiveMenu(jid, "Voltando ao nosso agendamento... deseja continuar de onde paramos?", [
                { id: 'cmd_agendar', title: 'Continuar agendamento' },
                { id: 'cmd_cancelar_fluxo', title: 'Cancelar' }
            ]);
        }
        return;
    }

    // AÇÃO DE DÚVIDA ORGÂNICA OU FALHA DE ENTENDIMENTO (UNKNOWN)
    const treatmentIntents = ['TREATMENT_PRICE', 'TREATMENT_INFO', 'TREATMENT_DURATION', 'TREATMENT_LIST'];
    const clinicIntents = ['CLINIC_HOURS', 'CLINIC_LOCATION', 'CLINIC_CONTACT', 'CLINIC_PAYMENT_METHODS'];

    if (intent === 'ASK_DATE_REFERENCE') {
        const fuso = configDb?.fusoHorario || 'Africa/Maputo';
        const formatterLongo = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'long', day: 'numeric', month: 'long' });
        const hojeObj = new Date();
        const amanhaObj = new Date(hojeObj.getTime() + 86400000);
        
        dadosCrmContexto.calendario_referencia = {
            hoje: formatterLongo.format(hojeObj),
            amanha: formatterLongo.format(amanhaObj)
        };
        dadosCrmContexto.aviso_sistema_prioridade = "Responda à pergunta do usuário sobre datas ou dias da semana usando EXATAMENTE os dados de 'calendario_referencia' acima. Não invente as datas.";
    } 
    else if (treatmentIntents.includes(intent)) {
        const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO' }});
        const mapearTratamento = (t) => ({
            nome: t.nome, categoria: t.categoria,
            preco: t.preco ? formatarMoeda(t.preco, moedaGlobal) : 'Sob Avaliação',
            informacoes_adicionais: t.informacoesIA
        });

        if (nlpResult?.entities?.treatment && intent !== 'TREATMENT_LIST') {
            const search = nlpResult.entities.treatment.toLowerCase();
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
        // UNKNOWN ou intenção solta
        dadosCrmContexto.dados_basicos = { nome_clinica: configDb?.nomeClinica || "Clínica", faq: configDb?.faq || "" };
        if (intent === 'UNKNOWN') {
            dadosCrmContexto.aviso_sistema_prioridade = "Você não entendeu a última mensagem do paciente. Peça desculpas educadamente e seja bem rápido nisso.";
        }
    }

    // A MÁGICA DA CONTEXT BRIDGE (Lembrar a IA do estado atual da conversa sem perder os dados da reserva)
    if (userState && userState.step.startsWith('AGENDAMENTO_')) {
        let passoFaltante = "continuar com o agendamento";
        if (userState.step === 'AGENDAMENTO_COLLECTING_TREATMENT') passoFaltante = "qual tratamento o paciente deseja agendar";
        if (userState.step === 'AGENDAMENTO_COLLECTING_PROFESSIONAL') passoFaltante = "se ele tem preferência de profissional";
        if (userState.step === 'AGENDAMENTO_COLLECTING_DATE') passoFaltante = "para qual data o paciente quer a consulta";
        if (userState.step === 'AGENDAMENTO_AWAITING_TIME') passoFaltante = "qual o horário que o paciente prefere";
        
        dadosCrmContexto.aviso_sistema_prioridade = `INSTRUÇÃO CRÍTICA: O paciente está no meio de um agendamento, e você estava aguardando ele informar: ${passoFaltante}. Responda rapidamente à dúvida (ou diga que não entendeu se for o caso) e, OBRIGATORIAMENTE, termine a sua resposta perguntando ${passoFaltante}.`;
    }

    const contextoIA = { paciente_nome: cliente.nome || 'Paciente', dados_crm: dadosCrmContexto };
    const respostaIA = await aiService.gerarRespostaNatural(textoProcessado, historico, contextoIA, configDb);
    
    await prisma.mensagemIA.create({ data: { role: 'assistant', content: respostaIA, clienteId: senderNumber } });
    await whatsappService.sendText(jid, respostaIA);
}

module.exports = { processarDuvidas };