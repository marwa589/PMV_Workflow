import { appConfig } from "@/lib/env";

export function getRequestOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || (host?.includes("localhost") || host?.startsWith("127.") ? "http" : "https");

  if (host) return `${protocol}://${host}`;
  return appConfig.appUrl();
}