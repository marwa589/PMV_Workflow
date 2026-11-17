import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import NewDocumentForm from "@/components/new-document-form";
import { requireAuth } from "@/lib/auth/guards";
import { hasRequiredRole } from "@/lib/auth/permissions";
import { getErrProjectDirectors } from "@/lib/err/directors";
import { getErrAccess } from "@/lib/err/permissions";
import { isErrUploaderAccount } from "@/lib/err/uploader-access";
import { prisma } from "@/lib/prisma";
import { workflowRouteOptionsForUploader } from "@/lib/ksa-projects";
import { getReceivingUploadOptions } from "@/lib/receiving-upload-options";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage() {
  const session = await requireAuth();
  // Invoice uploaders (Mohammed Mahmoud, Muneer) can open this page to upload invoices, GRVs and
  // Cash Receiving Vouchers even when their role cannot create workflow documents.
  const receivingUpload = await getReceivingUploadOptions(session);
  const hasDocumentRole = hasRequiredRole(session, [UserRole.CLERK, UserRole.ADMIN, UserRole.ERR_USER]);
  if (!hasDocumentRole && !receivingUpload) {
    redirect("/unauthorized");
  }

  const errAccess = await getErrAccess();
  const isUploader =
    Boolean(errAccess?.isUploader) ||
    (session.role === UserRole.ERR_USER && isErrUploaderAccount(session.name, session.role));

  const attachmentOnly = !hasDocumentRole || (session.role === UserRole.ERR_USER && !isUploader);
  if (attachmentOnly && !receivingUpload) {
    redirect("/unauthorized");
  }

  let errDirectors: Array<{ projectId: string; directorId: string; name: string; projectName: string; country: string }> = [];
  try {
    if (!attachmentOnly && (session.role === UserRole.ADMIN || isUploader)) {
      errDirectors = await getErrProjectDirectors();
    }
  } catch {
    errDirectors = [];
  }

  const uploader = session.role === UserRole.CLERK
    ? await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true, location: true } })
    : null;
  const workflowRouteOptions = uploader ? workflowRouteOptionsForUploader(uploader) : [];

  return (
    <DashboardShell
      role={session.role}
      userName={session.name}
      title="New Document"
      subtitle="Upload and submit a document to start workflow"
      isUploader={isUploader}
    >
      <NewDocumentForm defaultRedirectPath={session.role === UserRole.ADMIN ? "/admin" : session.role === UserRole.ERR_USER ? "/errs" : "/clerk"} errDirectors={errDirectors} errOnly={session.role === UserRole.ERR_USER} workflowRouteOptions={workflowRouteOptions} receivingUpload={receivingUpload} attachmentOnly={attachmentOnly} />
    </DashboardShell>
  );
}
