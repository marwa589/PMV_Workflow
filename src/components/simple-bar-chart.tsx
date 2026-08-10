type ChartItem = {
  label: string;
  value: number;
  tone: string;
  subLabel?: string;
};

type Props = {
  title: string;
  subtitle?: string;
  items: ChartItem[];
};

export default function SimpleBarChart({ title, subtitle, items }: Props) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="p-5">
        <div className="flex h-48 items-end gap-3">
          {items.map((item) => {
            const height = Math.max(12, (item.value / maxValue) * 100);
            return (
              <div key={item.label} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex h-36 w-full items-end rounded-2xl bg-slate-100 p-1">
                  <div
                    className={`w-full rounded-xl ${item.tone}`}
                    style={{ height: `${height}%` }}
                  />
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-slate-700">{item.label}</p>
                  <p className="text-sm font-semibold text-slate-900">{item.value}</p>
                  {item.subLabel ? <p className="text-[11px] text-slate-500">{item.subLabel}</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
