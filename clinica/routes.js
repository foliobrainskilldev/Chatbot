--- START OF FILE routes.js ---

const express = require('express');
const router = express.Router();
const multer = require('multer');

const crmControllerClinica = require('./crmController'); 
const relatoriosController = require('./relatoriosController');
const webhookController = require('./webhookController');
const automacoesController = require('./automacoesController'); 

const storage = multer.memoryStorage();
const upload = multer({ storage });

// ==========================================
// ROTAS DE DASHBOARD E RELATÓRIOS
// ==========================================
router.get('/dashboard/stats', crmControllerClinica.getDashboardStats);
router.get('/relatorios/geral', relatoriosController.getRelatoriosGerais);
router.get('/relatorios/atendimento', relatoriosController.getRelatoriosAtendimento);
router.get('/relatorios/exportar', relatoriosController.exportarRelatorioCSV);

// ==========================================
// CRM, PIPELINE E LEADS
// ==========================================
router.get('/leads', crmControllerClinica.getLeads);
router.post('/leads', crmControllerClinica.criarLeadManual); 
router.put('/leads/:id/status', crmControllerClinica.atualizarStatusLead);
router.put('/leads/:id', crmControllerClinica.atualizarLeadCompleto);

// ==========================================
// CENTRAL DE MENSAGENS (INBOX)
// ==========================================
router.get('/conversas/pendentes', crmControllerClinica.getConversasPendentes);
router.get('/conversas/:clienteId', crmControllerClinica.getMensagensConversa);
router.get('/conversas/:clienteId/notas', crmControllerClinica.getNotasInternas);
router.post('/conversas/:clienteId/notas', crmControllerClinica.criarNotaInterna);
router.post('/conversas/:clienteId/enviar', upload.single('arquivo'), crmControllerClinica.enviarMensagemManual);
router.post('/conversas/:clienteId/assumir', crmControllerClinica.assumirAtendimentoHumano);
router.post('/conversas/:clienteId/resolver', crmControllerClinica.resolverAtendimentoHumano);

// ==========================================
// AGENDAMENTOS E CALENDÁRIO
// ==========================================
router.get('/agendamentos/todos', crmControllerClinica.getAgendamentosTodos);
router.get('/agendamentos/disponiveis', crmControllerClinica.getHorariosLivresApi); 
router.post('/agendamentos', crmControllerClinica.criarAgendamentoManual);         
router.put('/agendamentos/:id/status', crmControllerClinica.atualizarStatusAgendamento);

// ==========================================
// BASE DE CONHECIMENTO (TRATAMENTOS)
// ==========================================
router.get('/tratamentos', crmControllerClinica.getTratamentos);
router.post('/tratamentos', upload.single('imagem'), crmControllerClinica.salvarTratamento);
router.delete('/tratamentos/:id', crmControllerClinica.excluirTratamento);

// ==========================================
// CONFIGURAÇÃO DO CÉREBRO DA IA
// ==========================================
router.get('/ia/config', crmControllerClinica.getConfigIA);
router.put('/ia/config', upload.single('avatar'), crmControllerClinica.atualizarConfigIA); 
router.post('/ia/testar', crmControllerClinica.testarIA); 

// ==========================================
// CONFIGURAÇÕES GERAIS, WEBHOOKS E EQUIPE
// ==========================================
router.get('/webhooks', webhookController.getWebhooks);
router.post('/webhooks', webhookController.createWebhook);
router.put('/webhooks/:id/toggle', webhookController.toggleWebhook);
router.delete('/webhooks/:id', webhookController.deleteWebhook);

// ==========================================
// MOTOR DE AUTOMAÇÕES, FLUXOS E FOLLOW-UP
// ==========================================
router.get('/automacoes', automacoesController.getAutomacoes);
router.post('/automacoes', automacoesController.criarAutomacao);
router.put('/automacoes/:id/toggle', automacoesController.toggleAutomacao); // NOVA
router.delete('/automacoes/:id', automacoesController.deletarAutomacao);
router.get('/automacoes/historico', automacoesController.getHistoricoExecucao); // NOVA

// ==========================================
// EQUIPE
// ==========================================
router.get('/equipe', crmControllerClinica.getEquipe);
router.post('/equipe', crmControllerClinica.criarMembroEquipe);
router.delete('/equipe/:id', crmControllerClinica.deletarMembroEquipe);

module.exports = router;