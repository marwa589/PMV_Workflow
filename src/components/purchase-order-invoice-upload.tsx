"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronsUpDown, Search, Sparkles, Trash2, UploadCloud, X } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";
import { findAutoTarget, mrMatchNames, purchaseOrderMatchNames, rankTargets, squash, type LinkTarget } from "@/lib/receiving-link-match";

type InvoicePurchaseOrder = {
  id: string;
  poNumber: string;
  originalName?: string | null;
  relatedMrLabels: string[];
};

type InvoiceCashMr = { id: string; documentNumber: string; title: string; mrNumber?: string | null };
type GrvInvoice = { id: string; label: string; matchNames?: string[] };

/** One selected file and the PO / Cash MR / invoice it will be attached to. `auto`: picked from the file name. */
type SelectedFile = { file: File; targetId: string; auto: boolean; error?: string | null };

/**
 * Links each file to a target from its name. With `unique` (GRVs: one per invoice) a target already
 * taken by another file is not used again; that file is left for the user to pick.
 */
function autoLink(items: SelectedFile[], targets: LinkTarget[], unique: boolean, keepExisting: boolean): SelectedFile[] {
  const used = new Set<string>(keepExisting && unique ? items.filter((item) => item.targetId).map((item) => item.targetId) : []);
  return items.map((item) => {
    if (keepExisting && item.targetId) return item;
    const available = unique ? targets.filter((target) => !used.has(target.id)) : targets;
    const match = findAutoTarget(item.file.name, available);
    if (match && unique) used.add(match.id);
    return match ? { ...item, targetId: match.id, auto: true, error: null } : { ...item, targetId: "", auto: false, error: null };
  });
}

export type ReceivingUploadKind = "INVOICE" | "GRV" | "CASH_RECEIVING_VOUCHER";

export const RECEIVING_UPLOAD_KIND_LABELS: Record<ReceivingUploadKind, string> = {
  INVOICE: "Invoice",
  GRV: "Goods Receiving Voucher (GRV)",
  CASH_RECEIVING_VOUCHER: "Cash Receiving Voucher",
};

const KIND_TOGGLE_LABELS: Record<ReceivingUploadKind, string> = {
  INVOICE: "Invoice",
  GRV: "GRV",
  CASH_RECEIVING_VOUCHER: "Cash Receiving Voucher",
};

const MAX_VISIBLE = 50;

/**
 * Searchable choice of the PO / Cash MR / invoice for ONE file.
 * Type to search ("lpo783050" finds "LPO-783050"); choices whose number appears in the file name are listed first.
 */
function TargetPicker({
  targets,
  value,
  auto,
  fileName,
  placeholder,
  disabled,
  onChange,
  takenIds,
}: {
  /** Targets already picked by other files (GRVs: each invoice once); hidden from this list. */
  takenIds?: Set<string>;
  targets: LinkTarget[];
  value: string;
  auto: boolean;
  fileName: string;
  placeholder: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = targets.find((target) => target.id === value) ?? null;

  const suggestedIds = useMemo(() => rankTargets(fileName, targets).map(({ target }) => target.id), [fileName, targets]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const squashed = squash(term);
    const pool = takenIds && takenIds.size > 0 ? targets.filter((target) => target.id === value || !takenIds.has(target.id)) : targets;
    const list = term
      ? pool.filter((target) => {
        const text = [target.label, ...target.matchNames].join(" ");
        return text.toLowerCase().includes(term) || (squashed.length > 0 && squash(text).includes(squashed));
      })
      : pool;
    const rank = new Map(suggestedIds.map((id, index) => [id, index]));
    return [...list].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  }, [targets, search, suggestedIds, takenIds, value]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const suggested = new Set(suggestedIds);
  const visible = rows.slice(0, MAX_VISIBLE);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen((current) => !current); setSearch(""); }}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-50 ${selected ? "border-slate-300 bg-white text-slate-900" : "border-amber-300 bg-amber-50 text-slate-500"}`}
      >
        <span className="min-w-0 truncate">{selected ? selected.label : placeholder}</span>
        <span className="flex shrink-0 items-center gap-1">
          {selected && auto ? <span className="inline-flex items-center gap-1 rounded bg-cyan-50 px-1.5 py-0.5 text-xs font-medium text-cyan-800" title="Linked automatically from the file name"><Sparkles className="h-3 w-3" />Auto</span> : null}
          <ChevronsUpDown className="h-4 w-4 text-slate-400" />
        </span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false);
                if (event.key === "Enter" && visible[0]) { event.preventDefault(); onChange(visible[0].id); setOpen(false); }
              }}
              placeholder="Search number, file name or MR"
              className="w-full text-sm outline-none"
            />
            {search ? <button type="button" onClick={() => setSearch("")} aria-label="Clear search"><X className="h-4 w-4 text-slate-400" /></button> : null}
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {visible.map((target, index) => (
              <li key={target.id}>
                {!search && index === 0 && suggested.has(target.id) ? <p className="px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-cyan-700">Matches the file name</p> : null}
                {!search && index > 0 && suggested.has(visible[index - 1].id) && !suggested.has(target.id) ? <p className="border-t border-slate-100 px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">All</p> : null}
                <button
                  type="button"
                  onClick={() => { onChange(target.id); setOpen(false); }}
                  className={`block w-full truncate px-3 py-2 text-left text-sm hover:bg-slate-50 ${target.id === value ? "bg-cyan-50 text-cyan-900" : "text-slate-700"}`}
                  title={target.label}
                >
                  {target.label}
                </button>
              </li>
            ))}
            {visible.length === 0 ? <li className="px-3 py-2 text-sm text-slate-500">No match.</li> : null}
            {rows.length > MAX_VISIBLE ? <li className="px-3 py-2 text-xs text-slate-500">Showing {MAX_VISIBLE} of {rows.length}; type to narrow the list.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Upload card for invoices (linked to a PO or an approved Cash MR), GRVs (one per invoice)
 * and Cash Receiving Vouchers (one per approved Cash MR).
 * Every file has its own searchable link, filled in automatically when the file name carries the number
 * (invoice "INV - 123456 LPO 783050" -> that PO; GRV "GRV 12345 LPO 783050" -> that PO's invoice;
 * voucher "CRV 123456 MR 21449700" -> that Cash MR). Several invoice files can share the same link.
 * Pass `kind` to lock the card to one type (the New Document page does); otherwise a toggle is shown.
 */
export default function PurchaseOrderInvoiceUpload({
  purchaseOrders,
  cashMrs = [],
  grvInvoices = [],
  voucherCashMrs = [],
  kind,
}: {
  purchaseOrders: InvoicePurchaseOrder[];
  cashMrs?: InvoiceCashMr[];
  grvInvoices?: GrvInvoice[];
  voucherCashMrs?: InvoiceCashMr[];
  kind?: ReceivingUploadKind;
}) {
  const [selectedKind, setSelectedKind] = useState<ReceivingUploadKind>(kind ?? "INVOICE");
  const activeKind = kind ?? selectedKind;
  const [targetType, setTargetType] = useState<"PO" | "CASH_MR">("PO");
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isInvoice = activeKind === "INVOICE";
  const isGrv = activeKind === "GRV";
  // Several GRVs can be uploaded at once, one file per invoice.
  const allowsMultipleFiles = isInvoice || isGrv;
  const uniqueTargets = isGrv;

  const targetOptions: LinkTarget[] = useMemo(() => {
    const mrLabel = (mr: InvoiceCashMr) => `${mr.documentNumber}${mr.mrNumber ? ` | ${mr.mrNumber}` : ""} | ${mr.title}`;
    if (activeKind === "GRV") {
      return grvInvoices.map((invoice) => ({ id: invoice.id, label: invoice.label, matchNames: invoice.matchNames ?? [] }));
    }
    if (activeKind === "CASH_RECEIVING_VOUCHER" || targetType === "CASH_MR") {
      return (activeKind === "CASH_RECEIVING_VOUCHER" ? voucherCashMrs : cashMrs)
        .map((mr) => ({ id: mr.id, label: mrLabel(mr), matchNames: mrMatchNames(mr) }));
    }
    return purchaseOrders.map((purchaseOrder) => ({
      id: purchaseOrder.id,
      label: `${purchaseOrder.poNumber}${purchaseOrder.originalName ? ` | ${purchaseOrder.originalName}` : ""} | ${purchaseOrder.relatedMrLabels.join(", ")}`,
      matchNames: purchaseOrderMatchNames(purchaseOrder),
    }));
  }, [activeKind, targetType, purchaseOrders, cashMrs, grvInvoices, voucherCashMrs]);

  const targetLabel = activeKind === "GRV"
    ? "Related invoice"
    : activeKind === "CASH_RECEIVING_VOUCHER" || targetType === "CASH_MR"
      ? "Related Cash MR"
      : "Related purchase order";
  const targetPlaceholder = activeKind === "GRV"
    ? "Select an invoice"
    : activeKind === "CASH_RECEIVING_VOUCHER" || targetType === "CASH_MR"
      ? "Select a Cash MR"
      : "Select a PO";
  const emptyMessage = activeKind === "GRV"
    ? "No Kuwait invoices without a GRV are available."
    : activeKind === "CASH_RECEIVING_VOUCHER"
      ? "No approved Kuwait Cash MRs without a Cash Receiving Voucher are available."
      : targetType === "PO"
        ? "No Kuwait purchase orders are available for invoice upload."
        : "No approved Kuwait Cash MRs are available for invoice upload.";
  const fileLabel = activeKind === "GRV" ? "GRV files" : activeKind === "CASH_RECEIVING_VOUCHER" ? "Voucher file" : "Invoice files";
  const title = activeKind === "GRV"
    ? "Upload Goods Receiving Vouchers"
    : activeKind === "CASH_RECEIVING_VOUCHER"
      ? "Upload Cash Receiving Voucher"
      : "Upload Invoices";
  const subtitle = activeKind === "GRV"
    ? "Select one or more GRV files and link each one to its invoice. Each invoice can have one GRV."
    : activeKind === "CASH_RECEIVING_VOUCHER"
      ? "Attach the voucher to an approved Cash MR. Each Cash MR can have one voucher."
      : "Attach invoice files to a purchase order or an approved Cash MR. Each file has its own link; several files can share one.";

  // Re-link automatically whenever the choices change (e.g. switching between Purchase Order and Cash MR).
  useEffect(() => {
    setFiles((current) => autoLink(current, targetOptions, uniqueTargets, false));
  }, [targetOptions, uniqueTargets]);

  function selectFiles(selected: File[]) {
    setError(null);
    setMessage(null);
    const added = selected.map((file) => ({ file, targetId: "", auto: false }));
    // GRVs: "Add more files" appends to the list (skipping a file picked twice); other types replace it.
    setFiles((current) => {
      if (!isGrv) return autoLink(added, targetOptions, uniqueTargets, false);
      const known = new Set(current.map((item) => `${item.file.name}|${item.file.size}|${item.file.lastModified}`));
      const fresh = added.filter((item) => !known.has(`${item.file.name}|${item.file.size}|${item.file.lastModified}`));
      return autoLink([...current, ...fresh], targetOptions, uniqueTargets, true);
    });
    // Reset the input so the same file can be chosen again after removing it.
    setFileInputKey((key) => key + 1);
  }

  const takenByOthers = (index: number) => new Set(
    uniqueTargets ? files.filter((item, itemIndex) => itemIndex !== index && item.targetId).map((item) => item.targetId) : [],
  );

  function resetSelection() {
    setFiles([]);
    setFileInputKey((current) => current + 1);
    setError(null);
    setMessage(null);
  }

  function endpointFor(targetId: string) {
    return activeKind === "GRV"
      ? `/api/invoices/${targetId}/grv`
      : activeKind === "CASH_RECEIVING_VOUCHER"
        ? `/api/documents/${targetId}/cash-receiving-voucher`
        : targetType === "PO"
          ? `/api/purchase-orders/${targetId}/invoices`
          : `/api/documents/${targetId}/invoices`;
  }

  async function submit() {
    if (files.length === 0) {
      setError(isInvoice ? "Select at least one invoice file." : `Select the ${fileLabel.toLowerCase()}.`);
      return;
    }
    const unlinked = files.filter((item) => !item.targetId);
    if (unlinked.length > 0) {
      setError(`${targetPlaceholder} for: ${unlinked.map((item) => item.file.name).join(", ")}.`);
      return;
    }

    if (isGrv) {
      await submitGrvs();
      return;
    }

    // Files sharing a link are uploaded together, one request per link.
    const groups = new Map<string, File[]>();
    for (const item of files) groups.set(item.targetId, [...(groups.get(item.targetId) ?? []), item.file]);

    setSubmitting(true);
    setError(null);
    setMessage(null);
    const uploadedNames: string[] = [];
    try {
      for (const [targetId, groupFiles] of groups) {
        const formData = new FormData();
        groupFiles.forEach((file) => formData.append("files", file));
        const response = await fetch(endpointFor(targetId), {
          method: "POST",
          headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
          body: formData,
        });
        const result = (await response.json()) as { message?: string };
        if (!response.ok) {
          const target = targetOptions.find((option) => option.id === targetId)?.label ?? "the selected link";
          throw new Error(`${result.message || "Unable to upload the file."} (${groupFiles.map((file) => file.name).join(", ")} → ${target})`);
        }
        uploadedNames.push(...groupFiles.map((file) => file.name));
      }

      setMessage(`Uploaded ${uploadedNames.length} file(s).`);
      setFiles([]);
      window.setTimeout(() => window.location.reload(), 800);
    } catch (uploadError) {
      const reason = uploadError instanceof Error ? uploadError.message : "Unable to upload the file.";
      // Keep only the files that were not uploaded, so they can be fixed and sent again.
      setFiles((current) => current.filter((item) => !uploadedNames.includes(item.file.name)));
      setError(uploadedNames.length > 0 ? `Uploaded ${uploadedNames.length} file(s); stopped at: ${reason}` : reason);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * GRVs: one request per file. A file that fails (e.g. its invoice got a GRV in the meantime) stays in the
   * list with its reason; the others are saved.
   */
  async function submitGrvs() {
    const counts = new Map<string, number>();
    files.forEach((item) => counts.set(item.targetId, (counts.get(item.targetId) ?? 0) + 1));
    const duplicates = files.filter((item) => (counts.get(item.targetId) ?? 0) > 1);
    if (duplicates.length > 0) {
      setError(`Each invoice can have only one GRV. Pick a different invoice for: ${duplicates.map((item) => item.file.name).join(", ")}.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);
    const remaining: SelectedFile[] = [];
    let uploaded = 0;
    for (const item of files) {
      try {
        const formData = new FormData();
        formData.append("files", item.file);
        const response = await fetch(endpointFor(item.targetId), {
          method: "POST",
          headers: { "x-csrf-token": getCsrfTokenFromBrowser() },
          body: formData,
        });
        const result = (await response.json().catch(() => ({}))) as { message?: string };
        if (!response.ok) throw new Error(result.message || "Unable to upload the GRV file.");
        uploaded += 1;
      } catch (uploadError) {
        remaining.push({ ...item, error: uploadError instanceof Error ? uploadError.message : "Unable to upload the GRV file." });
      }
    }
    setSubmitting(false);

    if (remaining.length === 0) {
      setFiles([]);
      setMessage(`Uploaded ${uploaded} GRV(s).`);
      window.setTimeout(() => window.location.reload(), 800);
      return;
    }
    setFiles(remaining);
    if (uploaded > 0) setMessage(`Uploaded ${uploaded} GRV(s).`);
    setError(`${remaining.length} GRV(s) were not uploaded. Fix them below and upload again, or reload the page to see the ones that were saved.`);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
      {kind ? null : (
        <div className="mt-4 inline-flex flex-wrap rounded-lg border border-slate-300 p-1" role="group" aria-label="Document type">
          {(Object.keys(KIND_TOGGLE_LABELS) as ReceivingUploadKind[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={selectedKind === option}
              onClick={() => { setSelectedKind(option); resetSelection(); }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${selectedKind === option ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              {KIND_TOGGLE_LABELS[option]}
            </button>
          ))}
        </div>
      )}
      {isInvoice ? (
        <div className="mt-4 block">
          <div className="inline-flex rounded-lg border border-slate-300 p-1" role="group" aria-label="Invoice target type">
            <button type="button" aria-pressed={targetType === "PO"} onClick={() => setTargetType("PO")} className={`rounded-md px-3 py-1.5 text-sm font-medium ${targetType === "PO" ? "bg-cyan-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}>Purchase Order</button>
            <button type="button" aria-pressed={targetType === "CASH_MR"} onClick={() => setTargetType("CASH_MR")} className={`rounded-md px-3 py-1.5 text-sm font-medium ${targetType === "CASH_MR" ? "bg-cyan-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}>Cash MR</button>
          </div>
        </div>
      ) : null}
      <label className="mt-4 block text-sm font-medium text-slate-700">
        {isGrv && files.length > 0 ? "Add more files" : fileLabel}
        <input
          key={fileInputKey}
          type="file"
          multiple={allowsMultipleFiles}
          accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png"
          onChange={(event) => selectFiles(Array.from(event.target.files ?? []))}
          className="mt-1 block w-full rounded-lg border border-slate-300 bg-white text-sm file:mr-3 file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:font-medium file:text-white"
        />
      </label>
      {files.length > 0 ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{targetLabel} per file</p>
          {files.map((item, index) => (
            <div key={`${item.file.name}-${index}`} className={`grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-3 rounded-lg border p-3 ${item.error ? "border-rose-300 bg-rose-50/50" : "border-slate-200"}`}>
              <span className="min-w-0 text-sm text-slate-700">
                <span className="block truncate" title={item.file.name}>{item.file.name}</span>
                {item.error ? <span className="mt-0.5 block text-xs text-rose-700">{item.error}</span> : null}
              </span>
              <TargetPicker
                targets={targetOptions}
                value={item.targetId}
                auto={item.auto}
                fileName={item.file.name}
                placeholder={targetPlaceholder}
                disabled={submitting}
                takenIds={takenByOthers(index)}
                onChange={(targetId) => setFiles((current) => current.map((value, valueIndex) => valueIndex === index ? { ...value, targetId, auto: false, error: null } : value))}
              />
              <button type="button" onClick={() => setFiles((current) => current.filter((_, valueIndex) => valueIndex !== index))} disabled={submitting} className="inline-flex items-center justify-center rounded-lg p-2 text-rose-700 hover:bg-rose-50 disabled:opacity-50" aria-label={`Remove ${item.file.name}`} title="Remove file"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />{message}</p> : null}
      <button type="button" onClick={() => void submit()} disabled={submitting || targetOptions.length === 0 || files.length === 0} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        <UploadCloud className="h-4 w-4" />
        {submitting ? "Uploading..." : isInvoice ? "Upload invoices" : activeKind === "GRV" ? (files.length > 1 ? `Upload ${files.length} GRVs` : "Upload GRV") : "Upload voucher"}
      </button>
      {targetOptions.length === 0 ? <p className="mt-3 text-sm text-slate-500">{emptyMessage}</p> : null}
    </section>
  );
}
