// src/app/admin/users/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import AdminUserManagement from "@/components/admin-user-management";
import { requirePermission } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await requirePermission("users.manage");

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Users" subtitle="System user management">
      <AdminUserManagement />
    </DashboardShell>
  );
}
