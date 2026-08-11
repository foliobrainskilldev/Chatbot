const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const express = require('express');

// 1. Rate Limiting Global
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 3000, // Aumentado substancialmente para evitar bloqueios via proxy
    message: { 
        error: "Muitas requisições originadas deste IP. Por favor, tente novamente após 15 minutos." 
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// 2. Limiter exclusivo para a rota de Webhooks da Meta 
const webhookLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, 
    max: 10000, // Limite drasticamente aumentado pois a Meta dispara eventos demais
    message: "Rate limit excedido para webhooks.",
    skipFailedRequests: true
});

// 3. Proteção de Cabeçalhos (Helmet)
const securityHeaders = helmet({
    contentSecurityPolicy: false, 
    crossOriginEmbedderPolicy: false
});

// 4. Validador de Tamanho de Payload
const payloadLimit = express.json({ limit: '50mb' });
const urlEncodedLimit = express.urlencoded({ extended: true, limit: '50mb' });

module.exports = {
    globalLimiter,
    webhookLimiter,
    securityHeaders,
    payloadLimit,
    urlEncodedLimit
};