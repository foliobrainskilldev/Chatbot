const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
    startOfDay,
    endOfDay,
    subDays
} = require('date-fns');
const {
    prisma
} = require('./db');
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
    storage
});

const settingsPath = path.join(__dirname, 'settings.json');

// Rotas de Configuração (Operação Horários)
router.get('/settings', (req, res) => {
    try {
        if (!fs.existsSync(settingsPath)) {
            return res.status(200).json({
                botAtivo: true,
                diasTrabalho: [1, 2, 3, 4, 5, 6],
                horaInicio: "09:00",
                horaFim: "19:00"
            });
        }
        res.status(200).json(JSON.parse(fs.readFileSync(settingsPath, 'utf8')));
    } catch (e) {
        res.status(500).json({
            error: "Erro"
        });
    }
});
router.post('/settings', (req, res) => {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(req.body, null, 2));
        res.status(200).json({
            message: "Salvo"
        });
    } catch (e) {
        res.status(500).json({
            error: "Erro"
        });
    }
});

// ==========================================
// 1. DASHBOARD & MÉTRICAS AVANÇADAS
// ==========================================
router.get('/dashboard/stats', async (req, res) => {
    try {
        const totalLeads = await prisma.cliente.count();
        const leadsHoje = await prisma.cliente.count({
            where: {
                criadoEm: {
                    gte: startOfDay(new Date())
                }
            }
        });

        const agendamentosTotais = await prisma.agendamento.count({
            where: {
                status: 'AGENDADO'
            }
        });
        const cancelamentosTotais = await prisma.agendamento.count({
            where: {
                status: 'CANCELADO'
            }
        });

        const funil = {
            novos: await prisma.cliente.count({
                where: {
                    leadStatus: 'NOVO'
                }
            }),
            emConversa: await prisma.cliente.count({
                where: {
                    leadStatus: 'EM_CONVERSA'
                }
            }),
            qualificados: await prisma.cliente.count({
                where: {
                    leadStatus: 'QUALIFICADO'
                }
            }),
            agendados: await prisma.cliente.count({
                where: {
                    leadStatus: 'AGENDADO'
                }
            }),
        };

        res.status(200).json({
            totalLeads,
            leadsHoje,
            agendamentosTotais,
            cancelamentosTotais,
            funil
        });
    } catch (error) {
        res.status(500).json({
            error: "Erro ao carregar Dashboard."
        });
    }
});

// ==========================================
// 2. GESTÃO DA I.A E CONFIGURAÇÃO (MULTI-NICHO)
// ==========================================
router.get('/config', async (req, res) => {
    try {
        let config = await prisma.configSistema.findFirst();
        res.status(200).json(config);
    } catch (e) {
        res.status(500).json({
            error: "Erro ao ler configurações da IA"
        });
    }
});

// ATUALIZAÇÃO IMPORTANTE (Solução do Erro): Usando UPSERT
router.post('/config', async (req, res) => {
    try {
        const dados = req.body;
        // O Upsert tenta atualizar o id: 1. Se o banco estiver recém-criado e o id: 1 não existir, ele cria sozinho.
        await prisma.configSistema.upsert({
            where: {
                id: 1
            },
            update: {
                modoAtivo: dados.modoAtivo,
                nomeAssistente: dados.nomeAssistente || "Assistente Virtual",
                tomDeVoz: dados.tomDeVoz || "Amigável",
                regrasExtrasIA: dados.regrasExtrasIA || "",
                ignorarDiagnosticos: dados.ignorarDiagnosticos || false
            },
            create: {
                id: 1,
                modoAtivo: dados.modoAtivo || "BARBEARIA",
                nomeAssistente: dados.nomeAssistente || "Assistente Virtual",
                tomDeVoz: dados.tomDeVoz || "Amigável",
                regrasExtrasIA: dados.regrasExtrasIA || "",
                ignorarDiagnosticos: dados.ignorarDiagnosticos || false
            }
        });
        res.status(200).json({
            message: "Configurações Globais atualizadas com sucesso!"
        });
    } catch (e) {
        res.status(500).json({
            error: "Erro ao salvar Configurações"
        });
    }
});

// ==========================================
// 3. CRM E CENTRAL DE LEADS
// ==========================================
router.get('/leads', async (req, res) => {
    try {
        const leads = await prisma.cliente.findMany({
            orderBy: {
                ultimaInteracao: 'desc'
            }
        });
        res.status(200).json(leads);
    } catch (error) {
        res.status(500).json({
            error: "Erro"
        });
    }
});

router.put('/leads/:id/status', async (req, res) => {
    try {
        const {
            status,
            tags,
            observacoes,
            valorPotencial
        } = req.body;
        const lead = await prisma.cliente.update({
            where: {
                id: req.params.id
            },
            data: {
                leadStatus: status,
                tags: tags,
                observacoes: observacoes,
                valorPotencial: valorPotencial
            }
        });
        res.status(200).json(lead);
    } catch (error) {
        res.status(500).json({
            error: "Erro"
        });
    }
});

// ==========================================
// 4. CENTRAL DE MENSAGENS E ATENDIMENTO
// ==========================================
router.get('/conversas/pendentes', async (req, res) => {
    try {
        res.status(200).json(await prisma.cliente.findMany({
            where: {
                falarHumano: true
            },
            orderBy: {
                ultimaInteracao: 'desc'
            }
        }));
    } catch (error) {
        res.status(500).json({
            error: "Erro"
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
            error: "Erro"
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
            error: "Erro"
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
                falarHumano: false,
                leadStatus: 'ATENDIDO'
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

// ==========================================
// 5. ZONA DE PERIGO
// ==========================================
router.post('/reset', async (req, res) => {
    try {
        await prisma.mensagemIA.deleteMany({});
        await prisma.agendamento.deleteMany({});
        await prisma.cliente.deleteMany({});
        // Não apagamos ConfigSistema nem Profissionais/Tratamentos/Barbeiros
        const {
            stateMachine
        } = require('./messageHandler');
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

router.get('/agendamentos/hoje', async (req, res) => {
    try {
        const hojeInicio = startOfDay(new Date());
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
                barbeiro: true,
                tratamento: true,
                profissionalSaude: true
            },
            orderBy: {
                dataHora: 'asc'
            }
        });
        res.status(200).json(agendamentos);
    } catch (error) {
        res.status(500).json({
            error: "Erro"
        });
    }
});

module.exports = router;