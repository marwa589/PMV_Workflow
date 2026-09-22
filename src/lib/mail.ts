import nodemailer from "nodemailer";
import { appConfig } from "@/lib/env";

const BLOCKED_EMAILS = new Set([
  "jad.kabalan@ahmadiah.com",
  "jad.kabalan@example.com",
].map((email) => email.trim().toLowerCase()));

const transporter = nodemailer.createTransport({
  host: appConfig.smtpHost(),
  port: appConfig.smtpPort(),
  secure: false,
  auth: {
    user: appConfig.smtpUser(),
    pass: appConfig.smtpPass(),
  },
});

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  const recipients = to
    .split(/[;,]/)
    .map((recipient) => recipient.trim().toLowerCase())
    .filter(Boolean);

  if (recipients.some((recipient) => BLOCKED_EMAILS.has(recipient))) {
    console.warn(`Skipping email to blocked recipient: ${to}`);
    return null;
  }

  if (!appConfig.emailDeliveryEnabled()) {
    console.warn("Email delivery is disabled by configuration. Skipping email send.");
    return null;
  }

  if (
    !appConfig.smtpHost() ||
    !appConfig.smtpUser() ||
    !appConfig.smtpPass()
  ) {
    console.warn("SMTP credentials are not configured. Skipping email send.");
    return null;
  }

  try {
    const info = await transporter.sendMail({
      from: appConfig.smtpFrom() || appConfig.smtpUser(),
      to,
      subject,
      html,
    });

    // Log Ethereal preview URL if available
    if ('previewUrl' in info) {
      console.log(`\n📧 [ETHEREAL PREVIEW] ${(info as any).previewUrl}\n`);
    } else {
      console.log(`\n📧 Email sent successfully. Message ID: ${info.messageId}\n`);
    }

    return info;
  } catch (error) {
    console.error("❌ Failed to send email:", error);
    // Don't crash the app - just log and return null
    return null;
  }
}