// src/app/admin/pending-approvals/page.tsx
import DocumentListPage from "@/components/document-list-page";
import { requireUserType } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";
import { getDocumentsForAdmin } from "@/lib/document-queries";

export const dynamic = "force-dynamic";

export default async function AdminPendingApprovalsPage({ searchParams }: any) {
  const session = await requireUserType([USER_TYPE.ADMIN]);
  const data = await getDocumentsForAdmin();

  return (
    <DocumentListPage
      session={session}
      rows={data.pendingDocuments}
      searchParams={await Promise.resolve(searchParams)}
      title="Pending Approvals"
      subtitle="Documents waiting at any level"
      emptyMessage="No pending approvals."
      summaryMode="byType"
      variant="pending"
      // Admin users may act at any level: Review opens a document, and ticking several reviews them together.
      table={{ allowReview: true }}
    />
  );
}
