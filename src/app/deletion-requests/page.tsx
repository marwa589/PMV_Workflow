// src/app/deletion-requests/page.tsx
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import DeletionRequestsList from "@/components/deletion-requests-list";
import { requireAuth } from "@/lib/auth/guards";
import { getReviewableDeletionRequests, userCanReviewDeletions } from "@/lib/deletion-review";

export const dynamic = "force-dynamic";

/**
 * Deletion requests waiting for a decision, for Admin users and for people whose role has "Review deletion".
 * Each person only sees the requests for documents inside the scope of that role.
 */
export default async function DeletionRequestsPage() {
  const session = await requireAuth();
  const user = { userId: session.userId, userType: session.userType };
  if (!(await userCanReviewDeletions(user))) redirect("/unauthorized");

  const requests = await getReviewableDeletionRequests(user);

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Deletion Requests" subtitle={`${requests.length} waiting for review`}>
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Waiting for review</h3>
          <p className="mt-1 text-sm text-slate-500">Approving a request permanently deletes the document and its files. Rejecting keeps it.</p>
        </div>
        {requests.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-500">No deletion requests are waiting for you.</div>
        ) : (
          <DeletionRequestsList requests={requests} />
        )}
      </section>
    </DashboardShell>
  );
}
