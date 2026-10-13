// src/app/admin/document-types/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import DocumentTypesManager from "@/components/admin/document-types-manager";
import { requirePermission } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AdminDocumentTypesPage() {
  const session = await requirePermission("types.manage");

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Document Types" subtitle="Types, sub types and the fields each one collects">
      <DocumentTypesManager />
    </DashboardShell>
  );
}
