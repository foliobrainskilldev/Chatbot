const { addMinutes, isBefore, format, startOfDay, endOfDay, parse, addDays, getDay } = require('date-fns');
const { prisma } = require('./db');

function obterDiasTrabalhoGlobais() {
    // 1=Segunda a 6=Sábado (Domingo=0). Pode ser movido para o banco no futuro.
    return [1, 2, 3, 4, 5, 6]; 
}

async function getFeriadosBloqueados() {
    try {
        // Tenta buscar na tabela Feriado. Se não existir no schema atual, ignora.
        const feriados = await prisma.feriado.findMany();
        return feriados.map(f => format(f.data, 'dd/MM/yyyy'));
    } catch (e) {
        return []; // Tabela inexistente, retorna array vazio (fallback seguro)
    }
}

async function getProximosDiasUteis(qtdDias = 7) {
    const diasPermitidos = obterDiasTrabalhoGlobais();
    const feriados = await getFeriadosBloqueados();
    let dias = [];
    let dataAtual = new Date();
    
    while (dias.length < qtdDias) {
        const diaSemana = getDay(dataAtual); 
        const dataFormatada = format(dataAtual, 'dd/MM/yyyy');
        
        if (diasPermitidos.includes(diaSemana) && !feriados.includes(dataFormatada)) {
            dias.push(dataFormatada);
        }
        dataAtual = addDays(dataAtual, 1);
    }
    return dias;
}

async function getHorariosDisponiveis(dataString, tratamentoDuracaoMinutos, profissionalSaudeId = null) {
    const dataEscolhida = parse(dataString, 'dd/MM/yyyy', new Date());
    
    let horaAbertura = 8; 
    let horaFecho = 18;

    // Se houver um médico específico, busca a agenda dele no banco
    if (profissionalSaudeId) {
        try {
            const medico = await prisma.profissionalSaude.findUnique({ where: { id: parseInt(profissionalSaudeId) } });
            if (medico && medico.horaInicioTrabalho) horaAbertura = parseInt(medico.horaInicioTrabalho);
            if (medico && medico.horaFimTrabalho) horaFecho = parseInt(medico.horaFimTrabalho);
        } catch (e) { console.error("Aviso: Configuração de hora do médico não encontrada."); }
    }

    const inicioDia = new Date(dataEscolhida.setHours(horaAbertura, 0, 0, 0)); 
    const fimDia = new Date(dataEscolhida.setHours(horaFecho, 0, 0, 0));   

    const agora = new Date();
    let horarioAtual = isBefore(inicioDia, agora) && dataString === format(agora, 'dd/MM/yyyy') ? agora : inicioDia;

    if (horarioAtual.getMinutes() % 30 !== 0) {
        horarioAtual = addMinutes(horarioAtual, 30 - (horarioAtual.getMinutes() % 30));
    }

    const whereClause = {
        dataHora: { gte: startOfDay(dataEscolhida), lte: endOfDay(dataEscolhida) },
        status: { in: ['AGENDADO', 'REMARCADO'] }
    };
    
    if (profissionalSaudeId) whereClause.profissionalSaudeId = parseInt(profissionalSaudeId);

    const agendamentosDia = await prisma.agendamento.findMany({
        where: whereClause,
        include: { tratamento: true }
    });

    const horariosLivres = [];

    while (addMinutes(horarioAtual, tratamentoDuracaoMinutos) <= fimDia) {
        const fimHorarioAtual = addMinutes(horarioAtual, tratamentoDuracaoMinutos);
        let conflito = false;

        for (let ag of agendamentosDia) {
            const inicioAg = ag.dataHora;
            const duracaoDoAgendamentoDb = ag.tratamento ? ag.tratamento.duracaoMin : 30;
            const fimAg = addMinutes(inicioAg, duracaoDoAgendamentoDb);
            
            if ((horarioAtual >= inicioAg && horarioAtual < fimAg) || 
                (fimHorarioAtual > inicioAg && fimHorarioAtual <= fimAg) ||
                (horarioAtual <= inicioAg && fimHorarioAtual >= fimAg)) {
                conflito = true;
                break;
            }
        }

        if (!conflito) horariosLivres.push(format(horarioAtual, 'HH:mm'));
        horarioAtual = addMinutes(horarioAtual, 30);
    }

    return horariosLivres;
}

module.exports = { getProximosDiasUteis, getHorariosDisponiveis };