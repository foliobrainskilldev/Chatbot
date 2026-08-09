const { addMinutes, isBefore, format, startOfDay, endOfDay, parse, isSunday, addDays, getDay } = require('date-fns');
const { prisma } = require('./db');

// Lê configurações de trabalho do painel ou assume padrão
function obterDiasTrabalho() {
    return [1, 2, 3, 4, 5, 6]; // Padrão: Segunda a Sábado
}

// Retorna os próximos dias úteis limitados pela configuração de dias de trabalho
function getProximosDiasUteis(qtdDias = 5) {
    const diasPermitidos = obterDiasTrabalho();
    let dias = [];
    let dataAtual = new Date();
    
    while (dias.length < qtdDias) {
        const diaSemana = getDay(dataAtual); 
        // Apenas adiciona se for um dia em que a empresa trabalha
        if (diasPermitidos.includes(diaSemana)) {
            dias.push(format(dataAtual, 'dd/MM/yyyy'));
        }
        dataAtual = addDays(dataAtual, 1);
    }
    return dias;
}

// Otimizado para Produção: Calcula espaços vazios entre horários preenchidos
async function getHorariosDisponiveis(dataString, servicoDuracao, barbeiroId = null, profissionalSaudeId = null) {
    const dataEscolhida = parse(dataString, 'dd/MM/yyyy', new Date());
    
    // Busca do banco a hora de abertura e fecho (ou aplica default Moçambique 09h - 19h)
    const configDb = await prisma.configSistema.findFirst();
    const horaAbertura = 9; 
    const horaFecho = 19;

    const inicioDia = new Date(dataEscolhida.setHours(horaAbertura, 0, 0, 0)); 
    const fimDia = new Date(dataEscolhida.setHours(horaFecho, 0, 0, 0));   

    // Em produção, temos que garantir que não marcamos no passado
    const agora = new Date();
    let horarioAtual = isBefore(inicioDia, agora) && dataString === format(agora, 'dd/MM/yyyy') 
        ? agora 
        : inicioDia;

    // Arredonda para os próximos 15/30 minutos
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

    // Loop que percorre os blocos do dia
    while (addMinutes(horarioAtual, servicoDuracao) <= fimDia) {
        const fimHorarioAtual = addMinutes(horarioAtual, servicoDuracao);
        let conflito = false;

        for (let ag of agendamentosDia) {
            const inicioAg = ag.dataHora;
            const duracaoDoAgendamentoDb = ag.servico ? ag.servico.duracaoMin : (ag.tratamento ? ag.tratamento.duracaoMin : 30);
            const fimAg = addMinutes(inicioAg, duracaoDoAgendamentoDb);
            
            // Verifica sobreposição de horários
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
        
        // Pulo de 30 em 30 minutos na interface
        horarioAtual = addMinutes(horarioAtual, 30); 
    }

    return horariosLivres;
}

module.exports = { 
    getProximosDiasUteis, 
    getHorariosDisponiveis 
};