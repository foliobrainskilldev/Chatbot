// ==========================================
// RENDERIZAÇÃO DO CHAT E ÁUDIOS (WhatsApp Like)
// ==========================================
function parseMessageContent(content) {
    if (!content) return "";
    
    if (content.startsWith('[MEDIA:image]')) {
        const parts = content.split(' | Transcrição: ');
        const url = parts[0].replace('[MEDIA:image] ', '').trim();
        const caption = parts[1] && parts[1] !== 'null' ? `<br><span style="font-size: 14px;">${parts[1]}</span>` : '';
        return `<img src="${API_BASE_URL}${url}" style="max-width: 100%; border-radius: 8px; margin-bottom: 4px;" />${caption}`;
    }
    
    if (content.startsWith('[MEDIA:audio]')) {
        const parts = content.split(' | Transcrição: ');
        const url = parts[0].replace('[MEDIA:audio] ', '').trim();
        const texto = parts[1] && parts[1] !== 'null' ? parts[1].trim() : '';
        const cap = texto ? `<div class="wa-audio-transcription"><div class="wa-transcription-header">Transcrição I.A</div><span>${texto}</span></div>` : '';
        
        return `<div style="display:flex; flex-direction:column; gap:4px; min-width: 220px;">
                    <div class="wa-audio-container">
                        <button class="wa-play-btn" onclick="toggleWaAudio(this)"><iconify-icon icon="solar:play-bold"></iconify-icon></button>
                        <div class="wa-audio-slider-container"><input type="range" class="wa-audio-slider" value="0" max="100" step="0.1" oninput="seekWaAudio(this)"></div>
                        <div class="wa-audio-time">0:00</div>
                        <audio src="${API_BASE_URL}${url}" class="hidden-audio" preload="metadata" ontimeupdate="updateWaTime(this)" onloadedmetadata="setWaDuration(this)" onended="resetWaAudio(this)"></audio>
                    </div>${cap}
                </div>`;
    }
    
    if (content.startsWith('[MEDIA:video]') || content.startsWith('[MEDIA:document]')) {
        const type = content.startsWith('[MEDIA:video]') ? 'video' : 'document';
        const parts = content.split(' | Transcrição: ');
        const url = parts[0].replace(`[MEDIA:${type}] `, '').trim();
        if(type === 'video') return `<video controls style="max-width: 100%; border-radius: 8px;"><source src="${API_BASE_URL}${url}"></video>`;
        return `<a href="${API_BASE_URL}${url}" target="_blank" style="display:flex; align-items:center; gap:8px; color:var(--primary-color); font-weight:600; text-decoration:none;"><iconify-icon icon="solar:document-bold" style="font-size:24px;"></iconify-icon> Ver Documento</a>`;
    }
    return content.replace(/\n/g, '<br>');
}

window.toggleWaAudio = function(btn) {
    const container = btn.closest('.wa-audio-container');
    const audio = container.querySelector('.hidden-audio');
    const icon = btn.querySelector('iconify-icon');
    document.querySelectorAll('.hidden-audio').forEach(a => { if(a !== audio && !a.paused) { a.pause(); a.closest('.wa-audio-container').querySelector('.wa-play-btn iconify-icon').setAttribute('icon', 'solar:play-bold'); }});
    if (audio.paused) { audio.play(); icon.setAttribute('icon', 'solar:pause-bold'); } else { audio.pause(); icon.setAttribute('icon', 'solar:play-bold'); }
};
window.updateWaTime = function(audio) {
    const container = audio.closest('.wa-audio-container'); const slider = container.querySelector('.wa-audio-slider'); const timeDisplay = container.querySelector('.wa-audio-time');
    if (audio.duration) { slider.value = (audio.currentTime / audio.duration) * 100; timeDisplay.innerText = `${Math.floor(audio.currentTime / 60)}:${Math.floor(audio.currentTime % 60).toString().padStart(2, '0')}`; }
};
window.setWaDuration = function(audio) {
    const container = audio.closest('.wa-audio-container'); const timeDisplay = container.querySelector('.wa-audio-time');
    timeDisplay.innerText = `${Math.floor(audio.duration / 60)}:${Math.floor(audio.duration % 60).toString().padStart(2, '0')}`;
};
window.seekWaAudio = function(slider) { const audio = slider.closest('.wa-audio-container').querySelector('.hidden-audio'); if (audio.duration) audio.currentTime = (slider.value / 100) * audio.duration; };
window.resetWaAudio = function(audio) {
    const container = audio.closest('.wa-audio-container'); container.querySelector('.wa-play-btn iconify-icon').setAttribute('icon', 'solar:play-bold');
    container.querySelector('.wa-audio-slider').value = 0; container.querySelector('.wa-audio-time').innerText = `${Math.floor(audio.duration / 60)}:${Math.floor(audio.duration % 60).toString().padStart(2, '0')}`;
};

// ==========================================
// BASE DE LEADS (CRM)
// ==========================================
function getStatusBadge(status) {
    const badges = { 'NOVO': '<span class="badge-status bg-novo">NOVO</span>', 'EM_CONVERSA': '<span class="badge-status bg-em-conversa">EM CONVERSA</span>', 'QUALIFICADO': '<span class="badge-status bg-qualificado">QUALIFICADO</span>', 'AGENDADO': '<span class="badge-status bg-agendado">AGENDADO</span>', 'PERDIDO': '<span class="badge-status" style="background:#fecaca; color:#991b1b;">PERDIDO</span>' };
    return badges[status] || badges['NOVO'];
}

async function carregarClientes() {
    const tbody = document.querySelector('#tabelaClientesBox tbody');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">A carregar...</td></tr>';
    try {
        const res = await fetch(`${API_BASE_URL}/api/crm/leads`);
        if(!res.ok) throw new Error();
        listaClientesGlobal = await res.json();
        tbody.innerHTML = '';
        listaClientesGlobal.forEach(c => {
            const resp = c.responsavel ? c.responsavel.nome : '<i style="color:#aaa;">Sem Atribuição</i>';
            const tagHtml = c.tags ? c.tags.split(',').map(t => `<span style="background:#e2e8f0; font-size:11px; padding:2px 5px; border-radius:4px; margin-right:4px;">${t.trim()}</span>`).join('') : '-';
            tbody.innerHTML += `<tr><td>${c.id}</td><td>${c.nome || 'Sem Nome'}</td><td style="position:relative;">${getStatusBadge(c.leadStatus)}</td><td>${tagHtml}</td><td>${c.valorPotencial}</td><td>${resp}</td></tr>`;
        });
    } catch(e) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Erro ao carregar base.</td></tr>'; }
}

// ==========================================
// CHAT CENTRAL & NOTAS
// ==========================================
async function carregarConversasPendentes() {
    const lista = document.getElementById('listaEspera');
    if(!lista) return;
    try {
        const res = await fetch(`${API_BASE_URL}/api/crm/conversas/pendentes`);
        if(!res.ok) throw new Error();
        const clientes = await res.json();
        lista.innerHTML = '';
        clientes.forEach(c => {
            const div = document.createElement('div');
            div.className = `chat-cliente-item ${clienteAtivoId === c.id ? 'active' : ''}`;
            div.innerHTML = `<strong>${c.nome || 'Lead s/ Nome'}</strong><br><small>${c.id}</small>${getStatusBadge(c.leadStatus)}`;
            div.onclick = () => abrirChat(c.id, c.nome || c.id, c.leadStatus, c.tags, c.valorPotencial);
            lista.appendChild(div);
        });
    } catch (e) { lista.innerHTML = '<div style="padding: 20px; text-align: center;">Erro ao carregar chat</div>'; }
}

async function abrirChat(id, nome, leadStatus, tags, valor) {
    clienteAtivoId = id;
    if(document.getElementById('caixaVazia')) document.getElementById('caixaVazia').style.display = 'none';
    if(document.getElementById('caixaChat')) document.getElementById('caixaChat').style.display = 'flex';
    if(document.getElementById('chatNomeCliente')) document.getElementById('chatNomeCliente').innerText = nome;
    if(document.getElementById('chatNumero')) document.getElementById('chatNumero').innerText = id;
    if(document.getElementById('chatLeadStatus')) document.getElementById('chatLeadStatus').value = leadStatus || 'NOVO';
    if(document.getElementById('chatLeadTags')) document.getElementById('chatLeadTags').value = tags || '';
    if(document.getElementById('chatLeadValor')) document.getElementById('chatLeadValor').value = valor || 0;
    
    carregarNotasInternas();
    
    const chatMensagens = document.getElementById('chatMensagens');
    if(chatMensagens) {
        chatMensagens.innerHTML = '';
        try {
            const res = await fetch(`${API_BASE_URL}/api/crm/conversas/${id}`);
            const msgs = await res.json();
            msgs.forEach(msg => {
                const div = document.createElement('div');
                div.className = `msg-balao ${msg.role === 'user' ? 'msg-user' : 'msg-assistant'}`;
                div.innerHTML = parseMessageContent(msg.content);
                chatMensagens.appendChild(div);
            });
            chatMensagens.scrollTop = chatMensagens.scrollHeight;
        } catch (e) {}
    }
}

async function atualizarDadosLeadChat() {
    if(!clienteAtivoId) return;
    const body = {
        status: document.getElementById('chatLeadStatus').value,
        tags: document.getElementById('chatLeadTags').value,
        valorPotencial: parseFloat(document.getElementById('chatLeadValor').value) || 0
    };
    try {
        await fetch(`${API_BASE_URL}/api/crm/leads/${clienteAtivoId}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if(typeof showToast === 'function') showToast("Dados do Lead atualizados.");
        carregarConversasPendentes();
    } catch(e) {}
}

async function carregarNotasInternas() {
    if(!clienteAtivoId) return;
    const divNotas = document.getElementById('listaNotasInternas');
    if(!divNotas) return;
    divNotas.innerHTML = 'A carregar...';
    try {
        const res = await fetch(`${API_BASE_URL}/api/crm/conversas/${clienteAtivoId}/notas`);
        const notas = await res.json();
        divNotas.innerHTML = '';
        notas.forEach(n => {
            const dt = new Date(n.criadoEm).toLocaleDateString('pt-PT', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
            divNotas.innerHTML += `<div style="background:rgba(0,0,0,0.03); padding:5px; margin-bottom:5px; border-radius:4px;"><strong>${n.usuario.nome}</strong> (${dt}): ${n.texto}</div>`;
        });
    } catch(e) { divNotas.innerHTML = ''; }
}

async function salvarNotaInterna() {
    if(!clienteAtivoId) return;
    const el = document.getElementById('inputNotaInterna');
    if(!el || !el.value) return;
    try {
        await fetch(`${API_BASE_URL}/api/crm/conversas/${clienteAtivoId}/notas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: el.value }) });
        el.value = '';
        carregarNotasInternas();
    } catch(e) {}
}

async function enviarMensagemManual() {
    if (!clienteAtivoId) return;
    const elTxt = document.getElementById('inputMensagem');
    const elFile = document.getElementById('inputFile');
    if(!elTxt) return;
    const txt = elTxt.value.trim();
    const file = elFile && elFile.files ? elFile.files[0] : null;
    if (!txt && !file) return;
    
    elTxt.value = ''; if(elFile) elFile.value = '';
    const fd = new FormData(); if(txt) fd.append('texto', txt); if(file) fd.append('arquivo', file);
    await fetch(`${API_BASE_URL}/api/crm/conversas/${clienteAtivoId}/enviar`, { method: 'POST', body: fd });
}

document.getElementById('btnResolverChat')?.addEventListener('click', async () => {
    if (!clienteAtivoId) return;
    await fetch(`${API_BASE_URL}/api/crm/conversas/${clienteAtivoId}/resolver`, { method: 'POST' });
    clienteAtivoId = null;
    if(document.getElementById('caixaChat')) document.getElementById('caixaChat').style.display = 'none';
    if(document.getElementById('caixaVazia')) document.getElementById('caixaVazia').style.display = 'flex';
    carregarConversasPendentes(); 
});

function filtrarChats() {
    const term = document.getElementById('pesquisaChat').value.toLowerCase();
    document.querySelectorAll('.chat-cliente-item').forEach(el => {
        el.style.display = el.innerText.toLowerCase().includes(term) ? 'block' : 'none';
    });
}

// ==========================================
// CALENDÁRIO
// ==========================================
async function carregarCalendario() {
    const tbody = document.querySelector('#tabelaCalendario tbody');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6">A carregar...</td></tr>';
    try {
        const res = await fetch(`${API_BASE_URL}/api/crm/agendamentos/todos`);
        const agendas = await res.json();
        tbody.innerHTML = '';
        agendas.forEach(ag => {
            const hora = new Date(ag.dataHora).toLocaleString('pt-PT');
            const serv = ag.tratamento ? ag.tratamento.nome : (ag.servico ? ag.servico.nome : '-');
            const prof = ag.profissionalSaude ? ag.profissionalSaude.nome : (ag.barbeiro ? ag.barbeiro.nome : '-');
            const stColor = ag.status === 'CANCELADO' ? 'red' : 'green';
            tbody.innerHTML += `<tr>
                <td>${hora}</td><td>${ag.cliente?.nome || ag.clienteId}</td><td>${serv}</td><td>${prof}</td>
                <td style="color:${stColor}; font-weight:bold;">${ag.status}</td>
                <td><select onchange="mudarStatusAgendamento(${ag.id}, this.value)" class="form-control" style="padding:4px; margin:0; width:auto;"><option value="">Ação...</option><option value="CONCLUIDO">Concluído</option><option value="CANCELADO">Cancelar</option></select></td>
            </tr>`;
        });
    } catch(e) { tbody.innerHTML = '<tr><td colspan="6">Erro ao carregar calendário.</td></tr>'; }
}

async function mudarStatusAgendamento(id, status) {
    if(!status) return;
    try {
        await fetch(`${API_BASE_URL}/api/crm/agendamentos/${id}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
        if(typeof showToast === 'function') showToast("Status da Agenda alterado!");
        carregarCalendario();
    } catch(e) {}
}

// ==========================================
// EQUIPE & EXPORTAÇÃO
// ==========================================
async function carregarEquipe() {
    const tbody = document.querySelector('#tabelaEquipe tbody');
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6">A carregar...</td></tr>';
    try {
        const res = await fetch(`${API_BASE_URL}/api/crm/equipe`);
        const eq = await res.json();
        tbody.innerHTML = '';
        eq.forEach(u => {
            const stColor = u.status === 'ONLINE' ? 'green' : 'gray';
            tbody.innerHTML += `<tr><td>${u.id}</td><td>${u.nome}</td><td>${u.email}</td><td>${u.funcao}</td><td style="color:${stColor}; font-weight:bold;">${u.status}</td><td><button class="btn-danger" style="padding:5px;" onclick="excluirMembro(${u.id})">Excluir</button></td></tr>`;
        });
    } catch(e) { tbody.innerHTML = '<tr><td colspan="6">Erro.</td></tr>'; }
}

async function criarMembroEquipe() {
    const elNome = document.getElementById('novoUserNome');
    const elEmail = document.getElementById('novoUserEmail');
    if(!elNome || !elEmail) return;
    const nome = elNome.value; const email = elEmail.value;
    if(!nome || !email) { if(typeof showToast === 'function') showToast('Preencha nome e e-mail', 'error'); return; }
    
    try {
        await fetch(`${API_BASE_URL}/api/crm/equipe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, email, senha: '123', funcao: 'ATENDENTE' }) });
        elNome.value = ''; elEmail.value = '';
        if(typeof showToast === 'function') showToast('Membro Adicionado!');
        carregarEquipe();
    } catch(e) { showToast('Erro', 'error'); }
}

async function excluirMembro(id) {
    if(!confirm('Deletar este membro permanentemente?')) return;
    try {
        await fetch(`${API_BASE_URL}/api/crm/equipe/${id}`, { method: 'DELETE' });
        if(typeof showToast === 'function') showToast('Membro removido');
        carregarEquipe();
    } catch(e) {}
}

function exportarCSV() {
    if(listaClientesGlobal.length === 0) {
        if(typeof showToast === 'function') showToast("Não há leads para exportar!", "error");
        return;
    }
    let csvContent = "data:text/csv;charset=utf-8,Numero WhatsApp,Nome,Status Funil,Valor Potencial,Origem\n";
    listaClientesGlobal.forEach(c => {
        const nome = c.nome ? c.nome.replace(/,/g, "") : "Sem Nome"; 
        csvContent += `${c.id},${nome},${c.leadStatus},${c.valorPotencial},${c.origem}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "crm_leads_export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if(typeof showToast === 'function') showToast("Planilha extraída com sucesso!", "success");
}