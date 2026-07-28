const { addMinutes, isBefore, format, startOfDay, endOfDay, parse, isSunday, addDays } = require('date-fns');

// Retorna os próximos dias úteis (ignora Domingos)
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

// Verifica e retorna horários livres com base na duração do serviço
async function getHorariosDisponiveis(prisma, dataString, servicoDuracao, barbeiroId) {
    const dataEscolhida = parse(dataString, 'dd/MM/yyyy', new Date());
    const inicioDia = new Date(dataEscolhida.setHours(9, 0, 0, 0)); // Abre às 09h
    const fimDia = new Date(dataEscolhida.setHours(19, 0, 0, 0));   // Fecha às 19h

    const agora = new Date();
    // Se a data for hoje, o horário inicial é agora (não pode agendar no passado)
    let horarioAtual = isBefore(inicioDia, agora) && dataString === format(agora, 'dd/MM/yyyy') 
        ? agora 
        : inicioDia;

    // Arredonda para o próximo intervalo de 15 minutos
    if (horarioAtual.getMinutes() % 15 !== 0) {
        horarioAtual = addMinutes(horarioAtual, 15 - (horarioAtual.getMinutes() % 15));
    }

    // Busca agendamentos ocupados no dia
    const whereClause = {
        dataHora: { gte: startOfDay(dataEscolhida), lte: endOfDay(dataEscolhida) },
        status: 'AGENDADO'
    };
    if (barbeiroId) whereClause.barbeiroId = parseInt(barbeiroId);

    const agendamentosDia = await prisma.agendamento.findMany({
        where: whereClause,
        include: { servico: true }
    });

    const horariosLivres = [];

    while (addMinutes(horarioAtual, servicoDuracao) <= fimDia) {
        const fimHorarioAtual = addMinutes(horarioAtual, servicoDuracao);
        let conflito = false;

        for (let ag of agendamentosDia) {
            const inicioAg = ag.dataHora;
            const fimAg = addMinutes(inicioAg, ag.servico.duracaoMin);
            
            // Verifica se os horários se sobrepõem
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
        
        // Pula de 30 em 30 min para não gerar uma lista enorme
        horarioAtual = addMinutes(horarioAtual, 30); 
    }

    return horariosLivres;
}

module.exports = { getProximosDiasUteis, getHorariosDisponiveis };