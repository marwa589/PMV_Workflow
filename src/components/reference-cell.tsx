export type ReferenceSummaryItem = { typeName: string; count: number };

/**
 * The "Reference documents" cell of a table: one line per reference type with how many were uploaded, for example
 * "Quotation (2)". Only documents the viewer may see references for ever get items, so the cell is a plain dash otherwise.
 */
export default function ReferenceCell({ items }: { items: ReferenceSummaryItem[] }) {
  if (items.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.typeName} className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
          {item.typeName} <span className="rounded-full bg-amber-200 px-1.5 text-[11px]">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}
