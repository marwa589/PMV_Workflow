// src/app/api/admin/mailing-list/digest-interval/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readJsonBody, requireApiAdmin } from "@/lib/admin-api";
import { MAX_DIGEST_INTERVAL_HOURS, MIN_DIGEST_INTERVAL_HOURS } from "@/lib/mailing-list-config";

export const runtime = "nodejs";

/** How many hours pass between two summary emails to the same person (applies to everyone). */
export async function PUT(request: Request) {
  const auth = await requireApiAdmin(request);
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const hours = typeof body?.hours === "number" ? body.hours : Number(body?.hours);
  if (!Number.isInteger(hours) || hours < MIN_DIGEST_INTERVAL_HOURS || hours > MAX_DIGEST_INTERVAL_HOURS) {
    return NextResponse.json({ message: `Enter a whole number of hours from ${MIN_DIGEST_INTERVAL_HOURS} to ${MAX_DIGEST_INTERVAL_HOURS}.` }, { status: 400 });
  }

  await prisma.mailDigestConfig.upsert({ where: { id: "global" }, create: { id: "global", intervalHours: hours }, update: { intervalHours: hours } });
  return NextResponse.json({ hours });
}
