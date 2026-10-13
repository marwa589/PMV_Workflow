// src/app/api/documents/[id]/delete/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";

// Direct deletion is intentionally not available. Documents are removed through a deletion request
// (POST /api/documents/deletion-requests) that is reviewed before an admin deletes anything.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    { message: "Deletion requests are reviewed before documents are deleted. Submit a deletion request instead." },
    { status: 403 },
  );
}
