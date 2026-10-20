import { notFound, redirect } from "next/navigation";
import { Download } from "lucide-react";
import { canViewErr, canViewErrQuotation, getErrVisibilityWhere, requireErrAccess } from "@/lib/err/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

function FilePreview({ errId, kind, mimeType, originalName }: { errId: string; kind: "ERR_PDF" | "QUOTATION"; mimeType: string | null; originalName: string }) {
  const fileUrl = `/api/errs/${errId}/download?kind=${kind}`;
  const inlineUrl = `${fileUrl}&inline=1`;
  const isImage = mimeType?.startsWith("image/") || /\.(png|jpe?g)$/i.test(originalName);

  return (
    <div className="overflow-hidden bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <p className="truncate text-sm font-medium text-slate-800" title={originalName}>{originalName}</p>
        <div className="flex shrink-0 gap-2">
          <a href={fileUrl} download className="inline-flex items-center gap-2 border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Download className="h-4 w-4" /> Download
          </a>
        </div>
      </div>
      {mimeType === "application/pdf" || /\.pdf$/i.test(originalName) ? (
        <iframe title={originalName} src={inlineUrl} className="h-[92vh] min-h-[40rem] w-full bg-white" />
      ) : isImage ? (
        <div className="flex min-h-80 items-center justify-center bg-white p-4">
          <img src={inlineUrl} alt={originalName} className="max-h-[92vh] max-w-full object-contain" />
        </div>
      ) : (
        <div className="flex min-h-80 items-center justify-center bg-slate-50 p-6 text-center text-sm text-slate-600">
          This file type cannot be previewed in the browser. Open or download the original file above.
        </div>
      )}
    </div>
  );
}

export default async function ErrPackagePage({ params }: Props) {
  const access = await requireErrAccess();
  const { id } = await params;
  if (!canViewErrQuotation(access) || !(await canViewErr(access, id))) redirect("/unauthorized");

  const err = await prisma.err.findFirst({
    where: { AND: [{ id }, getErrVisibilityWhere(access)] },
    select: {
      documentNumber: true,
      title: true,
      files: {
        where: { kind: { in: ["ERR_PDF", "QUOTATION"] } },
        orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
        select: { id: true, kind: true, originalName: true, mimeType: true },
      },
    },
  });

  if (!err) notFound();
  const errPdf = err.files.find((file) => file.kind === "ERR_PDF");
  const quotation = err.files.find((file) => file.kind === "QUOTATION");
  if (!errPdf || !quotation) notFound();

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-slate-200 px-4 py-3 sm:px-8">
        <p className="text-sm font-semibold">{err.documentNumber}</p>
        <p className="text-sm text-slate-600">{err.title}</p>
      </header>
      <div className="mx-auto max-w-7xl space-y-10 px-3 py-5 sm:px-6">
        <section className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold text-slate-600">ERR Document</h2>
          <FilePreview errId={id} kind="ERR_PDF" mimeType={errPdf.mimeType} originalName={errPdf.originalName} />
        </section>
        <section className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold text-slate-600">Quotation</h2>
          <FilePreview errId={id} kind="QUOTATION" mimeType={quotation.mimeType} originalName={quotation.originalName} />
        </section>
      </div>
    </main>
  );
}