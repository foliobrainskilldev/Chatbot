const cron = require('node-cron');
const { prisma } = require('./db');
const whatsappService = require('./whatsappService');
const aiService = require('./aiService');
const { format, subDays, startOfDay, endOfDay } = require('date-fns');

// Importa os estados dos dois motores para verificar abandonos de funil
const botBarbearia = require('./barbearia/botEngine');
const botClinica = require('./clinica/botEngine');

const lembretesEnviados = new Set(); 
const avaliacoesEnviadas = new Set();

function iniciarAutomaçoes() {
    console.log('⏰ Robôs de Automação (Multi-Tenant) ativados.');

    // 1. FOLLOW-UP AUTOMÁTICO (Verifica ambos os nichos)
    cron.schedule('*/5 * * * *', async () => {
        const config = await prisma.configSistema.findFirst();
        if (!config || !config.autoFollowUp) return;

        const agora = Date.now();
        const verificarAbandono = async (stateMachine) => {
            for (let [numero, state] of stateMachine.entries()) {
                if (state.step && state.step.includes('AGENDAMENTO_') && !state.step.includes('CONFIRMAR')) {
                    const tempoParado = agora - (state.lastActive || agora);
                    if (tempoParado > 15 * 60 * 1000 && !state.notified) {
                        state.notified = true; 
                        const clienteDb = await prisma.cliente.findUnique({ where: { id: numero } });
                        const prompt = `O cliente ${clienteDb?.nome || 'Amigo'} parou de agendar há 15min. Pergunte de forma curta se precisa de ajuda.`;
                        const txt = await aiService.gerarMensagemNotificacaoIA(prompt, "Notei que você não terminou de agendar. Posso ajudar?");
                        await whatsappService.sendText(numero, txt, false);
                    }
                }
            }
        };

        if (config.modoAtivo === 'BARBEARIA') await verificarAbandono(botBarbearia.stateMachine);
        if (config.modoAtivo === 'CLINICA') await verificarAbandono(botClinica.stateMachine);
    });

    // 2. LEMBRETE DE COMPROMISSO (Independente do Nicho)
    cron.schedule('*/15 * * * *', async () => {
        const config = await prisma.configSistema.findFirst();
        if (!config || !config.autoLembrete) return;

        const agora = new Date();
        const duasHorasFrente = new Date(agora.getTime() + 2 * 60 * 60 * 1000);
        
        try {
            const agendamentos = await prisma.agendamento.findMany({
                where: { status: 'AGENDADO', dataHora: { gte: agora, lte: duasHorasFrente } },
                include: { servico: true, tratamento: true, cliente: true }
            });

            for (let ag of agendamentos) {
                if (!lembretesEnviados.has(ag.id)) {
                    lembretesEnviados.add(ag.id);
                    // Dinâmico: Verifica se é Clínica ou Barbearia
                    const nomeSrv = ag.servico ? ag.servico.nome : (ag.tratamento ? ag.tratamento.nome : 'compromisso');
                    const tipo = ag.servico ? 'seu serviço de' : 'sua consulta de';
                    
                    const prompt = `Gere um lembrete curto. Cliente ${ag.cliente.nome || ''} tem ${tipo} ${nomeSrv} hoje às ${format(ag.dataHora, 'HH:mm')}.`;
                    const txt = await aiService.gerarMensagemNotificacaoIA(prompt, `Lembrete: Seu horário para ${nomeSrv} é hoje às ${format(ag.dataHora, 'HH:mm')}.`);
                    await whatsappService.sendText(ag.clienteId, txt, false);
                }
            }
        } catch (erro) { }
    });

    // 3. AVALIAÇÃO DE ATENDIMENTO
    cron.schedule('0 10 * * *', async () => {
        const ontem = subDays(new Date(), 1);
        try {
            const agendamentosOntem = await prisma.agendamento.findMany({
                where: { status: 'CONCLUIDO', dataHora: { gte: startOfDay(ontem), lte: endOfDay(ontem) } },
                include: { cliente: true }
            });
            for (let ag of agendamentosOntem) {
                if (!avaliacoesEnviadas.has(ag.id)) {
                    avaliacoesEnviadas.add(ag.id);
                    await prisma.agendamento.update({ where: { id: ag.id }, data: { status: 'AVALIADO' } });
                    await whatsappService.sendText(ag.clienteId, `Olá ${ag.cliente.nome || ''}! Como você avalia a sua experiência conosco ontem? (De 1 a 5) ⭐`, false);
                }
            }
        } catch (erro) {}
    }, { timezone: "Africa/Maputo" });
}

module.exports = { iniciarAutomaçoes };