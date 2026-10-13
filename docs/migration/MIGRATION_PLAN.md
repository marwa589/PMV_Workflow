# Migration Plan and Change Ledger

How this was verified: I applied the new schema to a working copy of your repo, generated the Prisma client, type-checked everything (0 errors), built the app with `next build`, and ran the engine and the whole app over HTTP against a real PostgreSQL (87 + 97 checks pass; details in the Phase 3 and Phase 4/5 sections). I could not click through the screens in a browser.

> Apply all phases together on the test branch: they depend on the new schema and on each other.

## Progress at a glance

| Phase | Scope | Status | Added | Changed | Deleted |
|---|---|---|---|---|---|
| 1 | Schema, seed, workflow engine, auth core | DELIVERED | 10 | 8 | 0 |
| 2 | Core libraries | DELIVERED | 0 | 11 (+3 files from Phase 1 revised) | 14 |
| 3 | API routes, shared libs, test | DELIVERED | 22 | 16 (+4 Phase 1/2 files revised) | 17 |
| 4 + 5 | Pages and components | DELIVERED | 26 | 40 (+6 comment-only) | 22 |
| 6 | Scripts and housekeeping | DELIVERED | 1 | 4 | 22 (5 files + 17 migrations) |
| 7 | Verification of untested areas | DELIVERED | 2 | 2 (+6 earlier files revised) | 0 |

**Totals: 61 added, 81 changed (+6 comment-only), 75 deleted** (each file counted once; the old migrations count as 17). **All seven phases are delivered.**

---

## PHASE 1: DELIVERED: schema, seed, workflow engine, auth core

### Added (10)
| File | Purpose |
|---|---|
| `prisma/seed.mjs` | Seeds user types, permissions, roles, document types and subtypes; optional first admin |
| `prisma/partial_indexes.sql` | Constraints Prisma cannot express (null-safe unique indexes, check constraints). Append to the init migration |
| `src/lib/auth/access.ts` | Permission checks, scope matching, "who sees what" document filter |
| `src/lib/workflow/engine.ts` | Submit, approve, reject, revision, hold, resume, resubmit, archive |
| `src/lib/workflow/eligibility.ts` | Who may act on a level, who gets notified, who may upload |
| `src/lib/workflow/resolve-flow.ts` | The confirmed 4-step flow lookup |
| `src/lib/workflow/processes.ts` | Start a run, link a document to a step, advance or complete a run |
| `src/lib/workflow/numbering.ts` | Document numbers from the naming pattern and counter |
| `src/lib/workflow/effects.ts` | Sends notifications and queues emails after a transaction commits |
| `src/lib/workflow/errors.ts` | `WorkflowError` with an HTTP status |

Also delivered (documentation): `SCHEMA_MERGE_MAP.md`.

### Changed (8)
| File | What changed |
|---|---|
| `prisma/schema.prisma` | Replaced: 36 models, 11 enums, dynamic types, flows, processes, roles |
| `src/lib/auth/roles.ts` | `UserRole` enum replaced by the four user types (`clerk`, `eng`, `manager`, `admin`) |
| `src/lib/auth/permissions.ts` | Pure route-area policy by user type |
| `src/lib/auth/session-token.ts` | Token carries `userType` instead of `role` |
| `src/lib/auth/session.ts` | Session carries `userType`; deactivated users are rejected |
| `src/lib/auth/guards.ts` | `requireRole` replaced by `requireUserType` and `requirePermission` |
| `src/lib/user-capabilities.ts` | Capability helpers based on user type, no hard-coded emails |
| `src/lib/notifications.ts` | Notification kinds extended (on hold, resumed) |

### Deleted
None.

### Rules the Phase 1 code encodes (tell me if any is wrong)
1. A named user in a flow is eligible anywhere. A user-type entry needs a matching assignment (project, location of the project, type, sub type).
2. A company-scoped assignment never matches a document, because projects do not belong to companies.
3. The Admin user type bypasses permission scope, can upload to any flow, and is never notified.
4. Delegation lets the delegate act on approval levels, not on uploads.
5. A document can be resubmitted by its creator, by someone the uploader step allows, or by an admin.
6. Archiving is allowed only from approved or rejected; restoring returns the previous status.
7. Reject keeps `currentWorkflowStep`, so the journey can show where it was rejected.
8. Deactivated users are locked out even with a valid cookie.
9. A flow with no approval levels, or no matching flow, auto-approves on upload.
10. Until an admin creates flow assignments, every document auto-approves.

---

## PHASE 2: DELIVERED: core libraries

### Added
None.

### Changed (11 files, plus 3 Phase 1 files revised)
| File | What changed |
|---|---|
| `src/lib/auth/otp.ts` | Returns a flat `userType`; rejects deactivated or unknown-type users |
| `src/lib/document-queries.ts` | Rewritten: one shared row shape; pending lists computed from the flow and eligibility instead of `currentApproverId`; `usersByType` for admin |
| `src/lib/document-status.ts` | Statuses follow the PDF; label built from the level name; type, subtype and project filters are data |
| `src/lib/document-search.ts` | Searches type, subtype, project, status label and custom field text |
| `src/lib/document-metrics.ts` | Status colours for the new statuses |
| `src/lib/files.ts` | Removed PO and comparison-specific saving; simplified `saveDocumentVersionFile`; `mergePdfFiles` writes to `{folder}/Merged/` |
| `src/lib/storage-layout.ts` | Folder built from data: `Documents/{Location}/{Project code}/{Type code}[/{Sub type code}]` |
| `src/lib/workflow-email-batching.ts` | Reminders go to everyone eligible at the level; process-based batching; process-stall reminder for admins |
| `src/lib/workflow-email-worker.ts` | Calls the renamed process reminder |
| `src/middleware.ts` | Still disabled as requested; only its commented gate now uses `userType` and `/processes` |
| `src/app/api/cron/workflow-emails/route.ts` | Calls the renamed process reminder; response key `queuedProcessReminders` |
| `src/lib/workflow/eligibility.ts` *(Phase 1 file)* | Added `createEligibilityChecker` |
| `src/lib/workflow/engine.ts` *(Phase 1 file)* | Added rejection email and "back with you" email on revision |
| `prisma/schema.prisma` *(Phase 1 file)* | `EmailEventType` simplified to `APPROVAL_PENDING, WORKFLOW_APPROVED, WORKFLOW_REJECTED, APPROVAL_OVERDUE, PROCESS_STEP_OVERDUE` |

### Deleted (14)
| File | Replaced by |
|---|---|
| `src/lib/workflow.ts` | `src/lib/workflow/engine.ts` |
| `src/lib/workflow-locations.ts` (hard-coded approver emails) | Flow rows and assignments you enter in the admin screens |
| `src/lib/document-workflow-config.ts` | Flow tables and `resolve-flow.ts` |
| `src/lib/po-access.ts` | Purchase orders are documents of type PO |
| `src/lib/err-storage.ts` | `storage-layout.ts` |
| `src/lib/err/directors.ts` | Per-project flow with a named user at level 1 |
| `src/lib/err/files.ts` | `files.ts` |
| `src/lib/err/permissions.ts` | `auth/access.ts` and the engine |
| `src/lib/err/queries.ts` | `document-queries.ts` |
| `src/lib/err/uploader-access.ts` | `eligibility.ts` (`canUserUpload`) |
| `src/lib/err/vouchers.ts` | Voucher document types |
| `src/lib/err/workflow.ts` | The engine |
| `src/lib/auth/module-visibility.ts` | Permissions and scope |
| `src/lib/auth/resource-access.ts` (hard-coded emails) | `auth/access.ts` |

### Choices made in Phase 2 (tell me if any is wrong)
1. Storage folders are built from data (location, project code, type, sub type). One function: `documentStorageFolder`.
2. A pending document shows its level, for example "Pending PMV Engineer". `CANCELLED` is displayed as "Rejected".
3. Reminders go to everyone eligible at the current level. A document back with the uploader reminds its creator.
4. Admins are reminded when a process run has waited 24 hours for its next document (replaces "approved Comparison with no MR").
5. Documents in a process run share a 20-minute email window; all others 10 minutes.
6. A clerk sees what the PDF's "who sees what" rule allows, not "all documents unless restricted".
7. Removed: purchase-order status lookups, the `uploads/` legacy path, the `MRs+Comparisons` folder logic.
8. Rejection and revision emails go to the document's creator.

---

## PHASE 3: DELIVERED: API routes, shared libraries, integration test

### Added (22)
| File | Purpose |
|---|---|
| `src/app/api/admin/flows/route.ts` | Flow builder: levels 0 to 10, each level lists users and/or user types (replaces `workflow-templates`) |
| `src/app/api/admin/flow-assignments/route.ts` | Which flow a type / sub type / project gets (empty flow = auto-approve) |
| `src/app/api/admin/document-types/route.ts` | Document types, naming pattern, line-item support |
| `src/app/api/admin/document-subtypes/route.ts` | Sub types of a type |
| `src/app/api/admin/field-definitions/route.ts` | Custom fields per type or sub type |
| `src/app/api/admin/locations/route.ts` | Locations (countries) |
| `src/app/api/admin/companies/route.ts` | Companies |
| `src/app/api/admin/projects/route.ts` | Projects with short code |
| `src/app/api/admin/roles/route.ts` | Roles and their permissions |
| `src/app/api/admin/assignments/route.ts` | A user holds a role within a scope |
| `src/app/api/admin/delegations/route.ts` | Admin delegates one user's approval tasks to another |
| `src/app/api/admin/processes/route.ts` | Define processes (ordered steps, up to 10) |
| `src/app/api/processes/route.ts` | List runs; start a run |
| `src/app/api/processes/[id]/route.ts` | One run with its steps and documents; cancel |
| `src/app/api/processes/[id]/link/route.ts` | Put an existing document into the run's current step |
| `src/app/api/processes/[id]/package-download/route.ts` | One PDF of the run's approved documents in step order |
| `src/app/api/documents/linkable/route.ts` | Search existing documents to fill a process step (replaces `comparisons`) |
| `src/app/api/documents/[id]/received/route.ts` | Confirm receipt of an approved document (replaces PO received) |
| `src/lib/admin-api.ts` | Shared guard: permission + CSRF for configuration APIs |
| `src/lib/document-fields.ts` | Validates and saves custom field values and line items |
| `src/lib/document-deletion.ts` | One shared cascade for permanent deletion |
| `scripts/smoke-test-workflow.ts` | Integration test against a real database (see Testing) |

### Changed (16 routes, plus 4 earlier files revised)
| File | What changed |
|---|---|
| `src/app/api/auth/login/route.ts` | Reads the user type; rejects deactivated users; returns `userType` |
| `src/app/api/auth/complete-otp-login/route.ts` | Returns `userType` |
| `src/app/api/auth/signature/route.ts` | Role gating removed (anyone signed in manages their own signature) |
| `src/app/api/auth/trusted-devices/revoke/route.ts` | Admin check by user type |
| `src/app/api/documents/route.ts` | Upload: type, sub type, project from the database; `canUserUpload`; number from counter; custom fields; `startApproval`; optional `processInstanceId`; repeat-submit protection; files cleaned up on failure |
| `src/app/api/documents/[id]/actions/route.ts` | One endpoint over the engine: `APPROVE`, `REJECT`, `REQUEST_REVISION` (with `targetLevel`), `HOLD`, `RESUME`, `RESUBMIT` |
| `src/app/api/documents/[id]/delete/route.ts` | Stub: direct deletion is not available |
| `src/app/api/documents/[id]/download/route.ts` | Access by visibility; inline view needs `documents.view`, saving needs `documents.download` |
| `src/app/api/documents/bulk-download/route.ts` | Groups by type and sub type; approved documents the person may download |
| `src/app/api/documents/bulk-print/route.ts` | Only documents the person may print |
| `src/app/api/documents/bulk-delete/route.ts` | Admin only; shared deletion helper |
| `src/app/api/documents/deletion-requests/route.ts` | Needs `documents.delete_request` for each document |
| `src/app/api/documents/deletion-requests/[id]/route.ts` | Needs `documents.delete_review`; reviewer stored in `approverId` |
| `src/app/api/documents/deletion-requests/bulk/route.ts` | Same, skipping what the person may not review |
| `src/app/api/sidebar-counts/route.ts` | `pendingApprovals`, `pendingByType[]`, `canUpload` |
| `src/app/api/admin/users/route.ts` | User type fixed at creation; activate / deactivate; no location, role or ERR grants |
| `src/lib/auth/access.ts` *(Phase 1)* | Visibility by permission; added `canAccessDocument`, `userHasPermissionForDocument`, `buildProcessVisibilityWhere` |
| `src/lib/workflow/numbering.ts` *(Phase 1)* | Added `validateNamingPattern` |
| `src/lib/workflow/effects.ts` *(Phase 1)* | Emails queued before responding, in-app notifications in the background |
| `src/lib/document-queries.ts` *(Phase 2)* | Exports `getActionableDocuments` |
| `prisma/seed.mjs` *(Phase 1)* | Added `documents.confirm_receipt` permission and the Receiving Clerk role (now 19 permissions, 10 roles) |

### Deleted (17 route files)
| File | Replaced by |
|---|---|
| `src/app/api/errs/route.ts`, `[id]/actions`, `[id]/download`, `[id]/quotations`, `[id]/vouchers`, `bulk-actions`, `bulk-download`, `sidebar` (8) | The generic document routes; quotations and vouchers are document types |
| `src/app/api/purchase-orders/route.ts`, `[id]`, `[id]/download`, `[id]/received`, `bulk-actions`, `bulk-download` (6) | Generic document routes; receipt is `documents/[id]/received` |
| `src/app/api/admin/workflow-templates/route.ts` | `admin/flows` and `admin/flow-assignments` |
| `src/app/api/documents/comparisons/route.ts` | `documents/linkable` |
| `src/app/api/documents/[id]/package-download/route.ts` (it returned an empty zip) | `processes/[id]/package-download` |

### Choices made in Phase 3 (tell me if any is wrong)
1. **Upload fields:** `documentTypeId`, `documentSubtypeId`, `projectId`, `title`, `files`, `fileTitles`, `fieldValues` (JSON), `lineItems` (JSON), `processInstanceId`, `submissionKey`. A sub type is required when the type has active sub types.
2. **Actions:** approving still needs the signed file, and only the newest file is kept after an approval or resubmission (as before). Resubmitting requires the revised file.
3. **Download:** people named in a flow, or who created or acted on a document, can always open it. Others need the scoped permission.
4. **Deletion:** requesting needs `documents.delete_request`, reviewing needs `documents.delete_review`, each scoped to the document. The reviewer is stored in `approverId`; `adminReviewerId` is now unused (candidate to drop from the schema).
5. **Receipt:** new permission `documents.confirm_receipt`, held through the Receiving Clerk role.
6. **Flows:** level 0 is required and levels must run 1, 2, 3 without gaps (up to 10). A flow that is still assigned cannot be deleted, because those documents would silently become auto-approved.
7. **Document types:** the naming pattern must contain `{TYPE}`, `{PROJECT}`, `{YYYY}` and `{SEQ}`, otherwise two documents could get the same number.
8. **Custom fields:** key, data type and group cannot change after creation.
9. **Processes:** steps are fixed once a run exists. The package download merges the run's approved PDFs in step order.
10. **Users:** a user's type cannot change; deactivate instead of deleting a user who has history.
11. **`bulk-download` still builds its zip with PowerShell** (Windows only), unchanged from before.

### Testing: what ran, and what did not
`scripts/smoke-test-workflow.ts` runs the real engine and libraries against a **real PostgreSQL** (an embedded one in my sandbox). **87 checks pass.** It covers: the confirmed 4-step flow lookup, upload eligibility, rule A (named user anywhere, user type needs a matching assignment), numbering (including 5 parallel requests), approve with delegation, revision to any step including the uploader and resubmit, reject, hold and resume, two simultaneous approvals (exactly one wins), archive, process runs (advance, replace a rejected document, complete), visibility and dashboard queries, scoped permissions, custom fields, the database constraints, and deleting a document that sits in a process run.
I confirmed the test can fail: deliberately breaking rule A and removing the concurrency lock each produced failures.
Run it yourself on an **empty** test database: `node prisma/seed.mjs`, then `DATABASE_URL=... npx tsx scripts/smoke-test-workflow.ts`.
**Not covered:** the HTTP routes themselves (no Next.js server was started), the UI, real email sending, saving files to disk, and PowerShell zipping. The tables in my test database were generated from the schema by a script, then `partial_indexes.sql` was applied (it applied cleanly). Prisma's own `migrate dev` output will differ only in constraint names.

### Findings from testing you should know about
1. **A document with no project and a flow level that names only a user type has nobody eligible**, because a project-scoped assignment does not cover a project-less document. Named users still work. Either give such documents a project, or name users at those levels.
2. **An admin cannot approve unless the flow names them** (by name or by the Admin user type). Admins can upload anywhere and delegate, but are not universal approvers. They are also never notified.

---

## PHASES 4 AND 5: DELIVERED: pages and components (done together)

Pages and components share data shapes, so they were built together, one screen at a time. Every page in the original Phase 4 and 5 lists is done, and every deletion. `src/app/layout.tsx` needed no change (its `LayoutProps` message is a global Next.js generates).

### Added (26)
| File | Purpose |
|---|---|
| `src/app/admin/delegations/page.tsx` | Delegate approval tasks |
| `src/app/admin/document-types/page.tsx` | Document types, sub types, custom fields |
| `src/app/admin/flow-assignments/page.tsx` | Which flow each type / sub type / project gets |
| `src/app/admin/flows/page.tsx` | Approval flow builder (replaces `admin/workflows`) |
| `src/app/admin/processes/page.tsx` | Design processes |
| `src/app/admin/projects/page.tsx` | Locations, companies, projects |
| `src/app/admin/roles/page.tsx` | Roles, permissions and who holds them where |
| `src/app/api/documents/[id]/archive/route.ts` | Archive and restore (needs `documents.archive`) |
| `src/app/processes/[id]/page.tsx` | One run: steps, documents, upload / link / cancel / package |
| `src/app/processes/page.tsx` | Process runs and "start a process" (replaces procurement-packages) |
| `src/components/admin/admin-ui.tsx` | Shared admin building blocks |
| `src/components/admin/assignments-manager.tsx` |  |
| `src/components/admin/delegations-manager.tsx` |  |
| `src/components/admin/document-types-manager.tsx` |  |
| `src/components/admin/flow-assignments-manager.tsx` |  |
| `src/components/admin/flows-manager.tsx` |  |
| `src/components/admin/processes-manager.tsx` |  |
| `src/components/admin/projects-manager.tsx` |  |
| `src/components/admin/roles-manager.tsx` |  |
| `src/components/document-detail-actions.tsx` | Confirm receipt and archive buttons |
| `src/components/document-list-page.tsx` | One shared page for every document list |
| `src/components/document-resubmit-form.tsx` | Uploader step after "revision required" |
| `src/components/process-run-view.tsx` | Run view |
| `src/components/processes-panel.tsx` | Run list and start form |
| `src/lib/admin-client.ts` | Browser helper for the admin APIs (CSRF header, readable errors) |
| `src/lib/document-list.ts` | Shared list filters, row mapping, summary cards |

### Changed (40, plus 6 routes that only gained the path comment)
| File | Purpose |
|---|---|
| `src/app/admin/users/page.tsx` | Gated by `users.manage` |
| `src/app/approver/review/[id]/page.tsx` | Eligibility from the flow; resubmit form; "approve without signature" is a permission |
| `src/app/clerk/page.tsx` | One dashboard for every clerk (the "restricted clerk" layout is gone) |
| `src/app/clerk/rejected-documents/page.tsx` | Redirect uses the new `CANCELLED` status |
| `src/app/documents/[id]/page.tsx` | Approval path, custom fields, line items, process runs, receipt and archive actions |
| `src/app/new-document/page.tsx` | Types, sub types, fields and projects from the database; process step context |
| `src/components/admin-user-management.tsx` | User type fixed at creation; activate / deactivate |
| `src/components/approver-pending-table.tsx` | Shows type, project, where it is waiting |
| `src/components/dashboard-shell.tsx` | Sidebar built from data: one entry per active document type, Processes, and the admin screens the person may use |
| `src/components/deletion-requests-list.tsx` | Reviewer instead of Approver 3 |
| `src/components/document-list-table.tsx` | Type / sub type / project columns replace PO status and related comparison |
| `src/components/document-review-editor.tsx` | No ERR-only controls; revision with a chosen target step; resume |
| `src/components/document-status-filter.tsx` | Type, sub type, project and status filters from the database |
| `src/components/new-document-form.tsx` | Data-driven: type, sub type, project, custom fields, line items, process-locked mode |
| `src/components/status-badge.tsx` | New statuses; level-aware label |
| `src/components/workflow-journey-chart.tsx` | Draws the document's own approval path |
| `src/components/workflow-pipeline-chart.tsx` | Pipeline from the new statuses |

Simple pages changed only to read `session.userType` and use `requireUserType` / `requireAuth` instead of the old role: `src/app/admin/all-documents/page.tsx`, `src/app/admin/approved-documents/page.tsx`, `src/app/admin/archive/page.tsx`, `src/app/admin/page.tsx`, `src/app/admin/pending-approvals/page.tsx`, `src/app/admin/rejected-documents/page.tsx`, `src/app/admin/settings/page.tsx`, `src/app/approver/approved-documents/page.tsx`, `src/app/approver/archive/page.tsx`, `src/app/approver/my-documents/page.tsx`, `src/app/approver/page.tsx`, `src/app/approver/pending-approvals/page.tsx`, `src/app/approver/rejected-documents/page.tsx`, `src/app/approver/settings/change-password/page.tsx`, `src/app/approver/settings/page.tsx`, `src/app/approver/settings/signature/page.tsx`, `src/app/clerk/my-documents/page.tsx`, `src/app/clerk/settings/page.tsx`, `src/app/forgot-password/page.tsx`, `src/app/login/page.tsx`, `src/app/page.tsx`, `src/app/pdf-lab/page.tsx`, `src/app/unauthorized/page.tsx`.


Path comment only (first line of the file now names its location): `src/app/api/auth/logout/route.ts`, `src/app/api/auth/password/change/route.ts`, `src/app/api/auth/password/forgot/route.ts`, `src/app/api/auth/password/reset/route.ts`, `src/app/api/auth/verify-otp/route.ts`, `src/app/api/notifications/route.ts`.

### Earlier-phase files revised in this phase
| File | What changed |
|---|---|
| `src/app/api/sidebar-counts/route.ts` | Adds `documentTypes` and `manage` (which admin screens the person may open); `canUpload` shared with the new-document page |
| `src/lib/auth/access.ts` | `getGlobalPermissionCodes` |
| `src/lib/auth/permissions.ts` | `/admin/*` screens are gated page by page by permission; only the `/admin` dashboard is limited to the Admin type |
| `src/lib/document-queries.ts` | Rows also carry `updatedAt`, `approvedAt`, `receivedAt` and the latest comment |
| `prisma/seed.mjs` | New permission `documents.approve_without_signature` and role "Unsigned Approver" (now **20 permissions, 11 roles**) |

### Deleted (22)
| File | Replaced by |
|---|---|
| `src/app/errs/page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `[id]/review/page.tsx`, `settings/page.tsx`, `vouchers/page.tsx` (6) | Generic document screens; ERR is a document type |
| `src/app/purchase-orders/page.tsx`, `[id]/page.tsx` (2) | Generic document screens; PO is a document type |
| `src/app/procurement-packages/page.tsx`, `[id]/page.tsx` (2) | `/processes` and `/processes/[id]` |
| `src/app/admin/workflows/page.tsx` | `/admin/flows` and `/admin/flow-assignments` |
| `src/components/err-list-table`, `err-quotation-upload`, `err-sidebar`, `err-summary-cards`, `err-voucher-modal`, `err-voucher-upload-page` (6) | Shared list, form and detail components |
| `src/components/purchase-order-delete-button`, `purchase-order-list-table`, `purchase-order-upload` (3) | Same |
| `src/components/procurement-package-tables`, `admin-workflow-management` (2) | Process run view; flow builder |

### Choices made in these phases (tell me if any is wrong)
1. **The sidebar is built from data:** one entry per active document type, Processes, and the administration screens the person may use (by permission, so a Flow Admin who is not an Admin user type sees only the flow screens).
2. **"Approve without a signature" is now a permission** (`documents.approve_without_signature`, role "Unsigned Approver"), replacing the hard-coded emails. **The people who had that exemption must be given this role** in Roles & Access. Scope it to a document type and/or location to reproduce the old "MRs from two locations only" rule.
3. **Revision:** the reviewer picks which earlier step to send the document back to and must write a comment. When it goes to the uploader, that person sees a "revise and resubmit" form and must upload the corrected file.
4. **Lists:** filters are type, sub type, project, status (plus download filters). The "PO status" and "related comparison" columns are replaced by Project. Links between documents now appear on the detail page, through process runs.
5. **Detail page** shows the document's own approval path, custom field values, line items and process runs, plus "Confirm received" and "Archive" for those with the permission.
6. **New-document form** is built from the types, sub types, projects and custom fields in the database. Opened from a process run, the type, sub type and project are fixed and only one file is accepted.
7. **The `/approver/*` dashboards are for Engineer and Manager user types.** A person of another type who is named in a flow can still act from the document's detail page and the review screen.
8. **Clerks have one dashboard** (the separate layout for specific clerks is gone).
9. Every `page.tsx` and `route.ts` starts with a comment naming its path.

### Testing
- **Type-check: 0 errors.** `next build` succeeds with every route (I stubbed the Google Fonts import only in my sandbox, which cannot reach Google, and restored the file).
- **`scripts/e2e-http-test.py`: 97 checks pass over real HTTP** against the running app and a real PostgreSQL: sign-in, the admin APIs (including refusals for bad input), upload with custom fields and repeat-submit protection, approve / revision to a step / revision to the uploader / resubmit, delegation, receipt, archive, a process run with package download, every page for every user type, and the access boundaries (including a missing CSRF header). The app logged no server errors.
- **`scripts/smoke-test-workflow.ts`: 87 checks pass** against the engine (re-run after the query changes).
- **Not covered:** clicking through screens in a browser and how they look; the PDF signing editor; real email sending and the email cron; OTP login, password reset, trusted devices and the notification bell; and bulk download (it zips with PowerShell, Windows only). Please click through the main screens yourself on the test database.

---

## PHASE 6: DELIVERED: scripts and housekeeping

### Added (1)
| File | Purpose |
|---|---|
| `scripts/e2e-http-test.py` | The 97-check HTTP end-to-end test, runnable against your own running app (see its header) |

### Changed (4)
| File | What changed |
|---|---|
| `README.md` | Rewritten: the concepts, how a document moves, first-time setup (migrate, then seed), permissions, tests, email batching. Says **not** to use `prisma db push` |
| `package.json` | New scripts `db:generate`, `db:migrate`, `test:workflow`, `test:e2e`; `tsx` dev dependency; `users:password-preview` pointed at the real file name (it had a typo). **Run `npm install` to update the lock file** |
| `.gitignore` | Removed the `prisma/seed.mjs` line, so the seed script can be committed |
| `scripts/preview-user-password.mjs` | Reads the user type instead of the old role; its "executives" group is now the emails in `EXECUTIVE_EMAILS` (the old CEO access table is gone) |

### Deleted (5 files and 17 old migrations)
| File | Why |
|---|---|
| `scripts/setup-err.mjs`, `scripts/migrate-err-access.mjs` | ERR set-up and access migration for the old tables |
| `prisma/cleanup-migration-emails.mjs` | Cleanup for the old role migration |
| `upgrade-review.sql`, `ma migrate status` | Notes for the old role migration |
| `prisma/migrations/` `0_init`, `20260913000000_err_user_access_project_id`, `20260913124306_add_country_to_err_project`, `20260913124307_classify_projects_by_country`, `20260913150000_add_err_approval_path_actions`, `20260913160000_add_purchase_orders`, `20260914000000_add_purchase_order_description`, `20260914010000_add_purchase_order_email_event`, `20260914011000_dedupe_purchase_order_notifications`, `20260914020000_add_user_location_and_roles`, `20260915000000_add_storage_folder_metadata`, `20260919101140_fix_user_location_nullable`, `20260921120000_add_err_next_approval_path`, `20260923100000_add_purchase_order_received_confirmation`, `20260924120000_add_custody_document_type`, `20260926120000_add_err_workflow_email_event`, `20260926130000_add_renewal_err_type` | They create and alter tables that no longer exist, so they cannot run on a fresh database. They remain in git history. `migration_lock.toml` stays. |

After the deletions, generate the one new migration as described in the README (create it with `--create-only`, append `prisma/partial_indexes.sql`, then run it).

---

## PHASE 7: DELIVERED: verification of the untested areas

Goal: test OTP sign-in, password reset and change, trusted devices, notifications, the email worker, and the middleware, and fix what the tests found. Three new test scripts were written; they found six problems, all fixed.

### Added (2)
| File | Purpose |
|---|---|
| `scripts/e2e-auth-test.py` | 66 checks over real HTTP (77 with the route gate on): forgot / reset / change password, session sign-out, OTP with wrong code and lockout, remembered devices and revoking them, deactivation, in-app notifications, cron secret, and the route gate. Runs its own tiny mail server to read the emails |
| `scripts/test-email-batching.ts` | 32 checks on the email rules with a fixed clock and its own mail server: send times, quiet hours, one summary per person, out-of-date reminders, comments, retry after a failed send, two workers, 24-hour reminders, stuck process runs |

### Changed (2)
| File | What changed |
|---|---|
| `src/components/forgot-password-form.tsx` | Sends the CSRF token (needed when the route gate is on) |
| `src/components/reset-password-form.tsx` | Same |

### Earlier-delivered files revised
| File | What changed |
|---|---|
| `src/lib/auth/session.ts` | **Fix:** a session is only valid if its `sessionVersion` matches the user's (see finding 1) |
| `src/middleware.ts` | **Fix:** a corrected route gate behind `ROUTE_GATE_ENABLED` (see findings 2 to 4). Off by default, so behaviour is unchanged until you switch it on |
| `src/lib/auth/permissions.ts` | The review screen is not limited to an area (see finding 3) |
| `scripts/e2e-http-test.py` | The client sends the CSRF token on every request, like a browser |
| `package.json` | Scripts `test:e2e-auth` and `test:email` |
| `README.md` | `CRON_SECRET` and `ROUTE_GATE_ENABLED`, a "Route gate" and a "Sign-in safety" section, the new tests |

### What the tests found (all fixed unless marked)
1. **A password change or reset did not sign out other sessions.** The code bumped `sessionVersion` and its comments said it invalidated old sessions, but the session check never compared the version. **This was already the case in your original code**, not caused by the migration. Fixed: the version is now compared, so after a reset or change every older session is rejected (tested, including a copied cookie).
2. **The original commented-out middleware gate would have locked everyone out.** It demanded a session on every `/api/` call before reaching its list of public paths, so `/api/auth/login` returned 401. Enabling it as written breaks sign-in (reproduced). Fixed in the new gate.
3. **With the gate on, a clerk could not resubmit a document sent back to them.** The review screen lives under `/approver/`, which the gate limited to engineers and managers. Fixed: the review screen is exempt (it checks eligibility itself).
4. **With the gate on, the forgot-password and reset-password pages would have failed:** their forms did not send the CSRF token, and those pages were not covered by the middleware, so someone arriving from a reset email would have no CSRF cookie. Fixed (forms send the token; both pages are public and receive the cookie).
5. **My earlier note was wrong.** I wrote that the CSRF cookie is never issued while the middleware is disabled. In fact the middleware always issued it; only the extra layer was off.
6. **The cron endpoint** is called by a scheduler, which has no session or CSRF cookie; the new gate lets `/api/cron/` through and leaves it to its bearer secret (tested).

### Tested and working
Forgot password (foreign origin refused, generic answer for unknown emails, one email per minute, 64-character single-use token, weak password refused); OTP (code emailed, wrong code refused, lockout after five wrong codes, even the right code refused while locked, challenge cannot be reused, remembered device skips the code, admin revokes remembered devices); deactivated users are signed out at once and cannot sign in; notifications (engineer on approval required, manager after level 1, uploader on revision, approval and rejection; admins never; marking as read); the cron secret (401 without or with a wrong secret); the app's own worker sends a summary on its own (checked in the running app); the email rules above. With the gate on, the whole 97-check end-to-end test still passes.

### Not verifiable here, and things to know
- **Browser behaviour.** I have no browser, so the sign-in screens, the notification bell and the other client code were not run. I did check that what they send and expect matches the tested APIs (bell: `notifications` and `{action:"mark-read"}`; sign-in: `requiresOtp` → `{code}` → `otpVerified` → `{rememberDevice}` → `redirectTo`; no stale reads of the old `role` field; all 21 write requests in the UI now send the CSRF token).
- **OTP applies to exactly one hard-coded address** (`reine.alsouki@ahmadiah.com`) through the constant `OTP_ROLLOUT = "TEST_USER"` in `src/lib/auth/otp.ts`. It is a person in code, like the ones removed elsewhere. Decision needed: leave it, or drive it from settings (for example all Admin user types).
- **`src/lib/mail.ts` silently drops mail to a hard-coded blocked address** and, like a missing SMTP setting or `EMAIL_DELIVERY_ENABLED` not `true`, it does this without an error: OTP codes and reset links are not delivered, and queued workflow events are marked as sent and lost. Make sure these are configured in production.
- **Logout only clears the browser's cookie.** A copied cookie stays valid until it expires (8 hours) or the password changes.
- A Prisma 7.9 deprecation warning about concurrent queries on one connection appears in the log. It comes from inside Prisma, not from our code, and is harmless today.

---

## Notes to keep in mind

1. **Apply everything together** on the test branch, in this order: schema and migration, `npm install`, seed, then the code. Steps are in `README.md`.
2. **The route gate in `src/middleware.ts` is still off** by default, as you asked, but it is now a tested, corrected version you switch on with `ROUTE_GATE_ENABLED=true` (no rebuild). The middleware has always issued the CSRF cookie. See Phase 7 for what was wrong with the old commented-out gate.
3. **Approvers, uploaders and exemptions are no longer in code.** Enter them in the admin screens: flows, flow assignments, roles and assignments. The seed does not invent them. **People who could previously approve without a signature need the "Unsigned Approver" role** (scope it to a document type and/or location to reproduce the old rule).
4. **Seed:** 4 user types, 20 permissions, 11 roles and 10 document types with PDF-style codes (`COMP`, `MR`, `ERR`, `PR`, `RV`, `QT`, `INV`, `DN`, `PL`, `PO`). Custody is not in the PDF, so it is not seeded.
5. **Behaviour to be aware of:**
   - A document with no project, under a flow level that names only a user type, has nobody eligible (a project-scoped assignment does not cover it). Named users still work.
   - An admin cannot approve unless the flow names them.
   - Until flow assignments exist, every document is approved on upload.
   - Bulk download zips with PowerShell (Windows only).
6. **`adminReviewerId`** on `DeletionRequest` is no longer written (the reviewer goes in `approverId`). Say the word and I will drop it from the schema.
7. **What was verified:** type-check 0 errors; `next build` succeeds; on a real PostgreSQL from a clean start: 87 engine checks, 97 HTTP end-to-end checks (gate off and on), 66 / 77 sign-in, notification and cron checks, and 32 email-rule checks pass. **Not verified:** clicking through screens in a browser and how they look; the PDF signing editor; real email delivery to a real mail server (a test mail server was used). Please click through the main flows on your test database.
8. The tables in my test database were generated from the schema by a script, then `partial_indexes.sql` was applied (it applied cleanly). Prisma's own `migrate dev` output may differ in constraint names only.
