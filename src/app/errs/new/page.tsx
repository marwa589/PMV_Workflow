import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import NewDocumentForm from "@/components/new-document-form";
import { requireErrAccess } from "@/lib/err/permissions";
import { getErrProjectDirectors } from "@/lib/err/directors";
import { isErrUploaderAccount } from "@/lib/err/uploader-access";
import { isKsaViewer } from "@/lib/ksa-viewer";

export const dynamic = "force-dynamic";

export default async function NewErrPage({ searchParams }: { searchParams: Promise<{ marcOnly?: string }> }) {
  const access = await requireErrAccess();
  if (isKsaViewer(access)) redirect("/unauthorized");
  const resolvedSearchParams = await searchParams;
  const marcOnly = resolvedSearchParams.marcOnly === "1";

  if (!access.isUploader && !isErrUploaderAccount(access.name, access.role) && !access.isAdmin) {
    redirect("/unauthorized");
  }

  const directors = await getErrProjectDirectors();

  return (
    <DashboardShell
      role={access.role}
      userName={access.name}
      title="New ERR"
      subtitle={`Welcome, ${access.name}`}
      isUploader={true}
    >
      <NewDocumentForm defaultRedirectPath="/errs" errDirectors={directors} errOnly marcOnly={marcOnly} />
    </DashboardShell>
  );
}