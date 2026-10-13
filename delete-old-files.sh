#!/usr/bin/env bash
# Deletes the files of the OLD workflow that the dynamic update replaces.
# Run from your repository root BEFORE extracting the update zip (Git Bash, WSL, macOS or Linux):
#
#   bash delete-old-files.sh --dry-run    # shows what would be deleted
#   bash delete-old-files.sh              # asks, then deletes
#
# Commit or back up first (git history keeps everything). Only the 75 listed files are deleted,
# then folders that became empty are removed; a folder holding a file of yours is left alone.
set -euo pipefail
ROOT="${REPO_ROOT:-$(pwd)}"
DRY=0; FORCE=0
for arg in "$@"; do case "$arg" in --dry-run) DRY=1;; --force) FORCE=1;; esac; done

FILES=(
  "ma migrate status"
  "prisma/cleanup-migration-emails.mjs"
  "prisma/migrations/0_init/migration.sql"
  "prisma/migrations/20260913000000_err_user_access_project_id/migration.sql"
  "prisma/migrations/20260913124306_add_country_to_err_project/migration.sql"
  "prisma/migrations/20260913124307_classify_projects_by_country/migration.sql"
  "prisma/migrations/20260913150000_add_err_approval_path_actions/migration.sql"
  "prisma/migrations/20260913160000_add_purchase_orders/migration.sql"
  "prisma/migrations/20260914000000_add_purchase_order_description/migration.sql"
  "prisma/migrations/20260914010000_add_purchase_order_email_event/migration.sql"
  "prisma/migrations/20260914011000_dedupe_purchase_order_notifications/migration.sql"
  "prisma/migrations/20260914020000_add_user_location_and_roles/migration.sql"
  "prisma/migrations/20260915000000_add_storage_folder_metadata/migration.sql"
  "prisma/migrations/20260919101140_fix_user_location_nullable/migration.sql"
  "prisma/migrations/20260921120000_add_err_next_approval_path/migration.sql"
  "prisma/migrations/20260923100000_add_purchase_order_received_confirmation/migration.sql"
  "prisma/migrations/20260924120000_add_custody_document_type/migration.sql"
  "prisma/migrations/20260926120000_add_err_workflow_email_event/migration.sql"
  "prisma/migrations/20260926130000_add_renewal_err_type/migration.sql"
  "scripts/migrate-err-access.mjs"
  "scripts/setup-err.mjs"
  "src/app/admin/workflows/page.tsx"
  "src/app/api/admin/workflow-templates/route.ts"
  "src/app/api/documents/[id]/package-download/route.ts"
  "src/app/api/documents/comparisons/route.ts"
  "src/app/api/errs/[id]/actions/route.ts"
  "src/app/api/errs/[id]/download/route.ts"
  "src/app/api/errs/[id]/quotations/route.ts"
  "src/app/api/errs/[id]/vouchers/route.ts"
  "src/app/api/errs/bulk-actions/route.ts"
  "src/app/api/errs/bulk-download/route.ts"
  "src/app/api/errs/route.ts"
  "src/app/api/errs/sidebar/route.ts"
  "src/app/api/purchase-orders/[id]/download/route.ts"
  "src/app/api/purchase-orders/[id]/received/route.ts"
  "src/app/api/purchase-orders/[id]/route.ts"
  "src/app/api/purchase-orders/bulk-actions/route.ts"
  "src/app/api/purchase-orders/bulk-download/route.ts"
  "src/app/api/purchase-orders/route.ts"
  "src/app/errs/[id]/page.tsx"
  "src/app/errs/[id]/review/page.tsx"
  "src/app/errs/new/page.tsx"
  "src/app/errs/page.tsx"
  "src/app/errs/settings/page.tsx"
  "src/app/errs/vouchers/page.tsx"
  "src/app/procurement-packages/[id]/page.tsx"
  "src/app/procurement-packages/page.tsx"
  "src/app/purchase-orders/[id]/page.tsx"
  "src/app/purchase-orders/page.tsx"
  "src/components/admin-workflow-management.tsx"
  "src/components/err-list-table.tsx"
  "src/components/err-quotation-upload.tsx"
  "src/components/err-sidebar.tsx"
  "src/components/err-summary-cards.tsx"
  "src/components/err-voucher-modal.tsx"
  "src/components/err-voucher-upload-page.tsx"
  "src/components/procurement-package-tables.tsx"
  "src/components/purchase-order-delete-button.tsx"
  "src/components/purchase-order-list-table.tsx"
  "src/components/purchase-order-upload.tsx"
  "src/lib/auth/module-visibility.ts"
  "src/lib/auth/resource-access.ts"
  "src/lib/document-workflow-config.ts"
  "src/lib/err-storage.ts"
  "src/lib/err/directors.ts"
  "src/lib/err/files.ts"
  "src/lib/err/permissions.ts"
  "src/lib/err/queries.ts"
  "src/lib/err/uploader-access.ts"
  "src/lib/err/vouchers.ts"
  "src/lib/err/workflow.ts"
  "src/lib/po-access.ts"
  "src/lib/workflow-locations.ts"
  "src/lib/workflow.ts"
  "upgrade-review.sql"
)

if [ ! -f "$ROOT/package.json" ] || [ ! -d "$ROOT/prisma" ] || [ ! -d "$ROOT/src" ]; then
  echo "This does not look like the repository root (no package.json, prisma and src): $ROOT"; exit 1
fi

PRESENT=()
for f in "${FILES[@]}"; do [ -e "$ROOT/$f" ] && PRESENT+=("$f"); done
echo "${#PRESENT[@]} of ${#FILES[@]} listed files exist in $ROOT"
for f in "${PRESENT[@]}"; do echo "  $f"; done

if [ "$DRY" = 1 ]; then echo "Dry run: nothing was deleted."; exit 0; fi
if [ "${#PRESENT[@]}" = 0 ]; then echo "Nothing to delete."; exit 0; fi
if [ "$FORCE" = 0 ]; then
  read -r -p "Delete these ${#PRESENT[@]} files? (y/N) " ans
  [ "$ans" = "y" ] || { echo "Cancelled."; exit 0; }
fi

for f in "${PRESENT[@]}"; do
  rm -f "$ROOT/$f"
  d="$(dirname "$ROOT/$f")"
  while [ "$d" != "$ROOT" ] && [ "$d" != "$ROOT/src" ] && [ "$d" != "$ROOT/prisma" ] && [ "$d" != "$ROOT/scripts" ] && [ -d "$d" ] && [ -z "$(ls -A "$d")" ]; do
    rmdir "$d"; d="$(dirname "$d")"
  done
done
echo "Deleted ${#PRESENT[@]} files. Now extract the update zip into the repository root."
