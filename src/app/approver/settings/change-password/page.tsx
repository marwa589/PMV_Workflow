// src/app/approver/settings/change-password/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import ChangePasswordForm from "@/components/change-password-form";
import { requireAuth } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function ApproverChangePasswordPage() {
  const session = await requireAuth();

  return (
    <DashboardShell
      role={session.userType}
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
