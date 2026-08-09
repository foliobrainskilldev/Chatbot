const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedDatabase() {
    // Configuração Inicial Mínima do Sistema (Se for a primeira vez rodando)
    const countConfig = await prisma.configSistema.count();
    if (countConfig === 0) {
        await prisma.configSistema.create({
            data: { 
                id: 1, 
                modoAtivo: 'BARBEARIA', 
                nomeAssistente: 'Assistente', 
                tomDeVoz: 'Profissional e acolhedor' 
            }
        });
        console.log('✅ Configuração global do CRM inicializada.');
    }

    // Usuário Administrador Obrigatório para acessar e gerir o sistema
    const countUsers = await prisma.usuario.count();
    if (countUsers === 0) {
        await prisma.usuario.create({
            data: {
                nome: 'Admin',
                email: 'admin@crm.com',
                senha: 'admin', 
                funcao: 'ADMIN',
                status: 'ONLINE'
            }
        });
        console.log('✅ Usuário Admin inicial criado (admin@crm.com / admin).');
    }
}

async function getOrCreateCliente(numero) {
    let cliente = await prisma.cliente.findUnique({ where: { id: numero } });
    
    if (!cliente) {
        cliente = await prisma.cliente.create({ 
            data: { 
                id: numero, 
                leadStatus: 'NOVO', 
                origem: 'WhatsApp Meta' 
            } 
        });
    } else {
        await prisma.cliente.update({
            where: { id: numero },
            data: { ultimaInteracao: new Date() }
        });
    }
    
    return cliente;
}

module.exports = { prisma, seedDatabase, getOrCreateCliente };