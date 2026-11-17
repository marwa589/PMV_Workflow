import { pruneAuditLogs } from "@/lib/audit";
import { isEmailQuietHours, nextEmailSendTime, sendInstantMailEvents, sendPendingTaskDigests } from "@/lib/workflow-email-batching";

// How often the worker looks for people whose summary interval is up. Each person still gets at most one email per interval.
const WORKER_INTERVAL_MS = 5 * 60 * 1000;
// Old audit log entries are removed at most once a day (this used to run on every audit write).
const AUDIT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

type WorkflowEmailWorkerState = typeof globalThis & {
  workflowEmailWorkerStarted?: boolean;
  workflowEmailWorkerRunning?: boolean;
  auditLastPrunedAt?: number;
};

const workerState = globalThis as WorkflowEmailWorkerState;

async function pruneAuditLogsIfDue() {
  const now = Date.now();
  if (workerState.auditLastPrunedAt && now - workerState.auditLastPrunedAt < AUDIT_PRUNE_INTERVAL_MS) return;
  workerState.auditLastPrunedAt = now;
  try {
    const result = await pruneAuditLogs();
    if (result.count > 0) console.info(`[audit] Removed ${result.count} old audit log entries`);
  } catch (error) {
    // Try again at the next run instead of waiting a day.
    workerState.auditLastPrunedAt = undefined;
    console.error("Audit log pruning failed:", error);
  }
}

async function processWorkflowEmails() {
  if (workerState.workflowEmailWorkerRunning) return;
  workerState.workflowEmailWorkerRunning = true;

  try {
    // Housekeeping does not depend on quiet hours.
    await pruneAuditLogsIfDue();
    if (isEmailQuietHours()) return;
    await sendInstantMailEvents();
    await sendPendingTaskDigests();
  } catch (error) {
    console.error("Workflow email worker failed:", error);
  } finally {
    workerState.workflowEmailWorkerRunning = false;
    const now = new Date();
    const nextRunDelay = isEmailQuietHours(now)
      ? Math.max(1000, nextEmailSendTime(now).getTime() - now.getTime())
      : WORKER_INTERVAL_MS;
    setTimeout(() => {
      void processWorkflowEmails();
    }, nextRunDelay);
  }
}

export function startWorkflowEmailWorker() {
  if (workerState.workflowEmailWorkerStarted) return;
  workerState.workflowEmailWorkerStarted = true;

  void processWorkflowEmails();
}
