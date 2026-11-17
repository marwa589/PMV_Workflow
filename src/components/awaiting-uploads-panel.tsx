"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

export type AwaitingUploadItem = {
  key: string;
  // What is waiting to be uploaded (the step / document name) and its type, e.g. "Purchase Order" / "PO".
  name: string;
  typeLabel: string;
  // The document it will be linked to, and the project.
  linkedLabel: string | null;
  projectLabel: string | null;
  href: string;
};

/**
 * "Waiting for you to upload", collapsed by default: only the number of awaiting documents and how many of each type.
 * Opening it shows every awaiting document with its details and an Upload button.
 */
export default function AwaitingUploadsPanel({ items }: { items: AwaitingUploadItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  const perType = new Map<string, number>();
  for (const item of items) perType.set(item.typeLabel, (perType.get(item.typeLabel) ?? 0) + 1);

  return (
    <section className="rounded-2xl border border-cyan-200 bg-cyan-50 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-cyan-950">
            {items.length} document{items.length === 1 ? "" : "s"} waiting for you to upload
          </span>
          {[...perType.entries()].map(([type, count]) => (
            <span key={type} className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-cyan-900 ring-1 ring-cyan-200">
              {type} · {count}
            </span>
          ))}
        </span>
        <ChevronDown className={`h-4 w-4 text-cyan-900 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <ul className="divide-y divide-cyan-100 border-t border-cyan-100 px-5">
          {items.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm text-cyan-950">
              <span>
                <span className="font-medium">{item.name}</span>
                <span className="text-cyan-900/80"> · {item.typeLabel}</span>
                {item.linkedLabel ? <span className="block text-xs text-cyan-900/80">Linked to {item.linkedLabel}</span> : null}
                {item.projectLabel ? <span className="block text-xs text-cyan-900/80">{item.projectLabel}</span> : null}
              </span>
              <Link href={item.href} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">
                Upload
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
