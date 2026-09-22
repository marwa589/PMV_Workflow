import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import NewDocumentForm from "@/components/new-document-form";
import { requireRole } from "@/lib/auth/guards";
import { getErrProjectDirectors } from "@/lib/err/directors";
import { getErrAccess } from "@/lib/err/permissions";
import { isErrUploaderAccount } from "@/lib/err/uploader-access";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage() {
  const session = await requireRole([UserRole.CLERK, UserRole.ADMIN, UserRole.ERR_USER]);
  const errAccess = await getErrAccess();
  const isUploader =
    Boolean(errAccess?.isUploader) ||
    (session.role === UserRole.ERR_USER && isErrUploaderAccount(session.name, session.role));

  if (session.role === UserRole.ERR_USER && !isUploader) {
    redirect("/unauthorized");
  }

  let errDirectors: Array<{ projectId: string; directorId: string; name: string; projectName: string; country: string }> = [];
  try {
    if (session.role === UserRole.ADMIN || isUploader) {
      errDirectors = await getErrProjectDirectors();
    }
  } catch {
    errDirectors = [];
  }

  return (
    <DashboardShell
      role={session.role}
      userName={session.name}
      title="New Document"
      subtitle="Upload and submit a document to start workflow"
      isUploader={isUploader}
    >
      <NewDocumentForm defaultRedirectPath={session.role === UserRole.ADMIN ? "/admin" : session.role === UserRole.ERR_USER ? "/errs" : "/clerk"} errDirectors={errDirectors} errOnly={session.role === UserRole.ERR_USER} />
    </DashboardShell>
  );
}
