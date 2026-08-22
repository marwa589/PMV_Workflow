import { UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import SignatureSettings from "@/components/signature-settings";
import { requireRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ApproverSettingsPage() {
  const session = await requireRole([UserRole.APPROVER_1, UserRole.APPROVER_2, UserRole.APPROVER_3]);
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { signaturePath: true, signatureOriginalName: true },
  });

  return (
    <DashboardShell role={session.role} userName={session.name} title="Account Settings" subtitle="Manage your approver profile and signature">
      <SignatureSettings hasSignature={Boolean(user?.signaturePath)} signatureName={user?.signatureOriginalName || null} />
    </DashboardShell>
  );
}
