import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { deleteDocumentFiles } from "@/lib/files";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== UserRole.ADMIN) {
    return NextResponse.json({ message: "Only admin can delete documents." }, { status: 403 });
  }

  return NextResponse.json(
    { message: "Deletion must be requested and approved by Approver 3 before any document is deleted." },
    { status: 403 },
  );
}
