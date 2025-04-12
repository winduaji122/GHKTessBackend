const nodemailer = require('nodemailer');
const { logger } = require('./logger');

// Konfigurasi transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Template dasar untuk semua email
const baseEmailTemplate = (content) => `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gema Hati Kudus</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f4f4f4; padding: 20px; border-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
    <header style="text-align: center; margin-bottom: 20px;">
      <img src="https://example.com/logo.png" alt="Gema Hati Kudus Logo" style="max-width: 150px;">
    </header>
    <main>
      ${content}
    </main>
    <footer style="margin-top: 30px; text-align: center; font-size: 0.9em; color: #666;">
      <p>&copy; 2023 Gema Hati Kudus. Semua hak dilindungi.</p>
      <p>
        <a href="${process.env.FRONTEND_URL}/privacy" style="color: #666; text-decoration: none;">Kebijakan Privasi</a> |
        <a href="${process.env.FRONTEND_URL}/terms" style="color: #666; text-decoration: none;">Syarat dan Ketentuan</a>
      </p>
    </footer>
  </div>
</body>
</html>
`;

async function sendEmail(to, subject, html) {
  const mailOptions = {
    from: `"Gema Hati Kudus" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email sent successfully to ${to}:`, info.messageId);
    return true;
  } catch (error) {
    logger.error(`Error sending email to ${to}:`, error);
    return false;
  }
}

async function sendVerificationEmail(to, verificationLink) {
  const subject = 'Verifikasi Akun Anda - Gema Hati Kudus';
  const content = `
    <h1 style="color: #4a4a4a; text-align: center; margin-bottom: 20px;">Verifikasi Akun Anda</h1>
    <p style="margin-bottom: 15px;">Terima kasih telah mendaftar. Silakan klik tautan di bawah ini untuk memverifikasi akun Anda:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${verificationLink}" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verifikasi Akun</a>
    </div>
    <p style="margin-bottom: 15px;">Jika Anda tidak mendaftar untuk akun ini, abaikan email ini.</p>
  `;
  const html = baseEmailTemplate(content);
  logger.info(`Sending verification email to ${to} with link: ${verificationLink}`);
  return sendEmail(to, subject, html);
}

async function sendNotificationEmail(to, message) {
  const subject = 'Notifikasi dari Gema Hati Kudus';
  const content = `
    <h1 style="color: #4a4a4a; text-align: center; margin-bottom: 20px;">Notifikasi dari Gema Hati Kudus</h1>
    <p style="margin-bottom: 15px;">${message}</p>
  `;
  const html = baseEmailTemplate(content);
  return sendEmail(to, subject, html);
}

async function sendTokenRefreshNotification(to) {
  const subject = 'Pemberitahuan Pembaruan Token - Gema Hati Kudus';
  const content = `
    <h1 style="color: #4a4a4a; text-align: center; margin-bottom: 20px;">Token Akses Anda Telah Diperbarui</h1>
    <p style="margin-bottom: 15px;">Kami ingin memberitahu Anda bahwa token akses untuk akun Anda di Gema Hati Kudus baru saja diperbarui.</p>
    <p style="margin-bottom: 15px;">Jika Anda tidak melakukan aktivitas ini atau merasa ada yang mencurigakan, silakan segera hubungi tim dukungan kami.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${process.env.FRONTEND_URL}/contact" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Hubungi Dukungan</a>
    </div>
    <p style="margin-bottom: 15px;">Jika Anda memang melakukan aktivitas ini, Anda dapat mengabaikan pesan ini.</p>
    <p style="font-style: italic; text-align: center; margin-top: 30px;">Terima kasih atas perhatian Anda terhadap keamanan akun Anda.</p>
  `;
  const html = baseEmailTemplate(content);
  return sendEmail(to, subject, html);
}

async function sendReVerificationEmail(to, verificationLink) {
  const subject = 'Verifikasi Ulang Akun Anda - Gema Hati Kudus';
  const content = `
    <h1 style="color: #4a4a4a; text-align: center; margin-bottom: 20px;">Verifikasi Ulang Akun Anda</h1>
    <p style="margin-bottom: 15px;">Anda telah diminta untuk memverifikasi ulang akun Anda. Silakan klik tautan di bawah ini untuk melanjutkan:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${verificationLink}" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verifikasi Akun</a>
    </div>
  `;
  const html = baseEmailTemplate(content);
  return sendEmail(to, subject, html);
}

async function sendAdminApprovalRequest(writerEmail) {
  const adminEmail = process.env.ADMIN_EMAIL;
  const subject = 'Permintaan Persetujuan Writer Baru - Gema Hati Kudus';
  const content = `
    <h1 style="color: #4a4a4a; text-align: center; margin-bottom: 20px;">Permintaan Persetujuan Writer Baru</h1>
    <p style="margin-bottom: 15px;">Seorang writer baru dengan email ${writerEmail} telah mendaftar dan memerlukan persetujuan Anda.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${process.env.FRONTEND_URL}/admin/posts?tab=users" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Tinjau Pendaftaran</a>
    </div>
  `;
  const html = baseEmailTemplate(content);
  return sendEmail(adminEmail, subject, html);
}

async function sendApprovalNotification(to, name) {
  const loginLink = `${process.env.FRONTEND_URL}/writer/posts`;
  const subject = 'Akun Writer Anda Telah Disetujui - Gema Hati Kudus';

  const html = `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="ie=edge">
    <title>Akun Writer Disetujui - Gema Hati Kudus</title>
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
                                Selamat, ${name || 'Writer'}! 🎉<br>
                                Akun Writer Anda Telah Disetujui
                            </h1>

                            <p style="color: #666666; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6;">
                                Kami dengan senang hati memberitahukan bahwa akun writer Anda di Gema Hati Kudus telah berhasil disetujui oleh tim admin kami. Anda sekarang dapat login dan mulai membuat konten yang menginspirasi.
                            </p>

                            <div style="margin: 30px 0; text-align: center;">
                                <a href="${loginLink}" style="background-color: #27ae60; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 5px; font-weight: 500; display: inline-block; font-size: 16px;">
                                    Mulai Menulis Sekarang
                                </a>
                            </div>

                            <div style="border-top: 1px solid #eeeeee; margin: 30px 0; padding-top: 20px;">
                                <h2 style="color: #2c3e50; margin: 0 0 15px 0; font-size: 18px;">Apa yang bisa Anda lakukan sekarang?</h2>
                                <ul style="padding-left: 20px; margin: 0; color: #666666;">
                                    <li style="margin-bottom: 10px;">Buat artikel pertama Anda di dashboard writer</li>
                                    <li style="margin-bottom: 10px;">Lengkapi profil Anda dengan foto dan bio</li>
                                    <li style="margin-bottom: 10px;">Jelajahi artikel dari penulis lain untuk inspirasi</li>
                                    <li>Bagikan artikel Anda ke media sosial setelah dipublikasikan</li>
                                </ul>
                            </div>

                            <p style="color: #666666; margin: 20px 0 0 0; font-size: 14px;">
                                Jika Anda memiliki pertanyaan atau membutuhkan bantuan, silakan hubungi tim support kami di
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
                    Skolastikat SCJ, Jl. Kaliurang Km 7.5 Yogyakarta |
                    <a href="${process.env.FRONTEND_URL}/privacy-policy" style="color: #ffffff; text-decoration: none;">Kebijakan Privasi</a> |
                    <a href="${process.env.FRONTEND_URL}/terms-of-service" style="color: #ffffff; text-decoration: none;">Syarat & Ketentuan</a>
                </p>
            </td>
        </tr>
    </table>
</body>
</html>
  `;

  return sendEmail(to, subject, html);
}

async function sendRejectionNotification(to) {
  const subject = 'Pemberitahuan Mengenai Pendaftaran Penulis - Gema Hati Kudus';
  const content = `
    <h1 style="color: #4a4a4a; text-align: center; margin-bottom: 20px;">Pemberitahuan Mengenai Pendaftaran Penulis</h1>
    <p style="margin-bottom: 15px;">Terima kasih atas minat Anda untuk bergabung sebagai penulis di Gema Hati Kudus. Setelah meninjau pendaftaran Anda, kami memutuskan bahwa saat ini kami tidak dapat menerima pendaftaran Anda.</p>
    <p style="margin-bottom: 15px;">Keputusan ini tidak mencerminkan kualitas atau nilai dari karya Anda. Kami mendorong Anda untuk terus mengembangkan bakat menulis Anda dan mungkin mendaftar kembali di masa depan.</p>
    <p style="margin-bottom: 15px;">Jika Anda memiliki pertanyaan atau ingin mendapatkan umpan balik lebih lanjut, jangan ragu untuk menghubungi tim dukungan kami.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${process.env.FRONTEND_URL}/contact" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Hubungi Kami</a>
    </div>
    <p style="font-style: italic; text-align: center; margin-top: 30px;">Kami menghargai minat Anda terhadap Gema Hati Kudus dan berharap yang terbaik untuk Anda.</p>
  `;
  const html = baseEmailTemplate(content);
  return sendEmail(to, subject, html);
}

async function sendPasswordResetEmail(to, resetLink) {
  const subject = 'Reset Password - Gema Hati Kudus';
  const content = `
    <h1 style="color: #4a4a4a; text-align: center; margin-bottom: 20px;">Reset Password</h1>
    <p style="margin-bottom: 15px;">Anda telah meminta untuk mereset password Anda. Klik tautan di bawah ini untuk melanjutkan:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${resetLink}" style="background-color: #4CAF50; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
    </div>
    <p style="margin-bottom: 15px;">Jika Anda tidak meminta reset password, abaikan email ini.</p>
  `;
  const html = baseEmailTemplate(content);
  return sendEmail(to, subject, html);
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendNotificationEmail,
  sendReVerificationEmail,
  sendApprovalNotification,
  sendRejectionNotification,
  sendPasswordResetEmail,
  sendAdminApprovalRequest,
  sendTokenRefreshNotification,
};