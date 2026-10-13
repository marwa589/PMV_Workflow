// src/app/clerk/my-documents/page.tsx
import DocumentListPage from "@/components/document-list-page";
import { requireUserType } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";
import { getDocumentsForClerk } from "@/lib/document-queries";

export const dynamic = "force-dynamic";

export default async function ClerkMyDocumentsPage({ searchParams }: any) {
  const session = await requireUserType([USER_TYPE.CLERK]);
  const data = await getDocumentsForClerk(session.userId, session.userType);

  return (
    <DocumentListPage
      session={session}
      rows={data.documents}
      searchParams={await Promise.resolve(searchParams)}
      title="Documents"
      subtitle="All your workflow documents"
      emptyMessage="No documents found."
      showDownloadFilters
      table={{ showBulkActions: true, allowBulkDelete: true, showDownloadTracking: true }}
    />
  );
}
