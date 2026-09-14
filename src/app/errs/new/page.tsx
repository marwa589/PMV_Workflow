import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import NewDocumentForm from "@/components/new-document-form";
import { requireErrAccess } from "@/lib/err/permissions";
import { getErrProjectDirectors } from "@/lib/err/directors";
import { isErrUploaderAccount } from "@/lib/err/uploader-access";

export const dynamic = "force-dynamic";

export default async function NewErrPage() {
  const access = await requireErrAccess();

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
      <NewDocumentForm defaultRedirectPath="/errs" errDirectors={directors} errOnly />
    </DashboardShell>
  );
}