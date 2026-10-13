import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, getSessionFromToken } from "@/lib/auth/session-token";
import { getDefaultRouteForRole } from "@/lib/auth/roles";
import { getRouteAccessPolicy, hasRequiredRole } from "@/lib/auth/permissions";
import { CSRF_COOKIE_NAME, createCsrfToken } from "@/lib/csrf";

// The route gate (sign-in required, area limits, CSRF check) is OFF by default, as it has been during testing.
// Turn it on by setting ROUTE_GATE_ENABLED=true. With it off, only the CSRF cookie is issued.
// Every API route and page still checks the session and the person's permissions itself, so the gate is an
// extra layer, not the only one.
const ROUTE_GATE_ENABLED = process.env.ROUTE_GATE_ENABLED === "true";

// Pages and APIs a person can reach without being signed in.
const PUBLIC_PAGES = ["/login", "/unauthorized", "/forgot-password", "/reset-password"];
const PUBLIC_APIS = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/verify-otp", // between password and session: protected by the OTP challenge cookie
  "/api/auth/complete-otp-login",
  "/api/auth/password/forgot",
  "/api/auth/password/reset",
];
// Called by a scheduler, not a browser: protected by its own bearer secret, so no session and no CSRF cookie.
const MACHINE_APIS = ["/api/cron/"];

const matches = (pathname: string, paths: string[]) => paths.some((path) => pathname === path || pathname.startsWith(path.endsWith("/") ? path : path + "/"));

function ensureCsrfCookie(response: NextResponse, request: NextRequest) {
  const currentToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const token = currentToken || createCsrfToken();

  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return token;
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const csrfToken = ensureCsrfCookie(response, request);

  if (!ROUTE_GATE_ENABLED) return response;

  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (matches(pathname, MACHINE_APIS)) return response;

    // Anything that changes data must send the CSRF token it was given in the cookie.
    if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
      const headerToken = request.headers.get("x-csrf-token") ?? "";
      if (!headerToken || headerToken !== csrfToken) {
        return NextResponse.json({ message: "CSRF validation failed." }, { status: 403 });
      }
    }

    if (matches(pathname, PUBLIC_APIS)) return response;

    const session = await getSessionFromToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const routePolicy = getRouteAccessPolicy(pathname);
    if (routePolicy && !hasRequiredRole(session.userType, routePolicy)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    return response;
  }

  if (matches(pathname, PUBLIC_PAGES)) return response;

  const session = await getSessionFromToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return NextResponse.redirect(new URL("/login", request.url));

  if (pathname === "/") return NextResponse.redirect(new URL(getDefaultRouteForRole(session.userType), request.url));

  const routePolicy = getRouteAccessPolicy(pathname);
  if (routePolicy && !hasRequiredRole(session.userType, routePolicy)) {
    return NextResponse.redirect(new URL("/unauthorized", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/unauthorized",
    "/forgot-password",
    "/reset-password",
    "/clerk/:path*",
    "/approver/:path*",
    "/admin/:path*",
    "/new-document",
    "/documents/:path*",
    "/processes/:path*",
    "/api/:path*",
  ],
};
