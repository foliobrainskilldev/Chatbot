const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.trim() : null;
    const supabaseKey = process.env.SUPABASE_KEY ? process.env.SUPABASE_KEY.trim() : null;
    
    if (!supabaseUrl || !supabaseKey) {
        throw new Error("Credenciais do Supabase ausentes no arquivo .env");
    }
    
    return createClient(supabaseUrl, supabaseKey);
}

const uploadStream = async (buffer, folder, resourceType = 'auto') => {
    const supabase = getSupabase();
    
    // Gerar um nome de arquivo único
    const ext = resourceType === 'image' ? 'jpg' : (resourceType === 'video' ? 'mp4' : 'bin');
    const filename = `${folder}/${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
    
    // O nome do bucket pode ser puxado do .env ou usa um padrão
    const bucketName = process.env.SUPABASE_BUCKET || 'healthcrm';

    const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(filename, buffer, {
            contentType: resourceType === 'image' ? 'image/jpeg' : (resourceType === 'video' ? 'video/mp4' : 'application/octet-stream'),
            upsert: false
        });

    if (error) {
        console.error("Erro no upload para Supabase:", error);
        throw error;
    }

    // Gerar URL pública 
    const { data: publicUrlData } = supabase.storage
        .from(bucketName)
        .getPublicUrl(filename);

    return {
        secure_url: publicUrlData.publicUrl,
        public_id: filename // Usado caso precise deletar depois
    };
};

const uploadFromUrl = async (url, folder) => {
    try {
        // Usa Fetch nativo do Node para fazer download do buffer da URL externa
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        return await uploadStream(buffer, folder, 'auto');
    } catch (error) {
        console.error("Erro no upload URL para Supabase:", error);
        throw error;
    }
};

const deleteFile = async (publicId) => {
    try {
        const supabase = getSupabase();
        const bucketName = process.env.SUPABASE_BUCKET || 'healthcrm';
        
        const { error } = await supabase.storage
            .from(bucketName)
            .remove([publicId]);
            
        if (error) throw error;
        return true;
    } catch (error) {
        console.error("Erro ao deletar do Supabase:", error);
        return false;
    }
};

module.exports = {
    uploadStream,
    uploadFromUrl,
    deleteFile
};