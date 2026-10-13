# PMV_Workflow: Schema Merge Map (v2, updated with your answers)

Result: `prisma/schema.prisma` (36 models, 11 enums) validated with Prisma's own schema validator. `prisma/partial_indexes.sql` holds the constraints Prisma cannot express.

## 1. Your decisions, and how they landed in the schema

| # | Your answer | Result |
|---|---|---|
| 1 | Fresh test DB, keep cuid | All ids stay `String @default(cuid())`. No data migration written. |
| 2 | Follow the PDF | Type codes are PDF-style (`MR`, `PO`, ...). Statuses follow the PDF (`CANCELLED` replaces `REJECTED`). |
| 3 | ERR, vouchers, quotations, PO become types/subtypes; processes connect them | Enums `DocumentType`, `ErrType`, `ErrFileKind`, `MrType`, `ComparisonType` and models `Err*`, `PurchaseOrder*` are gone. Replaced by `DocumentType` / `DocumentSubtype` rows. |
| 4 | Linked documents = same process run | `Document.relatedComparisonId`, `PurchaseOrderMrLink` removed. `ProcessInstance` + `ProcessStepDocument` replace them. |
| 5 | 4 user types; approval levels name a user or a user type | `UserType` (clerk, eng, manager, admin). `User.role/location/projectName` removed, `User.userTypeId` added. |
| 6 | Notify every approver except admin | `Document.currentApproverId` removed. Notification targets are computed from the current `DocumentApprovalStepApprover` rows. |
| 7 | Projects belong to locations (countries); no ErrProject | `Project` (code, name, locationId). `ErrProject`, `UserLocation`, `ErrProjectCountry`, `Document.projectName` removed. |
| 8 | Archived is a status; deletion is a permission | `DocumentStatus.ARCHIVED` kept. `DeletionRequest.approver3Id` → `approverId`; reviewer = anyone with `documents.delete_review`. |
| 9 | Project director = named user at level 1 of a per-project flow | `ErrProject.directorId` and `Err.projectDirectorId` removed. |

## 2. Old → new, model by model

| Old | New |
|---|---|
| `User` | `User` (+`userTypeId`, `isActive`; −`role`, `location`, `projectName`, `roleAssignments`) |
| `UserRoleAssignment`, `ErrUserAccess` | `UserAssignment` (role + scope: company, project, location, type, subtype, process) |
| `DocumentWorkflowTemplate` | same name; now only `code, name, description, isActive`. Targeting moved to `DocumentWorkflowAssignment` |
| `DocumentWorkflowStep` | same name; `stepNumber` 0 = uploader, 1–10 = approvals; `role/approverUserId` replaced by `DocumentWorkflowStepApprover` |
| `Document`, `Err`, `PurchaseOrder` | `Document` (+`documentTypeId`, `documentSubtypeId`, `projectId`, `approvedAt`; keeps `documentNumber`, `workflowTemplateId`, `currentWorkflowStep`, `createdById`, `downloadedAt`, `submissionKey`, `revisionNumber`, `lockVersion`) |
| `DocumentVersion`, `ErrFile` | `DocumentVersion` (all old column names kept, +`revisionNumber`) |
| `ApprovalHistory`, `ErrApprovalHistory` | `ApprovalHistory` (+`levelNumber`, `fromStatus`, `toStatus`, `revisionTargetLevel`, `onBehalfOfUserId`, `outputVersionId`, `revisionNumber`) |
| `Notification`, `ErrNotification` | `Notification` (+`eventKey`, unique per user). ERR email retry columns dropped; `EmailNotificationEvent` already covers email. |
| `PurchaseOrderSequence`, `CustodyFileSequence`, `ErrSequence` | `DocumentNumberCounter` |
| `DeletionRequest`, `EmailNotificationEvent`, `AuditLog`, `TrustedDevice`, `OtpChallenge`, `PasswordResetToken` | kept; only `DeletionRequest.approver3Id` renamed |
| none | `Location`, `Company`, `UserType`, `DocumentType`, `DocumentSubtype`, `FieldDefinition`, `DocumentLineItem`, `DocumentFieldValue`, `Role`, `Permission`, `RolePermission`, `ApprovalDelegation`, `DocumentWorkflowAssignment`, `DocumentApprovalStep`, `DocumentApprovalStepApprover`, `ProcessDefinition`, `ProcessStep`, `ProcessInstance`, `ProcessStepDocument` |

Choices I made that you should know about:
- `User.passwordHash` stays non-null (the PDF says nullable for SSO; the app has no SSO).
- `Document.currentApproverAssignedAt` keeps its old name but now means "when the current level became pending" (used by the overdue emails).
- `mrNumber` becomes a header custom field on the MR type, not a column.
- Approver and action enums use uppercase names (`USER_TYPE`, `PUT_ON_HOLD`), reusing the old enum value names where one existed.

## 3. Permissions (updated)

Permissions are generic. "View MR" or "Start Procurement" is a **role assignment whose scope names the document type or process**; so there is no row per type.

| Code | Meaning |
|---|---|
| `documents.view` | View documents in scope |
| `documents.create` | Upload / start documents in scope |
| `documents.edit` | Edit documents in scope |
| `documents.download` | Download and bulk download |
| `documents.print` | Print / bulk print |
| `documents.archive` | Archive and unarchive |
| `documents.delete_request` | Request deletion |
| `documents.delete_review` | Approve or reject deletion requests |
| `processes.view` | See process runs in scope |
| `processes.start` | Start a run of a process in scope |
| `processes.manage` | Create and edit process definitions |
| `flows.manage` | Create flows, set flow assignments |
| `types.manage` | Document types, sub types, custom fields, numbering |
| `analytics.view` | Dashboards |
| `users.manage` | Create users |
| `assignments.manage` | Role assignments and scopes |
| `delegations.manage` | Approval delegations |
| `projects.manage` | Locations, companies, projects |

Suggested roles: **Approver** (no permissions), **Viewer** (view, download), **Editor** (Viewer + create, edit), **Process Starter** (processes.view, processes.start), **Analyst** (analytics.view, view), **Archivist** (archive, print), **Deletion Reviewer** (delete_request, delete_review), **Flow Admin** (flows, types, processes manage), **User Admin** (users, assignments, delegations, projects manage).

Removed from the earlier list: `purchase_orders.confirm_receipt` (see open question C).

Rules from your answers: a **Clerk** uploads and starts flows only within the scope of their assignments and finishes tasks assigned to them. An **Engineer** or **Manager** approves where a flow level names them or their user type. Admin bypasses scope.

## 4. Seed data proposal (editable later in the admin UI; no schema impact)

| Code | Type | Sub types |
|---|---|---|
| COMP | Comp Sheet | Spare Parts, Other |
| MR | Material Req | Cash, Credit, Petty Cash, Advance Payment |
| ERR | Eq Rental Req | Rental ACTC, Rental External, Renewal, Purchase |
| PR | Payment Req | |
| RV | Receiving Voucher | Release, Receipt |
| QT | Quotation | |
| INV | Invoice | |
| DN | Delivery Note | |
| PL | Payment Letter | |
| PO | Purchase Order | |

Custody is not in the PDF's list, so I did not seed it.

## 5. How to apply on the test database

1. Replace `prisma/schema.prisma` with the new file. Move the old `prisma/migrations/*` out of the way (fresh DB).
2. `npx prisma migrate dev --name dynamic_init --create-only`
3. Append the contents of `prisma/partial_indexes.sql` to the end of the generated `migration.sql`, then `npx prisma migrate dev`.
4. Do not use `prisma db push` afterwards (it would drop the extra indexes). The README's db-push workflow needs to change.

I could not generate the migration SQL here: Prisma's engine download is blocked in my sandbox. The schema itself passed Prisma's validator. Step 2 produces the exact SQL on your machine.

## 6. Open questions

**A.** The PDF says approval ignores project and location. Your answer says an Engineer in project A approves project A documents. For an approver entry that is a **user type**, must the user also hold an assignment covering the document's project (and type)? Does a **named user** entry skip that check?

**B.** For "start [process name]" I added a `processDefinitionId` scope column to `UserAssignment`. The PDF's table does not have it. Confirm, or tell me to model it as per-process permission rows.

**C.** Purchase orders currently have a "received" confirmation (`receivedAt`, `receivedById`). In the new schema there is no place for it. Should it be dropped, become a Receiving Voucher document in the same process run, or a custom field?
