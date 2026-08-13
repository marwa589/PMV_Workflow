export const SESSION_COOKIE_NAME = "docflow_session";

export type SessionTokenPayload = {
  userId: string;
  email: string;
  name: string;
  role: "CLERK" | "APPROVER_1" | "APPROVER_2" | "APPROVER_3" | "ADMIN";
  sessionVersion: number;
  exp: number;
};

function getAuthSecret(): string {
  return process.env.AUTH_SECRET || "dev-auth-secret-change-me";
}

function toBase64Url(value: Uint8Array): string {
  let binary = "";
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function signMessage(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getAuthSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toBase64Url(new Uint8Array(signature));
}

function compareBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a[i] ^ b[i];
  }
  return mismatch === 0;
}

export async function createToken(payload: SessionTokenPayload): Promise<string> {
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const signature = await signMessage(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifyToken(token: string): Promise<SessionTokenPayload | null> {
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) return null;

  try {
    const expectedSignature = await signMessage(encodedPayload);
    const provided = fromBase64Url(encodedSignature);
    const expected = fromBase64Url(expectedSignature);

    if (!compareBytes(provided, expected)) {
      return null;
    }

    const binary = atob(encodedPayload.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as SessionTokenPayload;
    if (!parsed.exp || Date.now() > parsed.exp * 1000) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function getSessionFromToken(token: string | undefined): Promise<{
  userId: string;
  email: string;
  name: string;
  role: SessionTokenPayload["role"];
  sessionVersion: number;
} | null> {
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;

  return {
    userId: payload.userId,
    email: payload.email,
    name: payload.name,
    role: payload.role,
    sessionVersion: payload.sessionVersion,
  };
}
