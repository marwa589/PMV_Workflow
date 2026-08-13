export const CSRF_COOKIE_NAME = "docflow_csrf";

export function createCsrfToken(): string {
  const randomBytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < randomBytes.length; i += 1) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(randomBytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function getCookieValueFromHeader(header: string | null | undefined, cookieName: string): string {
  if (!header) return "";

  const match = header
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${cookieName}=`));

  if (!match) return "";
  const [, rawValue] = match.split("=");
  return rawValue ? decodeURIComponent(rawValue) : "";
}

export function getCsrfTokenFromRequest(request: Request): string {
  const headerToken = request.headers.get("x-csrf-token")?.trim() ?? "";
  if (headerToken) return headerToken;

  return getCookieValueFromHeader(request.headers.get("cookie"), CSRF_COOKIE_NAME);
}

export function getCsrfTokenFromBrowser(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`));
  return match ? decodeURIComponent(match[1] || "") : "";
}

export function validateCsrf(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return true;
  }

  const cookieToken = getCookieValueFromHeader(request.headers.get("cookie"), CSRF_COOKIE_NAME);
  const headerToken = request.headers.get("x-csrf-token")?.trim() ?? "";

  if (!cookieToken || !headerToken) {
    return false;
  }

  return cookieToken === headerToken;
}
