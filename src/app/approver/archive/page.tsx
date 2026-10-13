// src/app/approver/archive/page.tsx
import DocumentListPage from "@/components/document-list-page";
import { requireUserType } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";
import { getDocumentsForApprover } from "@/lib/document-queries";

export const dynamic = "force-dynamic";

export default async function ApproverArchivePage({ searchParams }: any) {
  const session = await requireUserType([USER_TYPE.ENGINEER, USER_TYPE.MANAGER]);
  const data = await getDocumentsForApprover(session.userId, session.userType);

  return (
    <DocumentListPage
      session={session}
      rows={data.myDocuments}
      searchParams={await Promise.resolve(searchParams)}
      title="Archive"
      subtitle="Archived documents"
      emptyMessage="No archived documents found."
      lockedStatus="ARCHIVED"
      table={{ showBulkActions: true }}
    />
  );
}
