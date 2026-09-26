const express = require('express');
const router = express.Router();

const botEngine = require('./botEngine');
const clinicaRoutes = require('./clinica/routes');

// Middleware de Autenticação
const authMiddleware = (req, res, next) => {
    if (req.path.startsWith('/webhook')) return next();
    if (req.path.includes('/demo/')) return next();
    
    // Mock de Desenvolvimento - Logado como Admin
    req.user = req.user || { id: 1, funcao: 'ADMIN' };
    next();
};

// Rotas Webhook Públicas
router.get('/webhook', botEngine.verificarWebhook);
router.post('/webhook', botEngine.processarWebhook);

// Aplica segurança nas rotas abaixo
router.use(authMiddleware);

// Roteamento exclusivo da Clínica
router.use('/api/clinica', clinicaRoutes);

module.exports = router;