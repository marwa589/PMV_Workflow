import "server-only";

import { createNotification } from "@/lib/notifications";
import { queueWorkflowEmailEvents } from "@/lib/workflow-email-batching";
import { runInBackground } from "@/lib/background";
import type { WorkflowEffects } from "@/lib/workflow/engine";

/**
 * Send the notifications and queue the email events an engine call asked for.
 * Call this AFTER the database transaction has committed (same pattern the app uses today).
 */
export async function dispatchWorkflowEffects(effects: WorkflowEffects): Promise<void> {
  // Email events are queued before responding so none are lost; in-app notifications are sent in the background.
  await queueWorkflowEmailEvents(effects.emailEvents);
  runInBackground(async () => {
    await Promise.all(effects.notifications.map((notification) => createNotification(notification)));
  });
}
