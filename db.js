const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedDatabase() {
    // 1. Configuração Inicial do Sistema
    const countConfig = await prisma.configSistema.count();
    if (countConfig === 0) {
        await prisma.configSistema.create({
            data: { id: 1, modoAtivo: 'BARBEARIA' }
        });
        console.log('✅ Configuração global criada (Modo padrão: BARBEARIA).');
    }

    // 2. Usuário Administrador (Equipe)
    const countUsers = await prisma.usuario.count();
    if (countUsers === 0) {
        await prisma.usuario.create({
            data: {
                nome: 'Admin',
                email: 'admin@crm.com',
                senha: 'admin', // Numa app de prod, usar bcrypt. Aqui mantido simples para CRM interno
                funcao: 'ADMIN',
                status: 'ONLINE'
            }
        });
        console.log('✅ Usuário Admin inicial criado.');
    }

    // 3. Dados da Barbearia
    const countServicos = await prisma.servico.count();
    if (countServicos === 0) {
        await prisma.servico.createMany({
            data: [
                { nome: 'Corte de Cabelo', preco: 500, duracaoMin: 30 },
                { nome: 'Barba', preco: 300, duracaoMin: 20 },
                { nome: 'Corte + Barba', preco: 700, duracaoMin: 50 },
            ]
        });
        console.log('✅ Serviços da Barbearia criados.');
    }

    const countBarbeiros = await prisma.barbeiro.count();
    if (countBarbeiros === 0) {
        await prisma.barbeiro.createMany({
            data: [{ nome: 'João' }, { nome: 'Marcos' }, { nome: 'Emanuel' }]
        });
        console.log('✅ Barbeiros iniciais criados.');
    }

    // 4. Dados da Clínica
    const countTratamentos = await prisma.tratamento.count();
    if (countTratamentos === 0) {
        await prisma.tratamento.createMany({
            data: [
                { nome: 'Consulta Geral', preco: 1500, duracaoMin: 45, descricao: 'Avaliação clínica completa.' },
                { nome: 'Limpeza Dentária', preco: 2000, duracaoMin: 40, descricao: 'Profilaxia e remoção de tártaro.' }
            ]
        });
        console.log('✅ Tratamentos da Clínica criados.');
    }

    const countMedicos = await prisma.profissionalSaude.count();
    if (countMedicos === 0) {
        await prisma.profissionalSaude.createMany({
            data: [{ nome: 'Dr. Carlos', especialidade: 'Clínico Geral' }, { nome: 'Dra. Ana', especialidade: 'Odontologista' }]
        });
        console.log('✅ Profissionais de Saúde iniciais criados.');
    }
}

async function getOrCreateCliente(numero) {
    let cliente = await prisma.cliente.findUnique({ where: { id: numero } });
    if (!cliente) {
        cliente = await prisma.cliente.create({ 
            data: { id: numero, leadStatus: 'NOVO', origem: 'WhatsApp' } 
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