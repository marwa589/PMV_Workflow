// src/app/processes/[id]/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import ProcessRunView from "@/components/process-run-view";
import { requireAuth } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function ProcessRunPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Process Run" subtitle="Follow the steps and the documents that fill them">
      <ProcessRunView runId={id} />
    </DashboardShell>
  );
}
