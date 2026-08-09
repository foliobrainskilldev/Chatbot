const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

// Aqui importamos o Controller exclusivo da barbearia que estará na mesma pasta
const crmControllerBarbearia = require('./crmController'); 

const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || (file.mimetype.startsWith('image/') ? '.jpg' : '.mp4');
        cb(null, `crm_barb_${Date.now()}${ext}`);
    }
});
const upload = multer({ storage });

// ==========================================
// ROTAS 100% EXCLUSIVAS DA BARBEARIA
// Todas estarão acessíveis via /api/barbearia/...
// ==========================================

// Dashboard Analítico
router.get('/dashboard/stats', crmControllerBarbearia.getDashboardStats);

// Equipe Barbearia
router.get('/equipe', crmControllerBarbearia.getEquipe);
router.post('/equipe', crmControllerBarbearia.criarMembroEquipe);
router.delete('/equipe/:id', crmControllerBarbearia.deletarMembroEquipe);

// Gestão de CRM / Leads Barbearia
router.get('/leads', crmControllerBarbearia.getLeads);
router.put('/leads/:id/status', crmControllerBarbearia.atualizarStatusLead);

// Chat / Conversas
router.get('/conversas/pendentes', crmControllerBarbearia.getConversasPendentes);
router.get('/conversas/:clienteId', crmControllerBarbearia.getMensagensConversa);
router.get('/conversas/:clienteId/notas', crmControllerBarbearia.getNotasInternas);
router.post('/conversas/:clienteId/notas', crmControllerBarbearia.criarNotaInterna);
router.post('/conversas/:clienteId/enviar', upload.single('arquivo'), crmControllerBarbearia.enviarMensagemManual);
router.post('/conversas/:clienteId/resolver', crmControllerBarbearia.resolverAtendimentoHumano);

// Agendamentos Barbearia
router.get('/agendamentos/todos', crmControllerBarbearia.getAgendamentosTodos);
router.get('/agendamentos/hoje', crmControllerBarbearia.getAgendamentosHoje);
router.put('/agendamentos/:id/status', crmControllerBarbearia.atualizarStatusAgendamento);

// Formatar Sistema Isolado (Zona de Perigo)
router.post('/reset', crmControllerBarbearia.formatarSistema);

module.exports = router;