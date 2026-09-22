import { UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import AdminWorkflowManagement from "@/components/admin-workflow-management";
import { requireRole } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AdminWorkflowTemplatesPage() {
  const session = await requireRole([UserRole.ADMIN]);

  return (
    <DashboardShell role={session.role} userName={session.name} title="Workflow Templates" subtitle="Manage approval chains by document type and location">
      <AdminWorkflowManagement />
    </DashboardShell>
  );
}
