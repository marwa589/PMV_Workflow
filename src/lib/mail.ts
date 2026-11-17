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

/** Is any of these addresses one the system never emails? */
export function isBlockedEmail(to: string): boolean {
  return to.split(/[;,]/).map((recipient) => recipient.trim().toLowerCase()).filter(Boolean).some((recipient) => BLOCKED_EMAILS.has(recipient));
}

/** Can emails go out at all (delivery switched on and SMTP configured)? When not, queued emails simply wait. */
export function emailSendingConfigured(): boolean {
  return appConfig.emailDeliveryEnabled() && Boolean(appConfig.smtpHost() && appConfig.smtpUser() && appConfig.smtpPass());
}

export async function sendEmail({
  to,
  subject,
  html,
  throwOnError = false,
}: {
  to: string;
  subject: string;
  html: string;
  /** The caller wants to know why a send failed (e.g. the server's rate limit) instead of getting null. */
  throwOnError?: boolean;
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
    if (throwOnError) throw error;
    // Don't crash the app - just log and return null
    return null;
  }
}