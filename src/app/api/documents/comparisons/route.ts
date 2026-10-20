import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { canAccessMrModuleForSession, isErroUser, isRestrictedClerk } from "@/lib/auth/resource-access";
import { READY_MIX_KHOBAR_PROJECT_NAME } from "@/lib/ready-mix-mr-access";
import { KSA_USER_LOCATIONS, isKsaViewer } from "@/lib/ksa-viewer";

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

  const isDispatcher = session.userId === "cmtzdt5fx000uastr7kdqoe5c" || isErroUser(session);
  const isRestricted = isRestrictedClerk(session);
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() || "";
  const workflowLocation = searchParams.get("workflowLocation") || "";

  if (workflowLocation && (!isDispatcher || !["AVR", "READY_MIX_KHOBAR"].includes(workflowLocation))) {
    return NextResponse.json({ message: "Invalid comparison workflow scope." }, { status: 403 });
  }

  const comparisons = await prisma.document.findMany({
    where: {
      documentType: "COMPARISON",
      status: "APPROVED",
      AND: [
        ...(isRestricted
          ? [isDispatcher
            ? { OR: [
              { createdById: session.userId },
              { versions: { some: { uploadedById: session.userId } } },
            ] }
            : { createdById: session.userId }]
          : []),
        {
          OR: [
            { documentNumber: { contains: search, mode: "insensitive" } },
            { title: { contains: search, mode: "insensitive" } },
          ],
        },
      ],
      ...(isKsaViewer(session) ? { createdBy: { location: { in: [...KSA_USER_LOCATIONS] } } } : {}),
      ...(workflowLocation === "READY_MIX_KHOBAR" && !isDispatcher ? { projectName: READY_MIX_KHOBAR_PROJECT_NAME } : {}),
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
