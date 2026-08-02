const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const {
    startOfDay,
    endOfDay
} = require('date-fns');
const {
    prisma
} = require('./db');
const {
    stateMachine
} = require('./messageHandler');
const {
    sendText,
    uploadMediaToMeta,
    sendMediaMessage
} = require('./whatsappApi');

const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || (file.mimetype.startsWith('image/') ? '.jpg' : '.mp4');
        cb(null, `crm_${Date.now()}${ext}`);
    }
});
const upload = multer({
    storage: storage
});

router.get('/kpis', async (req, res) => {
    try {
        const totalClientes = await prisma.cliente.count();
        const totalAgendamentos = await prisma.agendamento.count({
            where: {
                status: 'AGENDADO'
            }
        });
        const conversasPendentes = await prisma.cliente.count({
            where: {
                falarHumano: true
            }
        });

        const hojeInicio = startOfDay(new Date());
        const hojeFim = endOfDay(new Date());

        const agendamentosHoje = await prisma.agendamento.count({
            where: {
                status: 'AGENDADO',
                dataHora: {
                    gte: hojeInicio,
                    lte: hojeFim
                }
            }
        });

        res.status(200).json({
            totalClientes,
            totalAgendamentos,
            conversasPendentes,
            agendamentosHoje
        });
    } catch (error) {
        res.status(500).json({
            error: "Erro ao carregar estatísticas."
        });
    }
});

router.get('/agendamentos/hoje', async (req, res) => {
    try {
        const hojeInicio = startOfDay(new Date());

        // Agora busca todos os agendamentos futuros (incluindo o de hoje) para que
        // mesmo que o cliente agende para amanhã, possas ver na lista da agenda.
        const agendamentos = await prisma.agendamento.findMany({
            where: {
                status: 'AGENDADO',
                dataHora: {
                    gte: hojeInicio
                }
            },
            include: {
                cliente: true,
                servico: true,
                barbeiro: true
            },
            orderBy: {
                dataHora: 'asc'
            }
        });
        res.status(200).json(agendamentos);
    } catch (error) {
        res.status(500).json({
            error: "Erro ao carregar agenda."
        });
    }
});

router.post('/reset', async (req, res) => {
    try {
        await prisma.mensagemIA.deleteMany({});
        await prisma.agendamento.deleteMany({});
        await prisma.cliente.deleteMany({});
        if (stateMachine) stateMachine.clear();
        res.status(200).json({
            message: "Memória do bot apagada com sucesso!"
        });
    } catch (error) {
        res.status(500).json({
            error: "Erro interno."
        });
    }
});

router.get('/clientes', async (req, res) => {
    try {
        res.status(200).json(await prisma.cliente.findMany({
            orderBy: {
                id: 'desc'
            }
        }));
    } catch (error) {
        res.status(500).json({
            error: "Erro."
        });
    }
});

router.get('/conversas/pendentes', async (req, res) => {
    try {
        res.status(200).json(await prisma.cliente.findMany({
            where: {
                falarHumano: true
            },
            orderBy: {
                id: 'desc'
            }
        }));
    } catch (error) {
        res.status(500).json({
            error: "Erro."
        });
    }
});

router.get('/conversas/:clienteId', async (req, res) => {
    try {
        res.status(200).json(await prisma.mensagemIA.findMany({
            where: {
                clienteId: req.params.clienteId
            },
            orderBy: {
                criadoEm: 'asc'
            }
        }));
    } catch (error) {
        res.status(500).json({
            error: "Erro."
        });
    }
});

router.post('/conversas/:clienteId/enviar', upload.single('arquivo'), async (req, res) => {
    try {
        const {
            clienteId
        } = req.params;
        const texto = req.body.texto || "";
        let mensagemParaBD = texto;

        if (req.file) {
            const mimeType = req.file.mimetype;
            const type = mimeType.startsWith('image/') ? 'image' : (mimeType.startsWith('video/') ? 'video' : 'document');
            const mediaId = await uploadMediaToMeta(req.file.path, mimeType);

            if (mediaId) {
                await sendMediaMessage(clienteId, type, mediaId, texto);
                mensagemParaBD = `[MEDIA:${type}] /${req.file.path} | Transcrição: ${texto}`;
            } else {
                return res.status(500).json({
                    error: "A Meta rejeitou o ficheiro."
                });
            }
        } else if (texto) {
            await sendText(clienteId, texto);
        }

        const novaMsg = await prisma.mensagemIA.create({
            data: {
                role: 'assistant',
                content: mensagemParaBD,
                clienteId: clienteId
            }
        });
        if (global.io) global.io.emit('nova_mensagem', {
            clienteId: clienteId,
            mensagem: novaMsg
        });
        res.status(200).json(novaMsg);
    } catch (error) {
        res.status(500).json({
            error: "Erro ao enviar."
        });
    }
});

router.post('/conversas/:clienteId/resolver', async (req, res) => {
    try {
        await prisma.cliente.update({
            where: {
                id: req.params.clienteId
            },
            data: {
                falarHumano: false
            }
        });
        await sendText(req.params.clienteId, "Atendimento humano encerrado. O Assistente Virtual assumiu novamente o comando.");
        if (global.io) global.io.emit('atualizar_fila');
        res.status(200).json({
            message: "Resolvido."
        });
    } catch (error) {
        res.status(500).json({
            error: "Erro."
        });
    }
});

module.exports = router;