const { subDays, addDays } = require('date-fns');

// Estado mantido exclusivamente na Memória RAM (Mais seguro e à prova de falhas no Render)
let demoState = {
    active: false,
    scenario: 'ODONTO',
    data: null
};

function generateMockData(scenario) {
    const data = {
        leads: [],
        agendamentos: [],
        tratamentos: [],
        equipe: [],
        mensagens: []
    };

    // 1. Equipe Fictícia
    data.equipe = [
        { id: 1, nome: "Dra. Carolina Silva", funcao: "PROFISSIONAL", status: "ONLINE", email: "carolina@demo.com" },
        { id: 2, nome: "Dr. Marcos Rocha", funcao: "PROFISSIONAL", status: "ONLINE", email: "marcos@demo.com" },
        { id: 3, nome: "Ana Atendente", funcao: "ATENDENTE", status: "ONLINE", email: "ana@demo.com" }
    ];

    // 2. Tratamentos por Cenário
    if (scenario === 'ODONTO') {
        data.tratamentos = [
            { id: 1, nome: "Clareamento a Laser", categoria: "Estética", preco: 800, duracaoMin: 60, podeAgendarIA: true, status: "ATIVO" },
            { id: 2, nome: "Implante Dentário", categoria: "Cirurgia", preco: 3500, duracaoMin: 120, podeAgendarIA: true, status: "ATIVO" },
            { id: 3, nome: "Limpeza (Profilaxia)", categoria: "Geral", preco: 250, duracaoMin: 45, podeAgendarIA: true, status: "ATIVO" }
        ];
    } else if (scenario === 'ESTETICA') {
        data.tratamentos = [
            { id: 1, nome: "Aplicação de Botox", categoria: "Facial", preco: 1200, duracaoMin: 45, podeAgendarIA: true, status: "ATIVO" },
            { id: 2, nome: "Preenchimento Labial", categoria: "Facial", preco: 1500, duracaoMin: 60, podeAgendarIA: true, status: "ATIVO" },
            { id: 3, nome: "Limpeza de Pele Profunda", categoria: "Estética", preco: 200, duracaoMin: 60, podeAgendarIA: true, status: "ATIVO" }
        ];
    } else {
        data.tratamentos = [
            { id: 1, nome: "Consulta Clínica Geral", categoria: "Consulta", preco: 300, duracaoMin: 30, podeAgendarIA: true, status: "ATIVO" },
            { id: 2, nome: "Consulta Dermatologia", categoria: "Especialidade", preco: 400, duracaoMin: 40, podeAgendarIA: true, status: "ATIVO" },
            { id: 3, nome: "Check-up Completo", categoria: "Exames", preco: 850, duracaoMin: 90, podeAgendarIA: true, status: "ATIVO" }
        ];
    }

    // 3. Leads Fictícios
    const nomes = ["Mariana Costa", "Pedro Alves", "Fernanda Lima", "João Santos", "Beatriz Gomes", "Lucas Rocha", "Juliana Ribeiro", "Rafael Martins", "Camila Sousa", "Diego Carvalho"];
    const statusFunil = ['NOVO', 'EM_CONVERSA', 'QUALIFICADO', 'AGENDADO', 'CLIENTE', 'PERDIDO'];
    const origens = ['WhatsApp Meta', 'Instagram', 'Indicação'];

    for (let i = 1; i <= 50; i++) {
        const isFalarHumano = Math.random() > 0.8;
        const randomStatus = statusFunil[Math.floor(Math.random() * statusFunil.length)];
        
        data.leads.push({
            id: `+25884${Math.floor(Math.random() * 9000000) + 1000000}`,
            nome: nomes[i % nomes.length] + ` ${i}`,
            leadStatus: isFalarHumano ? 'EM_CONVERSA' : randomStatus,
            origem: origens[Math.floor(Math.random() * origens.length)],
            falarHumano: isFalarHumano,
            tags: Math.random() > 0.5 ? "VIP, Retorno" : "",
            valorPotencial: Math.floor(Math.random() * 2000),
            responsavelId: Math.random() > 0.5 ? 3 : null,
            criadoEm: subDays(new Date(), Math.floor(Math.random() * 30)).toISOString(),
            ultimaInteracao: subDays(new Date(), Math.floor(Math.random() * 2)).toISOString()
        });
    }

    // 4. Agendamentos Fictícios
    for (let i = 1; i <= 20; i++) {
        const lead = data.leads[i];
        const trat = data.tratamentos[i % data.tratamentos.length];
        const isFuturo = Math.random() > 0.5;
        const dataHora = isFuturo ? addDays(new Date(), Math.floor(Math.random() * 7)) : subDays(new Date(), Math.floor(Math.random() * 7));
        
        data.agendamentos.push({
            id: i,
            clienteId: lead.id,
            cliente: lead,
            tratamentoId: trat.id,
            tratamento: trat,
            profissionalSaudeId: 1,
            profissionalSaude: data.equipe[0],
            dataHora: dataHora.toISOString(),
            status: isFuturo ? 'AGENDADO' : 'REALIZADA'
        });
    }

    // 5. Mensagens Fake
    data.mensagens = [
        { role: 'user', content: 'Olá, gostaria de saber os preços.', criadoEm: new Date().toISOString() },
        { role: 'assistant', content: 'Olá! Claro, nossos preços variam conforme avaliação. Deseja agendar?', atendenteHumano: false, criadoEm: new Date().toISOString() }
    ];

    demoState.data = data;
}

// Controladores Exportados
exports.getStatus = (req, res) => res.json({ active: demoState.active, scenario: demoState.scenario });

exports.toggleStatus = (req, res) => {
    try {
        const { active, scenario } = req.body;
        console.log(`[DEMO SERVICE] Pedido de ativação: ${active}, Cenário: ${scenario}`);
        
        demoState.active = active;
        if (scenario) demoState.scenario = scenario;
        
        if (active) {
            generateMockData(demoState.scenario);
        }
        
        res.status(200).json({ success: true, message: `Modo demonstração ${active ? 'ativado' : 'desativado'}.` });
    } catch (error) {
        console.error("[DEMO SERVICE] Erro ao gerar dados:", error);
        res.status(500).json({ error: "Erro interno do servidor ao gerar dados falsos. Detalhe: " + error.message });
    }
};

exports.resetData = (req, res) => {
    try {
        generateMockData(demoState.scenario);
        res.status(200).json({ success: true, message: "Dados fictícios restaurados com sucesso." });
    } catch (error) {
        res.status(500).json({ error: "Erro ao resetar demonstração." });
    }
};

exports.isDemoActive = () => demoState.active;

// MIDDLEWARE: Intercepta rotas e devolve os dados da RAM
exports.middleware = (req, res, next) => {
    if (!demoState.active || !demoState.data) return next();

    const method = req.method;
    const path = req.path;

    if (method === 'GET') {
        if (path === '/dashboard/stats') {
            return res.json({
                kpis: { conversasTotais: 142, novosLeads: 50, leadsQualificados: 28, agendamentosTotais: 20, taxaConversao: 40.5, consultasHoje: 4, pendentesHoje: 2 },
                agendamentosHoje: demoState.data.agendamentos.slice(0, 4),
                leadsRecentes: demoState.data.leads.slice(0, 5),
                atencaoNecessaria: demoState.data.leads.filter(l => l.falarHumano).map(l => ({ clienteId: l.id, clienteNome: l.nome, motivo: 'Aguardando Atendimento' })),
                desempenhoIA: { conversasIA: 142, transferidas: 5, resolvidas: 137, taxaResolucao: 96.4 },
                graficos: {
                    funil: [
                        { etapa: 'Conversas', valor: 142 }, { etapa: 'Novos', valor: 50 }, { etapa: 'Qualificados', valor: 28 }, { etapa: 'Agendados', valor: 20 }, { etapa: 'Clientes', valor: 15 }
                    ],
                    servicos: demoState.data.tratamentos.map(t => ({ nome: t.nome, count: Math.floor(Math.random() * 15) + 5 })),
                    origens: [{ origem: 'WhatsApp Meta', count: 30 }, { origem: 'Instagram', count: 15 }, { origem: 'Indicação', count: 5 }],
                    evolucao: [{ data: '01/08', leads: 5, agendamentos: 2 }, { data: '02/08', leads: 8, agendamentos: 4 }, { data: '03/08', leads: 12, agendamentos: 6 }]
                }
            });
        }
        if (path === '/leads') return res.json({ data: demoState.data.leads, pagination: { total: 50, page: 1, limit: 200, totalPages: 1 } });
        if (path === '/agendamentos/todos') return res.json({ data: demoState.data.agendamentos, stats: { hoje: 4, confirmadas: 8, pendentes: 2, canceladas: 1, realizadas: 9, faltas: 0 } });
        if (path === '/tratamentos') return res.json(demoState.data.tratamentos);
        if (path === '/equipe') return res.json(demoState.data.equipe);
        if (path === '/conversas/pendentes') return res.json(demoState.data.leads.filter(l => l.falarHumano));
        if (path.match(/\/conversas\/.*\/notas/)) return res.json([]);
        if (path.match(/\/conversas\/.*/)) return res.json(demoState.data.mensagens);
        if (path === '/relatorios/geral') return res.json({ cards: { conversas: { total: 150, novas: 50, resolvidas: 100 }, leads: { novos: 50, qualificados: 30, convertidos: 15 }, agendamentos: { solicitados: 25, confirmados: 20, realizados: 15, cancelados: 2, faltas: 3 }, conversao: { qualificacao: 60, agendamento: 80, comparecimento: 90, final: 30 } }, ia: { atendidas: 150, resolvidas: 140, transferidas: 10, taxaResolucao: 93, agendamentos: 20 }, funil: [], origens: [], tratamentos: [], evolucao: [] });
        
        return res.json([]); 
    }

    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
        if (path.includes('/leads/') && path.includes('/status') && method === 'PUT') {
            const id = req.path.split('/')[2];
            const lead = demoState.data.leads.find(l => l.id === id);
            if (lead) {
                if (req.body.status) lead.leadStatus = req.body.status;
                if (req.body.tags !== undefined) lead.tags = req.body.tags;
            }
        }
        return res.json({ success: true, message: "Ação simulada com sucesso no Modo Demonstração.", id: Date.now() });
    }

    next();
};