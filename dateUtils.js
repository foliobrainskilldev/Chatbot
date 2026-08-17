// dateUtils.js
const { addMinutes, format, startOfDay, endOfDay, addDays, getDay, parse } = require('date-fns');
const { prisma } = require('./db');

function obterDiasTrabalhoGlobais() {
    return [1, 2, 3, 4, 5, 6]; 
}

async function getFeriadosBloqueados() {
    try {
        const feriados = await prisma.feriado.findMany();
        return feriados.map(f => format(f.data, 'dd/MM/yyyy'));
    } catch (e) {
        return []; 
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

async function getHorariosDisponiveis(dataString, tratamentoDuracaoMinutos, profissionalSaudeId = null, nicho = 'CLINICA') {
    const configDb = await prisma.configSistema.findFirst();
    const fusoOffset = configDb?.fusoHorario === 'America/Sao_Paulo' ? '-03:00' : '+02:00';
    const clinicTZ = configDb?.fusoHorario || 'Africa/Maputo';

    let horaAbertura = 8; 
    let horaFecho = 18;

    if (profissionalSaudeId) {
        try {
            if (nicho === 'CLINICA') {
                const medico = await prisma.profissionalSaude.findUnique({ where: { id: parseInt(profissionalSaudeId) } });
                if (medico && medico.horaInicioTrabalho) horaAbertura = parseInt(medico.horaInicioTrabalho);
                if (medico && medico.horaFimTrabalho) horaFecho = parseInt(medico.horaFimTrabalho);
            } else {
                const barbeiro = await prisma.barbeiro.findUnique({ where: { id: parseInt(profissionalSaudeId) } });
                // Aqui podemos adicionar lógica específica de horas para barbeiros no futuro
            }
        } catch (e) { console.error("Aviso: Configuração de hora do profissional não encontrada."); }
    }

    // O NLP extrai a data puramente como "DD/MM/YYYY". Montamos a data cravada no fuso.
    const [dia, mes, ano] = dataString.split('/');
    const hrAStr = horaAbertura.toString().padStart(2, '0');
    const hrFStr = horaFecho.toString().padStart(2, '0');
    
    const inicioDia = new Date(`${ano}-${mes}-${dia}T${hrAStr}:00:00${fusoOffset}`);
    const fimDia = new Date(`${ano}-${mes}-${dia}T${hrFStr}:00:00${fusoOffset}`);   

    const agora = new Date();
    let horarioAtual = inicioDia;

    if (inicioDia.getDate() === agora.getDate() && inicioDia.getMonth() === agora.getMonth() && agora > inicioDia) {
        horarioAtual = agora;
        const diff = 30 - (horarioAtual.getMinutes() % 30);
        horarioAtual = new Date(horarioAtual.getTime() + diff * 60000);
        horarioAtual.setSeconds(0, 0);
    }

    const whereClause = {
        dataHora: { 
            gte: new Date(`${ano}-${mes}-${dia}T00:00:00${fusoOffset}`), 
            lte: new Date(`${ano}-${mes}-${dia}T23:59:59${fusoOffset}`) 
        },
        status: { in: ['AGENDADO', 'REMARCADO', 'CONFIRMADA'] }
    };
    
    if (profissionalSaudeId) {
        if (nicho === 'CLINICA') whereClause.profissionalSaudeId = parseInt(profissionalSaudeId);
        else whereClause.barbeiroId = parseInt(profissionalSaudeId);
    }

    const agendamentosDia = await prisma.agendamento.findMany({
        where: whereClause,
        include: { tratamento: true, servico: true }
    });

    const horariosLivres = [];
    const formatterHora = new Intl.DateTimeFormat('pt-BR', { timeZone: clinicTZ, hour: '2-digit', minute: '2-digit', hour12: false });

    while (new Date(horarioAtual.getTime() + tratamentoDuracaoMinutos * 60000) <= fimDia) {
        const fimHorarioAtual = new Date(horarioAtual.getTime() + tratamentoDuracaoMinutos * 60000);
        let conflito = false;

        for (let ag of agendamentosDia) {
            const inicioAg = new Date(ag.dataHora);
            const duracaoDb = ag.tratamento ? ag.tratamento.duracaoMin : (ag.servico ? ag.servico.duracaoMin : 30);
            const fimAg = new Date(inicioAg.getTime() + duracaoDb * 60000);
            
            // Verifica sobreposição estrita
            if ((horarioAtual >= inicioAg && horarioAtual < fimAg) || 
                (fimHorarioAtual > inicioAg && fimHorarioAtual <= fimAg) ||
                (horarioAtual <= inicioAg && fimHorarioAtual >= fimAg)) {
                conflito = true;
                break;
            }
        }

        if (!conflito) {
            horariosLivres.push(formatterHora.format(horarioAtual));
        }
        horarioAtual = new Date(horarioAtual.getTime() + 30 * 60000);
    }

    return horariosLivres;
}

module.exports = { getProximosDiasUteis, getHorariosDisponiveis };