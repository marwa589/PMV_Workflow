import DashboardShell from "@/components/dashboard-shell";
import MaintenanceManager from "@/components/admin/maintenance-manager";
import { requirePermission } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AdminMaintenancePage() {
  const session = await requirePermission("maintenance.manage");
  return <DashboardShell role={session.userType} userName={session.name} title="Maintenance Setup" subtitle="Manage maintenance items, follow-up workflows and project assignments"><MaintenanceManager /></DashboardShell>;
}
