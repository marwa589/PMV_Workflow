"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DocumentReviewEditor, { type BatchAction, type BatchDecision } from "@/components/document-review-editor";

type ReviewItem = {
  id: string;
  documentNumber: string;
  title: string;
  downloadUrl: string;
  actionUrl: string;
  allowNoSignature: boolean;
};

/**
 * Several documents stacked on one screen. Each one is signed or marked up on its own, then "Submit all"
 * sends them one after another using the same action as the one-by-one review screen.
 */
export default function BatchDocumentReview({ items, hasSignature, returnUrl }: { items: ReviewItem[]; hasSignature: boolean; returnUrl: string }) {
  const router = useRouter();
  const actions = useRef(new Map<string, BatchAction>());
  const submitted = useRef(new Set<string>());
  const [activeId, setActiveId] = useState(items[0]?.id ?? null);
  const [decisions, setDecisions] = useState<Record<string, BatchDecision>>(() => Object.fromEntries(items.map((item) => [item.id, "APPROVE" as BatchDecision])));
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const registerAction = useCallback((id: string, action: BatchAction | null) => {
    if (action) actions.current.set(id, action);
    else actions.current.delete(id);
  }, []);

  async function submitAll() {
    const waiting = items.filter((item) => !submitted.current.has(item.id));

    if (waiting.some((item) => !actions.current.has(item.id))) {
      setFailure("Wait for all document previews to finish loading before submitting.");
      return;
    }
    // Check every document first, so nothing is sent while one of them is still missing its signature.
    for (const item of waiting) {
      const problem = actions.current.get(item.id)?.validate(decisions[item.id] ?? "APPROVE");
      if (problem) {
        setActiveId(item.id);
        setFailure(`${item.documentNumber}: ${problem}`);
        return;
      }
    }

    setSubmitting(true);
    setFailure(null);
    for (const item of waiting) {
      const ok = await actions.current.get(item.id)?.submit(decisions[item.id] ?? "APPROVE");
      if (!ok) {
        setActiveId(item.id);
        setMessage(`${submitted.current.size} of ${items.length} documents submitted. Fix the problem on ${item.documentNumber} and press Submit all again; documents already sent are skipped.`);
        setFailure(`Stopped at ${item.documentNumber}. See the message on that document.`);
        setSubmitting(false);
        return;
      }
      submitted.current.add(item.id);
      setMessage(`${submitted.current.size} of ${items.length} documents submitted.`);
    }

    router.push(returnUrl);
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl pt-2">
        <p className="mb-3 border border-slate-200 bg-white p-3 text-sm text-slate-700">
          Reviewing {items.length} document{items.length === 1 ? "" : "s"} together. Place your signature on each one (or choose Reject), then press Submit all.
        </p>
        {message ? <p role="status" className="mb-3 border border-slate-200 bg-white p-3 text-sm text-slate-700">{message}</p> : null}
        {failure ? <p role="alert" className="mb-3 border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{failure}</p> : null}
      </div>

      <div className="mx-auto max-w-6xl space-y-8 pt-28">
        {items.map((item) => (
          <section
            key={item.id}
            onPointerDownCapture={() => setActiveId(item.id)}
            onFocusCapture={() => setActiveId(item.id)}
            className={`border-t-4 bg-white ${activeId === item.id ? "border-cyan-600" : "border-slate-200"}`}
          >
            <DocumentReviewEditor
              documentId={item.id}
              documentNumber={item.documentNumber}
              title={item.title}
              hasSignature={hasSignature}
              allowNoSignature={item.allowNoSignature}
              downloadUrl={item.downloadUrl}
              actionUrl={item.actionUrl}
              returnUrl={returnUrl}
              batchMode
              batchActive={activeId === item.id}
              batchSubmitting={submitting}
              batchDecision={decisions[item.id] ?? "APPROVE"}
              onBatchDecisionChange={(next) => setDecisions((current) => ({ ...current, [item.id]: next }))}
              onBatchSubmit={submitAll}
              onBatchAction={registerAction}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
