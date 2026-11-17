"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import UserPicker, { type PickableUser } from "@/components/admin/user-picker";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

/**
 * Admin only, on a document nobody can act on at its current level (for example it goes to the Project Director and
 * the project has none yet). Either set the project's director / manager (then every waiting document of the project
 * goes to them), or send this level to someone for this document only.
 */
export default function AssignLevelApprover({
  documentId,
  levelName,
  waitingFor,
  projectLabel,
  users,
}: {
  documentId: string;
  levelName: string;
  waitingFor: "PROJECT_DIRECTOR" | "PROJECT_MANAGER" | null;
  projectLabel: string | null;
  users: PickableUser[];
}) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const role = waitingFor === "PROJECT_DIRECTOR" ? "Project Director" : waitingFor === "PROJECT_MANAGER" ? "Project Manager" : null;

  async function send() {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/assign-level-approver`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": getCsrfTokenFromBrowser() },
        body: JSON.stringify({ userId }),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(result.message ?? "Could not send this level.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not send this level.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-amber-950">
            {role ? `No ${role} assigned` : "Nobody can approve this level"}
          </h3>
          <p className="mt-1 text-sm text-amber-900">
            {role
              ? `${levelName} goes to the ${role}, but ${projectLabel ?? "this project"} has none. Set one on the project (every document waiting for it then goes to them), or send this level to someone for this document only.`
              : `Nobody is on ${levelName} for this document. Send it to someone, or approve it yourself as an Admin user.`}
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            {role ? (
              <Link href="/admin/projects" className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100">
                Set the {role} in Projects &amp; Locations
              </Link>
            ) : null}
            <div className="w-72">
              <UserPicker value={userId} users={users} onChange={setUserId} placeholder="Choose a person" emptyLabel="Nobody" ariaLabel="Send this level to" />
            </div>
            <button
              type="button"
              disabled={!userId || busy}
              onClick={send}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {busy ? "Sending..." : "Send this level to them"}
            </button>
          </div>
          {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
