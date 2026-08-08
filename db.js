const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedDatabase() {
    // 1. Configuração Inicial do Sistema
    const countConfig = await prisma.configSistema.count();
    if (countConfig === 0) {
        await prisma.configSistema.create({
            data: {
                id: 1,
                modoAtivo: 'BARBEARIA', // Pode ser alterado no painel para 'CLINICA'
                nomeAssistente: 'Assistente',
                tomDeVoz: 'Amigável e profissional',
                regrasExtrasIA: '',
                ignorarDiagnosticos: true
            }
        });
        console.log('✅ Configuração global criada (Modo padrão: BARBEARIA).');
    }

    // 2. Dados da Barbearia (Intactos)
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
            data: [
                { nome: 'João' },
                { nome: 'Marcos' },
                { nome: 'Emanuel' }
            ]
        });
        console.log('✅ Barbeiros iniciais criados.');
    }

    // 3. Dados da Clínica (Novos)
    const countTratamentos = await prisma.tratamento.count();
    if (countTratamentos === 0) {
        await prisma.tratamento.createMany({
            data: [
                { nome: 'Consulta Geral', preco: 1500, duracaoMin: 45, descricao: 'Avaliação clínica completa.' },
                { nome: 'Limpeza Dentária', preco: 2000, duracaoMin: 40, descricao: 'Profilaxia e remoção de tártaro.' },
                { nome: 'Clareamento', preco: 5000, duracaoMin: 60, descricao: 'Clareamento a laser seguro.' }
            ]
        });
        console.log('✅ Tratamentos da Clínica criados.');
    }

    const countMedicos = await prisma.profissionalSaude.count();
    if (countMedicos === 0) {
        await prisma.profissionalSaude.createMany({
            data: [
                { nome: 'Dr. Carlos', especialidade: 'Clínico Geral' },
                { nome: 'Dra. Ana', especialidade: 'Odontologista' }
            ]
        });
        console.log('✅ Profissionais de Saúde iniciais criados.');
    }
}

async function getOrCreateCliente(numero) {
    let cliente = await prisma.cliente.findUnique({ where: { id: numero } });
    if (!cliente) {
        cliente = await prisma.cliente.create({ 
            data: { 
                id: numero,
                leadStatus: 'NOVO',
                origem: 'WhatsApp'
            } 
        });
    } else {
        // Atualiza a última interação para o CRM
        await prisma.cliente.update({
            where: { id: numero },
            data: { ultimaInteracao: new Date() }
        });
    }
    return cliente;
}

module.exports = { 
    prisma, 
    seedDatabase, 
    getOrCreateCliente 
};