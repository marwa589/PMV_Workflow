import { appConfig } from "@/lib/env";

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getRequestHostOrigin(request: Request): string | null {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || (host?.includes("localhost") || host?.startsWith("127.") ? "http" : "https");

  return host ? normalizeOrigin(`${protocol}://${host}`) : null;
}

export function getRequestOrigin(request: Request): string {
  const configuredAppUrl = appConfig.appUrl();
  if (configuredAppUrl) return normalizeOrigin(configuredAppUrl) || configuredAppUrl;

  return getRequestHostOrigin(request) || configuredAppUrl;
}

export function isAllowedRequestOrigin(request: Request): boolean {
  const requestOrigin = normalizeOrigin(request.headers.get("origin") || "");
  if (!requestOrigin) return false;

  const configuredOrigin = normalizeOrigin(appConfig.appUrl());
  const requestHostOrigin = getRequestHostOrigin(request);

  return requestOrigin === configuredOrigin || requestOrigin === requestHostOrigin;
}