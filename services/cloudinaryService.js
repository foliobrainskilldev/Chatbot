const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

// Função para garantir que a configuração seja lida apenas no momento da execução (lazy-loading)
function getCloudinary() {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
    return cloudinary;
}

/**
 * Faz o upload de um buffer de arquivo (imagem, áudio, pdf) diretamente para o Cloudinary.
 * @param {Buffer} buffer - O buffer do arquivo na memória.
 * @param {String} folder - Pasta de destino no Cloudinary (ex: 'clinica/pacientes/audios').
 * @param {String} resourceType - Tipo do arquivo ('image', 'video', 'raw', 'auto').
 * @returns {Promise<Object>} - Resultado do Cloudinary contendo a secure_url.
 */
const uploadStream = (buffer, folder, resourceType = 'auto') => {
    return new Promise((resolve, reject) => {
        const cld = getCloudinary();
        const stream = cld.uploader.upload_stream(
            { 
                folder: folder, 
                resource_type: resourceType,
                access_mode: 'public'
            },
            (error, result) => {
                if (result) {
                    resolve(result);
                } else {
                    reject(error);
                }
            }
        );
        streamifier.createReadStream(buffer).pipe(stream);
    });
};

/**
 * Faz o upload a partir de uma URL externa (útil para mídias recebidas via Webhook da Meta).
 * @param {String} url - URL original do arquivo.
 * @param {String} folder - Pasta de destino no Cloudinary.
 */
const uploadFromUrl = async (url, folder) => {
    try {
        const cld = getCloudinary();
        const result = await cld.uploader.upload(url, {
            folder: folder,
            resource_type: 'auto'
        });
        return result;
    } catch (error) {
        console.error("Erro no upload URL para Cloudinary:", error);
        throw error;
    }
};

/**
 * Remove um arquivo do Cloudinary.
 * @param {String} publicId - ID público do arquivo gerado pelo Cloudinary.
 */
const deleteFile = async (publicId) => {
    try {
        const cld = getCloudinary();
        await cld.uploader.destroy(publicId);
        return true;
    } catch (error) {
        console.error("Erro ao deletar do Cloudinary:", error);
        return false;
    }
};

module.exports = {
    uploadStream,
    uploadFromUrl,
    deleteFile
};