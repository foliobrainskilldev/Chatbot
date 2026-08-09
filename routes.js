const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crmController = require('./crmController');
const botEngine = require('./botEngine');

// Configuração real de Upload para ambiente de produção
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || (file.mimetype.startsWith('image/') ? '.jpg' : '.mp4');
        cb(null, `crm_${Date.now()}${ext}`);
    }
});
const upload = multer({ storage });

// ==========================================
// ROTAS DO WEBHOOK (WHATSAPP META API)
// ==========================================
router.get('/webhook', botEngine.verificarWebhook);
router.post('/webhook', botEngine.processarWebhook);

// ==========================================
// ROTAS DO PAINEL CRM (API)
// ==========================================

// Configurações e Dashboard
router.get('/settings', crmController.getSettings);
router.post('/settings', crmController.saveSettings);
router.get('/dashboard/stats', crmController.getDashboardStats);
router.get('/config', crmController.getConfigSistema);
router.post('/config', crmController.saveConfigSistema);

// Gestão de Equipe
router.get('/equipe', crmController.getEquipe);
router.post('/equipe', crmController.criarMembroEquipe);
router.delete('/equipe/:id', crmController.deletarMembroEquipe);

// Gestão de Leads e CRM
router.get('/leads', crmController.getLeads);
router.put('/leads/:id/status', crmController.atualizarStatusLead);

// Conversas (Chat Central)
router.get('/conversas/pendentes', crmController.getConversasPendentes);
router.get('/conversas/:clienteId', crmController.getMensagensConversa);
router.get('/conversas/:clienteId/notas', crmController.getNotasInternas);
router.post('/conversas/:clienteId/notas', crmController.criarNotaInterna);
router.post('/conversas/:clienteId/enviar', upload.single('arquivo'), crmController.enviarMensagemManual);
router.post('/conversas/:clienteId/resolver', crmController.resolverAtendimentoHumano);

// Agendamentos
router.get('/agendamentos/todos', crmController.getAgendamentosTodos);
router.get('/agendamentos/hoje', crmController.getAgendamentosHoje);
router.put('/agendamentos/:id/status', crmController.atualizarStatusAgendamento);

// Zona de Perigo
router.post('/reset', crmController.formatarSistema);

module.exports = router;