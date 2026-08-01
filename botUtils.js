const { sendText, sendInteractiveMenu: metaInteractiveMenu, sendLocation } = require('./whatsappApi');

const aguardar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendDelayedText(arg1, arg2, arg3) {
    const jid = arg3 !== undefined ? arg2 : arg1;
    const text = arg3 !== undefined ? arg3 : arg2;
    
    const compassoRandomSegundos = Math.floor(Math.random() * (5000 - 2000 + 1)) + 2000;
    await aguardar(compassoRandomSegundos);
    
    await sendText(jid, text);
}

// NOVA FUNÇÃO: Prepara e envia o mapa com delay humano
async function sendDelayedLocation(jid, lat, lng, name, address) {
    const compassoRandomSegundos = Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000;
    await aguardar(compassoRandomSegundos);
    
    await sendLocation(jid, lat, lng, name, address);
}

async function sendInteractiveMenu(arg1, arg2, arg3, arg4) {
    const jid = arg4 !== undefined ? arg2 : arg1;
    const text = arg4 !== undefined ? arg3 : arg2;
    const options = arg4 !== undefined ? arg4 : arg3;

    const compassoRandomSegundos = Math.floor(Math.random() * (4000 - 2000 + 1)) + 2000;
    await aguardar(compassoRandomSegundos); 

    if (!options || !Array.isArray(options)) {
        await sendText(jid, text);
        return;
    }

    let safeOptions = options;
    if (safeOptions.length > 10) {
        const cancelarUltimaPonta = safeOptions[safeOptions.length - 1]; 
        safeOptions = safeOptions.slice(0, 9);
        safeOptions.push(cancelarUltimaPonta);
    }
    
    await metaInteractiveMenu(jid, text, safeOptions);
}

module.exports = { sendDelayedText, sendInteractiveMenu, sendDelayedLocation };