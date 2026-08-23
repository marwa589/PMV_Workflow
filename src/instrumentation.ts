export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorkflowEmailWorker } = await import("@/lib/workflow-email-worker");
    startWorkflowEmailWorker();
  }
}