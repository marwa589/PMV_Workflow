import { UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import NewDocumentForm from "@/components/new-document-form";
import { requireRole } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage() {
  const session = await requireRole([UserRole.CLERK, UserRole.ADMIN]);

  return (
    <DashboardShell
      role={session.role}
      userName={session.name}
      title="New Document"
      subtitle="Upload and submit a document to start workflow"
    >
      <NewDocumentForm />
    </DashboardShell>
  );
}
