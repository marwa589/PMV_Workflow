// src/app/admin/mailing-list/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import MailingListManager from "@/components/admin/mailing-list-manager";
import { requireUserType } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export default async function MailingListPage() {
  const session = await requireUserType([USER_TYPE.ADMIN]);

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Mailing List" subtitle="Which emails each person gets, for which projects and document types, and how they are delivered">
      <MailingListManager />
    </DashboardShell>
  );
}
