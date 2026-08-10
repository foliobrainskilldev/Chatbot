const express = require('express');
const router = express.Router();
const multer = require('multer');

const crmControllerClinica = require('./crmController'); 
const relatoriosController = require('./relatoriosController');
const webhookController = require('./webhookController');
const automacoesController = require('./automacoesController'); // NOVO CONTROLLER

const storage = multer.memoryStorage();
const upload = multer({ storage });

// DASHBOARD & ANALYTICS
router.get('/dashboard/stats', crmControllerClinica.getDashboardStats);
router.get('/relatorios/geral', relatoriosController.getRelatoriosGerais);
router.get('/relatorios/atendimento', relatoriosController.getRelatoriosAtendimento);

// CRM & LEADS (Agora com query params para Paginação e Busca)
router.get('/leads', crmControllerClinica.getLeads);
router.put('/leads/:id/status', crmControllerClinica.atualizarStatusLead);
router.put('/leads/:id', crmControllerClinica.atualizarLeadCompleto);

// CHAT / CAIXA DE ENTRADA
router.get('/conversas/pendentes', crmControllerClinica.getConversasPendentes);
router.get('/conversas/:clienteId', crmControllerClinica.getMensagensConversa);
router.post('/conversas/:clienteId/enviar', upload.single('arquivo'), crmControllerClinica.enviarMensagemManual);
router.post('/conversas/:clienteId/assumir', crmControllerClinica.assumirAtendimentoHumano);
router.post('/conversas/:clienteId/resolver', crmControllerClinica.resolverAtendimentoHumano);

// CALENDÁRIO & AGENDAMENTOS
router.get('/agendamentos/todos', crmControllerClinica.getAgendamentosTodos);
router.put('/agendamentos/:id/status', crmControllerClinica.atualizarStatusAgendamento);

// BASE DE CONHECIMENTO (TRATAMENTOS)
router.get('/tratamentos', crmControllerClinica.getTratamentos);
router.post('/tratamentos', upload.single('imagem'), crmControllerClinica.salvarTratamento);
router.delete('/tratamentos/:id', crmControllerClinica.excluirTratamento);

// IA CONFIGURAÇÕES
router.get('/ia/config', crmControllerClinica.getConfigIA);
router.put('/ia/config', crmControllerClinica.atualizarConfigIA);

// INTEGRAÇÕES & WEBHOOKS
router.get('/webhooks', webhookController.getWebhooks);
router.post('/webhooks', webhookController.createWebhook);
router.put('/webhooks/:id/toggle', webhookController.toggleWebhook);
router.delete('/webhooks/:id', webhookController.deleteWebhook);

// AUTOMAÇÕES (NOVO ENDPOINT)
router.get('/automacoes', automacoesController.getAutomacoes);
router.post('/automacoes', automacoesController.criarAutomacao);
router.delete('/automacoes/:id', automacoesController.deletarAutomacao);

// GESTÃO DE EQUIPE
router.get('/equipe', crmControllerClinica.getEquipe);
router.post('/equipe', crmControllerClinica.criarMembroEquipe);
router.delete('/equipe/:id', crmControllerClinica.deletarMembroEquipe);

module.exports = router;