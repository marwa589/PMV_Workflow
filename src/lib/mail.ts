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
  if (!appConfig.smtpHost() || !appConfig.smtpUser() || !appConfig.smtpPass()) {
    console.warn("SMTP credentials are not configured. Skipping email send.");
    return null;
  }

  return transporter.sendMail({
    from: appConfig.smtpFrom() || appConfig.smtpUser(),
    to,
    subject,
    html,
  });
}
