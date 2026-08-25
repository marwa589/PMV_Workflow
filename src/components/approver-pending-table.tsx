"use client";

import { useRouter } from "next/navigation";

type PendingDocument = {
  id: string;
  documentNumber: string;
  title: string;
  documentType?: "COMPARISON" | "MATERIAL_REQUISITION" | null;
  mrType?: "CASH" | "CREDIT" | null;
  currentVersion: number;
  uploadedAt: string;
  relatedComparisonId?: string | null;
  relatedComparisonDocumentNumber?: string | null;
};

export default function ApproverPendingTable({ documents }: { documents: PendingDocument[] }) {
  const router = useRouter();

  if (documents.length === 0) {
    return <div className="px-5 py-6 text-sm text-slate-500">No pending approvals assigned to you.</div>;
  }

  function getDocumentTypeLabel(document: PendingDocument): string {
    if (document.documentType === "MATERIAL_REQUISITION") {
      return document.mrType === "CASH" ? "MR - Cash" : document.mrType === "CREDIT" ? "MR - Credit" : "Material Requisition";
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
            <th className="px-5 py-3 font-semibold">Related Comparison</th>
            <th className="px-5 py-3 font-semibold">Current Version</th>
            <th className="px-5 py-3 font-semibold">Date</th>
            <th className="px-5 py-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <tr key={document.id} className="border-t border-slate-100">
              <td className="px-5 py-4 font-medium text-slate-900"><a href={`/documents/${document.id}`} className="hover:underline">{document.documentNumber}</a></td>
              <td className="px-5 py-4 text-slate-700">{document.title}</td>
              <td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{getDocumentTypeLabel(document)}</span></td>
              <td className="px-5 py-4">{document.relatedComparisonId && document.relatedComparisonDocumentNumber ? <a href={`/documents/${document.relatedComparisonId}`} target="_blank" rel="noopener noreferrer" className="font-medium text-cyan-700 hover:underline">{document.relatedComparisonDocumentNumber}</a> : "—"}</td>
              <td className="px-5 py-4 text-slate-700">V{document.currentVersion}</td>
              <td className="px-5 py-4 text-slate-500">{document.uploadedAt}</td>
              <td className="px-5 py-4">
                <div className="flex gap-2">
                  <a href={`/api/documents/${document.id}/download`} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Download</a>
                  <button type="button" onClick={() => router.push(`/approver/review/${document.id}`)} className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700">Review</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
