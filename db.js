const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function seedDatabase() {
    const countConfig = await prisma.configSistema.count();
    if (countConfig === 0) {
        await prisma.configSistema.create({
            data: { 
                id: 1, 
                modoAtivo: 'CLINICA', 
                nomeAssistente: 'Assistente', 
                tomDeVoz: 'Profissional e acolhedor',
                distribuicaoLeads: 'MANUAL'
            }
        });
        console.log('✅ Configuração do CRM inicializada.');
    }

    // Busca se já existe algum admin no banco
    const adminExistente = await prisma.usuario.findFirst({
        where: { funcao: 'ADMIN' },
        orderBy: { id: 'asc' }
    });

    if (!adminExistente) {
        // Se não tem nenhum, cria do zero
        const salt = await bcrypt.genSalt(10);
        const hashedAdminPassword = await bcrypt.hash('admin123', salt);

        await prisma.usuario.create({
            data: {
                nome: 'Administrador',
                email: 'admin@healtcrm.abrdns.com',
                senha: hashedAdminPassword, 
                funcao: 'ADMIN',
                status: 'ONLINE'
            }
        });
        console.log('✅ Usuário Admin inicial criado. (admin@healtcrm.abrdns.com / admin123)');
    } else {
        // Se o admin existe mas está com email antigo ou senha em texto puro (não começa com $2b$), vamos forçar a atualização
        if (adminExistente.email === 'admin@crm.com' || !adminExistente.senha?.startsWith('$2b$')) {
             const salt = await bcrypt.genSalt(10);
             const hashedAdminPassword = await bcrypt.hash('admin123', salt);
             
             await prisma.usuario.update({
                 where: { id: adminExistente.id },
                 data: { 
                     email: 'admin@healtcrm.abrdns.com', 
                     senha: hashedAdminPassword 
                 }
             });
             console.log('🔄 Usuário Admin antigo migrado para o novo padrão Seguro (admin@healtcrm.abrdns.com / admin123).');
        }
    }
}

async function atribuirLeadAutomaticamente() {
    try {
        const config = await prisma.configSistema.findUnique({ where: { id: 1 } });
        if (!config || config.distribuicaoLeads === 'MANUAL') {
            return config?.responsavelPadrao || null;
        }

        const whereClause = { funcao: { in: ['ATENDENTE', 'GESTOR', 'ADMIN'] } };
        if (config.distribuicaoLeads === 'DISPONIBILIDADE') whereClause.status = 'ONLINE'; 

        const usuarios = await prisma.usuario.findMany({ where: whereClause });
        if (usuarios.length === 0) return config.responsavelPadrao || null;

        let minLeads = Infinity;
        let userSelecionado = null;

        for (let u of usuarios) {
            const count = await prisma.cliente.count({ where: { responsavelId: u.id } });
            if (count < minLeads) {
                minLeads = count;
                userSelecionado = u.id;
            }
        }
        return userSelecionado;
    } catch(e) { return null; }
}

async function getOrCreateCliente(numero, nomePushName = null) {
    let cliente = await prisma.cliente.findUnique({ where: { id: numero } });
    let isNewPatient = false;
    
    if (!cliente) {
        try {
            isNewPatient = true;
            const respId = await atribuirLeadAutomaticamente();
            cliente = await prisma.cliente.create({ 
                data: { id: numero, nome: nomePushName || 'Paciente', leadStatus: 'NOVO', origem: 'WhatsApp Meta', responsavelId: respId } 
            });
        } catch (error) {
            if (error.code === 'P2002') {
                isNewPatient = false;
                cliente = await prisma.cliente.findUnique({ where: { id: numero } });
            } else throw error;
        }
    } else {
        const updates = { ultimaInteracao: new Date() };
        if (nomePushName && !cliente.nome) updates.nome = nomePushName;
        cliente = await prisma.cliente.update({ where: { id: numero }, data: updates });
    }
    return { cliente, isNewPatient }; 
}

module.exports = { prisma, seedDatabase, getOrCreateCliente, atribuirLeadAutomaticamente };