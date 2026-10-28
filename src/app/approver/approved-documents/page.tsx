// src/app/approver/approved-documents/page.tsx
import DocumentListPage from "@/components/document-list-page";
import { requireUserType } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";
import { getDocumentsForApprover } from "@/lib/document-queries";

export const dynamic = "force-dynamic";

export default async function ApproverApprovedDocumentsPage({ searchParams }: any) {
  const session = await requireUserType([USER_TYPE.ENGINEER, USER_TYPE.MANAGER]);
  const data = await getDocumentsForApprover(session.userId, session.userType);

  return (
    <DocumentListPage
      session={session}
      rows={data.approvedDocuments}
      searchParams={await Promise.resolve(searchParams)}
      title="Approved Documents"
      subtitle="Documents you approved"
      emptyMessage="No documents approved by you yet."
      showDownloadFilters
      table={{ showBulkActions: true, showDownloadTracking: true }}
    />
  );
}
