// src/app/admin/users/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import AdminUserManagement from "@/components/admin-user-management";
import { requireUserType } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await requireUserType([USER_TYPE.ADMIN]);

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Users" subtitle="System user management">
      <AdminUserManagement />
    </DashboardShell>
  );
}
