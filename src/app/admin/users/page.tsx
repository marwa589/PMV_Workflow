import { UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import AdminUserManagement from "@/components/admin-user-management";
import { requireRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await requireRole([UserRole.ADMIN]);
  const [users, projects] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        errAccess: {
          where: { isActive: true },
          select: {
            id: true,
            role: true,
            projectId: true,
            project: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ name: "asc" }, { createdAt: "desc" }],
    }),
    prisma.errProject.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <DashboardShell role={session.role} userName={session.name} title="Users" subtitle="System user management">
      <AdminUserManagement
        initialUsers={users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          errAccessRoles: [...new Set(user.errAccess.map((entry) => entry.role))],
          errAccess: user.errAccess.map((entry: any) => {
            const proj: any = entry.project;
            return {
              id: entry.id,
              role: entry.role,
              projectId: entry.projectId ?? null,
              projectName: proj ? (proj.name as string) : null,
            };
          }),
          createdAt: user.createdAt.toISOString(),
        }))}
        projects={projects}
      />
    </DashboardShell>
  );
}
