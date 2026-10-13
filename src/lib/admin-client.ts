"use client";

import { getCsrfTokenFromBrowser } from "@/lib/csrf";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string };

/** Call one of the /api/admin or /api/processes endpoints with the CSRF header and a readable error. */
export async function callApi<T = Record<string, unknown>>(url: string, method: "GET" | "POST" | "PATCH" | "DELETE" = "GET", body?: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(method !== "GET" ? { "x-csrf-token": getCsrfTokenFromBrowser() } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) return { ok: false, message: data.message || "Something went wrong." };
    return { ok: true, data };
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}
