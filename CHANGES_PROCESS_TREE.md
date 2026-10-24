# Process tree change

Run `npx prisma migrate deploy` (migration `20261021090000_process_tree`), then `npx prisma generate`.
The migration deactivates all old linear processes and cancels runs still in progress (start fresh).
Then build your trees in Admin > Process Setup.

New: src/app/tasks/page.tsx (My Tasks). Removed: api/processes/[id]/link, api/documents/linkable, manual start (POST /api/processes).
Rewritten: lib/workflow/processes.ts, process-status.ts, api/admin/processes, process-run-view, processes-manager, processes-panel, new-document page/form.

Update: migration `20261021120000_process_upload_ready` adds a PROCESS_UPLOAD_READY notification/email type.
When a document is approved (or a child is rejected) and the process waits for an upload, everyone who may upload a choice is notified (in-app + batched email).
My Tasks no longer cuts off at 500 runs; run page buttons (Upload / Cancel) show only to people who can use them.

Update: migration `20261022090000_process_versions`. Editing a process that already has runs now creates a new version of its tree.
Existing and running runs keep the version they started with; new uploads follow the newest version.

Update: admins can approve/reject/hold/request revision at any level of any document, and My Tasks > Document review lists everything waiting for admins (engine.ts, document-queries.ts).
