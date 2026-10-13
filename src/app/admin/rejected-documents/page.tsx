// src/app/admin/rejected-documents/page.tsx
import DocumentListPage from "@/components/document-list-page";
import { requireUserType } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";
import { getDocumentsForAdmin } from "@/lib/document-queries";

export const dynamic = "force-dynamic";

export default async function AdminRejectedDocumentsPage({ searchParams }: any) {
  const session = await requireUserType([USER_TYPE.ADMIN]);
  const data = await getDocumentsForAdmin();

  return (
    <DocumentListPage
      session={session}
      rows={data.rejectedDocuments}
      searchParams={await Promise.resolve(searchParams)}
      title="Rejected Documents"
      subtitle="Administrative rejected queue"
      emptyMessage="No rejected documents."
      lockedStatus="CANCELLED"
      summaryMode="byType"
      table={{ showBulkActions: true, allowAdminDelete: true }}
    />
  );
}
