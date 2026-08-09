const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const express = require('express');

// 1. Rate Limiting (Proteção contra DDoS e Força Bruta)
// Limita cada IP a 300 requisições a cada 15 minutos.
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 300, 
    message: { 
        error: "Muitas requisições originadas deste IP. Por favor, tente novamente após 15 minutos." 
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Limiter mais estrito exclusivo para a rota de Webhooks da Meta 
// (A Meta envia muitos eventos, mas previne que um atacante simule a Meta)
const webhookLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 500,
    message: "Rate limit excedido para webhooks."
});

// 2. Proteção de Cabeçalhos (Helmet)
// Oculata o "X-Powered-By: Express" e configura CSP, XSS Filter, HSTS, etc.
const securityHeaders = helmet({
    contentSecurityPolicy: false, // Desativado no backend para não bloquear os assets do Cloudinary/D3 no Front
    crossOriginEmbedderPolicy: false
});

// 3. Validador de Tamanho de Payload
// Evita que enviem JSONs gigantescos para travar a memória do Node.
const payloadLimit = express.json({ limit: '10mb' });
const urlEncodedLimit = express.urlencoded({ extended: true, limit: '10mb' });

module.exports = {
    globalLimiter,
    webhookLimiter,
    securityHeaders,
    payloadLimit,
    urlEncodedLimit
};