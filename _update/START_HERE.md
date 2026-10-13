# Dynamic workflow update: start here

This zip holds every file that was **added or changed** (148 files), at its exact path in your repository.
It does not contain the files that must be **deleted**; the two scripts in this folder do that.

## 1. Before you start
Commit or back up your current work (for example `git checkout -b dynamic-workflow` and commit). Nothing here touches your `.env`.

## 2. Delete the old files (75 files, run from the repository root, BEFORE extracting)

PowerShell:
```powershell
# copy delete-old-files.ps1 into the repository root first, then:
powershell -ExecutionPolicy Bypass -File .\delete-old-files.ps1 -DryRun   # shows the list, deletes nothing
powershell -ExecutionPolicy Bypass -File .\delete-old-files.ps1           # asks, then deletes
```
Git Bash / WSL / macOS / Linux: `bash delete-old-files.sh --dry-run`, then `bash delete-old-files.sh`.
The full list is in `DELETE_LIST.txt`. It covers the old ERR, purchase-order and procurement pages, routes and components,
the old workflow libraries, the 17 old migrations (they build tables that no longer exist; they stay in git history),
and five obsolete scripts and notes.

## 3. Extract this zip into the repository root
Overwrite when asked. Everything lands at its place under `src/`, `prisma/`, `scripts/`, plus `README.md`, `package.json`
and `.gitignore`. (`docs/migration/` holds the full change ledger; `_update/` can be deleted afterwards.)

## 4. Install and create the database
```powershell
npm install                       # adds the new dev dependency (tsx) and updates package-lock.json
```
Use a **new, empty** PostgreSQL database for testing and point `DATABASE_URL` at it in `.env`
(`UPLOAD_PATH` must also be set, as before). Then:
```powershell
npx prisma migrate dev --name dynamic_init --create-only
```
Open the new `prisma/migrations/<timestamp>_dynamic_init/migration.sql`, **paste the contents of `prisma/partial_indexes.sql`
at the very end**, save, then:
```powershell
npx prisma migrate dev
```
Do not use `prisma db push` from now on (it would drop those extra constraints).

## 5. Seed the reference data and your first admin
```powershell
$env:SEED_ADMIN_EMAIL="you@example.com"; $env:SEED_ADMIN_PASSWORD="a-strong-password-1!"; npm run db:seed
```
(Git Bash / Linux: `SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npm run db:seed`.)
The seed is safe to run again. It creates the 4 user types, 20 permissions, 11 roles and 10 document types.

## 6. Run it
`npm run dev`, sign in as that admin, then set things up in this order (sidebar):
**Projects & Locations → Users → Roles & Access → Document Types (fields) → Approval Flows → Flow Assignments → Process Setup.**
Until you add flow assignments, every uploaded document is approved automatically.

Remember to give the people who could approve without a signature the **Unsigned Approver** role (scope it by document type or location).

## 7. Optional: run the automated tests (on an empty test database only)
```
npm run test:workflow     # engine, 87 checks
npm run test:email        # email rules, 32 checks
npm run test:e2e          # needs the app running; see the header of scripts/e2e-http-test.py (97 checks)
npm run test:e2e-auth     # needs the app running with a test mail server setting; see its header (66 checks)
```

## Things to know
- The route gate in `src/middleware.ts` is **off** by default. Turn it on with `ROUTE_GATE_ENABLED=true` when you want to test it.
- OTP sign-in applies only to the one address hard-coded in `src/lib/auth/otp.ts` (`OTP_ROLLOUT = "TEST_USER"`).
- Set SMTP and `EMAIL_DELIVERY_ENABLED=true`; otherwise emails (OTP codes, reset links, workflow summaries) are skipped silently.
- Full details of every file, choice and test: `docs/migration/MIGRATION_PLAN.md`.
