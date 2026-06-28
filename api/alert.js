// Vercel Serverless Function: api/alert.js
// Securely handles sending Telegram notifications and Google Mail alerts on user login.
const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
  // Allow only POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user } = req.body;

    // Only alert for user 'anu' (configured via USER_B_NAME env variable)
    const userBName = process.env.USER_B_NAME || 'anu';
    if (user !== userBName) {
      return res.status(200).json({ success: true, message: 'Alerts bypassed for this user' });
    }

    // Load credentials from environment variables (stripping quotes if present)
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN.replace(/^["']|["']$/g, '') : undefined;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID ? process.env.TELEGRAM_CHAT_ID.replace(/^["']|["']$/g, '') : undefined;
    const googleMailUser = process.env.GOOGLE_MAIL_USER ? process.env.GOOGLE_MAIL_USER.replace(/^["']|["']$/g, '') : undefined;
    const googleMailPass = process.env.GOOGLE_MAIL_PASS ? process.env.GOOGLE_MAIL_PASS.replace(/^["']|["']$/g, '') : undefined;
    const emailTo = (process.env.EMAIL_TO || googleMailUser) ? (process.env.EMAIL_TO || googleMailUser).replace(/^["']|["']$/g, '') : undefined; // Send to Gmail user if not specified

    const logTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const notificationText = `⚠️ Login Alert: User '${userBName}' has logged into the private chat space at ${logTime} (IST).`;

    let telegramSent = false;
    let emailSent = false;
    const errors = [];

    // 1. Send Telegram Alert
    if (telegramToken && telegramChatId) {
      try {
        const tgResponse = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramChatId,
            text: notificationText
          })
        });

        if (tgResponse.ok) {
          telegramSent = true;
        } else {
          const errorMsg = await tgResponse.text();
          errors.push(`Telegram failed: ${errorMsg}`);
        }
      } catch (tgError) {
        errors.push(`Telegram request exception: ${tgError.message}`);
      }
    } else {
      errors.push('Telegram credentials missing (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)');
    }

    // 2. Send Google Mail Alert via SMTP
    if (googleMailUser && googleMailPass) {
      try {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: googleMailUser,
            pass: googleMailPass
          }
        });

        await transporter.sendMail({
          from: `"Amio Chat Alerts" <${googleMailUser}>`,
          to: emailTo,
          subject: 'Amio Chat: Security login notification',
          html: `
            <div style="font-family: sans-serif; padding: 20px; color: #141413; background-color: #faf9f5; border: 1px solid #e6dfd8; border-radius: 8px;">
               <h2 style="font-size: 20px; border-bottom: 1px solid #cc785c; padding-bottom: 8px; color: #cc785c;">Security Notification</h2>
               <p>User <strong>${userBName}</strong> has logged into the chat room.</p>
               <p style="font-size: 13px; color: #6c6a64;">Time: ${logTime} (IST)</p>
            </div>
          `
        });
        emailSent = true;
      } catch (emailError) {
        errors.push(`Email SMTP exception: ${emailError.message}`);
      }
    } else {
      errors.push('Google Mail credentials missing (GOOGLE_MAIL_USER or GOOGLE_MAIL_PASS)');
    }

    return res.status(200).json({
      success: telegramSent || emailSent,
      telegramSent,
      emailSent,
      errors: errors.length > 0 ? errors : null
    });

  } catch (err) {
    console.error('Serverless function exception:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
};
