import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { canAccessMrModuleForSession, isErroUser, isRestrictedClerk } from "@/lib/auth/resource-access";
import { BERNABIE_UPLOADER_EMAIL, getKsaProjectByKey, workflowRouteOptionsForUploader } from "@/lib/ksa-projects";
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

  const routeUploader = workflowLocation
    ? await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true, location: true } })
    : null;
  const allowedRoutes = routeUploader ? workflowRouteOptionsForUploader(routeUploader).map((option) => option.value) : [];
  if (workflowLocation && !allowedRoutes.includes(workflowLocation)) {
    return NextResponse.json({ message: "Invalid comparison workflow scope." }, { status: 403 });
  }
  const routeProject = getKsaProjectByKey(workflowLocation);
  // Erro and Bernabie can link any approved comparison (any uploader, location or project) to their MRs.
  const seesAllComparisons = isDispatcher || session.email?.trim().toLowerCase() === BERNABIE_UPLOADER_EMAIL;

  const comparisons = await prisma.document.findMany({
    where: {
      documentType: "COMPARISON",
      status: "APPROVED",
      AND: [
        ...(isRestricted && !seesAllComparisons ? [{ createdById: session.userId }] : []),
        {
          OR: [
            { documentNumber: { contains: search, mode: "insensitive" } },
            { title: { contains: search, mode: "insensitive" } },
          ],
        },
      ],
      ...(isKsaViewer(session) ? { createdBy: { location: { in: [...KSA_USER_LOCATIONS] } } } : {}),
      ...(routeProject && !seesAllComparisons ? { projectName: routeProject.name } : {}),
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
