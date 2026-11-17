// src/app/api/admin/mailing-list/defaults/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readJsonBody, requireApiAdmin, str } from "@/lib/admin-api";
import { MAIL_KIND_KEYS, type MailDelivery, type MailKind } from "@/lib/mailing-list-config";

export const runtime = "nodejs";

/** How one kind of email is delivered for everyone without their own setting. */
export async function PUT(request: Request) {
  const auth = await requireApiAdmin(request);
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const kind = str(body?.kind) as MailKind;
  const delivery = str(body?.delivery) as MailDelivery;
  if (!MAIL_KIND_KEYS.includes(kind) || !["OFF", "DIGEST", "INSTANT"].includes(delivery)) {
    return NextResponse.json({ message: "Choose a kind of email and Off, Summary email or Instant." }, { status: 400 });
  }

  await prisma.mailKindDefault.upsert({ where: { kind }, create: { kind, delivery }, update: { delivery } });
  return NextResponse.json({ kind, delivery });
}
