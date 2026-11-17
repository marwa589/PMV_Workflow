// src/app/api/cron/workflow-emails/route.ts
import { NextResponse } from "next/server";
import { sendInstantMailEvents, sendPendingTaskDigests } from "@/lib/workflow-email-batching";
import { notifyUploadsThatJustOpened } from "@/lib/workflow/processes";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  // A waiting period between two process documents may have ended: tell the people who can now upload (in-app).
  const openedUploads = await notifyUploadsThatJustOpened();
  // The same hourly digest the background worker sends; each person is claimed atomically, so running both is safe.
  const sentInstant = await sendInstantMailEvents();
  const sentDigests = await sendPendingTaskDigests();

  return NextResponse.json({ openedUploads, sentInstant, sentDigests });
}
