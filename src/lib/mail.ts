import nodemailer from "nodemailer";
import { appConfig } from "@/lib/env";

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