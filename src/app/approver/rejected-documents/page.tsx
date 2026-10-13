// src/app/approver/rejected-documents/page.tsx
import DocumentListPage from "@/components/document-list-page";
import { requireUserType } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";
import { getDocumentsForApprover } from "@/lib/document-queries";

export const dynamic = "force-dynamic";

export default async function ApproverRejectedDocumentsPage({ searchParams }: any) {
  const session = await requireUserType([USER_TYPE.ENGINEER, USER_TYPE.MANAGER]);
  const data = await getDocumentsForApprover(session.userId, session.userType);

  return (
    <DocumentListPage
      session={session}
      rows={data.rejectedDocuments}
      searchParams={await Promise.resolve(searchParams)}
      title="Rejected Documents"
      subtitle="Documents you rejected"
      emptyMessage="No documents rejected by you yet."
      table={{ showBulkActions: true }}
    />
  );
}
