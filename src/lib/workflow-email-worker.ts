import {
  flushWorkflowEmailBatches,
  queueComparisonMrReminders,
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
    await queuePendingApprovalReminders();
    await queueComparisonMrReminders();
    await flushWorkflowEmailBatches();
  } catch (error) {
    console.error("Workflow email worker failed:", error);
  } finally {
    workerState.workflowEmailWorkerRunning = false;
  }
}

export function startWorkflowEmailWorker() {
  if (workerState.workflowEmailWorkerStarted) return;
  workerState.workflowEmailWorkerStarted = true;

  void processWorkflowEmails();
  setInterval(() => {
    void processWorkflowEmails();
  }, WORKER_INTERVAL_MS);
}