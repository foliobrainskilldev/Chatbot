const { prisma } = require('../../db');
const whatsappService = require('../../whatsappService');
const supabaseService = require('../../services/supabaseService'); 
const automationEngine = require('../../services/automationEngine');
const webhookService = require('../../services/webhookService');
const aiService = require('../../aiService');

exports.getConversasPendentes = async (req, res) => {
    try {
        const pendentes = await prisma.cliente.findMany({ orderBy: { ultimaInteracao: 'desc' }, take: 50 });
        res.status(200).json(pendentes);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar caixa de entrada." }); }
};

exports.getMensagensConversa = async (req, res) => {
    try {
        const mensagens = await prisma.mensagemIA.findMany({ where: { clienteId: req.params.clienteId }, orderBy: { criadoEm: 'asc' } });
        res.status(200).json(mensagens);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar mensagens." }); }
};

exports.getNotasInternas = async (req, res) => {
    try {
        const notas = await prisma.notaInterna.findMany({ where: { clienteId: req.params.clienteId }, include: { usuario: true }, orderBy: { criadoEm: 'asc' } });
        res.status(200).json(notas);
    } catch (error) { res.status(500).json({ error: "Erro notas." }); }
};

exports.criarNotaInterna = async (req, res) => {
    try {
        const nota = await prisma.notaInterna.create({ data: { texto: req.body.texto, clienteId: req.params.clienteId, usuarioId: req.body.usuarioId || 1 } });
        res.status(200).json(nota);
    } catch (error) { res.status(500).json({ error: "Erro criar nota." }); }
};

exports.assumirAtendimentoHumano = async (req, res) => {
    try {
        const clienteId = req.params.clienteId;
        const lead = await prisma.cliente.update({ where: { id: clienteId }, data: { falarHumano: true, leadStatus: 'EM_CONVERSA' } });
        
        const msgTexto = `Agora você está falando com um atendente.\nOlá, ${lead.nome || 'paciente'}. A partir deste momento, nossa equipe continuará seu atendimento por aqui.`;
        await whatsappService.sendText(clienteId, msgTexto);
        
        await prisma.mensagemIA.create({
            data: { role: 'assistant', content: `[SISTEMA] ${msgTexto}`, clienteId, atendenteHumano: true }
        });
        
        await prisma.notaInterna.create({
            data: { texto: `Atendimento assumido por humano. Tempo de espera e métricas iniciadas.`, clienteId, usuarioId: 1 }
        });

        await automationEngine.dispararAutomacoes('TRANSFERIDO_HUMANO', lead);
        await webhookService.dispararEvento('lead.updated', lead);
        
        if (global.io) global.io.emit('atualizar_fila');
        res.status(200).json({ message: "Atendimento humano assumido com sucesso." });
    } catch (error) { res.status(500).json({ error: "Erro ao assumir atendimento." }); }
};

exports.resolverAtendimentoHumano = async (req, res) => {
    try {
        const clienteId = req.params.clienteId;
        const lead = await prisma.cliente.update({ where: { id: clienteId }, data: { falarHumano: false } });
        
        const msgFim = `Atendimento encerrado.\nObrigado pelo contato. Se precisar de mais alguma coisa, estamos à disposição.`;
        await whatsappService.sendText(clienteId, msgFim);
        
        const msgCSAT = `Por favor, avalie seu atendimento respondendo com um número:\n\n1 - Muito ruim\n2 - Ruim\n3 - Regular\n4 - Bom\n5 - Excelente`;
        await whatsappService.sendText(clienteId, msgCSAT);

        await prisma.mensagemIA.create({
            data: { role: 'assistant', content: `[SISTEMA] ${msgFim} (Pesquisa CSAT enviada)`, clienteId, atendenteHumano: true }
        });

        await prisma.notaInterna.create({
            data: { texto: `Atendimento humano encerrado. Aguardando a avaliação do paciente.`, clienteId, usuarioId: 1 }
        });

        await automationEngine.dispararAutomacoes('ATENDIMENTO_ENCERRADO', lead);
        await webhookService.dispararEvento('conversation.closed', lead); 
        
        if (global.io) global.io.emit('atualizar_fila');
        res.status(200).json({ message: "Conversa devolvida para a IA e CSAT enviado." });
    } catch (error) { res.status(500).json({ error: "Erro ao devolver para IA." }); }
};

exports.enviarMensagemManual = async (req, res) => {
    try {
        const { clienteId } = req.params; 
        const texto = req.body.texto || ""; 
        let msgDb = texto;
        let supabaseUrl = null;
        let typeMsg = null;

        if (req.file) {
            const mimeType = req.file.mimetype;
            const isAudio = mimeType.startsWith('audio/') || req.file.originalname.endsWith('.ogg') || req.file.originalname.endsWith('.webm');
            
            // CORREÇÃO: Repassa 'audio' para o supabase processar corretamente
            const resourceType = mimeType.startsWith('image/') ? 'image' : (isAudio ? 'audio' : (mimeType.startsWith('video/') ? 'video' : 'raw'));
            
            const cloudResult = await supabaseService.uploadStream(req.file.buffer, 'clinica/atendimento', resourceType);
            supabaseUrl = cloudResult.secure_url;
            
            typeMsg = mimeType.startsWith('image/') ? 'image' : (isAudio ? 'audio' : (mimeType.startsWith('video/') ? 'video' : 'document'));
            
            await whatsappService.sendMediaUrl(clienteId, typeMsg, supabaseUrl, texto);
            msgDb = `[MEDIA:${typeMsg}] ${supabaseUrl} | Texto: ${texto}`;
        } else if (texto) { 
            await whatsappService.sendText(clienteId, texto); 
        }
        
        const novaMsg = await prisma.mensagemIA.create({ 
            data: { role: 'assistant', content: msgDb, clienteId, midiaUrl: supabaseUrl, tipoMidia: typeMsg, atendenteHumano: true } 
        });
        
        if (global.io) global.io.emit('nova_mensagem', { clienteId, mensagem: novaMsg });
        res.status(200).json(novaMsg);
    } catch (error) { res.status(500).json({ error: "Erro ao enviar mensagem manual." }); }
};

exports.getConfigIA = async (req, res) => {
    try {
        const config = await prisma.configSistema.findFirst();
        const logs = await prisma.logAlteracaoIA.findMany({ orderBy: { criadoEm: 'desc' }, take: 10 });
        res.status(200).json({ config, logs });
    } catch (error) { res.status(500).json({ error: "Erro ao buscar config IA." }); }
};

exports.atualizarConfigIA = async (req, res) => {
    try {
        const p = req.body;
        let avatarNovaUrl = p.avatarUrl || null;
        if (req.file) {
            const cloudResult = await supabaseService.uploadStream(req.file.buffer, 'clinica/ia', 'image');
            avatarNovaUrl = cloudResult.secure_url;
        }

        const config = await prisma.configSistema.update({
            where: { id: 1 },
            data: { 
                nomeClinica: p.nomeClinica, nomeAssistente: p.nomeAssistente, idioma: p.idioma,
                tomDeVoz: p.tomDeVoz, estiloComunicacao: p.estiloComunicacao, formalidade: p.formalidade,
                objetivos: p.objetivos, permissoes: p.permissoes, regrasExtrasIA: p.regrasExtrasIA, faq: p.faq, 
                regrasTransferencia: p.regrasTransferencia, msgTransferencia: p.msgTransferencia,
                avatarUrl: avatarNovaUrl !== 'null' ? avatarNovaUrl : null
            }
        });
        await prisma.logAlteracaoIA.create({ data: { autor: p.usuarioLogado || "Administrador", descricao: `Configurações da IA atualizadas.` } });
        res.status(200).json(config);
    } catch (error) { res.status(500).json({ error: "Erro ao atualizar IA." }); }
};

exports.testarIA = async (req, res) => {
    try {
        const { mensagem } = req.body;
        if (!mensagem) return res.status(400).json({ error: "Mensagem vazia." });

        const configDb = await prisma.configSistema.findFirst();
        const tratamentos = await prisma.tratamento.findMany({ where: { status: 'ATIVO' } });

        const estadoFake = { step: 'IDLE', intent: null, entities: {} };
        const nlpResult = await aiService.analisarMensagemNLP(mensagem, [], estadoFake);

        let respostaIA = "";

        if (nlpResult.intent === 'appointment.create') {
            respostaIA = `[AÇÃO DE BACKEND]\nO motor identificou a intenção de AGENDAR.\nEntidades extraídas: ${JSON.stringify(nlpResult.entities)}\nO sistema iniciaria o fluxo de botões para escolher data e horário.`;
        } else if (nlpResult.intent === 'appointment.cancel' || nlpResult.intent === 'appointment.reschedule') {
            respostaIA = `[AÇÃO DE BACKEND]\nO motor identificou a intenção de CANCELAR/REMARCAR.\nEntidades extraídas: ${JSON.stringify(nlpResult.entities)}\nO sistema buscaria as consultas ativas do paciente.`;
        } else if (nlpResult.intent === 'human.transfer') {
            respostaIA = `[AÇÃO DE BACKEND]\nTransferindo para a fila de atendimento humano...`;
        } else {
            let dadosContexto = {};
            if (nlpResult.intent.startsWith('treatment.')) {
                dadosContexto.catologo_servicos = tratamentos.map(t => ({ nome: t.nome, preco: t.preco, tipoPreco: t.tipoPreco, info: t.informacoesIA }));
            } else {
                dadosContexto.dados_operacionais = {
                    horarios: configDb?.horarioFuncionamento || "Segunda a Sexta",
                    endereco: configDb?.endereco || "Endereço cadastrado",
                    telefone: configDb?.telefone || "",
                    faq: configDb?.faq || ""
                };
            }
            const textoResposta = await aiService.gerarRespostaNatural(mensagem, [], dadosContexto, configDb);
            respostaIA = textoResposta;
        }

        res.status(200).json({ resposta: respostaIA });
    } catch (error) { 
        res.status(500).json({ error: "Falha na simulação IA." }); 
    }
};