const { addMinutes, isBefore, format, startOfDay, endOfDay, parse, addDays, getDay } = require('date-fns');
const { prisma } = require('./db');

function obterDiasTrabalho() {
    return [1, 2, 3, 4, 5, 6]; // Segunda a Sábado
}

function getProximosDiasUteis(qtdDias = 5) {
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

// Aceita dinamicamente o ID de qualquer tipo de profissional
async function getHorariosDisponiveis(dataString, servicoDuracao, barbeiroId = null, profissionalSaudeId = null) {
    const dataEscolhida = parse(dataString, 'dd/MM/yyyy', new Date());
    
    const horaAbertura = 9; 
    const horaFecho = 19;
    const inicioDia = new Date(dataEscolhida.setHours(horaAbertura, 0, 0, 0)); 
    const fimDia = new Date(dataEscolhida.setHours(horaFecho, 0, 0, 0));   

    const agora = new Date();
    let horarioAtual = isBefore(inicioDia, agora) && dataString === format(agora, 'dd/MM/yyyy') ? agora : inicioDia;

    if (horarioAtual.getMinutes() % 30 !== 0) {
        horarioAtual = addMinutes(horarioAtual, 30 - (horarioAtual.getMinutes() % 30));
    }

    const whereClause = {
        dataHora: { gte: startOfDay(dataEscolhida), lte: endOfDay(dataEscolhida) },
        status: 'AGENDADO'
    };
    
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
            const duracaoDoAgendamentoDb = ag.servico ? ag.servico.duracaoMin : (ag.tratamento ? ag.tratamento.duracaoMin : 30);
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