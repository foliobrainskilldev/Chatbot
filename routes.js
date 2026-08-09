const express = require('express');
const router = express.Router();

// Controladores Centrais (Direcionadores)
const botEngine = require('./botEngine');
const hubController = require('./hubController');

// Rotas Isoladas por Nicho
const barbeariaRoutes = require('./barbearia/routes');
const clinicaRoutes = require('./clinica/routes');

// ==========================================
// WEBHOOK (WHATSAPP META API) - Roteador Central
// ==========================================
router.get('/webhook', botEngine.verificarWebhook);
router.post('/webhook', botEngine.processarWebhook);

// ==========================================
// HUB NEUTRO (Painel Central de Seleção)
// ==========================================
router.get('/hub/config', hubController.getConfigSistema);
router.post('/hub/config', hubController.saveConfigSistema);
router.get('/hub/stats', hubController.getHubStats);

// ==========================================
// ENDPOINTS ISOLADOS (NUNCA SE MISTURAM)
// ==========================================
// Tudo que bater em /api/barbearia vai para a pasta de barbearia
router.use('/api/barbearia', barbeariaRoutes);

// Tudo que bater em /api/clinica vai para a pasta de clínica
router.use('/api/clinica', clinicaRoutes);

module.exports = router;