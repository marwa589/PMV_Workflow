import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { deleteDocumentFiles } from "@/lib/files";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== UserRole.CLERK) {
    return NextResponse.json({ message: "Only Clerk can request document deletion." }, { status: 403 });
  }

  return NextResponse.json(
    { message: "Deletion requests are reviewed by Admin before documents are deleted." },
    { status: 403 },
  );
}
