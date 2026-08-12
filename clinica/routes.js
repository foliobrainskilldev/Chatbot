const express = require('express');
const router = express.Router();
const multer = require('multer');

// CORREÇÃO APLICADA: Ponto e barra (./) colocados corretamente.
// IMPORTANTE: Se a sua pasta se chama "controller" (sem S), remova o "s" nas linhas abaixo.
const crmLeadsController = require('./controllers/crmLeadsController'); 
const chatController = require('./controllers/chatController');
const agendaTratamentosController = require('./controllers/agendaTratamentosController');
const configController = require('.controllers/configController');

// Módulos que estão na pasta raiz da clínica (junto com routes.js)
const relatoriosController = require('./relatoriosController');
const webhookController = require('./webhookController');
const automacoesController = require('./automacoesController'); 

const storage = multer.memoryStorage();
const upload = multer({ storage });

// ==========================================
// ROTAS DE DASHBOARD E RELATÓRIOS
// ==========================================
router.get('/dashboard/stats', crmLeadsController.getDashboardStats);
router.get('/relatorios/geral', relatoriosController.getRelatoriosGerais);
router.get('/relatorios/atendimento', relatoriosController.getRelatoriosAtendimento);
router.get('/relatorios/exportar', relatoriosController.exportarRelatorioCSV);

// ==========================================
// CONFIGURAÇÕES GERAIS DA CLÍNICA E ZONA DE PERIGO (RESET)
// ==========================================
router.get('/config', configController.getConfigCompleta);
router.put('/config', upload.single('logo'), configController.atualizarConfigCompleta);
router.post('/config/test-storage', configController.testSupabase);
router.post('/reset', configController.formatarSistemaClinica);

// ==========================================
// CRM, PIPELINE E LEADS
// ==========================================
router.get('/leads', crmLeadsController.getLeads);
router.post('/leads', crmLeadsController.criarLeadManual); 
router.put('/leads/:id/status', crmLeadsController.atualizarStatusLead);
router.put('/leads/:id', crmLeadsController.atualizarLeadCompleto);

// ==========================================
// CENTRAL DE MENSAGENS (INBOX / CHAT)
// ==========================================
router.get('/conversas/pendentes', chatController.getConversasPendentes);
router.get('/conversas/:clienteId', chatController.getMensagensConversa);
router.get('/conversas/:clienteId/notas', chatController.getNotasInternas);
router.post('/conversas/:clienteId/notas', chatController.criarNotaInterna);
router.post('/conversas/:clienteId/enviar', upload.single('arquivo'), chatController.enviarMensagemManual);
router.post('/conversas/:clienteId/assumir', chatController.assumirAtendimentoHumano);
router.post('/conversas/:clienteId/resolver', chatController.resolverAtendimentoHumano);

// ==========================================
// AGENDAMENTOS E CALENDÁRIO
// ==========================================
router.get('/agendamentos/todos', agendaTratamentosController.getAgendamentosTodos);
router.get('/agendamentos/disponiveis', agendaTratamentosController.getHorariosLivresApi); 
router.post('/agendamentos', agendaTratamentosController.criarAgendamentoManual);         
router.put('/agendamentos/:id/status', agendaTratamentosController.atualizarStatusAgendamento);

// ==========================================
// BASE DE CONHECIMENTO (TRATAMENTOS)
// ==========================================
router.get('/tratamentos', agendaTratamentosController.getTratamentos);
router.post('/tratamentos', upload.single('imagem'), agendaTratamentosController.salvarTratamento);
router.delete('/tratamentos/:id', agendaTratamentosController.excluirTratamento);

// ==========================================
// CONFIGURAÇÃO DO CÉREBRO DA IA 
// ==========================================
router.get('/ia/config', chatController.getConfigIA);
router.put('/ia/config', upload.single('avatar'), chatController.atualizarConfigIA); 
router.post('/ia/testar', chatController.testarIA); 

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
router.get('/equipe/atividades', crmLeadsController.getAtividadesEquipe);
router.get('/equipe/:id/perfil', crmLeadsController.getMembroPerfil);
router.get('/equipe', crmLeadsController.getEquipe);
router.post('/equipe', crmLeadsController.criarMembroEquipe);
router.put('/equipe/:id', crmLeadsController.atualizarMembroEquipe);

module.exports = router;