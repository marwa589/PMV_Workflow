import nextEnv from "@next/env";
import nodemailer from "nodemailer";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

function getOption(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function passwordForUser(email) {
  const localPart = email.trim().toLowerCase().split("@")[0] || "user";
  return `${localPart}@ahmadiah26`;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildCredentialEmail(user, password, appUrl) {
  const name = escapeHtml(user.name || "there");
  const email = escapeHtml(user.email);
  const safePassword = escapeHtml(password);
  const loginUrl = escapeHtml(new URL("/login", appUrl).toString());

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0;padding:24px 12px;background:#eef2f7;font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;">
      <tr><td align="center">
        <table role="presentation" width="720" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:720px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;color:#0f172a;">
          <tr><td style="padding:22px 28px;background:#0f172a;color:#fff;">
            <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;opacity:.78;">PMV Workflow</div>
            <h1 style="margin:8px 0 0;font-size:28px;line-height:1.25;">Your account credentials</h1>
          </td></tr>
          <tr><td style="padding:28px;">
            <p style="margin:0 0 16px;">Hello ${name},</p>
            <p style="margin:0 0 20px;">Your PMV Workflow account is ready. Use the credentials below to sign in.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;color:#0f172a;">
              <tr><td style="padding:12px;border-bottom:1px solid #e2e8f0;font-weight:700;width:35%;color:#0f172a !important;">Email</td><td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#0f172a !important;word-break:break-word;overflow-wrap:anywhere;"><span style="color:#0f172a !important;">${email}</span></td></tr>
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

const mode = getOption("mode", "test").toLowerCase();
const testEmail = getOption("email").trim().toLowerCase();
const group = getOption("group", "staff").toLowerCase();
const applyChanges = hasFlag("apply");
const sendEmails = hasFlag("send-email");
const confirmAll = hasFlag("confirm-all");

if (mode !== "test" && mode !== "all") {
  throw new Error("Use --mode test or --mode all.");
}

if (group !== "staff" && group !== "executives" && group !== "all") {
  throw new Error("Use --group staff, --group executives, or --group all.");
}

if (mode === "test" && !testEmail) {
  throw new Error("Test mode requires --email user@example.com.");
}

if (mode === "all" && (applyChanges || sendEmails) && !confirmAll) {
  throw new Error("All-user changes require --confirm-all.");
}

if (sendEmails && !applyChanges) {
  throw new Error("--send-email requires --apply so emailed passwords match the database.");
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  const executiveRoles = ["CEO"];
  const excludedStaffEmails = ["elie.elhani@ahmadiah.com"];
  const groupFilter = group === "staff"
    ? {
        email: { notIn: excludedStaffEmails },
        errAccess: { none: { role: { in: executiveRoles }, isActive: true } },
      }
    : group === "executives"
      ? { errAccess: { some: { role: { in: executiveRoles }, isActive: true } } }
      : {};

  const users = await prisma.user.findMany({
    where: mode === "test" ? { email: testEmail, ...groupFilter } : groupFilter,
    select: {
      name: true,
      email: true,
      role: true,
    },
    orderBy: { email: "asc" },
  });

  if (users.length === 0) {
    throw new Error(mode === "test" ? `No user found for ${testEmail}.` : "No users found.");
  }

  console.log(`Preparing ${users.length} password hash${users.length === 1 ? "" : "es"}...`);
  const credentials = await Promise.all(users.map(async (user) => {
    const password = passwordForUser(user.email);
    return {
      ...user,
      password,
      passwordHash: await hash(password, 12),
    };
  }));

  let appUrl = "";
  if (sendEmails) {
    appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
    if (!appUrl) throw new Error("APP_URL or NEXT_PUBLIC_APP_URL is required to send emails.");
    if (process.env.EMAIL_DELIVERY_ENABLED !== "true") {
      throw new Error("Set EMAIL_DELIVERY_ENABLED=true before sending emails.");
    }
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      throw new Error("SMTP_HOST, SMTP_USER, and SMTP_PASS are required to send emails.");
    }
    new URL(appUrl);
  }

  if (applyChanges) {
    console.log("Updating the database...");
    await prisma.$transaction(async (tx) => {
      for (const credential of credentials) {
        await tx.user.update({
          where: { email: credential.email },
          data: {
            passwordHash: credential.passwordHash,
            sessionVersion: { increment: 1 },
          },
        });
      }
    }, { timeout: 30000 });
  }

  if (sendEmails) {
    console.log(`Connecting to SMTP to send ${credentials.length} email${credentials.length === 1 ? "" : "s"}...`);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });

    for (const credential of credentials) {
      console.log(`Sending email to ${credential.email}...`);
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: credential.email,
        subject: "Your PMV Workflow account credentials",
        html: buildCredentialEmail(credential, credential.password, appUrl),
        text: `Hello ${credential.name},\n\nEmail: ${credential.email}\nPassword: ${credential.password}\nLogin: ${new URL("/login", appUrl).toString()}\n\nPlease keep this email private and change the password after signing in.`,
      });
    }
  }

  console.log(applyChanges
    ? "APPLIED: passwords were updated and existing sessions were invalidated."
    : "PREVIEW ONLY: no passwords, database records, sessions, or emails were changed.");
  if (sendEmails) console.log("Emails sent separately to each selected user.");
  console.log(`Mode: ${mode}`);
  console.log(`Group: ${group}`);
  console.log(`Users: ${credentials.length}\n`);

  for (const credential of credentials) {
    console.log(`Name: ${credential.name}`);
    console.log(`Email: ${credential.email}`);
    console.log(`Role: ${credential.role}`);
    console.log(`Generated password: ${credential.password}`);
    console.log("-".repeat(60));
  }
} finally {
  await prisma.$disconnect();
}
