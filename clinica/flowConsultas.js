const { prisma } = require('../db');
const aiService = require('../aiService');
const whatsappService = require('../whatsappService');
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
            await whatsappService.sendInteractiveMenu(jid, "Voltando ao nosso agendamento... deseja continuar com a sua reserva?", [
                { id: 'cmd_agendar', title: 'Continuar agendamento' },
                { id: 'cmd_cancelar_fluxo', title: 'Cancelar' }
            ]);
        }
        return;
    }

    if (intent === 'TREATMENT_LIST') {
        const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO', podeAgendarIA: true }});
        if (tratamentos.length > 0) {
            const rows = tratamentos.slice(0, 10).map(t => ({
                id: `trat_${t.id}`, title: t.nome.substring(0, 24), description: t.preco ? `Valor: ${formatarMoeda(t.preco, moedaGlobal)}` : 'Consulte valor'
            }));
            await whatsappService.sendInteractiveList(jid, "Aqui está o nosso menu de procedimentos disponíveis:", "Ver Menu", [{ title: "Tratamentos", rows: rows }]);
        } else {
            await whatsappService.sendText(jid, "No momento não temos procedimentos cadastrados no catálogo automático.");
        }
        
        if (userState && userState.step.startsWith('AGENDAMENTO_')) {
            await whatsappService.sendText(jid, "Qual procedimento você deseja realizar para continuarmos o seu agendamento?");
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
        if (intent === 'UNKNOWN') {
            dadosCrmContexto.aviso_sistema_prioridade = "Você não conseguiu classificar a última mensagem. Peça desculpas gentilmente e pergunte em que pode ajudar.";
        }
    }

    if (userState && userState.step.startsWith('AGENDAMENTO_')) {
        let passoFaltante = "continuar com o agendamento";
        if (userState.step === 'AGENDAMENTO_COLLECTING_TREATMENT') passoFaltante = "Qual procedimento você deseja realizar?";
        if (userState.step === 'AGENDAMENTO_COLLECTING_PROFESSIONAL') passoFaltante = "Você tem preferência por algum profissional específico?";
        if (userState.step === 'AGENDAMENTO_COLLECTING_DATE') passoFaltante = "Para qual data você quer agendar?";
        if (userState.step === 'AGENDAMENTO_AWAITING_TIME') passoFaltante = "Qual o melhor horário para você?";
        
        dadosCrmContexto.aviso_sistema_prioridade = `O paciente está no meio de um agendamento. Responda à dúvida dele de forma muito rápida e direta e, no final, retome o controle fazendo EXATAMENTE esta pergunta para não prendê-lo no sistema: "${passoFaltante}"`;
    }

    const contextoIA = { paciente_nome: cliente.nome || 'Paciente', dados_crm: dadosCrmContexto };
    const respostaIA = await aiService.gerarRespostaNatural(textoProcessado, historico, contextoIA, configDb);
    
    await prisma.mensagemIA.create({ data: { role: 'assistant', content: respostaIA, clienteId: senderNumber } });
    await whatsappService.sendText(jid, respostaIA);
}

module.exports = { processarDuvidas };