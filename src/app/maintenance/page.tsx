import DashboardShell from "@/components/dashboard-shell";
import MaintenancePage from "@/components/maintenance-page";
import { requireAuth } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function MaintenanceTicketsPage() {
  const session = await requireAuth();
  return <DashboardShell role={session.userType} userName={session.name} title="Maintenance Requests" subtitle="Submit and follow up on maintenance tickets"> <MaintenancePage /> </DashboardShell>;
}
