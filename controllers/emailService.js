const nodemailer = require('nodemailer');

const createTransporter = () => nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const sendOTPEmail = async (email, otp, name = 'User') => {
  const transporter = createTransporter();
  const mailOptions = {
    from: `"AIStudio" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `${otp} is your AIStudio password reset code`,
    html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;padding:0 20px;">
    <div style="text-align:center;padding:32px 0 24px;">
      <div style="display:inline-block;background:#6c63ff;border-radius:14px;padding:12px 18px;">
        <span style="color:white;font-size:22px;font-weight:800;">AIStudio</span>
      </div>
    </div>
    <div style="background:#13131f;border:1px solid rgba(108,99,255,0.2);border-radius:20px;padding:40px 36px;">
      <h1 style="color:#f0f0ff;font-size:24px;font-weight:700;margin:0 0 8px;">Reset your password</h1>
      <p style="color:#a0a0c0;font-size:15px;margin:0 0 32px;line-height:1.6;">
        Hi ${name}, use the code below to reset your password. It expires in <strong style="color:#f0f0ff;">10 minutes</strong>.
      </p>
      <div style="background:#1e1e30;border:2px solid rgba(108,99,255,0.4);border-radius:16px;padding:28px;text-align:center;margin-bottom:32px;">
        <p style="color:#a0a0c0;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 12px;">Your verification code</p>
        <div style="letter-spacing:12px;font-size:42px;font-weight:800;color:#6c63ff;font-family:'Courier New',monospace;margin-left:12px;">${otp}</div>
      </div>
      <div style="background:rgba(246,201,14,0.08);border:1px solid rgba(246,201,14,0.2);border-radius:10px;padding:14px 16px;margin-bottom:24px;">
        <p style="color:#f6c90e;font-size:13px;margin:0;">⚠️ Never share this code. AIStudio will never ask for it.</p>
      </div>
      <p style="color:#606080;font-size:13px;margin:0;">If you didn't request this, you can safely ignore this email.</p>
    </div>
    <div style="text-align:center;padding:24px 0;">
      <p style="color:#606080;font-size:12px;margin:0;">© ${new Date().getFullYear()} AIStudio. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`,
    text: `Your AIStudio OTP is: ${otp}\nExpires in 10 minutes.\nIf you didn't request this, ignore this email.`,
  };
  const info = await transporter.sendMail(mailOptions);
  console.log('✅ OTP email sent to', email, '- ID:', info.messageId);
  return info;
};

module.exports = { sendOTPEmail };
