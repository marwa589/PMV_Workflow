import { NextResponse } from "next/server";
import { ErrAction, UserRole } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getErrAccess, canViewErr } from "@/lib/err/permissions";
import { getCsrfTokenFromRequest, validateCsrf } from "@/lib/csrf";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Please sign in." }, { status: 401 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const body = await request.json().catch(() => null) as { action?: string; ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  if (ids.length === 0) return NextResponse.json({ message: "Select at least one ERR." }, { status: 400 });

  const access = await getErrAccess();
  if (!access) return NextResponse.json({ message: "Please sign in." }, { status: 401 });

  const visibleIds: string[] = [];
  for (const id of ids) {
    if (await canViewErr(access, id)) visibleIds.push(id);
  }
  if (visibleIds.length === 0) return NextResponse.json({ message: "No selected ERRs are accessible." }, { status: 403 });

  if (body?.action === "delete") {
    if (session.role !== UserRole.ADMIN) return NextResponse.json({ message: "Only admins can permanently delete ERRs." }, { status: 403 });

    await prisma.$transaction(async (tx) => {
      await tx.errNotification.deleteMany({ where: { errId: { in: visibleIds } } });
      await tx.errApprovalHistory.deleteMany({ where: { errId: { in: visibleIds } } });
      await tx.errFile.deleteMany({ where: { errId: { in: visibleIds } } });
      await tx.err.deleteMany({ where: { id: { in: visibleIds } } });
    });
    return NextResponse.json({ message: `${visibleIds.length} ERR(s) deleted.` });
  }

  if (body?.action === "request-delete") {
    if (!access.isUploader) return NextResponse.json({ message: "Only ERR uploaders can request deletion." }, { status: 403 });

    const admins = await prisma.user.findMany({ where: { role: UserRole.ADMIN }, select: { id: true } });
    await prisma.$transaction(async (tx) => {
      for (const errId of visibleIds) {
        const action = await tx.errApprovalHistory.create({
          data: {
            errId,
            performedById: session.userId,
            action: ErrAction.COMMENTED,
            comments: "Deletion requested by ERR uploader.",
            revisionNumber: 1,
          },
        });
        if (admins.length > 0) {
          await tx.errNotification.createMany({
            data: admins.map((admin) => ({
              errId,
              recipientId: admin.id,
              type: "APPROVAL_PENDING",
              eventKey: action.id,
              title: "ERR deletion requested",
              message: `An ERR uploader requested deletion for ERR ${errId}.`,
              emailEnabled: false,
            })),
          });
        }
      }
    });
    return NextResponse.json({ message: `${visibleIds.length} deletion request(s) sent to Admin.` });
  }

  return NextResponse.json({ message: "Unsupported bulk action." }, { status: 400 });
}
