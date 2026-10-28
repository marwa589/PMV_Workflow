// src/app/admin/processes/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import ProcessesManager from "@/components/admin/processes-manager";
import { requirePermission } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AdminProcessesPage() {
  const session = await requirePermission("processes.manage");

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Process Setup" subtitle="Design document trees: a start document and its optional next documents">
      <ProcessesManager />
    </DashboardShell>
  );
}
