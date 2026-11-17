import type { EligiblePerson } from "@/lib/workflow/eligible-people-types";

type Props = {
  people: EligiblePerson[];
  // Short title of the dropdown, e.g. "Who can upload".
  label: string;
  emptyText?: string;
  defaultOpen?: boolean;
};

/**
 * Admin-only list of the people who can do a task. Collapsed by default so long tables stay readable.
 * Admin users can always act, so they are not listed.
 */
export default function WhoCanAct({ people, label, emptyText = "Nobody except admins", defaultOpen = false }: Props) {
  if (people.length === 0) {
    return <p className="text-xs font-medium text-amber-700">{label}: {emptyText}</p>;
  }

  return (
    <details open={defaultOpen} className="text-xs">
      <summary className="cursor-pointer select-none font-medium text-cyan-700 hover:underline">
        {label} ({people.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {people.map((person) => (
          <li key={person.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-200">
            <p className="font-medium text-slate-900">
              {person.name} <span className="font-normal text-slate-500">· {person.userTypeName}</span>
            </p>
            <p className="text-slate-500">{person.email}</p>
            {person.reasons.map((reason) => (
              <p key={reason} className="text-slate-600">{reason}</p>
            ))}
          </li>
        ))}
      </ul>
    </details>
  );
}
