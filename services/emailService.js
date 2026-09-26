const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const DOMAIN_EMAIL = 'no-reply@healtcrm.abrdns.com'; // O seu domínio configurado no Resend

async function enviarConviteEquipe(nome, emailDestino, senhaTemporaria) {
    if (!process.env.RESEND_API_KEY) {
        console.warn("⚠️ Chave do Resend não configurada. E-mail não enviado para:", emailDestino);
        return;
    }

    try {
        const { data, error } = await resend.emails.send({
            from: `HealthCRM <${DOMAIN_EMAIL}>`,
            to: emailDestino,
            subject: 'Bem-vindo(a) à Equipe - Seu Acesso ao HealthCRM',
            html: `
                <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
                    <h2 style="color: #4318FF;">Olá, ${nome}!</h2>
                    <p>Você foi adicionado(a) à equipe do <b>HealthCRM</b> da clínica.</p>
                    <p>Aqui estão as suas credenciais de acesso:</p>
                    <div style="background: #f4f7fe; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 5px 0;"><b>E-mail:</b> ${emailDestino}</p>
                        <p style="margin: 5px 0;"><b>Senha temporária:</b> ${senhaTemporaria}</p>
                    </div>
                    <p>Acesse o painel no link abaixo e recomendamos alterar sua senha logo após o primeiro login:</p>
                    <a href="https://healtcrm.abrdns.com" style="display: inline-block; padding: 10px 20px; background-color: #4318FF; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">Acessar Painel</a>
                    <p style="margin-top: 30px; font-size: 12px; color: #777;">Equipe HealthCRM &copy; ${new Date().getFullYear()}</p>
                </div>
            `
        });

        if (error) {
            console.error("❌ Erro ao enviar e-mail via Resend:", error);
        } else {
            console.log(`✅ E-mail de convite enviado para ${emailDestino} (ID: ${data.id})`);
        }
    } catch (err) {
        console.error("❌ Falha crítica no envio de e-mail:", err);
    }
}

module.exports = { enviarConviteEquipe };