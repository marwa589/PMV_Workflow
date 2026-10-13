// src/app/api/documents/bulk-delete/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { USER_TYPE } from "@/lib/auth/roles";
import { deleteDocumentsPermanently } from "@/lib/document-deletion";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  if (ids.length === 0) {
    return NextResponse.json({ message: "No documents selected." }, { status: 400 });
  }

  if (session.userType !== USER_TYPE.ADMIN) {
    return NextResponse.json({ message: "Only Admin can permanently delete documents. Use a deletion request instead." }, { status: 403 });
  }

  const existing = await prisma.document.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const count = await deleteDocumentsPermanently(existing.map((document) => document.id));

  return NextResponse.json({ message: `${count} document(s) permanently deleted.` }, { status: 200 });
}
