const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Função para popular dados iniciais, caso a base de dados esteja vazia
async function seedDatabase() {
    // Verificar e criar Serviços
    const countServicos = await prisma.servico.count();
    if (countServicos === 0) {
        await prisma.servico.createMany({
            data: [
                { nome: 'Corte de Cabelo', preco: 500, duracaoMin: 30 },
                { nome: 'Barba', preco: 300, duracaoMin: 20 },
                { nome: 'Corte + Barba', preco: 700, duracaoMin: 50 },
            ]
        });
        console.log('✅ Serviços iniciais criados com sucesso.');
    }

    // Verificar e criar Barbeiros
    const countBarbeiros = await prisma.barbeiro.count();
    if (countBarbeiros === 0) {
        await prisma.barbeiro.createMany({
            data: [
                { nome: 'João' },
                { nome: 'Marcos' },
                { nome: 'Emanuel' }
            ]
        });
        console.log('✅ Barbeiros iniciais criados com sucesso.');
    }
}

// Função utilitária para buscar ou registar o cliente automaticamente
async function getOrCreateCliente(numero) {
    let cliente = await prisma.cliente.findUnique({ where: { id: numero } });
    if (!cliente) {
        cliente = await prisma.cliente.create({ data: { id: numero } });
    }
    return cliente;
}

module.exports = { 
    prisma, 
    seedDatabase, 
    getOrCreateCliente 
};