// utils/emailTemplates.js
const verificationEmailTemplate = (verificationLink) => `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verifikasi Akun Anda</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button { background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Verifikasi Akun Anda</h1>
        <p>Terima kasih telah mendaftar di Gema Hati Kudus. Silakan klik tombol di bawah untuk memverifikasi akun Anda:</p>
        <p><a href="${verificationLink}" class="button">Verifikasi Akun</a></p>
        <p>Jika Anda tidak mendaftar untuk akun ini, abaikan email ini.</p>
    </div>
</body>
</html>
`;

const notificationEmailTemplate = (message) => `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Notifikasi</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Notifikasi dari Gema Hati Kudus</h1>
        <p>${message}</p>
    </div>
</body>
</html>
`;

const writerVerificationTemplate = (name, loginLink) => `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="ie=edge">
    <title>Verifikasi Writer - Gema Hati Kudus</title>
    <!--[if mso]>
    <xml>
        <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
    </xml>
    <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f7f7f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen-Sans, Ubuntu, Cantarell, sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
            <td style="padding: 20px 0; text-align: center; background-color: #2c3e50;">
                <img src="${process.env.FRONTEND_URL}/logo-email.png" alt="Logo Gema Hati Kudus" width="150" style="max-width: 100%; height: auto;">
            </td>
        </tr>
        <tr>
            <td style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="padding: 40px 30px;">
                            <h1 style="color: #2c3e50; margin: 0 0 25px 0; font-size: 24px; line-height: 1.4;">
                                Selamat, ${name}! 🎉<br>
                                Akun Writer Anda Telah Diverifikasi
                            </h1>
                            
                            <p style="color: #666666; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">
                                Kami dengan senang hati memberitahukan bahwa akun writer Anda di Gema Hati Kudus telah berhasil diverifikasi oleh tim admin kami.
                            </p>

                            <div style="margin: 30px 0; text-align: center;">
                                <a href="${loginLink}" style="background-color: #27ae60; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 5px; font-weight: 500; display: inline-block; font-size: 16px;">
                                    Login ke Dashboard Writer
                                </a>
                            </div>

                            <div style="border-top: 1px solid #eeeeee; margin: 30px 0; padding-top: 20px;">
                                <h2 style="color: #2c3e50; margin: 0 0 15px 0; font-size: 18px;">Apa selanjutnya?</h2>
                                <ul style="padding-left: 20px; margin: 0; color: #666666;">
                                    <li style="margin-bottom: 10px;">Mulai menulis artikel pertama Anda</li>
                                    <li style="margin-bottom: 10px;">Upload foto profil untuk melengkapi akun</li>
                                    <li>Baca panduan writer kami</li>
                                </ul>
                            </div>

                            <p style="color: #666666; margin: 20px 0 0 0; font-size: 14px;">
                                Jika Anda memiliki pertanyaan, silakan balas email ini atau hubungi tim support kami di 
                                <a href="mailto:support@gema-hati-kudus.id" style="color: #2980b9; text-decoration: none;">support@gema-hati-kudus.id</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
        <tr>
            <td style="padding: 30px 20px; text-align: center; background-color: #2c3e50;">
                <p style="margin: 0; color: #ffffff; font-size: 12px;">
                    © ${new Date().getFullYear()} Gema Hati Kudus. All rights reserved.<br>
                    Jl. Contoh No. 123, Jakarta Selatan | 
                    <a href="${process.env.FRONTEND_URL}/privacy-policy" style="color: #ffffff; text-decoration: none;">Kebijakan Privasi</a> | 
                    <a href="${process.env.FRONTEND_URL}/unsubscribe" style="color: #ffffff; text-decoration: none;">Berhenti Berlangganan</a>
                </p>
            </td>
        </tr>
    </table>
</body>
</html>
`;

module.exports = { verificationEmailTemplate, notificationEmailTemplate, writerVerificationTemplate };