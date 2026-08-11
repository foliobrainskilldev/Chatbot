const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

function getCloudinary() {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME ? process.env.CLOUDINARY_CLOUD_NAME.trim() : null,
        api_key: process.env.CLOUDINARY_API_KEY ? process.env.CLOUDINARY_API_KEY.trim() : null,
        api_secret: process.env.CLOUDINARY_API_SECRET ? process.env.CLOUDINARY_API_SECRET.trim() : null
    });
    return cloudinary;
}

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