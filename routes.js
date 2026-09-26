// --- START OF FILE routes.js ---
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken'); 

// Importação dos Motores e Controladores Principais
const botEngine = require('./botEngine');
const hubController = require('./hubController');

// Importação das Rotas Específicas por Nicho (Tenants)
const clinicaRoutes = require('./clinica/routes');
const barbeariaRoutes = require('./barbearia/routes');

// ==========================================
// 🛡️ MIDDLEWARE DE AUTENTICAÇÃO E SEGURANÇA
// Protege as rotas contra BOLA/IDOR e acessos anônimos
// ==========================================
const authMiddleware = (req, res, next) => {
    // 1. Permite que os Webhooks da Meta passem livremente (eles têm a sua própria verificação de Token)
    if (req.path.startsWith('/webhook')) return next();
    
    // 2. Ignora as rotas públicas do modo de demonstração (Portfólio)
    if (req.path.includes('/demo/')) return next();
    
    /* 
       =========================================================
       🔒 LÓGICA FINAL DE PRODUÇÃO (Descomentar quando o Frontend tiver Login)
       =========================================================
       const authHeader = req.headers['authorization'];
       const token = authHeader && authHeader.split(' ')[1];
       
       if (!token) {
           return res.status(401).json({ error: "Acesso não autorizado. Token ausente." });
       }
       
       try {
           const decoded = jwt.verify(token, process.env.JWT_SECRET || 'healthcrm_secret_key');
           req.user = decoded; // Injcta os dados do usuário (id, funcao) na requisição
       } catch (e) {
           return res.status(403).json({ error: "Token inválido ou expirado." });
       }
    */

    // =========================================================
    // ⚠️ MOCK DE DESENVOLVIMENTO
    // Simula que um Administrador está logado para que o seu painel atual funcione sem a tela de login pronta.
    // Para testar o bloqueio de privilégios (BOPLA), mude 'ADMIN' para 'ATENDENTE'.
    // =========================================================
    req.user = req.user || { id: 1, funcao: 'ADMIN' };
    
    next();
};

// ==========================================
// 🌍 WEBHOOK (WHATSAPP META API) - PÚBLICO
// Estas rotas ficam antes do middleware para não serem bloqueadas
// ==========================================
router.get('/webhook', botEngine.verificarWebhook);
router.post('/webhook', botEngine.processarWebhook);

// Aplica a segurança em TODAS as rotas que vêm abaixo
router.use(authMiddleware);

// ==========================================
// ⚙️ HUB CENTRAL (Gestão Global do SaaS) - PROTEGIDO
// ==========================================
router.get('/hub/config', hubController.getConfigSistema);
router.post('/hub/config', hubController.saveConfigSistema);
router.post('/hub/motor', hubController.mudarMotorAtivo); 
router.get('/hub/stats', hubController.getHubStats);
router.post('/hub/reset', hubController.formatarSistemaCompleto);

// ==========================================
// 🚀 ROTEAMENTO ISOLADO POR NICHO (TENANTS) - PROTEGIDO
// Encaminha as requisições para as pastas específicas (Clínica ou Barbearia)
// ==========================================
router.use('/api/clinica', clinicaRoutes);
router.use('/api/barbearia', barbeariaRoutes);

module.exports = router;
// --- END OF FILE routes.js ---