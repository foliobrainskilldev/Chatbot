// --- START OF FILE crmRoutes.js ---
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { prisma } = require('./db');
const { stateMachine } = require('./messageHandler');
const { sendText, uploadMediaToMeta, sendMediaMessage } = require('./whatsappApi'); 

// Configuração do Multer (Onde guardar as fotos enviadas pelo CRM)
const upload = multer({ dest: 'uploads/' });

router.post('/reset', async (req, res) => {
    try {
        await prisma.mensagemIA.deleteMany({});
        await prisma.agendamento.deleteMany({});
        await prisma.cliente.deleteMany({});
        if (stateMachine) stateMachine.clear();
        res.status(200).json({ message: "Memória do bot apagada com sucesso!" });
    } catch(error) { res.status(500).json({ error: "Erro interno ao apagar dados." }); }
});

router.get('/clientes', async (req, res) => {
    try {
        const clientes = await prisma.cliente.findMany({ orderBy: { id: 'desc' } });
        res.status(200).json(clientes);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar clientes." }); }
});

router.get('/conversas/pendentes', async (req, res) => {
    try {
        const clientesPendentes = await prisma.cliente.findMany({ where: { falarHumano: true }, orderBy: { id: 'desc' } });
        res.status(200).json(clientesPendentes);
    } catch (error) { res.status(500).json({ error: "Erro ao buscar conversas." }); }
});

router.get('/conversas/:clienteId', async (req, res) => {
    try {
        const { clienteId } = req.params;
        const mensagens = await prisma.mensagemIA.findMany({ where: { clienteId: clienteId }, orderBy: { criadoEm: 'asc' } });
        res.status(200).json(mensagens);
    } catch (error) { res.status(500).json({ error: "Erro ao carregar histórico." }); }
});

// NOVO: Enviar Mensagem COM suporte a Mídia
router.post('/conversas/:clienteId/enviar', upload.single('arquivo'), async (req, res) => {
    try {
        const { clienteId } = req.params;
        const texto = req.body.texto || "";
        let mensagemParaBD = texto;
        
        if (req.file) {
            // Se o atendente enviou um ficheiro (Imagem, Vídeo)
            const mimeType = req.file.mimetype;
            const type = mimeType.startsWith('image/') ? 'image' : (mimeType.startsWith('video/') ? 'video' : 'document');
            
            // 1. Sobe para a Meta e pega o ID
            const mediaId = await uploadMediaToMeta(req.file.path, mimeType);
            
            // 2. Envia a Mídia para o WhatsApp do cliente
            if (mediaId) {
                await sendMediaMessage(clienteId, type, mediaId, texto);
                mensagemParaBD = `[MEDIA:${type}] /${req.file.path} | Transcrição: ${texto}`;
            } else {
                return res.status(500).json({ error: "Erro ao subir media para o WhatsApp." });
            }
        } else if (texto) {
            // Se for só texto normal
            await sendText(clienteId, texto);
        }

        const novaMsg = await prisma.mensagemIA.create({
            data: { role: 'assistant', content: mensagemParaBD, clienteId: clienteId }
        });
        
        if (global.io) global.io.emit('nova_mensagem', { clienteId: clienteId, mensagem: novaMsg });
        res.status(200).json(novaMsg);
    } catch (error) { res.status(500).json({ error: "Erro ao enviar mensagem." }); }
});

router.post('/conversas/:clienteId/resolver', async (req, res) => {
    try {
        const { clienteId } = req.params;
        await prisma.cliente.update({ where: { id: clienteId }, data: { falarHumano: false } });
        await sendText(clienteId, "Atendimento humano encerrado. O Assistente Virtual assumiu novamente o comando.");
        if (global.io) global.io.emit('atualizar_fila');
        res.status(200).json({ message: "Atendimento devolvido ao bot." });
    } catch (error) { res.status(500).json({ error: "Erro ao encerrar atendimento." }); }
});

module.exports = router;
// --- END OF FILE crmRoutes.js ---