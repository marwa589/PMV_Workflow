// src/app/processes/[id]/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import ProcessRunView from "@/components/process-run-view";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export default async function ProcessRunPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session.userType !== USER_TYPE.ADMIN) redirect("/tasks");
  const { id } = await params;

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Process Run" subtitle="Follow the documents and the path this process has taken">
      <ProcessRunView runId={id} />
    </DashboardShell>
  );
}
