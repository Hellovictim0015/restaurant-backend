import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (!transporter) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD are not configured');
    }
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return transporter;
}

export async function sendOtpEmail(email, code) {
  const restaurantName = process.env.RESTAURANT_NAME || 'Royal Food Villa Restaurant';
  await getTransporter().sendMail({
    from: `${restaurantName} <${process.env.GMAIL_USER}>`,
    to: email,
    subject: `${code} is your login code`,
    text: `Your ${restaurantName} login code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px;">
        <h2 style="color:#F62440; margin-bottom: 8px;">${restaurantName}</h2>
        <p style="color:#333; font-size: 15px;">Your login code is:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color:#111; margin: 12px 0;">${code}</p>
        <p style="color:#777; font-size: 13px;">This code expires in 10 minutes. Do not share it with anyone.</p>
      </div>
    `,
  });
}
