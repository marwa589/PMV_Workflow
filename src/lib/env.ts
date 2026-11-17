type EnvOptions = {
  required?: boolean;
  fallback?: string;
  allowDevFallback?: boolean;
};

export function getEnv(name: string, options: EnvOptions = {}): string {
  const value = process.env[name];

  if (value && value.trim() !== "") {
    return value;
  }

  if (options.fallback !== undefined) {
    return options.fallback;
  }

  if (options.required) {
    throw new Error(`${name} is not set.`);
  }

  return "";
}

export function getSecret(name: string, options: EnvOptions = {}): string {
  const value = getEnv(name, options);

  if (value !== "" || !options.required) {
    return value;
  }

  throw new Error(`${name} is not set.`);
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export const appConfig = {
  authSecret: (): string => {
    const fallback = "dev-auth-secret-change-me";
    const value = process.env.AUTH_SECRET;

    if (value && value.trim() !== "") {
      return value;
    }

    if (isProduction()) {
      throw new Error("AUTH_SECRET is required in production.");
    }

    return fallback;
  },
  databaseUrl: () => getSecret("DATABASE_URL", { required: true }),
  smtpHost: () => getEnv("SMTP_HOST"),
  smtpPort: () => Number(getEnv("SMTP_PORT", { fallback: "587" })),
  smtpUser: () => getEnv("SMTP_USER"),
  smtpPass: () => getEnv("SMTP_PASS"),
  smtpFrom: () => getEnv("SMTP_FROM", { fallback: getEnv("SMTP_USER") }),
  appUrl: () => getEnv("APP_URL", { fallback: getEnv("NEXT_PUBLIC_APP_URL") }),
  // Documents created before this moment never trigger "pending" emails. Default: everything after 2 Nov 2026 (Kuwait time),
  // i.e. from 3 Nov 2026 00:00. Set EMAIL_PENDING_SINCE (ISO date/time) to change it.
  emailPendingSince: (): Date => {
    const raw = getEnv("EMAIL_PENDING_SINCE").trim();
    const parsed = raw ? new Date(raw) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
    return new Date("2026-11-03T00:00:00+03:00");
  },
  auditRetentionDays: () => Number(getEnv("AUDIT_LOG_RETENTION_DAYS", { fallback: "90" })),
  emailDeliveryEnabled: () => getEnv("EMAIL_DELIVERY_ENABLED", { fallback: "false" }) === "true",
  passwordResetEmailEnabled: () => getEnv("PASSWORD_RESET_EMAIL_ENABLED", { fallback: "false" }) === "true",
  otpAuthenticationEnabled: () => getEnv("OTP_AUTH_ENABLED", { fallback: "false" }) === "true",
};
