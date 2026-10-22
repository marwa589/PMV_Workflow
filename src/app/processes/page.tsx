// src/app/processes/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import ProcessesPanel from "@/components/processes-panel";
import { requireAuth } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function ProcessesPage() {
  const session = await requireAuth();

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Process Runs" subtitle="Follow the documents of each running process">
      <ProcessesPanel />
    </DashboardShell>
  );
}
