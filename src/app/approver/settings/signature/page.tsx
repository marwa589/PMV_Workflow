// src/app/approver/settings/signature/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import SignatureSettings from "@/components/signature-settings";
import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ApproverSignaturePage() {
  const session = await requireAuth();

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { signaturePath: true, signatureOriginalName: true },
  });

  return (
    <DashboardShell
      role={session.userType}
      userName={session.name}
      title="Account Settings"
      subtitle="Manage your approval signature"
    >
      <SignatureSettings hasSignature={Boolean(user?.signaturePath)} signatureName={user?.signatureOriginalName || null} />
    </DashboardShell>
  );
}
