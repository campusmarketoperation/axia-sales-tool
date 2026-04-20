import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to, subject, body, gmailUser, gmailPass } = req.body;

  if (!to || !subject || !body || !gmailUser || !gmailPass) {
    return res.status(400).json({ error: '必須パラメータが不足しています' });
  }

  // Basic email validation
  if (!to.match(/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/)) {
    return res.status(400).json({ error: '無効なメールアドレスです' });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailPass, // Gmail App Password (16 chars)
      },
    });

    await transporter.sendMail({
      from: `"${gmailUser}" <${gmailUser}>`,
      to,
      subject,
      text: body,
      // Add headers to reduce spam score
      headers: {
        'X-Priority': '3',
        'X-Mailer': 'Nodemailer',
      },
    });

    return res.status(200).json({ success: true, to });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message });
  }
}
