// src/app/admin/archive/page.tsx
import DocumentListPage from "@/components/document-list-page";
import { requireUserType } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";
import { getDocumentsForAdmin } from "@/lib/document-queries";

export const dynamic = "force-dynamic";

export default async function AdminArchivePage({ searchParams }: any) {
  const session = await requireUserType([USER_TYPE.ADMIN]);
  const data = await getDocumentsForAdmin();

  return (
    <DocumentListPage
      session={session}
      rows={data.archivedDocuments}
      searchParams={await Promise.resolve(searchParams)}
      title="Archive"
      subtitle="Administrative archive"
      emptyMessage="No archived documents."
      lockedStatus="ARCHIVED"
      table={{ showBulkActions: true, allowAdminDelete: true }}
    />
  );
}
