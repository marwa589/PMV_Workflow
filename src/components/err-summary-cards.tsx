import PageSummaryCards from "@/components/page-summary-cards";

type Props = {
  counts: {
    all: number;
    pending: number;
    onHold: number;
    approved: number;
    rejected: number;
    revisionRequired: number;
  };
  personal: boolean;
};

export default function ErrSummaryCards({ counts, personal }: Props) {
  const cards = [
    {
      label: "Assigned/Handled",
      value: String(counts.all),
      tone: "bg-slate-900 text-white",
    },
    {
      label: "Pending",
      value: String(counts.pending),
      tone: "bg-amber-50 text-amber-900 ring-1 ring-amber-200",
    },
    {
      label: "Approved",
      value: String(counts.approved),
      tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200",
    },
    {
      label: "Rejected",
      value: String(counts.rejected),
      tone: "bg-rose-50 text-rose-900 ring-1 ring-rose-200",
    },
  ];

  return <PageSummaryCards cards={cards} />;
}