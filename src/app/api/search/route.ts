// src/app/api/search/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { searchDocuments } from "@/lib/global-search";

export const runtime = "nodejs";

// Top-bar search: documents anywhere in the system that the signed-in person may open.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").slice(0, 100);
  const requested = Number(searchParams.get("limit") ?? 8);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 50) : 8;

  return NextResponse.json(await searchDocuments(session, query, limit));
}
