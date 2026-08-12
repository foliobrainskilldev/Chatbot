const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedDatabase() {
    const countConfig = await prisma.configSistema.count();
    if (countConfig === 0) {
        await prisma.configSistema.create({
            data: { 
                id: 1, 
                modoAtivo: 'BARBEARIA', 
                nomeAssistente: 'Assistente', 
                tomDeVoz: 'Profissional e acolhedor',
                distribuicaoLeads: 'MANUAL'
            }
        });
        console.log('✅ Configuração global do CRM inicializada.');
    }

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

async function atribuirLeadAutomaticamente() {
    try {
        const config = await prisma.configSistema.findUnique({ where: { id: 1 } });
        if (!config || config.distribuicaoLeads === 'MANUAL') {
            return config?.responsavelPadrao || null;
        }

        const whereClause = { funcao: { in: ['ATENDENTE', 'GESTOR', 'ADMIN'] } };
        
        // Verifica a lógica "Por Disponibilidade" (Online)
        if (config.distribuicaoLeads === 'DISPONIBILIDADE') {
            whereClause.status = 'ONLINE'; 
        }

        const usuarios = await prisma.usuario.findMany({ where: whereClause });
        if (usuarios.length === 0) return config.responsavelPadrao || null;

        let minLeads = Infinity;
        let userSelecionado = null;

        // Lógica Stateless Round-Robin (Equilibra pela menor quantidade atribuída)
        for (let u of usuarios) {
            const count = await prisma.cliente.count({ where: { responsavelId: u.id } });
            if (count < minLeads) {
                minLeads = count;
                userSelecionado = u.id;
            }
        }
        return userSelecionado;
    } catch(e) {
        return null;
    }
}

async function getOrCreateCliente(numero, nomePushName = null) {
    let cliente = await prisma.cliente.findUnique({ where: { id: numero } });
    
    if (!cliente) {
        // Usa o novo sistema de atribuição e distribuição de Pipeline para o Banco
        const respId = await atribuirLeadAutomaticamente();
        
        cliente = await prisma.cliente.create({ 
            data: { 
                id: numero, 
                nome: nomePushName || 'Paciente',
                leadStatus: 'NOVO', 
                origem: 'WhatsApp Meta',
                responsavelId: respId
            } 
        });
    } else {
        const updates = { ultimaInteracao: new Date() };
        if (nomePushName && !cliente.nome) updates.nome = nomePushName;
        
        await prisma.cliente.update({
            where: { id: numero },
            data: updates
        });
    }
    
    return cliente;
}

module.exports = { prisma, seedDatabase, getOrCreateCliente, atribuirLeadAutomaticamente };