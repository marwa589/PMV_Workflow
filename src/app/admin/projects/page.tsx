// src/app/admin/projects/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import ProjectsManager from "@/components/admin/projects-manager";
import { requirePermission } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AdminProjectsPage() {
  const session = await requirePermission("projects.manage");

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Projects & Locations" subtitle="Locations, companies and projects">
      <ProjectsManager />
    </DashboardShell>
  );
}
