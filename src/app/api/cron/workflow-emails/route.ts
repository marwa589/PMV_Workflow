// src/app/api/cron/workflow-emails/route.ts
import { NextResponse } from "next/server";
import {
  flushWorkflowEmailBatches,
  queueProcessStepReminders,
  queuePendingApprovalReminders,
} from "@/lib/workflow-email-batching";
import { notifyUploadsThatJustOpened } from "@/lib/workflow/processes";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const queuedApprovalReminders = await queuePendingApprovalReminders();
  // A waiting period between two process documents may have ended: tell the people who can now upload.
  const openedUploads = await notifyUploadsThatJustOpened();
  const queuedProcessReminders = await queueProcessStepReminders();
  const sentBatches = await flushWorkflowEmailBatches();

  return NextResponse.json({
    queuedApprovalReminders,
    openedUploads,
    queuedProcessReminders,
    sentBatches,
  });
}
