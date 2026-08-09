const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { startOfDay, endOfDay, subDays, format } = require('date-fns');
const { prisma } = require('./db');
const { sendText, uploadMediaToMeta, sendMediaMessage } = require('./whatsappApi');

const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || (file.mimetype.startsWith('image/') ? '.jpg' : '.mp4');
        cb(null, `crm_${Date.now()}${ext}`);
    }
});
const upload = multer({ storage });
const settingsPath = path.join(__dirname, 'settings.json');

router.get('/settings', (req, res) => {
    try {
        if (!fs.existsSync(settingsPath)) return res.status(200).json({ botAtivo: true, diasTrabalho: [1, 2, 3, 4, 5, 6], horaInicio: "09:00", horaFim: "19:00" });
        res.status(200).json(JSON.parse(fs.readFileSync(settingsPath, 'utf8')));
    } catch (e) { res.status(500).json({ error: "Erro" }); }
});
router.post('/settings', (req, res) => {
    try { fs.writeFileSync(settingsPath, JSON.stringify(req.body, null, 2)); res.status(200).json({ message: "Salvo" }); } catch (e) { res.status(500).json({ error: "Erro" }); }
});

router.get('/dashboard/stats', async (req, res) => {
    try {
        const totalLeads = await prisma.cliente.count();
        const leadsHoje = await prisma.cliente.count({ where: { criadoEm: { gte: startOfDay(new Date()) } } });
        const agendamentosTotais = await prisma.agendamento.count({ where: { status: 'AGENDADO' } });
        const cancelamentosTotais = await prisma.agendamento.count({ where: { status: 'CANCELADO' } });
        
        const funil = {
            novos: await prisma.cliente.count({ where: { leadStatus: 'NOVO' } }),
            emConversa: await prisma.cliente.count({ where: { leadStatus: 'EM_CONVERSA' } }),
            qualificados: await prisma.cliente.count({ where: { leadStatus: 'QUALIFICADO' } }),
            agendados: await prisma.cliente.count({ where: { leadStatus: 'AGENDADO' } }),
        };

        const origensRaw = await prisma.cliente.groupBy({ by: ['origem'], _count: { origem: true } });
        const origens = origensRaw.map(o => ({ rotulo: o.origem, contagem: o._count.origem }));
        
        let leadsPorDia = [];
        for (let i = 6; i >= 0; i--) {
            const dataBase = subDays(new Date(), i);
            const count = await prisma.cliente.count({ where: { criadoEm: { gte: startOfDay(dataBase), lte: endOfDay(dataBase) } } });
            leadsPorDia.push({ dia: format(dataBase, 'dd/MM'), count });
        }

        // NOVO: Serviços Mais Procurados (Barbearia e Clínica)
        const topServicosAg = await prisma.agendamento.groupBy({
            by: ['servicoId'], _count: { servicoId: true }, where: { servicoId: { not: null } }, orderBy: { _count: { servicoId: 'desc' } }, take: 5
        });
        const topTratamentosAg = await prisma.agendamento.groupBy({
            by: ['tratamentoId'], _count: { tratamentoId: true }, where: { tratamentoId: { not: null } }, orderBy: { _count: { tratamentoId: 'desc' } }, take: 5
        });

        let topServicos = [];
        for (let s of topServicosAg) {
            const servDb = await prisma.servico.findUnique({ where: { id: s.servicoId } });
            if (servDb) topServicos.push({ nome: servDb.nome, count: s._count.servicoId });
        }
        for (let t of topTratamentosAg) {
            const tratDb = await prisma.tratamento.findUnique({ where: { id: t.tratamentoId } });
            if (tratDb) topServicos.push({ nome: tratDb.nome, count: t._count.tratamentoId });
        }
        
        // Ordena tudo junto e pega os 5 melhores
        topServicos.sort((a, b) => b.count - a.count);
        topServicos = topServicos.slice(0, 5);

        res.status(200).json({ totalLeads, leadsHoje, agendamentosTotais, cancelamentosTotais, funil, origens, leadsPorDia, topServicos });
    } catch (error) { res.status(500).json({ error: "Erro." }); }
});

router.get('/config', async (req, res) => {
    try { res.status(200).json(await prisma.configSistema.findFirst()); } catch (e) { res.status(500).json({ error: "Erro" }); }
});
router.post('/config', async (req, res) => {
    try {
        const d = req.body;
        await prisma.configSistema.upsert({
            where: { id: 1 },
            update: {
                modoAtivo: d.modoAtivo, nomeAssistente: d.nomeAssistente, tomDeVoz: d.tomDeVoz,
                objetivos: d.objetivos, regrasExtrasIA: d.regrasExtrasIA, faq: d.faq,
                ignorarDiagnosticos: d.ignorarDiagnosticos, regrasTransferencia: d.regrasTransferencia,
                notificarNovosLeads: d.notificarNovosLeads, autoFollowUp: d.autoFollowUp,
                autoLembrete: d.autoLembrete, distribuicaoLeads: d.distribuicaoLeads,
                webhookUrl: d.webhookUrl, metaToken: d.metaToken
            },
            create: {
                id: 1, modoAtivo: d.modoAtivo || "BARBEARIA", nomeAssistente: d.nomeAssistente,
                tomDeVoz: d.tomDeVoz, objetivos: d.objetivos, regrasExtrasIA: d.regrasExtrasIA, faq: d.faq,
                ignorarDiagnosticos: d.ignorarDiagnosticos || false, regrasTransferencia: d.regrasTransferencia,
                notificarNovosLeads: d.notificarNovosLeads, autoFollowUp: d.autoFollowUp,
                autoLembrete: d.autoLembrete, distribuicaoLeads: d.distribuicaoLeads,
                webhookUrl: d.webhookUrl, metaToken: d.metaToken
            }
        });
        res.status(200).json({ message: "Salvo" });
    } catch (e) { res.status(500).json({ error: "Erro" }); }
});

router.get('/equipe', async (req, res) => {
    try { res.status(200).json(await prisma.usuario.findMany()); } catch (error) { res.status(500).json({ error: "Erro" }); }
});
router.post('/equipe', async (req, res) => {
    try {
        const newUser = await prisma.usuario.create({
            data: { nome: req.body.nome, email: req.body.email, senha: req.body.senha, funcao: req.body.funcao, status: 'ONLINE' }
        });
        res.status(200).json(newUser);
    } catch (error) { res.status(500).json({ error: "Erro. Email pode já existir." }); }
});
router.delete('/equipe/:id', async (req, res) => {
    try {
        await prisma.usuario.delete({ where: { id: parseInt(req.params.id) } });
        res.status(200).json({ message: "Usuário deletado." });
    } catch (error) { res.status(500).json({ error: "Erro ao deletar." }); }
});

router.get('/leads', async (req, res) => {
    try { res.status(200).json(await prisma.cliente.findMany({ include: { responsavel: true }, orderBy: { ultimaInteracao: 'desc' } })); } catch (error) { res.status(500).json({ error: "Erro" }); }
});
router.put('/leads/:id/status', async (req, res) => {
    try {
        const { status, tags, observacoes, valorPotencial, responsavelId } = req.body;
        const dataUpdate = { leadStatus: status };
        if (tags !== undefined) dataUpdate.tags = tags;
        if (observacoes !== undefined) dataUpdate.observacoes = observacoes;
        if (valorPotencial !== undefined) dataUpdate.valorPotencial = valorPotencial;
        if (responsavelId !== undefined) dataUpdate.responsavelId = responsavelId ? parseInt(responsavelId) : null;
        res.status(200).json(await prisma.cliente.update({ where: { id: req.params.id }, data: dataUpdate }));
    } catch (error) { res.status(500).json({ error: "Erro" }); }
});

router.get('/conversas/:clienteId/notas', async (req, res) => {
    try { res.status(200).json(await prisma.notaInterna.findMany({ where: { clienteId: req.params.clienteId }, include: { usuario: true }, orderBy: { criadoEm: 'desc' } })); } catch (error) { res.status(500).json({ error: "Erro" }); }
});
router.post('/conversas/:clienteId/notas', async (req, res) => {
    try { res.status(200).json(await prisma.notaInterna.create({ data: { texto: req.body.texto, clienteId: req.params.clienteId, usuarioId: req.body.usuarioId || 1 } })); } catch (error) { res.status(500).json({ error: "Erro" }); }
});

router.get('/conversas/pendentes', async (req, res) => {
    try { res.status(200).json(await prisma.cliente.findMany({ where: { falarHumano: true }, include: { responsavel: true }, orderBy: { ultimaInteracao: 'desc' } })); } catch (error) { res.status(500).json({ error: "Erro" }); }
});
router.get('/conversas/:clienteId', async (req, res) => {
    try { res.status(200).json(await prisma.mensagemIA.findMany({ where: { clienteId: req.params.clienteId }, orderBy: { criadoEm: 'asc' } })); } catch (error) { res.status(500).json({ error: "Erro" }); }
});
router.post('/conversas/:clienteId/enviar', upload.single('arquivo'), async (req, res) => {
    try {
        const { clienteId } = req.params; const texto = req.body.texto || ""; let msgDb = texto;
        if (req.file) {
            const mimeType = req.file.mimetype; const type = mimeType.startsWith('image/') ? 'image' : (mimeType.startsWith('video/') ? 'video' : 'document');
            const mediaId = await uploadMediaToMeta(req.file.path, mimeType);
            if (mediaId) { await sendMediaMessage(clienteId, type, mediaId, texto); msgDb = `[MEDIA:${type}] /${req.file.path} | Transcrição: ${texto}`; }
        } else if (texto) { await sendText(clienteId, texto); }
        const novaMsg = await prisma.mensagemIA.create({ data: { role: 'assistant', content: msgDb, clienteId } });
        if (global.io) global.io.emit('nova_mensagem', { clienteId, mensagem: novaMsg });
        res.status(200).json(novaMsg);
    } catch (error) { res.status(500).json({ error: "Erro" }); }
});
router.post('/conversas/:clienteId/resolver', async (req, res) => {
    try {
        await prisma.cliente.update({ where: { id: req.params.clienteId }, data: { falarHumano: false, leadStatus: 'ATENDIDO' } });
        await sendText(req.params.clienteId, "Atendimento humano encerrado. O bot foi reativado.");
        if (global.io) global.io.emit('atualizar_fila');
        res.status(200).json({ message: "Resolvido." });
    } catch (error) { res.status(500).json({ error: "Erro." }); }
});

router.get('/agendamentos/todos', async (req, res) => {
    try { res.status(200).json(await prisma.agendamento.findMany({ include: { cliente: true, servico: true, barbeiro: true, tratamento: true, profissionalSaude: true }, orderBy: { dataHora: 'asc' } })); } catch (error) { res.status(500).json({ error: "Erro" }); }
});
router.put('/agendamentos/:id/status', async (req, res) => {
    try { res.status(200).json(await prisma.agendamento.update({ where: { id: parseInt(req.params.id) }, data: { status: req.body.status } })); } catch (error) { res.status(500).json({ error: "Erro" }); }
});
router.get('/agendamentos/hoje', async (req, res) => {
    try { res.status(200).json(await prisma.agendamento.findMany({ where: { status: 'AGENDADO', dataHora: { gte: startOfDay(new Date()) } }, include: { cliente: true, servico: true, barbeiro: true, tratamento: true, profissionalSaude: true }, orderBy: { dataHora: 'asc' } })); } catch (error) { res.status(500).json({ error: "Erro" }); }
});

router.post('/reset', async (req, res) => {
    try {
        await prisma.notaInterna.deleteMany({}); await prisma.mensagemIA.deleteMany({});
        await prisma.agendamento.deleteMany({}); await prisma.cliente.deleteMany({});
        const { stateMachine } = require('./messageHandler'); if (stateMachine) stateMachine.clear();
        res.status(200).json({ message: "Memória apagada!" });
    } catch (error) { res.status(500).json({ error: "Erro interno." }); }
});
module.exports = router;