const { sendText, sendInteractiveMenu: metaInteractiveMenu } = require('./whatsappApi');

// Função Utilitária Privada da Engrenagem Artificial Delay Aleatório Mítico: 
const aguardar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendDelayedText(arg1, arg2, arg3) {
    const jid = arg3 !== undefined ? arg2 : arg1;
    const text = arg3 !== undefined ? arg3 : arg2;
    
    // CALCULA UMA DEMORA DE "FALSIFICAÇÃO ORGÂNICA HUMANA" ENRE 1000 a 4500 Milisegundos
    const compassoRandomSegundos = Math.floor(Math.random() * (4500 - 1500 + 1)) + 1500;
    await aguardar(compassoRandomSegundos);
    
    await sendText(jid, text);
}

async function sendInteractiveMenu(arg1, arg2, arg3, arg4) {
    const jid = arg4 !== undefined ? arg2 : arg1;
    const text = arg4 !== undefined ? arg3 : arg2;
    const options = arg4 !== undefined ? arg4 : arg3;

    // Atrasar com sutilezas da leitura UI pro Menus pesados 
    await aguardar(1000); 

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

module.exports = { sendDelayedText, sendInteractiveMenu };