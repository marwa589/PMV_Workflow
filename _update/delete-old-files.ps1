<#
  Deletes the files of the OLD workflow that the dynamic update replaces.
  Run it from your repository root BEFORE extracting the update zip:

      powershell -ExecutionPolicy Bypass -File .\delete-old-files.ps1 -DryRun     # shows what would be deleted
      powershell -ExecutionPolicy Bypass -File .\delete-old-files.ps1             # asks, then deletes

  Commit or back up your work first (git history keeps everything).
  It deletes only the 75 files listed below, then removes folders that became empty.
  A folder that still holds a file of yours is left alone.
#>
param([string]$RepoRoot = (Get-Location).Path, [switch]$DryRun, [switch]$Force)

$files = @(
    'ma migrate status'
    'prisma/cleanup-migration-emails.mjs'
    'prisma/migrations/0_init/migration.sql'
    'prisma/migrations/20260913000000_err_user_access_project_id/migration.sql'
    'prisma/migrations/20260913124306_add_country_to_err_project/migration.sql'
    'prisma/migrations/20260913124307_classify_projects_by_country/migration.sql'
    'prisma/migrations/20260913150000_add_err_approval_path_actions/migration.sql'
    'prisma/migrations/20260913160000_add_purchase_orders/migration.sql'
    'prisma/migrations/20260914000000_add_purchase_order_description/migration.sql'
    'prisma/migrations/20260914010000_add_purchase_order_email_event/migration.sql'
    'prisma/migrations/20260914011000_dedupe_purchase_order_notifications/migration.sql'
    'prisma/migrations/20260914020000_add_user_location_and_roles/migration.sql'
    'prisma/migrations/20260915000000_add_storage_folder_metadata/migration.sql'
    'prisma/migrations/20260919101140_fix_user_location_nullable/migration.sql'
    'prisma/migrations/20260921120000_add_err_next_approval_path/migration.sql'
    'prisma/migrations/20260923100000_add_purchase_order_received_confirmation/migration.sql'
    'prisma/migrations/20260924120000_add_custody_document_type/migration.sql'
    'prisma/migrations/20260926120000_add_err_workflow_email_event/migration.sql'
    'prisma/migrations/20260926130000_add_renewal_err_type/migration.sql'
    'scripts/migrate-err-access.mjs'
    'scripts/setup-err.mjs'
    'src/app/admin/workflows/page.tsx'
    'src/app/api/admin/workflow-templates/route.ts'
    'src/app/api/documents/[id]/package-download/route.ts'
    'src/app/api/documents/comparisons/route.ts'
    'src/app/api/errs/[id]/actions/route.ts'
    'src/app/api/errs/[id]/download/route.ts'
    'src/app/api/errs/[id]/quotations/route.ts'
    'src/app/api/errs/[id]/vouchers/route.ts'
    'src/app/api/errs/bulk-actions/route.ts'
    'src/app/api/errs/bulk-download/route.ts'
    'src/app/api/errs/route.ts'
    'src/app/api/errs/sidebar/route.ts'
    'src/app/api/purchase-orders/[id]/download/route.ts'
    'src/app/api/purchase-orders/[id]/received/route.ts'
    'src/app/api/purchase-orders/[id]/route.ts'
    'src/app/api/purchase-orders/bulk-actions/route.ts'
    'src/app/api/purchase-orders/bulk-download/route.ts'
    'src/app/api/purchase-orders/route.ts'
    'src/app/errs/[id]/page.tsx'
    'src/app/errs/[id]/review/page.tsx'
    'src/app/errs/new/page.tsx'
    'src/app/errs/page.tsx'
    'src/app/errs/settings/page.tsx'
    'src/app/errs/vouchers/page.tsx'
    'src/app/procurement-packages/[id]/page.tsx'
    'src/app/procurement-packages/page.tsx'
    'src/app/purchase-orders/[id]/page.tsx'
    'src/app/purchase-orders/page.tsx'
    'src/components/admin-workflow-management.tsx'
    'src/components/err-list-table.tsx'
    'src/components/err-quotation-upload.tsx'
    'src/components/err-sidebar.tsx'
    'src/components/err-summary-cards.tsx'
    'src/components/err-voucher-modal.tsx'
    'src/components/err-voucher-upload-page.tsx'
    'src/components/procurement-package-tables.tsx'
    'src/components/purchase-order-delete-button.tsx'
    'src/components/purchase-order-list-table.tsx'
    'src/components/purchase-order-upload.tsx'
    'src/lib/auth/module-visibility.ts'
    'src/lib/auth/resource-access.ts'
    'src/lib/document-workflow-config.ts'
    'src/lib/err-storage.ts'
    'src/lib/err/directors.ts'
    'src/lib/err/files.ts'
    'src/lib/err/permissions.ts'
    'src/lib/err/queries.ts'
    'src/lib/err/uploader-access.ts'
    'src/lib/err/vouchers.ts'
    'src/lib/err/workflow.ts'
    'src/lib/po-access.ts'
    'src/lib/workflow-locations.ts'
    'src/lib/workflow.ts'
    'upgrade-review.sql'
)

if (-not ((Test-Path (Join-Path $RepoRoot 'package.json')) -and (Test-Path (Join-Path $RepoRoot 'prisma')) -and (Test-Path (Join-Path $RepoRoot 'src')))) {
    Write-Host "This does not look like the repository root (no package.json, prisma and src): $RepoRoot" -ForegroundColor Red
    exit 1
}

$present = $files | Where-Object { Test-Path -LiteralPath (Join-Path $RepoRoot $_) }
Write-Host ("{0} of {1} listed files exist in {2}" -f $present.Count, $files.Count, $RepoRoot)
$present | ForEach-Object { Write-Host "  $_" }

if ($DryRun) { Write-Host "Dry run: nothing was deleted." -ForegroundColor Yellow; exit 0 }
if ($present.Count -eq 0) { Write-Host "Nothing to delete."; exit 0 }
if (-not $Force) {
    $answer = Read-Host "Delete these $($present.Count) files? (y/N)"
    if ($answer -ne 'y') { Write-Host "Cancelled."; exit 0 }
}

$stop = @('src', 'prisma', 'scripts') | ForEach-Object { Join-Path $RepoRoot $_ }
foreach ($file in $present) {
    $path = Join-Path $RepoRoot $file
    Remove-Item -LiteralPath $path -Force
    $dir = Split-Path -Parent $path
    while ($dir -and ($stop -notcontains $dir) -and ($dir.Length -gt $RepoRoot.Length) -and (Test-Path -LiteralPath $dir) -and -not (Get-ChildItem -LiteralPath $dir -Force)) {
        Remove-Item -LiteralPath $dir -Force
        $dir = Split-Path -Parent $dir
    }
}
Write-Host "Deleted $($present.Count) files. Now extract the update zip into the repository root." -ForegroundColor Green
