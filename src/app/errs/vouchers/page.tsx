import { redirect } from "next/navigation";
import { ErrType } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import ErrVoucherUploadPage from "@/components/err-voucher-upload-page";
import { canUploadErrVoucher, requireErrAccess, getErrVisibilityWhere } from "@/lib/err/permissions";
import { isErrUploaderAccount } from "@/lib/err/uploader-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ErrVouchersPage() {
  const access = await requireErrAccess();
  const canUpload = access.isAdmin || access.isUploader || isErrUploaderAccount(access.name, access.role);
  if (!canUpload) redirect("/unauthorized");

  const errs = await prisma.err.findMany({
    where: {
      AND: [
        { status: "APPROVED" },
        { type: { in: [ErrType.RENTAL_ACTC, ErrType.RENTAL_EXTERNAL] } },
        getErrVisibilityWhere(access),
      ],
    },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      type: true,
      projectNameSnapshot: true,
      projectId: true,
      files: {
        where: { kind: { in: ["RELEASE_VOUCHER", "RECEIPT_VOUCHER"] } },
        select: { kind: true },
      },
    },
    orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
  });

  const approvedErrs = errs
    .filter((err) => canUploadErrVoucher(access, err.projectId))
    .map((err) => ({
      id: err.id,
      documentNumber: err.documentNumber,
      title: err.title,
      projectName: err.projectNameSnapshot || "Unknown project",
      type: err.type,
      releaseVoucherCount: err.files.filter((file) => file.kind === "RELEASE_VOUCHER").length,
      receiptVoucherCount: err.files.filter((file) => file.kind === "RECEIPT_VOUCHER").length,
    }));

  return (
    <DashboardShell
      role={access.role}
      userName={access.name}
      title="Attach Vouchers"
      subtitle="Upload release and receipt vouchers for approved rental ERRs"
      isUploader={access.isUploader}
    >
      <ErrVoucherUploadPage approvedErrs={approvedErrs} />
    </DashboardShell>
  );
}
