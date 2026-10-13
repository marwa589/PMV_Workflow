// src/app/processes/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import ProcessesPanel from "@/components/processes-panel";
import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ProcessesPage() {
  const session = await requireAuth();
  const projects = await prisma.project.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Processes" subtitle="Ordered sequences of documents, such as Comp Sheet → Material Req → Purchase Order">
      <ProcessesPanel projects={projects} />
    </DashboardShell>
  );
}
