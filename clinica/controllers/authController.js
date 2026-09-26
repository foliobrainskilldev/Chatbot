const { prisma } = require('../../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    try {
        const { email, senha } = req.body;

        if (!email || !senha) {
            return res.status(400).json({ error: "E-mail e senha são obrigatórios." });
        }

        const usuario = await prisma.usuario.findUnique({ where: { email } });

        if (!usuario) {
            return res.status(401).json({ error: "Credenciais inválidas." });
        }

        // Verifica a senha com bcrypt
        let senhaValida = await bcrypt.compare(senha, usuario.senha);
        
        // --- SISTEMA DE MIGRAÇÃO DE SENHA ANTIGA (Texto Puro) ---
        if (!senhaValida && senha === usuario.senha) {
            senhaValida = true;
            
            // Já criptografa a senha para os próximos acessos ficarem seguros
            const salt = await bcrypt.genSalt(10);
            const hashedNovaSenha = await bcrypt.hash(senha, salt);
            
            await prisma.usuario.update({
                where: { id: usuario.id },
                data: { senha: hashedNovaSenha }
            });
            console.log(`🔒 Senha do usuário ${usuario.email} migrada para Hash.`);
        }

        if (!senhaValida) {
            return res.status(401).json({ error: "Credenciais inválidas." });
        }

        if (usuario.status === 'SUSPENSO') {
            return res.status(403).json({ error: "Sua conta está suspensa. Fale com a administração." });
        }

        // Atualiza status e último acesso
        await prisma.usuario.update({
            where: { id: usuario.id },
            data: { ultimoAcesso: new Date(), status: 'ONLINE' }
        });

        // Gera o Token JWT válido por 24h
        const token = jwt.sign(
            { id: usuario.id, funcao: usuario.funcao, email: usuario.email },
            process.env.JWT_SECRET || 'healthcrm_secret_key',
            { expiresIn: '24h' }
        );

        res.status(200).json({
            token,
            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                funcao: usuario.funcao
            }
        });
    } catch (error) {
        console.error("Erro no login:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
};