// src/app/processes/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import ProcessesPanel from "@/components/processes-panel";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export default async function ProcessesPage() {
  const session = await requireAuth();
  if (session.userType !== USER_TYPE.ADMIN) redirect("/tasks");

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Process Runs" subtitle="Follow the documents of each running process">
      <ProcessesPanel />
    </DashboardShell>
  );
}
