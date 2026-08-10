type SummaryCard = {
  label: string;
  value: string;
  tone: string;
};

type Props = {
  cards: SummaryCard[];
};

export default function PageSummaryCards({ cards }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-4">
      {cards.map((card) => (
        <article key={card.label} className={`rounded-2xl p-5 shadow-sm ${card.tone}`}>
          <p className="text-sm font-medium">{card.label}</p>
          <p className="mt-3 text-3xl font-semibold">{card.value}</p>
        </article>
      ))}
    </div>
  );
}
