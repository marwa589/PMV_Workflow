// src/app/approver/my-documents/page.tsx
import DocumentListPage from "@/components/document-list-page";
import { requireUserType } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";
import { getDocumentsForApprover } from "@/lib/document-queries";

export const dynamic = "force-dynamic";

export default async function ApproverMyDocumentsPage({ searchParams }: any) {
  const session = await requireUserType([USER_TYPE.ENGINEER, USER_TYPE.MANAGER]);
  const data = await getDocumentsForApprover(session.userId, session.userType);

  return (
    <DocumentListPage
      session={session}
      rows={data.myDocuments}
      searchParams={await Promise.resolve(searchParams)}
      title="My Documents"
      subtitle="Documents assigned to you or previously handled by you"
      emptyMessage="No documents assigned or previously handled by you."
      table={{ showBulkActions: true, allowReview: true }}
    />
  );
}
