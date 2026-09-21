import DashboardShell from "@/components/dashboard-shell";
import PdfLabViewer from "@/components/pdf-lab-viewer";
import { requireAuth } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function PdfLabPage() {
  const session = await requireAuth();

  return (
    <DashboardShell
      role={session.role}
      userName={session.name}
      title="PDF Lab"
      subtitle="Add and export PDF annotations"
    >
      <PdfLabViewer />
    </DashboardShell>
  );
}
