# Cutover runbook: rebuild the new system's data from a fresh copy of the old system

Run everything from the project folder `C:\Users\Dell\Repo\pmv-dc-sys\PMV_Workflow`, in PowerShell. Every step that writes has a dry run first: look at the plan, then repeat with `--apply`.
Send me the plan after each dry run and wait for my OK before `--apply`.

## 0. Variables (paste once per PowerShell window)

```
$OLDROOT = "C:\Users\Dell\OneDrive - Ahmadiah Contracting & Trading Co. kcsc\PMV Department's files - PMV Dept Shared Resources\PMV_AWF"
$NEWROOT = "C:\Users\Dell\OneDrive - Ahmadiah Contracting & Trading Co. kcsc\PMV Department's files - PMV Dept Shared Resources\system-docs\uploads"
$OLD = "postgresql://postgres:ahmadiah26@localhost:5432/pmv_old_final"
$NEW = "postgresql://postgres:ahmadiah26@localhost:5432/pmv_system"
$env:PGPASSWORD = "ahmadiah26"
```

## 1. Freeze the old system (nobody uploads or approves any more)

Stop the old application (or tell everybody to stop). Open OneDrive and wait until `PMV_AWF` shows "Up to date" with no pending sync. Every file must be on this PC (right-click the folder, "Always keep on this device").

## 2. Take a fresh copy of the old database (a NEW database, nothing is dropped)

```
pg_dump -h localhost -p 5432 -U postgres -Fc -f "$env:TEMP\pmv_final.dump" pmv_upToDate
```
Check that the file exists and is large: `(Get-Item "$env:TEMP\pmv_final.dump").Length`. Only then:
```
createdb -h localhost -p 5432 -U postgres pmv_old_final
```
```
pg_restore -h localhost -p 5432 -U postgres -d pmv_old_final --no-owner "$env:TEMP\pmv_final.dump"
```
Check the newest document: `psql -h localhost -U postgres -d pmv_old_final -c "select \"documentNumber\", \"createdAt\" from \"Document\" order by \"createdAt\" desc limit 3"`

## 3. Remove the earlier migration from the new database (and its copied files)

```
node scripts/migration/stage0-reset-documents.mjs --new-url $NEW --new-root $NEWROOT
```
Look at the counts, send them to me, then add `--apply`. It removes only what the migration created.

## 4. Configuration and users (Stages 1 to 3)

```
node scripts/migration/stage1-config.mjs --old-url $OLD --new-url $NEW --out migration-output
node scripts/migration/stage2-users.mjs --old-url $OLD --new-url $NEW --upload-root $OLDROOT --out migration-output
node scripts/migration/stage3-flows.mjs --new-url $NEW --out migration-output
```
Look at each plan (new projects? new users?), then repeat each with `--apply`.

## 5. MR numbers for the fresh data

```
node scripts/migration/extract-mr-numbers.mjs --old-url $OLD --out migration-output
```
Use the newest `migration-output\mr-numbers-<time>\mr-numbers-proposed.csv` as `--mr-numbers` below. Any MR in `mr-numbers-missing.csv` needs its number from you.

## 6. Documents, purchase orders, processes, ERRs (Stages 4 to 7)

```
node scripts/migration/stage4-documents.mjs --old-url $OLD --new-url $NEW --batch cut-docs --types MR,COMP,CUSTODY --mr-numbers "<path to proposed csv>" --upload-root $OLDROOT --out migration-output
node scripts/migration/stage5-purchase-orders.mjs --old-url $OLD --new-url $NEW --batch cut-po --all --duplicates "migration-output\stage4-cut-docs-duplicates-dropped.csv" --upload-root $OLDROOT --out migration-output
node scripts/migration/stage6-processes.mjs --old-url $OLD --new-url $NEW --batch cut-runs --all --out migration-output
node scripts/migration/stage7-errs.mjs --old-url $OLD --new-url $NEW --batch cut-err --all --upload-root $OLDROOT --out migration-output
```
Each: dry run, send me the plan, then the same command plus `--apply`. Blocked documents (for example a new MR without a number) are listed in the plan; fix them and run the same command again: finished documents are skipped.

## 7. Files and checks (Stages 8 and 9)

```
node scripts/migration/stage8-copy-files.mjs --new-url $NEW --old-root $OLDROOT --new-root $NEWROOT --out migration-output
node scripts/migration/stage9-reconcile.mjs --old-url $OLD --new-url $NEW --new-root $NEWROOT --out migration-output
```
Stage 8: dry run, then `--verify-hash --apply`. Stage 9 must say ALL CHECKS PASSED.

## 8. Go live

Point the new system at `pmv_system` and the upload folder `system-docs\uploads`, restart it, and log in as an approver and as an uploader to look at one document of each type. Then tell the users.
