// src/app/api/admin/delegations/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";

export const runtime = "nodejs";

const delegationSelect = {
  id: true,
  reason: true,
  createdAt: true,
  expiresAt: true,
  delegator: { select: { id: true, name: true, email: true } },
  delegate: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

/**
 * An admin hands one user's approval tasks to another user, optionally until an expiry time.
 * The delegate can act on any level where the delegator is eligible; history records who acted for whom.
 */
export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "delegations.manage");
  if (auth.response) return auth.response;

  const [delegations, users] = await Promise.all([
    prisma.approvalDelegation.findMany({ select: delegationSelect, orderBy: { createdAt: "desc" } }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ delegations, users });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "delegations.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const delegatorUserId = str(body?.delegatorUserId);
  const delegateUserId = str(body?.delegateUserId);
  const rawExpiresAt = body?.expiresAt;
  if (rawExpiresAt !== undefined && rawExpiresAt !== null && typeof rawExpiresAt !== "string") {
    return NextResponse.json({ message: "Enter a valid delegation end date and time." }, { status: 400 });
  }
  const expiresAtValue = str(rawExpiresAt);
  const expiresAt = expiresAtValue ? new Date(expiresAtValue) : null;

  if (!delegatorUserId || !delegateUserId) return NextResponse.json({ message: "Choose who is away and who takes over." }, { status: 400 });
  if (delegatorUserId === delegateUserId) return NextResponse.json({ message: "A user cannot delegate to themselves." }, { status: 400 });
  if (expiresAtValue && (!expiresAt || Number.isNaN(expiresAt.getTime()))) {
    return NextResponse.json({ message: "Enter a valid delegation end date and time." }, { status: 400 });
  }
  if (expiresAt && expiresAt <= new Date()) {
    return NextResponse.json({ message: "The delegation end date and time must be in the future." }, { status: 400 });
  }

  const users = await prisma.user.count({ where: { id: { in: [delegatorUserId, delegateUserId] }, isActive: true } });
  if (users !== 2) return NextResponse.json({ message: "Both users must exist and be active." }, { status: 400 });

  try {
    const delegation = await prisma.approvalDelegation.create({
      data: { delegatorUserId, delegateUserId, createdById: auth.session.userId, reason: str(body?.reason) || null, expiresAt },
      select: delegationSelect,
    });
    return NextResponse.json({ delegation }, { status: 201 });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "This delegation already exists." })
      ?? NextResponse.json({ message: "Unable to create the delegation." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "delegations.manage");
  if (auth.response) return auth.response;

  const id = str((await readJsonBody(request))?.id);
  if (!id) return NextResponse.json({ message: "Delegation id is required." }, { status: 400 });

  try {
    await prisma.approvalDelegation.delete({ where: { id } });
    return NextResponse.json({ message: "Delegation removed." });
  } catch (error) {
    return prismaErrorResponse(error) ?? NextResponse.json({ message: "Unable to remove the delegation." }, { status: 500 });
  }
}
