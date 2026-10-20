"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DocumentReviewEditor from "@/components/document-review-editor";

type ReviewItem = {
  id: string;
  documentNumber: string;
  title: string;
  documentType: "MATERIAL_REQUISITION" | "COMPARISON" | "CUSTODY" | "ERR";
  errStage?: "PROJECT_DIRECTOR" | "PMV_MANAGER" | "ACTING_CEO" | "CEO";
  downloadUrl: string;
  actionUrl: string;
};

type BatchDecision = "APPROVE" | "REJECT" | "COMMENT";
type BatchAction = { validate: (decision: BatchDecision) => string | null; submit: (decision: BatchDecision) => Promise<boolean> };

export default function BatchDocumentReview({
  items,
  hasSignature,
  returnUrl,
}: {
  items: ReviewItem[];
  hasSignature: boolean;
  returnUrl: string;
}) {
  const router = useRouter();
  const actions = useRef(new Map<string, BatchAction>());
  const [activeDocumentId, setActiveDocumentId] = useState(items[0]?.id ?? null);
  const [decisions, setDecisions] = useState<Record<string, BatchDecision>>(() => Object.fromEntries(items.map((item) => [item.id, "APPROVE"])));
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const registerAction = useCallback((id: string, action: BatchAction | null) => {
    if (action) actions.current.set(id, action);
    else actions.current.delete(id);
  }, []);

  async function submitAll() {
    const missingAction = items.find((item) => !actions.current.has(item.id));
    if (missingAction) {
      setFailure("Wait for all document previews to finish loading before submitting.");
      return;
    }

    for (const item of items) {
      const itemDecision = decisions[item.id] ?? "APPROVE";
      const validationError = actions.current.get(item.id)?.validate(itemDecision);
      if (validationError) {
        setFailure(`${item.documentNumber}: ${validationError}`);
        return;
      }
    }

    setSubmitting(true);
    setFailure(null);
    setMessage(null);
    let completed = 0;
    for (const item of items) {
      const action = actions.current.get(item.id);
      const itemDecision = decisions[item.id] ?? "APPROVE";
      if (!action || !(await action.submit(itemDecision))) {
        setMessage(`${completed} of ${items.length} documents submitted. The remaining documents are still available for individual review.`);
        setFailure(`Submission stopped at ${item.documentNumber}. Check its message and the pending list before retrying.`);
        setSubmitting(false);
        return;
      }
      completed += 1;
      window.dispatchEvent(new Event("sidebar-counts-refresh"));
      setMessage(`${completed} of ${items.length} documents submitted.`);
    }

    window.dispatchEvent(new Event("sidebar-counts-refresh"));
    router.push(returnUrl);
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl pt-2">
        {message ? <p role="status" className="mb-3 border border-slate-200 bg-white p-3 text-sm text-slate-700">{message}</p> : null}
        {failure ? <p role="alert" className="mb-3 border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{failure}</p> : null}
      </div>

      {items.length === 0 ? (
        <p className="mx-auto mt-20 max-w-6xl border border-slate-200 bg-white p-6 text-sm text-slate-600">There are no standalone documents awaiting your action.</p>
      ) : (
        <div className="mx-auto max-w-6xl space-y-8 pt-28">
          {items.map((item) => (
            <section key={item.id} onPointerDownCapture={() => setActiveDocumentId(item.id)} onFocusCapture={() => setActiveDocumentId(item.id)} className={`border-t-4 bg-white ${activeDocumentId === item.id ? "border-cyan-700" : "border-slate-300"}`}>
              <DocumentReviewEditor
                documentId={item.id}
                documentNumber={item.documentNumber}
                title={item.title}
                errStage={item.errStage}
                hasSignature={hasSignature}
                downloadUrl={item.downloadUrl}
                actionUrl={item.actionUrl}
                returnUrl={returnUrl}
                batchMode
                batchActive={activeDocumentId === item.id}
                batchSubmitting={submitting}
                batchDecision={decisions[item.id] ?? "APPROVE"}
                onBatchDecisionChange={(nextDecision) => setDecisions((current) => ({ ...current, [item.id]: nextDecision }))}
                onBatchSubmit={submitAll}
                onBatchAction={registerAction}
              />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}