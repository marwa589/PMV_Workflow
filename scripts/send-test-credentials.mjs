import nextEnv from "@next/env";
import nodemailer from "nodemailer";

nextEnv.loadEnvConfig(process.cwd(), true);

function getOption(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() || "" : "";
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildCredentialEmail(email, password, appUrl) {
  const safeEmail = escapeHtml(email);
  const safePassword = escapeHtml(password);
  const loginUrl = escapeHtml(new URL("/login", appUrl).toString());

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0;padding:24px 12px;background:#eef2f7;font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;">
      <tr><td align="center">
        <table role="presentation" width="720" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:720px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;color:#0f172a;">
          <tr><td style="padding:22px 28px;background:#0f172a;color:#fff;">
            <div style="font-size:12px;text-transform:uppercase;opacity:.78;">PMV Workflow</div>
            <h1 style="margin:8px 0 0;font-size:28px;line-height:1.25;">Your account credentials</h1>
          </td></tr>
          <tr><td style="padding:28px;">
            <p style="margin:0 0 16px;">Hello,</p>
            <p style="margin:0 0 20px;">Use the credentials below to sign in to PMV Workflow.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;color:#0f172a;">
              <tr><td style="padding:12px;border-bottom:1px solid #e2e8f0;font-weight:700;width:35%;color:#0f172a !important;">Email</td><td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#0f172a !important;word-break:break-word;overflow-wrap:anywhere;"><span style="color:#0f172a !important;">${safeEmail}</span></td></tr>
              <tr><td style="padding:12px;font-weight:700;color:#0f172a !important;">Password</td><td style="padding:12px;font-family:monospace;font-weight:700;color:#0f172a !important;word-break:break-word;overflow-wrap:anywhere;"><span style="color:#0f172a !important;">${safePassword}</span></td></tr>
            </table>
            <p style="margin:24px 0 0;"><a href="${loginUrl}" style="display:inline-block;max-width:100%;box-sizing:border-box;background:#0f172a;color:#ffffff !important;text-decoration:none !important;padding:14px 22px;border:1px solid #0f172a;border-radius:8px;font-size:14px;line-height:20px;font-weight:700;">Open PMV Workflow</a></p>
            <p style="margin:20px 0 0;color:#64748b;font-size:13px;">Please keep this email private and change the password after signing in.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  `;
}

const recipient = getOption("to").toLowerCase();
const email = getOption("email").toLowerCase();
const password = getOption("password");
const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

if (!/^\S+@\S+\.\S+$/.test(recipient) || !/^\S+@\S+\.\S+$/.test(email) || !password) {
  throw new Error("Usage: npx tsx scripts/send-test-credentials.mjs --to recipient@example.com --email user@example.com --password <password>");
}

if (!appUrl) throw new Error("APP_URL or NEXT_PUBLIC_APP_URL is required.");
if (process.env.EMAIL_DELIVERY_ENABLED !== "true") {
  throw new Error("Set EMAIL_DELIVERY_ENABLED=true before sending emails.");
}
if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
  throw new Error("SMTP_HOST, SMTP_USER, and SMTP_PASS are required.");
}
new URL(appUrl);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 30000,
});

await transporter.sendMail({
  from: process.env.SMTP_FROM || process.env.SMTP_USER,
  to: recipient,
  subject: "Your PMV Workflow account credentials",
  html: buildCredentialEmail(email, password, appUrl),
  text: `Hello,\n\nEmail: ${email}\nPassword: ${password}\nLogin: ${new URL("/login", appUrl).toString()}\n\nPlease keep this email private and change the password after signing in.`,
});

console.log(`Credential-format test email sent to ${recipient}. No database records were read or changed.`);