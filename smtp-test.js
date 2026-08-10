const fs = require('fs');
const nodemailer = require('nodemailer');
const content = fs.readFileSync('.env', 'utf8');
const env = {};
for (const line of content.split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const idx = line.indexOf('=');
  if (idx === -1) continue;
  let key = line.slice(0, idx).trim();
  let value = line.slice(idx + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env[key] = value;
}

console.log('SMTP_HOST=' + env.SMTP_HOST);
console.log('SMTP_USER=' + env.SMTP_USER);
console.log('SMTP_PASS_LENGTH=' + (env.SMTP_PASS || '').length);
const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: Number(env.SMTP_PORT || 587),
  secure: false,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

transporter.verify(function (err) {
  if (err) {
    console.error('VERIFY_ERROR=' + err.message);
    process.exit(1);
  }
  console.log('VERIFY_OK');
  transporter.sendMail({
    from: env.SMTP_FROM || env.SMTP_USER,
    to: env.SMTP_USER,
    subject: 'DocuFlow SMTP test',
    text: 'SMTP test from DocuFlow',
  }, function (sendErr, info) {
    if (sendErr) {
      console.error('SEND_ERROR=' + sendErr.message);
      process.exit(1);
    }
    console.log('SEND_OK=' + info.messageId);
  });
});
