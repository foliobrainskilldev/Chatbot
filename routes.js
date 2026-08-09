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
// HUB NEUTRO (Painel Central de Controle)
// ==========================================
router.get('/hub/config', hubController.getConfigSistema);
router.post('/hub/config', hubController.saveConfigSistema);
router.get('/hub/stats', hubController.getHubStats);
router.post('/hub/reset', hubController.formatarSistemaCompleto); // Novo Endpoint para formatar TUDO

// ==========================================
// ENDPOINTS ISOLADOS (NUNCA SE MISTURAM)
// ==========================================
router.use('/api/barbearia', barbeariaRoutes);
router.use('/api/clinica', clinicaRoutes);

module.exports = router;