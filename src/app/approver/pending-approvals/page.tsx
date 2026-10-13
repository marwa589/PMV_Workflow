// src/app/approver/pending-approvals/page.tsx
import DocumentListPage from "@/components/document-list-page";
import { requireUserType } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";
import { getDocumentsForApprover } from "@/lib/document-queries";

export const dynamic = "force-dynamic";

export default async function ApproverPendingApprovalsPage({ searchParams }: any) {
  const session = await requireUserType([USER_TYPE.ENGINEER, USER_TYPE.MANAGER]);
  const data = await getDocumentsForApprover(session.userId, session.userType);

  return (
    <DocumentListPage
      session={session}
      rows={data.pendingDocuments}
      searchParams={await Promise.resolve(searchParams)}
      title="Pending Approvals"
      subtitle="Documents awaiting your action"
      emptyMessage="No pending approvals assigned to you."
      summaryMode="byType"
      variant="pending"
    />
  );
}
