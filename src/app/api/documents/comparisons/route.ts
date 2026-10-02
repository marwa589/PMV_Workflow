import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { canAccessMrModuleForSession, isRestrictedClerk } from "@/lib/auth/resource-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (!canAccessMrModuleForSession(session)) {
    return NextResponse.json(
      { message: "You do not have access to MR documents." },
      { status: 403 },
    );
  }

  const isRestricted = isRestrictedClerk(session);
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() || "";

  const comparisons = await prisma.document.findMany({
    where: {
      documentType: "COMPARISON",
      status: "APPROVED",
      ...(isRestricted ? { createdById: session.userId } : {}),
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
