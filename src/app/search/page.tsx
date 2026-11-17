// src/app/search/page.tsx
import Link from "next/link";
import DashboardShell from "@/components/dashboard-shell";
import SearchResultsTable from "@/components/search-results-table";
import { getDownloadedAtMap } from "@/lib/download-tracking";
import { requireAuth } from "@/lib/auth/guards";
import { SEARCH_MIN_LENGTH, searchDocuments } from "@/lib/global-search";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const MAX_RESULTS = 100;

/** Results of the top-bar search: every document the person may open, whichever page they searched from. */
export default async function SearchPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAuth();
  const params = (await searchParams) ?? {};
  const raw = params.q;
  const query = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 100) ?? "";
  const { hits, total } = await searchDocuments(session, query, MAX_RESULTS);
  const downloadedByMe = await getDownloadedAtMap(session.userId, hits.map((hit) => hit.id));

  return (
    <DashboardShell
      role={session.userType}
      userName={session.name}
      title="Search"
      subtitle={query ? `${total} document${total === 1 ? "" : "s"} found for "${query}"` : "Search all documents you have access to"}
    >
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <form method="get" action="/search" className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="search-q" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Search all documents</label>
            <input
              id="search-q"
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Number, title, type, project or field value"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400"
            />
          </div>
          <button type="submit" className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700">
            Search
          </button>
        </form>

        {query.length < SEARCH_MIN_LENGTH ? (
          <div className="px-5 py-6 text-sm text-slate-500">Type at least {SEARCH_MIN_LENGTH} characters to search.</div>
        ) : hits.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-500">No documents you can access match &quot;{query}&quot;.</div>
        ) : (
          <>
            <SearchResultsTable
              rows={hits.map((hit) => ({
                id: hit.id,
                documentNumber: hit.documentNumber,
                title: hit.title,
                typeLabel: `${hit.typeName}${hit.subtypeName ? ` - ${hit.subtypeName}` : ""}`,
                projectLabel: hit.projectLabel,
                status: hit.status,
                statusLabel: hit.statusLabel,
                downloaded: downloadedByMe.has(hit.id),
                createdLabel: dateFormat.format(new Date(hit.createdAt)),
              }))}
            />
            {total > hits.length ? <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">Showing the {hits.length} most recent of {total}. Narrow the search to see the rest.</p> : null}
          </>
        )}
      </section>
    </DashboardShell>
  );
}
