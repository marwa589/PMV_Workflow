"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

type PendingDocument = {
  id: string;
  documentNumber: string;
  title: string;
  documentType?: "COMPARISON" | "MATERIAL_REQUISITION" | "ERR" | null;
  mrType?: "CASH" | "CREDIT" | null;
  currentVersion: number;
  uploadedAt: string;
  relatedComparisonId?: string | null;
  relatedComparisonDocumentNumber?: string | null;
  quotationFileName?: string | null;
};

export default function ApproverPendingTable({ documents, showQuotation }: { documents: PendingDocument[]; showQuotation: boolean }) {
  const router = useRouter();
  const [visibleCount, setVisibleCount] = useState(10);

  if (documents.length === 0) {
    return <div className="px-5 py-6 text-sm text-slate-500">No pending approvals assigned to you.</div>;
  }

  function getDocumentTypeLabel(document: PendingDocument): string {
    if (document.documentType === "MATERIAL_REQUISITION") {
      return document.mrType === "CASH" ? "MR - Cash" : document.mrType === "CREDIT" ? "MR - Credit" : "Material Requisition";
    }
    if (document.documentType === "ERR") {
      return "ERR";
    }
    return "Comparison Sheet";
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-3 font-semibold">Document Number</th>
            <th className="px-5 py-3 font-semibold">Title</th>
            <th className="px-5 py-3 font-semibold">Type</th>
            {showQuotation ? <th className="px-5 py-3 font-semibold">Quotation</th> : null}
            <th className="px-5 py-3 font-semibold">Related Comparison</th>
            <th className="px-5 py-3 font-semibold">Current Version</th>
            <th className="px-5 py-3 font-semibold">Date</th>
            <th className="px-5 py-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.slice(0, visibleCount).map((document) => {
            const detailUrl =
              document.documentType === "ERR"
                ? `/errs/${document.id}`
                : `/documents/${document.id}`;

            return (
              <tr key={document.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="px-5 py-4 font-medium text-slate-900">
                  <Link href={detailUrl} className="hover:text-indigo-600 hover:underline">
                    {document.documentNumber}
                  </Link>
                </td>
                <td className="px-5 py-4 text-slate-700">
                  <Link href={detailUrl} className="text-slate-800 hover:text-indigo-600 hover:underline">
                    {document.title}
                  </Link>
                </td>
                {showQuotation ? <td className="px-5 py-4">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                    {getDocumentTypeLabel(document)}
                  </span>
                </td> : null}
                <td className="px-5 py-4">
                  {document.documentType === "ERR" && document.quotationFileName ? (
                    <a href={`/api/errs/${document.id}/download?kind=QUOTATION&inline=1`} target="_blank" rel="noopener noreferrer" className="font-medium text-cyan-700 hover:underline">Open Quotation</a>
                  ) : "—"}
                </td>
                <td className="px-5 py-4">
                  {document.relatedComparisonId && document.relatedComparisonDocumentNumber ? (
                    <Link
                      href={`/documents/${document.relatedComparisonId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-cyan-700 hover:underline"
                    >
                      {document.relatedComparisonDocumentNumber}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-5 py-4 text-slate-700">V{document.currentVersion}</td>
                <td className="px-5 py-4 text-slate-500">{document.uploadedAt}</td>
                <td className="px-5 py-4">
                  <div className="flex gap-2">
                    <a
                      href={
                        document.documentType === "ERR"
                          ? `/api/errs/${document.id}/download?kind=ERR_PDF`
                          : `/api/documents/${document.id}/download`
                      }
                      download
                      className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      onClick={() =>
                        router.push(
                          document.documentType === "ERR"
                            ? `/errs/${document.id}/review`
                            : `/approver/review/${document.id}`,
                        )
                      }
                      className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                    >
                      Review
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {visibleCount < documents.length ? <div className="border-t border-slate-200 px-5 py-4 text-center"><button type="button" onClick={() => setVisibleCount((count) => count + 10)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Load more</button></div> : null}
    </div>
  );
}
