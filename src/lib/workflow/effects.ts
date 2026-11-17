import "server-only";

import { createNotification } from "@/lib/notifications";
import { queueWorkflowEmailEvents, sendInstantMailEvents } from "@/lib/workflow-email-batching";
import { runInBackground } from "@/lib/background";
import type { WorkflowEffects } from "@/lib/workflow/engine";

/**
 * Send the notifications and queue the email events an engine call asked for.
 * Call this AFTER the database transaction has committed (same pattern the app uses today).
 */
export async function dispatchWorkflowEffects(effects: WorkflowEffects): Promise<void> {
  // Email events are queued before responding so none are lost; in-app notifications are sent in the background.
  const queued = await queueWorkflowEmailEvents(effects.emailEvents);
  // Instant emails go out right away (the worker picks up anything held back by quiet hours).
  if (queued > 0) runInBackground(() => sendInstantMailEvents());
  runInBackground(async () => {
    await Promise.all(effects.notifications.map((notification) => createNotification(notification)));
  });
}
