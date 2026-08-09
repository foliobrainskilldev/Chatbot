const { addMinutes, isBefore, format, startOfDay, endOfDay, parse, addDays, getDay } = require('date-fns');
const { prisma } = require('./db');

function obterDiasTrabalho() {
    // 1=Segunda a 6=Sábado (Domingo=0)
    return [1, 2, 3, 4, 5, 6]; 
}

function getProximosDiasUteis(qtdDias = 7) {
    const diasPermitidos = obterDiasTrabalho();
    let dias = [];
    let dataAtual = new Date();
    
    while (dias.length < qtdDias) {
        const diaSemana = getDay(dataAtual); 
        if (diasPermitidos.includes(diaSemana)) {
            dias.push(format(dataAtual, 'dd/MM/yyyy'));
        }
        dataAtual = addDays(dataAtual, 1);
    }
    return dias;
}

/**
 * Calcula horários disponíveis no dia, respeitando a duração do tratamento e a agenda dos médicos.
 */
async function getHorariosDisponiveis(dataString, tratamentoDuracaoMinutos, profissionalSaudeId = null) {
    const dataEscolhida = parse(dataString, 'dd/MM/yyyy', new Date());
    
    const horaAbertura = 8; 
    const horaFecho = 18;
    const inicioDia = new Date(dataEscolhida.setHours(horaAbertura, 0, 0, 0)); 
    const fimDia = new Date(dataEscolhida.setHours(horaFecho, 0, 0, 0));   

    const agora = new Date();
    // Impede marcação no passado para o dia atual
    let horarioAtual = isBefore(inicioDia, agora) && dataString === format(agora, 'dd/MM/yyyy') ? agora : inicioDia;

    // Arredonda para o próximo bloco de 30 minutos
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
            
            // Lógica de interseção de horários
            if ((horarioAtual >= inicioAg && horarioAtual < fimAg) || 
                (fimHorarioAtual > inicioAg && fimHorarioAtual <= fimAg) ||
                (horarioAtual <= inicioAg && fimHorarioAtual >= fimAg)) {
                conflito = true;
                break;
            }
        }

        if (!conflito) horariosLivres.push(format(horarioAtual, 'HH:mm'));
        horarioAtual = addMinutes(horarioAtual, 30); // Avança em blocos de 30 min
    }

    return horariosLivres;
}

module.exports = { getProximosDiasUteis, getHorariosDisponiveis };