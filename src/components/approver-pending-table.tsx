"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

type PendingDocument = {
  id: string;
  documentNumber: string;
  title: string;
  documentType?: "COMPARISON" | "MATERIAL_REQUISITION" | null;
  mrType?: "CASH" | "CREDIT" | null;
  currentVersion: number;
  uploadedAt: string;
};

type Props = {
  documents: PendingDocument[];
};

export default function ApproverPendingTable({ documents }: Props) {
  const router = useRouter();
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [decision, setDecision] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [comments, setComments] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const activeDocument = useMemo(
    () => documents.find((doc) => doc.id === activeDocumentId) || null,
    [activeDocumentId, documents],
  );

  async function submitAction() {
    if (!activeDocument) return;

    if (decision === "APPROVE" && !selectedFile) {
      setError("Please upload a signed/revised file before approving.");
      return;
    }

    setError(null);
    setSubmittingId(activeDocument.id);

    try {
      const formData = new FormData();
      formData.set("decision", decision);
      formData.set("comments", comments);
      if (selectedFile) {
        formData.set("file", selectedFile);
      }

      const response = await fetch(`/api/documents/${activeDocument.id}/actions`, {
        method: "POST",
        body: formData,
      });

      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(result.message || "Failed to submit action.");
        return;
      }

      setActiveDocumentId(null);
      setDecision("APPROVE");
      setComments("");
      setSelectedFile(null);
      router.refresh();
    } catch {
      setError("Unexpected error while submitting approval action.");
    } finally {
      setSubmittingId(null);
    }
  }

  if (documents.length === 0) {
    return <div className="px-5 py-6 text-sm text-slate-500">No pending approvals assigned to you.</div>;
  }

  function getDocumentTypeLabel(doc: PendingDocument): string {
    if (doc.documentType === "MATERIAL_REQUISITION") {
      if (doc.mrType === "CASH") return "MR - Cash";
      if (doc.mrType === "CREDIT") return "MR - Credit";
      return "Material Requisition";
    }

    return "Comparison Sheet";
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 font-semibold">Document Number</th>
              <th className="px-5 py-3 font-semibold">Title</th>
              <th className="px-5 py-3 font-semibold">Type</th>
              <th className="px-5 py-3 font-semibold">Current Version</th>
              <th className="px-5 py-3 font-semibold">Date</th>
              <th className="px-5 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id} className="border-t border-slate-100">
                <td className="px-5 py-4 font-medium text-slate-900">
                  <a href={`/documents/${doc.id}`} className="text-slate-900 hover:text-slate-700 hover:underline">
                    {doc.documentNumber}
                  </a>
                </td>
                <td className="px-5 py-4 text-slate-700">{doc.title}</td>
                <td className="px-5 py-4">
                  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                    {getDocumentTypeLabel(doc)}
                  </span>
                </td>
                <td className="px-5 py-4 text-slate-700">V{doc.currentVersion}</td>
                <td className="px-5 py-4 text-slate-500">{doc.uploadedAt}</td>
                <td className="px-5 py-4">
                  <div className="flex gap-2">
                    <a
                      href={`/api/documents/${doc.id}/download`}
                      className="inline-flex rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveDocumentId(doc.id);
                        setError(null);
                      }}
                      className="inline-flex rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                    >
                      Review
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {activeDocument && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">
            {activeDocument.documentNumber} - {activeDocument.title}
          </p>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Decision</label>
              <select
                value={decision}
                onChange={(e) => setDecision(e.target.value as "APPROVE" | "REJECT")}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="APPROVE">Approve</option>
                <option value="REJECT">Reject</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Upload Signed/Revised File</label>
              <input
                type="file"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Comments</label>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              placeholder="Optional comments for audit trail"
            />
          </div>

          {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={submitAction}
              disabled={submittingId === activeDocument.id}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {submittingId === activeDocument.id ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                "Submit Action"
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveDocumentId(null)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
