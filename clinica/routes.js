const express = require('express');
const router = express.Router();
const multer = require('multer');

const crmControllerClinica = require('./crmController'); 
const relatoriosController = require('./relatoriosController');
const webhookController = require('./webhookController');
const automacoesController = require('./automacoesController'); 
const configController = require('./configController');

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
// CONFIGURAÇÕES GERAIS DA CLÍNICA
// ==========================================
router.get('/config', configController.getConfigCompleta);
router.put('/config', upload.single('logo'), configController.atualizarConfigCompleta);
router.post('/config/test-storage', configController.testCloudinary);

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
// INTEGRAÇÕES E WEBHOOKS AVANÇADOS
// ==========================================
router.get('/webhooks', webhookController.getWebhooks);
router.get('/webhooks/logs', webhookController.getWebhookLogs);
router.post('/webhooks', webhookController.createWebhook);
router.post('/webhooks/:id/test', webhookController.testWebhook);
router.put('/webhooks/:id/toggle', webhookController.toggleWebhook);
router.delete('/webhooks/:id', webhookController.deleteWebhook);

// ==========================================
// MOTOR DE AUTOMAÇÕES E FLUXOS
// ==========================================
router.get('/automacoes', automacoesController.getAutomacoes);
router.post('/automacoes', automacoesController.criarAutomacao);
router.put('/automacoes/:id/toggle', automacoesController.toggleAutomacao);
router.delete('/automacoes/:id', automacoesController.deletarAutomacao);
router.get('/automacoes/historico', automacoesController.getHistoricoExecucao);

// ==========================================
// EQUIPE, PERMISSÕES E AUDITORIA
// ==========================================
router.get('/equipe/atividades', crmControllerClinica.getAtividadesEquipe);
router.get('/equipe/:id/perfil', crmControllerClinica.getMembroPerfil);
router.get('/equipe', crmControllerClinica.getEquipe);
router.post('/equipe', crmControllerClinica.criarMembroEquipe);
router.put('/equipe/:id', crmControllerClinica.atualizarMembroEquipe);

module.exports = router;