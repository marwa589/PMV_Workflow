import Link from "next/link";
import { UserRole } from "@prisma/client";
import { KeyRound, PenLine } from "lucide-react";
import DashboardShell from "@/components/dashboard-shell";
import { requireRole } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const session = await requireRole([UserRole.ADMIN]);

  return (
    <DashboardShell role={session.role} userName={session.name} title="Account Settings" subtitle="Manage your account and profile preferences">
      <div className="grid gap-6 lg:grid-cols-2">
        <Link
          href="/approver/settings/change-password"
          className="group block rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Security</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-900">Change Password</h2>
              <p className="mt-2 text-sm text-slate-600">Update your login password and revoke active sessions on all devices.</p>
            </div>
            <KeyRound className="h-6 w-6 text-slate-700 transition group-hover:text-slate-900" />
          </div>
        </Link>

        <Link
          href="/approver/settings/signature"
          className="group block rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Profile</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-900">Signature</h2>
              <p className="mt-2 text-sm text-slate-600">Upload or replace the signature saved for your account.</p>
            </div>
            <PenLine className="h-6 w-6 text-slate-700 transition group-hover:text-slate-900" />
          </div>
        </Link>
      </div>
    </DashboardShell>
  );
}
