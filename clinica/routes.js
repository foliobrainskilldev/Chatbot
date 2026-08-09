const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

const crmControllerClinica = require('./crmController'); 

const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `crm_clinica_${Date.now()}${ext}`);
    }
});
const upload = multer({ storage });

// ==========================================
// ROTAS 100% EXCLUSIVAS DA CLÍNICA
// ==========================================

router.get('/dashboard/stats', crmControllerClinica.getDashboardStats);

router.get('/equipe', crmControllerClinica.getEquipe);
router.get('/leads', crmControllerClinica.getLeads);
router.put('/leads/:id/status', crmControllerClinica.atualizarStatusLead);

router.get('/conversas/pendentes', crmControllerClinica.getConversasPendentes);
router.get('/conversas/:clienteId', crmControllerClinica.getMensagensConversa);
router.post('/conversas/:clienteId/enviar', upload.single('arquivo'), crmControllerClinica.enviarMensagemManual);
router.post('/conversas/:clienteId/resolver', crmControllerClinica.resolverAtendimentoHumano);

router.get('/agendamentos/todos', crmControllerClinica.getAgendamentosTodos);
router.put('/agendamentos/:id/status', crmControllerClinica.atualizarStatusAgendamento);

module.exports = router;