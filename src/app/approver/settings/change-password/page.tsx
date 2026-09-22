import { UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import ChangePasswordForm from "@/components/change-password-form";
import { requireRole } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function ApproverChangePasswordPage() {
  const session = await requireRole([
    UserRole.CLERK,
    UserRole.APPROVER_1,
    UserRole.APPROVER_2,
    UserRole.APPROVER_3,
    UserRole.ADMIN,
    UserRole.ERR_USER,
  ]);

  return (
    <DashboardShell
      role={session.role}
      userName={session.name}
      title="Account Settings"
      subtitle="Change your account password"
    >
      <div className="max-w-5xl">
        <ChangePasswordForm />
      </div>
    </DashboardShell>
  );
}
