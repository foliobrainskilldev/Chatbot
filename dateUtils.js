const { addMinutes, isBefore, format, startOfDay, endOfDay, parse, isSunday, addDays } = require('date-fns');

function getProximosDiasUteis(qtdDias = 5) {
    let dias = [];
    let dataAtual = new Date();
    while (dias.length < qtdDias) {
        if (!isSunday(dataAtual)) {
            dias.push(format(dataAtual, 'dd/MM/yyyy'));
        }
        dataAtual = addDays(dataAtual, 1);
    }
    return dias;
}

// ATUALIZADO: Suporta barbershop (barbeiroId) e clinica (profissionalSaudeId)
async function getHorariosDisponiveis(prisma, dataString, servicoDuracao, barbeiroId = null, profissionalSaudeId = null) {
    const dataEscolhida = parse(dataString, 'dd/MM/yyyy', new Date());
    const inicioDia = new Date(dataEscolhida.setHours(9, 0, 0, 0)); 
    const fimDia = new Date(dataEscolhida.setHours(19, 0, 0, 0));   

    const agora = new Date();
    let horarioAtual = isBefore(inicioDia, agora) && dataString === format(agora, 'dd/MM/yyyy') 
        ? agora 
        : inicioDia;

    if (horarioAtual.getMinutes() % 15 !== 0) {
        horarioAtual = addMinutes(horarioAtual, 15 - (horarioAtual.getMinutes() % 15));
    }

    const whereClause = {
        dataHora: { gte: startOfDay(dataEscolhida), lte: endOfDay(dataEscolhida) },
        status: 'AGENDADO'
    };
    
    // Filtro dinâmico CRM
    if (barbeiroId) whereClause.barbeiroId = parseInt(barbeiroId);
    if (profissionalSaudeId) whereClause.profissionalSaudeId = parseInt(profissionalSaudeId);

    const agendamentosDia = await prisma.agendamento.findMany({
        where: whereClause,
        include: { servico: true, tratamento: true }
    });

    const horariosLivres = [];

    while (addMinutes(horarioAtual, servicoDuracao) <= fimDia) {
        const fimHorarioAtual = addMinutes(horarioAtual, servicoDuracao);
        let conflito = false;

        for (let ag of agendamentosDia) {
            const inicioAg = ag.dataHora;
            // Verifica a duração baseada no modo ativo
            const duracaoDoAgendamentoDb = ag.servico ? ag.servico.duracaoMin : (ag.tratamento ? ag.tratamento.duracaoMin : 30);
            const fimAg = addMinutes(inicioAg, duracaoDoAgendamentoDb);
            
            if ((horarioAtual >= inicioAg && horarioAtual < fimAg) || 
                (fimHorarioAtual > inicioAg && fimHorarioAtual <= fimAg) ||
                (horarioAtual <= inicioAg && fimHorarioAtual >= fimAg)) {
                conflito = true;
                break;
            }
        }

        if (!conflito) {
            horariosLivres.push(format(horarioAtual, 'HH:mm'));
        }
        
        horarioAtual = addMinutes(horarioAtual, 30); 
    }

    return horariosLivres;
}

module.exports = { getProximosDiasUteis, getHorariosDisponiveis };