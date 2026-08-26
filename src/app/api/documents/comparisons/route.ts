import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() || "";

  const comparisons = await prisma.document.findMany({
    where: {
      documentType: "COMPARISON",
      status: "APPROVED",
      linkedMRs: { none: {} },
      OR: [
        { documentNumber: { contains: search, mode: "insensitive" } },
        { title: { contains: search, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    comparisons: comparisons.map((item) => ({
      id: item.id,
      documentNumber: item.documentNumber,
      title: item.title,
      approvedAt: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(item.updatedAt),
    })),
  });
}
