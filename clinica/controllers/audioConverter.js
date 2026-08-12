const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Aponta para o binário do FFmpeg que acabamos de instalar
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

async function convertToOggOpus(inputBuffer) {
    return new Promise((resolve, reject) => {
        // Cria arquivos temporários seguros
        const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const tempInput = path.join(os.tmpdir(), `input_${uniqueId}.webm`);
        const tempOutput = path.join(os.tmpdir(), `output_${uniqueId}.ogg`);

        // Salva o buffer do navegador
        fs.writeFileSync(tempInput, inputBuffer);

        // Inicia a conversão rigorosa exigida pela Meta (OGG + OPUS)
        ffmpeg(tempInput)
            .toFormat('ogg')
            .audioCodec('libopus')
            .on('end', () => {
                try {
                    const outputBuffer = fs.readFileSync(tempOutput);
                    // Limpa o servidor
                    fs.unlinkSync(tempInput);
                    fs.unlinkSync(tempOutput);
                    resolve(outputBuffer);
                } catch (e) {
                    reject(e);
                }
            })
            .on('error', (err) => {
                console.error('❌ Erro no FFmpeg ao converter áudio:', err);
                if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                reject(err);
            })
            .save(tempOutput);
    });
}

module.exports = { convertToOggOpus };