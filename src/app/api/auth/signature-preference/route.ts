import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { preferredSignatureWidth: true },
  });
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  return NextResponse.json(user);
}

export async function PATCH(request: Request) {
  if (!validateCsrf(request)) {
    return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });
  }

  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    !("preferredSignatureWidth" in body) ||
    typeof body.preferredSignatureWidth !== "number" ||
    !Number.isFinite(body.preferredSignatureWidth) ||
    body.preferredSignatureWidth < 8 ||
    body.preferredSignatureWidth > 100
  ) {
    return NextResponse.json({ message: "Signature width is invalid." }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.userId },
    data: { preferredSignatureWidth: body.preferredSignatureWidth },
  });

  return NextResponse.json({ preferredSignatureWidth: body.preferredSignatureWidth });
}