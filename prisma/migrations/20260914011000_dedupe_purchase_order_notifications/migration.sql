DELETE FROM "EmailNotificationEvent" first_event
USING "EmailNotificationEvent" duplicate_event
WHERE first_event."documentId" IS NOT NULL
	AND duplicate_event."documentId" IS NOT NULL
	AND first_event."recipientId" = duplicate_event."recipientId"
	AND first_event."type" = duplicate_event."type"
	AND first_event."documentId" = duplicate_event."documentId"
	AND first_event."id" > duplicate_event."id";

CREATE UNIQUE INDEX "EmailNotificationEvent_purchase_order_dedupe_key"
ON "EmailNotificationEvent"("recipientId", "type", "documentId")
WHERE "documentId" IS NOT NULL;