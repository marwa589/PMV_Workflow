import { UserRole } from "@prisma/client";
import AdminUserManagement from "@/components/admin-user-management";
import DashboardShell from "@/components/dashboard-shell";
import { requireRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await requireRole([UserRole.ADMIN]);
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <DashboardShell role={session.role} userName={session.name} title="Users" subtitle="System user management">
      <AdminUserManagement initialUsers={users.map((user) => ({ ...user, createdAt: user.createdAt.toISOString() }))} />
    </DashboardShell>
  );
}
