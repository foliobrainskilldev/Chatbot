const API_BASE_URL = 'https://chatbot-2tta.onrender.com';
let clienteAtivoId = null; 
let listaClientesGlobal = []; 
let configSistemaGlobal = {};
const socket = typeof io !== 'undefined' ? io(API_BASE_URL) : null;

window.onload = async () => {
    await carregarConfigIA(); 
    carregarDashboard();
};

async function carregarConfigIA() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/crm/config`);
        if (res.ok) {
            const data = await res.json();
            configSistemaGlobal = data || {}; 
        }
    } catch(e) { console.log("Aguardando backend..."); configSistemaGlobal = {}; }

    if (configSistemaGlobal.modoAtivo) aplicarTema(configSistemaGlobal.modoAtivo);
    else await abrirHubNeutro();

    const getEl = (id) => document.getElementById(id);
    if(getEl('confIaNome')) getEl('confIaNome').value = configSistemaGlobal.nomeAssistente || '';
    if(getEl('confIaTom')) getEl('confIaTom').value = configSistemaGlobal.tomDeVoz || '';
    if(getEl('confIaObj')) getEl('confIaObj').value = configSistemaGlobal.objetivos || '';
    if(getEl('confIaRegras')) getEl('confIaRegras').value = configSistemaGlobal.regrasExtrasIA || '';
    if(getEl('confIaFaq')) getEl('confIaFaq').value = configSistemaGlobal.faq || '';
    if(getEl('confIaTransf')) getEl('confIaTransf').value = configSistemaGlobal.regrasTransferencia || '';
    if(getEl('confIaDiag')) getEl('confIaDiag').checked = configSistemaGlobal.ignorarDiagnosticos || false;
    
    if(getEl('confAutoNovo')) getEl('confAutoNovo').checked = configSistemaGlobal.notificarNovosLeads || false;
    if(getEl('confAutoFollow')) getEl('confAutoFollow').checked = configSistemaGlobal.autoFollowUp || false;
    if(getEl('confAutoLemb')) getEl('confAutoLemb').checked = configSistemaGlobal.autoLembrete || false;
    if(getEl('confAutoDistr')) getEl('confAutoDistr').value = configSistemaGlobal.distribuicaoLeads || 'MANUAL';
    
    if(getEl('confIntMeta')) getEl('confIntMeta').value = configSistemaGlobal.metaToken || '';
    if(getEl('confIntWeb')) getEl('confIntWeb').value = configSistemaGlobal.webhookUrl || '';
}

function aplicarTema(modo) {
    const hub = document.getElementById('hub-neutro');
    if(hub) { hub.style.opacity = '0'; setTimeout(() => hub.style.display = 'none', 500); }
    document.body.className = modo === 'BARBEARIA' ? 'theme-barbearia' : 'theme-clinica';
    const logoSidebar = document.getElementById('logo-sidebar');
    if(logoSidebar) logoSidebar.innerHTML = modo === 'BARBEARIA' ? '<iconify-icon icon="solar:shop-2-bold"></iconify-icon> Barbearia CRM' : '<iconify-icon icon="solar:health-bold"></iconify-icon> Clínica CRM';
}

async function abrirHubNeutro() {
    try {
        const resStats = await fetch(`${API_BASE_URL}/api/crm/dashboard/stats`);
        if (resStats.ok) {
            const stats = await resStats.json();
            const elLeads = document.getElementById('hubKpiLeads');
            const elAg = document.getElementById('hubKpiAgendamentos');
            if (elLeads) elLeads.innerText = stats.totalLeads || 0;
            if (elAg) elAg.innerText = stats.agendamentosTotais || 0;
        }
    } catch (e) {}
    const hub = document.getElementById('hub-neutro');
    if (hub) { hub.style.display = 'flex'; setTimeout(() => hub.style.opacity = '1', 50); }
}

async function selecionarNicho(modo) {
    if (!configSistemaGlobal) configSistemaGlobal = {};
    configSistemaGlobal.modoAtivo = modo;
    configSistemaGlobal.ignorarDiagnosticos = (modo === 'CLINICA');
    await salvarConfigIADireto(configSistemaGlobal);
    showToast(`Aplicação ${modo} Ativada!`, 'success');
    aplicarTema(modo); carregarDashboard(); 
}

function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container'); if(!container) return;
    const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.innerHTML = msg;
    container.appendChild(toast); setTimeout(() => { toast.remove(); }, 3000);
}

function mudarAba(abaId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar .nav-btn').forEach(b => b.classList.remove('active'));
    const pageObj = document.getElementById(abaId); if(pageObj) pageObj.classList.add('active');
    if(event && event.currentTarget) event.currentTarget.classList.add('active');
    
    if(abaId === 'dashboard') carregarDashboard();
    if(abaId === 'contactos' && typeof carregarClientes === 'function') carregarClientes();
    if(abaId === 'conversas' && typeof carregarConversasPendentes === 'function') carregarConversasPendentes();
    if(abaId === 'calendario' && typeof carregarCalendario === 'function') carregarCalendario();
    if(abaId === 'equipe' && typeof carregarEquipe === 'function') carregarEquipe();
}

function switchConfigTab(tabId, btn) {
    document.querySelectorAll('.config-section').forEach(sec => sec.classList.remove('active'));
    const tabObj = document.getElementById(tabId); if(tabObj) tabObj.classList.add('active');
    document.querySelectorAll('#configuracoes .tab-btn').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active');
}

// ==========================================
// FORMATAÇÃO DO SISTEMA (RESET)
// ==========================================
async function formatarSistema() {
    if(!confirm('ATENÇÃO: O sistema vai formatar TODOS os leads, agendamentos e conversas.\nTem certeza absoluta?')) return;
    try {
        await fetch(`${API_BASE_URL}/api/crm/reset`, { method: 'POST' });
        showToast("Memória apagada com sucesso!", "success");
        carregarDashboard(); 
    } catch(e) { showToast("Erro ao apagar banco de dados.", "error"); }
}

// ==========================================
// GRÁFICOS D3.JS NATIVOS (Responsivos)
// ==========================================
function drawLineChartD3(containerId, data) {
    const container = d3.select(`#${containerId}`);
    container.selectAll("*").remove();
    if(!data || data.length === 0) return;

    const width = container.node().getBoundingClientRect().width;
    const height = 250;
    const margin = {top: 20, right: 20, bottom: 30, left: 40};
    
    const svg = container.append("svg").attr("width", "100%").attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
    const x = d3.scalePoint().domain(data.map(d => d.dia)).range([margin.left, width - margin.right]).padding(0.5);
    const y = d3.scaleLinear().domain([0, d3.max(data, d => d.count) || 5]).nice().range([height - margin.bottom, margin.top]);
    const color = getComputedStyle(document.body).getPropertyValue('--primary-color').trim() || "#16a34a";

    svg.append("g").attr("class", "d3-axis").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x));
    svg.append("g").attr("class", "d3-axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(5));

    const area = d3.area().x(d => x(d.dia)).y0(y(0)).y1(d => y(d.count)).curve(d3.curveMonotoneX);
    svg.append("path").datum(data).attr("fill", color).attr("opacity", 0.1).attr("d", area);

    const line = d3.line().x(d => x(d.dia)).y(d => y(d.count)).curve(d3.curveMonotoneX);
    svg.append("path").datum(data).attr("fill", "none").attr("stroke", color).attr("stroke-width", 3).attr("d", line);

    const tooltip = d3.select("#d3-tooltip");
    svg.selectAll("circle").data(data).enter().append("circle").attr("cx", d => x(d.dia)).attr("cy", d => y(d.count)).attr("r", 5).attr("fill", "white").attr("stroke", color).attr("stroke-width", 2)
        .on("mouseover", (event, d) => {
            tooltip.style("opacity", 1).html(`${d.dia}<br/>${d.count} Leads`).style("left", (event.pageX + 10) + "px").style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", () => tooltip.style("opacity", 0));
}

function drawDonutChartD3(containerId, data) {
    const container = d3.select(`#${containerId}`);
    container.selectAll("*").remove();

    const width = container.node().getBoundingClientRect().width || 300;
    const height = 250;
    const radius = Math.min(width, height) / 2 - 10;
    
    const svg = container.append("svg")
        .attr("width", "100%")
        .attr("height", height)
        .attr("viewBox", `0 0 ${width} ${height}`)
        .append("g")
        .attr("transform", `translate(${width / 2},${height / 2})`);

    // VALIDAÇÃO: Se o banco estiver zerado ou sem origens reais, mostra um Donut Cinza
    const isVazio = !data || data.length === 0 || data.every(d => d.contagem === 0);

    if (isVazio) {
        const arc = d3.arc().innerRadius(radius * 0.5).outerRadius(radius * 0.8);
        svg.append("path").attr("d", arc({startAngle: 0, endAngle: 2 * Math.PI})).attr("fill", "#e2e8f0");
        svg.append("text").attr("text-anchor", "middle").attr("dy", "0.3em").style("fill", "#94a3b8").style("font-size", "14px").text("Sem dados");
        return;
    }

    const color = d3.scaleOrdinal(["#38bdf8", "#a78bfa", "#facc15", "#4ade80", "#fb7185"]);
    const pie = d3.pie().value(d => d.contagem);
    const data_ready = pie(data);
    const arc = d3.arc().innerRadius(radius * 0.5).outerRadius(radius * 0.8);
    const tooltip = d3.select("#d3-tooltip");

    svg.selectAll("path").data(data_ready).enter().append("path")
        .attr("d", arc).attr("fill", d => color(d.data.rotulo)).attr("stroke", "white").style("stroke-width", "2px")
        .on("mouseover", (event, d) => {
            tooltip.style("opacity", 1).html(`${d.data.rotulo}<br/>${d.data.contagem}`).style("left", (event.pageX + 10) + "px").style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", () => tooltip.style("opacity", 0));
}

function drawBarChartD3(containerId, data) {
    const container = d3.select(`#${containerId}`);
    container.selectAll("*").remove();
    if(!data || data.length === 0) { container.html("<p style='text-align:center; padding:50px; color:#94a3b8;'>Sem agendamentos registrados.</p>"); return; }

    const width = container.node().getBoundingClientRect().width || 600;
    const height = 300;
    const margin = {top: 20, right: 20, bottom: 40, left: 50};
    
    const svg = container.append("svg").attr("width", "100%").attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);
    const x = d3.scaleBand().range([margin.left, width - margin.right]).domain(data.map(d => d.nome)).padding(0.2);
    const y = d3.scaleLinear().domain([0, d3.max(data, d => d.count) || 5]).nice().range([height - margin.bottom, margin.top]);
    const color = getComputedStyle(document.body).getPropertyValue('--primary-color').trim() || "#0284c7";

    svg.append("g").attr("class", "d3-axis").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x));
    svg.append("g").attr("class", "d3-axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(5));

    const tooltip = d3.select("#d3-tooltip");

    svg.selectAll("rect").data(data).enter().append("rect")
        .attr("x", d => x(d.nome)).attr("y", d => y(d.count)).attr("width", x.bandwidth()).attr("height", d => height - margin.bottom - y(d.count))
        .attr("fill", color).attr("rx", 4)
        .on("mouseover", (event, d) => {
            d3.select(event.currentTarget).attr("fill", "#0f172a");
            tooltip.style("opacity", 1).html(`${d.nome}<br/>${d.count} marcações`).style("left", (event.pageX + 10) + "px").style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", (event) => { d3.select(event.currentTarget).attr("fill", color); tooltip.style("opacity", 0); });
}

async function carregarDashboard() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/crm/dashboard/stats`);
        if (!res.ok) return;
        const stats = await res.json();
        
        const setText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
        
        setText('dashNovos', stats.funil?.novos || 0);
        setText('dashAgendados', stats.agendamentosTotais || 0);
        setText('dashCancelados', stats.cancelamentosTotais || 0);
        
        const totalSemNovos = (stats.totalLeads || 0) - (stats.funil?.novos || 0);
        setText('dashConversao', totalSemNovos > 0 ? `${((stats.funil.agendados / totalSemNovos) * 100).toFixed(1)}%` : '0%');

        if(stats.leadsPorDia) drawLineChartD3('d3-evolucao', stats.leadsPorDia.reverse());
        if(stats.origens) drawDonutChartD3('d3-origem', stats.origens);
        if(stats.topServicos) drawBarChartD3('d3-servicos', stats.topServicos);

    } catch(e) { console.log("Dashboard aguardando dados..."); }
}

window.addEventListener("resize", () => { carregarDashboard(); });

async function salvarConfigAvancada() {
    const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const getChk = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };

    configSistemaGlobal.nomeAssistente = getVal('confIaNome');
    configSistemaGlobal.tomDeVoz = getVal('confIaTom');
    configSistemaGlobal.objetivos = getVal('confIaObj');
    configSistemaGlobal.regrasExtrasIA = getVal('confIaRegras');
    configSistemaGlobal.faq = getVal('confIaFaq');
    configSistemaGlobal.regrasTransferencia = getVal('confIaTransf');
    configSistemaGlobal.ignorarDiagnosticos = getChk('confIaDiag');
    
    configSistemaGlobal.notificarNovosLeads = getChk('confAutoNovo');
    configSistemaGlobal.autoFollowUp = getChk('confAutoFollow');
    configSistemaGlobal.autoLembrete = getChk('confAutoLemb');
    configSistemaGlobal.distribuicaoLeads = getVal('confAutoDistr');
    
    configSistemaGlobal.metaToken = getVal('confIntMeta');
    configSistemaGlobal.webhookUrl = getVal('confIntWeb');
    
    await salvarConfigIADireto(configSistemaGlobal);
    showToast('Configurações atualizadas com sucesso!', 'success');
}

async function salvarConfigIADireto(payload) { 
    try { await fetch(`${API_BASE_URL}/api/crm/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } catch(e) {}
}

if (socket) {
    socket.on('atualizar_fila', () => { 
        if(typeof carregarConversasPendentes === 'function') carregarConversasPendentes(); 
        if(typeof carregarDashboard === 'function') carregarDashboard(); 
    });
    
    socket.on('nova_mensagem', (data) => {
        if (clienteAtivoId === data.clienteId) {
            const chatMensagens = document.getElementById('chatMensagens');
            if(chatMensagens && typeof parseMessageContent === 'function') {
                const div = document.createElement('div'); 
                div.className = `msg-balao ${data.mensagem.role === 'user' ? 'msg-user' : 'msg-assistant'}`; 
                div.innerHTML = parseMessageContent(data.mensagem.content);
                chatMensagens.appendChild(div); 
                chatMensagens.scrollTop = chatMensagens.scrollHeight;
            }
        }
    });
}