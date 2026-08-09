const express = require('express');
const router = express.Router();

const botEngine = require('./botEngine');
const clinicaRoutes = require('./clinica/routes');
const barbeariaRoutes = require('./barbearia/routes');
const hubController = require('./hubController');

// ==========================================
// WEBHOOK (WHATSAPP META API)
// ==========================================
router.get('/webhook', botEngine.verificarWebhook);
router.post('/webhook', botEngine.processarWebhook);

// ==========================================
// HUB CENTRAL (Gestão Global do SaaS)
// ==========================================
router.get('/hub/config', hubController.getConfigSistema);
router.post('/hub/config', hubController.saveConfigSistema);
router.get('/hub/stats', hubController.getHubStats);
router.post('/hub/reset', hubController.formatarSistemaCompleto);

// ==========================================
// ROTEAMENTO ISOLADO POR NICHO (TENANTS)
// ==========================================
router.use('/api/clinica', clinicaRoutes);
router.use('/api/barbearia', barbeariaRoutes);

module.exports = router;