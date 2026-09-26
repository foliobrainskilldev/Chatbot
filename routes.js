const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const botEngine = require('./botEngine');
const clinicaRoutes = require('./clinica/routes');
const authController = require('./clinica/controllers/authController'); // <-- NOVO

// Rotas Webhook Públicas (Não pedem senha)
router.get('/webhook', botEngine.verificarWebhook);
router.post('/webhook', botEngine.processarWebhook);

// ROTA DE LOGIN PÚBLICA (Gera o Token)
router.post('/api/clinica/login', authController.login);

// Middleware de Autenticação Real com JWT
const authMiddleware = (req, res, next) => {
    // Libera a demonstração caso precise
    if (req.path.includes('/demo/')) return next();
    
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: "Acesso não autorizado. Token ausente." });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'healthcrm_secret_key');
        req.user = decoded; // Coloca os dados do usuário (id, email, funcao) no req
        next();
    } catch (e) {
        return res.status(403).json({ error: "Sua sessão expirou ou o token é inválido. Faça login novamente." });
    }
};

// Aplica segurança em todas as rotas abaixo desta linha
router.use(authMiddleware);

// Roteamento exclusivo da Clínica (Painel)
router.use('/api/clinica', clinicaRoutes);

module.exports = router;