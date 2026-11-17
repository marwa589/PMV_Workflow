# Send for approval — what changed and how to apply it

## After extracting over your project
```
npm run db:migrate     # applies prisma/migrations/20261107100000_send_for_approval
npm run db:generate    # regenerates the Prisma client (new enum value + columns)
npm run db:seed        # optional: adds the "Approval Sender" role template (the permission itself comes from the migration)
```
Then restart the app.

## Behaviour
* Review screen -> **Decision** list now has **Send for approval** (Admin users always; everyone else needs the
  `documents.send_for_approval` permission, given through a role + assignment, scoped like other permissions).
* Picking it shows a **searchable list of all active users** (name, email, user type) and a **Require signature**
  switch that is **on by default**.
* The chosen user gets a pending task + notification/email. If signature is required they must place a signature to approve.
* When they **approve**, the document goes **back to the sender's level** and the sender is notified.
* If they choose **Revision required** it goes back to the sender (who can resubmit it to them).
* **Revision required** (all documents) always goes back to the previous level on the path; nobody picks the target.
* If they **Reject**, the document is rejected as usual. **On hold / resume** work as usual.
* They may also send it onward to someone else if they hold the permission (it still returns step by step).

## History / logs
* Workflow history: `SENT FOR APPROVAL` (who, to whom, signature yes/no, comment), then the recipient's `APPROVED`
  entry ("Approved on request and returned to <sender>").
* Audit log actions: `DOCUMENT_SENT_FOR_APPROVAL`, `DOCUMENT_APPROVAL_RETURNED` (details include recipient, signature flag, levels).
* Document page: the approval path shows the extra step with a "Sent for approval" badge and who sent it;
  the journey chart shows it right after the level it was sent from.

## Files
* prisma/schema.prisma, prisma/migrations/20261107100000_send_for_approval/migration.sql, prisma/seed.mjs
* src/lib/workflow/tracks.ts (adds previousLevel), src/lib/workflow/engine.ts
* src/app/api/documents/[id]/actions/route.ts
* src/app/approver/review/[id]/page.tsx, src/components/document-review-editor.tsx
* src/app/documents/[id]/page.tsx, src/components/workflow-journey-chart.tsx
