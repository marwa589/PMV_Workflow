# Data migration design (old hard-coded system -> dynamic system)

Status: DRAFT. Defaults marked (default) are not confirmed by the owner yet.

## 1. Access parity matrix (old rule -> new role / assignment)

| Old rule (source) | New equivalent |
|---|---|
| Upload documents: CLERK/ADMIN only (`api/documents`) | Clerk user type + role with `documents.create`, scoped to project/type |
| Non-restricted clerk sees all documents; restricted clerk sees own only | Role `Viewer` (view) unscoped vs. scoped to own uploads (verify new logic; fix if not identical) |
| Custody upload: CLERK/ADMIN, AVR only | `documents.create` scoped to type Custody + project AVR |
| Deletion request: CLERK/ADMIN; review: ADMIN | `documents.delete_request`, `documents.delete_review` |
| KSA_VIEWER | Role with `documents.view` scoped to location KSA; user type eng (cannot upload) (default) |
| ERR_USER (view+upload) | Role view+create scoped to type ERR |
| Approver w/o signature: mohammad.mehieddine, joemar.paraiso (always); george.azzi on MR created by AVR/AVK users (`approver/review/[id]/page.tsx`) | Permission `documents.approve_without_signature` role; George's is scoped to type MR + projects AVR, AVK |
| Elie Azzam approves Ready Mix MR/Comparison from dispatcher.pmv | Named user at level 1 of the RMX flow |
| Ramzi/Mohamed approves AVK-uploader MR at level 1 | Named user at level 1 of the AVK MR flow |
| Approver 3 chooses approval route per document | Replaced by admin flow assignment (closest approach) |
| PO "Received" confirmation | `documents.confirm_receipt` (see section 2) |

## 2. UI requirements added 2026-10-28
- PO/document "Received" confirmation, dynamic: shown wherever the document list/detail is shown, only to holders of `documents.confirm_receipt` in scope. Proposal: list-level checkbox/button, no schema change.
- Colour code system-wide: pending = yellow, rejected = red, approved = blue, approved and downloaded = green.
  Proposal for the rest (default): revision required = orange, on hold = violet, archived = grey.
  Single source of truth: `src/components/status-badge.tsx` + `getStatusColor` in `src/lib/document-metrics.ts`.

## 3. Open items needing owner confirmation
1. Delivery path for the audit script (GitHub link) and the audit report from a copy of the real old DB.
2. User-type mapping for each old user.
3. PO "Received" design (list-level vs per-type switch).
4. Colours for revision/hold/archived, and whether "downloaded" means downloaded by the viewing user.
