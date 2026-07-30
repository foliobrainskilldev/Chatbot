const { sendText, sendInteractiveMenu: metaInteractiveMenu } = require('./whatsappApi');

// Aceita formato novo (numero, texto) e formato antigo (null, numero, texto)
async function sendDelayedText(arg1, arg2, arg3) {
    const jid = arg3 !== undefined ? arg2 : arg1;
    const text = arg3 !== undefined ? arg3 : arg2;
    await sendText(jid, text);
}

// Aceita formato novo e formato antigo blindado, detetando automaticamente o que recebe
async function sendInteractiveMenu(arg1, arg2, arg3, arg4) {
    const jid = arg4 !== undefined ? arg2 : arg1;
    const text = arg4 !== undefined ? arg3 : arg2;
    const options = arg4 !== undefined ? arg4 : arg3;

    // Verificação de Segurança Total
    if (!options || !Array.isArray(options)) {
        console.error("⚠️ [AVISO INTERNO] Variável das opções perdeu-se no ar. Forçando reenvio de erro seguro ao cliente.");
        await sendText(jid, text);
        return;
    }

    // MÁXIMA PREVENÇÃO PARA A META CLOUD API: 
    // O Whatsapp não aceita mais que 3 botões físicos na tela OU mais de 10 botões soltos em lista no Action
    let safeOptions = options;
    if (safeOptions.length > 10) {
        console.warn(`[ATENÇÃO API DO WHATSAPP]: A lista continha ${safeOptions.length} horários. Foram ocultados alguns pois a META apenas autoriza 10 (incluindo Cancelar) em formato UI/Listas`);
        
        // Pega as 9 primeiras (que normalmente seriam horários e retém obrigatoriamente a opção final (ex: O '0️⃣' cancelar que adicionavas pro fundo do Array na lógica nos flows)
        const cancelarUltimaPonta = safeOptions[safeOptions.length - 1]; 
        safeOptions = safeOptions.slice(0, 9);
        safeOptions.push(cancelarUltimaPonta);
    }

    await metaInteractiveMenu(jid, text, safeOptions);
}

module.exports = { sendDelayedText, sendInteractiveMenu };