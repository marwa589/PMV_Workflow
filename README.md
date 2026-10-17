# DocuFlow 365: dynamic document workflow

Documents, approval flows and multi-document processes are all configured in the app (no code changes):
what kinds of documents exist, what each one collects, who may upload and who must approve at each level,
and which documents belong together in a process.

Built with [Next.js](https://nextjs.org), Prisma and PostgreSQL.

## The ideas

| Concept | What it is |
|---|---|
| **Document type / sub type** | Comp Sheet, Material Req (Cash, Credit...), Eq Rental Req, Purchase Order... and anything you add. Each type and sub type has an internal code and a separate configurable numbering code. Subtyped documents use `TYPE-SUBTYPE-YEAR-SEQUENCE` (for example, `MR-CH-2026-0001`); types without subtypes keep their naming pattern such as `{TYPE}-{PROJECT}-{YYYY}-{SEQ:4}`. |
| **Custom fields** | Extra fields a type (or one sub type) collects, per document or per line item. |
| **Location / project** | Locations are generally countries. A project belongs to a location and has a short code used in document numbers. |
| **User type** | Clerk, Engineer, Manager or Admin. Set once when the account is created; never changes. |
| **Role, permission, assignment** | A role is a bundle of permissions. An assignment gives a user a role limited to a scope (company, location, project, document type, sub type, process). An empty scope means no restriction. |
| **Approval flow** | A chain of levels. Level 0 says who may upload; levels 1 to 10 are approvals. Each level lists named users and/or user types; any one of them is enough (OR). |
| **Flow assignment** | Decides which flow a document gets. Most specific wins: project + sub type, project + type, sub type, type. No match, or "no approval", means approved on upload. |
| **Process** | An ordered list of documents (up to 10 steps), for example Comp Sheet → Material Req → Purchase Order. A step is done when its document is uploaded and fully approved. Documents in the same run are the "linked documents". |
| **Delegation** | An admin hands one user's approval tasks to another until the delegation is deleted. |

### Who can act

A flow level that names a **user** works for that user, wherever they are assigned. A level that names a **user type**
works only for users of that type who also hold an assignment covering the document's project (and its location, type
and sub type, when the assignment sets them). Admin users upload into any flow and are never notified; they approve only
where a flow names them.

### How a document moves

Upload (by someone the uploader step allows) → level 1 → ... → approved. At each level any one listed approver can:
**approve** (next level), **reject** (document becomes cancelled; upload a new one), **request a revision** (send it to
an earlier step, defaulting to the immediately previous step, with a comment), or **hold** / **resume**. The selected
reviser can edit the latest PDF with the review text and circle tools or upload a replacement. Resubmission creates a
new file version, preserves earlier versions, and returns the document to the approver who requested the revision.
Each document keeps its own copy of the flow, so editing a flow never changes documents in progress.

## First-time setup

1. Copy `.env` settings (see below) and create an empty PostgreSQL database.
2. Create the tables:
   ```bash
   npx prisma migrate dev --name dynamic_init --create-only
   ```
   Open the generated `migration.sql` and append the contents of `prisma/partial_indexes.sql` to the end, then:
   ```bash
   npx prisma migrate dev
   ```
   Use `prisma migrate` from now on. **Do not use `prisma db push`**: it would drop the extra constraints in `partial_indexes.sql`.
3. Seed the reference data and a first admin:
   ```bash
   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='a-strong-password-1!' npm run db:seed
   ```
   The seed creates the four user types, the permissions, the standard roles and a starting list of document types.
   It is safe to run again.
4. `npm run dev`, sign in as the admin, then configure in this order:
   **Projects & Locations → Users → Roles & Access → Document Types (and fields) → Approval Flows → Flow Assignments → Process Setup**.

Until you create flow assignments, every uploaded document is approved automatically.

### Environment settings

`DATABASE_URL`, `AUTH_SECRET`, `UPLOAD_PATH` (where files are stored), `APP_URL`, `OTP_AUTH_ENABLED`,
`PASSWORD_RESET_EMAIL_ENABLED`, `EMAIL_DELIVERY_ENABLED`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`,
`AUDIT_LOG_RETENTION_DAYS`, `CRON_SECRET` (bearer secret for `/api/cron/workflow-emails`), and optionally `ROUTE_GATE_ENABLED` (see below).

## Roles and permissions

| Permission | Allows |
|---|---|
| `documents.view` / `.download` / `.print` | See, save and print documents in scope |
| `documents.create` / `.edit` | Upload and edit documents in scope |
| `documents.archive` | Archive and restore |
| `documents.confirm_receipt` | Mark an approved document (for example a purchase order) as received |
| `documents.approve_without_signature` | Approve without placing a signature |
| `documents.delete_request` / `.delete_review` | Ask for, and review, document deletion |
| `processes.view` / `.start` / `.manage` | See runs, start a run, design processes |
| `flows.manage` | Approval flows and flow assignments |
| `types.manage` | Document types, sub types, custom fields, naming |
| `analytics.view` | Dashboards |
| `users.manage` / `assignments.manage` / `delegations.manage` / `projects.manage` | The matching admin screens |

The **Approver** role has no permissions on purpose: it only sees documents where a flow names the user or their type,
plus their own approval history.

In **Document Types**, configure the numbering code separately from the internal code. When an uploader selects a type
and sub type, the app uses those configured codes automatically. Subtype numbering has its own sequence per subtype
and year and does not depend on project. Changing a numbering code renumbers existing subtype documents in date order
and continues from the resulting sequence; document types without subtypes keep their configured naming pattern.

In **Roles & Access**, an assignment can be scoped to multiple projects, document types, and processes. Each selected
document type can independently cover all its subtypes or only the selected subtypes. Leaving a scope empty means no
restriction for that scope.

Deactivating an item that is referenced by documents, assignments, flows, or process runs asks for confirmation and
shows what is using it. Deactivation prevents new work from using that item; existing documents and in-progress process
runs remain intact. A process that depends on a deactivated document type or subtype cannot be started for new work.
Deactivating a user blocks sign-in; reassign any pending approvals they can no longer perform.

Sidebar pending counts follow the signed-in user's document visibility: each document type shows its visible pending
documents, and **All Documents** (or **My Documents**) shows the total across all document types the user can see.

## Route gate (middleware)

`src/middleware.ts` always issues the CSRF cookie. Its extra layer (signed-out visitors are sent to the login page,
areas are limited by user type, every write request must carry the CSRF token) is **off by default**. Turn it on with
`ROUTE_GATE_ENABLED=true`; the setting is read when the app starts, so no rebuild is needed. Every API route and page
also checks the session and permissions itself, so the gate is an additional layer. Public: the login, forgot-password and
reset-password pages and their API routes. The cron endpoint is machine-to-machine and uses its bearer secret instead.

## Sign-in safety

- A password change or reset signs out every session opened before it (the user's `sessionVersion` is compared on each request).
- A deactivated user loses access immediately.
- One-time passcode (OTP) sign-in is controlled by `OTP_ROLLOUT` in `src/lib/auth/otp.ts` (`OFF`, `TEST_USER` or `ALL`); it is currently `TEST_USER`, which applies to one address set in that file.
- If SMTP is not configured, or `EMAIL_DELIVERY_ENABLED` is not `true`, emails are skipped without an error: OTP codes and reset links are not delivered, and queued workflow events are marked as sent.

## Tests

- `npm run test:workflow`: runs the workflow engine against a real **empty** test database (87 checks).
- `npm run test:e2e`: drives the running app over HTTP (97 checks). See the header of `scripts/e2e-http-test.py` for setup.
- `npm run test:e2e-auth`: password reset and change, session sign-out, OTP and remembered devices, deactivation, notifications and the cron secret (66 checks; 77 with `GATE=1` against an app started with `ROUTE_GATE_ENABLED=true`). It runs its own mail server; see its header.
- `npm run test:email`: the email rules (send times, quiet hours, batching, reminders, retries) with a fixed clock (32 checks).
- `npm run build`: type-checks and builds.

Both tests create their own data. Never run them against a database with real data.

## Workflow email batching

Workflow events are stored with `createdAt`, `emailDueAt` and `emailSent`. The Node.js application starts an in-process
worker through `src/instrumentation.ts`; it checks due events every minute, groups them by recipient, sends one summary
email per recipient, and marks delivered events as sent. No external cron scheduler is required. Documents that belong to
a process run are batched over a longer window (20 minutes) than others (10 minutes). Reminders go to everyone eligible at
the document's current level; admins are reminded when a process run has waited 24 hours for its next document.

## Notes

- Bulk download builds its zip with PowerShell, so it works on Windows servers only.
- `scripts/preview-user-password.mjs` is a one-off tool; set `EXECUTIVE_EMAILS` (comma separated) to define its "executives" group.
