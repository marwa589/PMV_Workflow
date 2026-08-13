import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, getSessionFromToken } from "@/lib/auth/session-token";
import { getDefaultRouteForRole } from "@/lib/auth/roles";
import { getRouteAccessPolicy, hasRequiredRole } from "@/lib/auth/permissions";
import { CSRF_COOKIE_NAME, createCsrfToken, validateCsrf } from "@/lib/csrf";

const PUBLIC_PATHS = ["/login", "/unauthorized", "/_next", "/api/auth/login", "/api/auth/logout"];

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
  // TEMPORARY TEST OVERRIDE: disable the cookie/session gate so all roles can be tested without stale-session restrictions.
  // const { pathname } = request.nextUrl;
  //
  // if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.startsWith("/public")) {
  //   return NextResponse.next();
  // }
  //
  // const response = NextResponse.next();
  // const csrfToken = ensureCsrfCookie(response, request);
  //
  // if (pathname.startsWith("/api/")) {
  //   if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
  //     const headerToken = request.headers.get("x-csrf-token") ?? "";
  //     if (!headerToken || headerToken !== csrfToken) {
  //       return NextResponse.json({ message: "CSRF validation failed." }, { status: 403 });
  //     }
  //
  //     if (!validateCsrf(request)) {
  //       return NextResponse.json({ message: "CSRF validation failed." }, { status: 403 });
  //     }
  //   }
  //
  //   const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  //   const session = await getSessionFromToken(token);
  //
  //   if (!session) {
  //     return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  //   }
  //
  //   const routePolicy = getRouteAccessPolicy(pathname);
  //   if (routePolicy && !hasRequiredRole(session.role, routePolicy)) {
  //     return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  //   }
  //
  //   return response;
  // }
  //
  // if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"))) {
  //   return response;
  // }
  //
  // const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  // const session = await getSessionFromToken(token);
  //
  // if (!session) {
  //   const loginUrl = new URL("/login", request.url);
  //   return NextResponse.redirect(loginUrl);
  // }
  //
  // if (pathname === "/") {
  //   const homeUrl = new URL(getDefaultRouteForRole(session.role), request.url);
  //   return NextResponse.redirect(homeUrl);
  // }
  //
  // const routePolicy = getRouteAccessPolicy(pathname);
  // if (routePolicy && !hasRequiredRole(session.role, routePolicy)) {
  //   const unauthorizedUrl = new URL("/unauthorized", request.url);
  //   return NextResponse.redirect(unauthorizedUrl);
  // }
  //
  // return response;

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/unauthorized",
    "/clerk/:path*",
    "/approver/:path*",
    "/admin/:path*",
    "/new-document",
    "/documents/:path*",
    "/procurement-packages/:path*",
    "/api/:path*",
  ],
};
