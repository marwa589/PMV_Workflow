import {
  flushWorkflowEmailBatches,
  isEmailQuietHours,
  nextEmailSendTime,
  queueProcessStepReminders,
  queuePendingApprovalReminders,
} from "@/lib/workflow-email-batching";

const WORKER_INTERVAL_MS = 60 * 1000;

type WorkflowEmailWorkerState = typeof globalThis & {
  workflowEmailWorkerStarted?: boolean;
  workflowEmailWorkerRunning?: boolean;
};

const workerState = globalThis as WorkflowEmailWorkerState;

async function processWorkflowEmails() {
  if (workerState.workflowEmailWorkerRunning) return;
  workerState.workflowEmailWorkerRunning = true;

  try {
    if (isEmailQuietHours()) return;
    await queuePendingApprovalReminders();
    await queueProcessStepReminders();
    await flushWorkflowEmailBatches();
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