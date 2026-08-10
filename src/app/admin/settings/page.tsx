import { UserRole } from "@prisma/client";
import DashboardShell from "@/components/dashboard-shell";
import { requireRole } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const session = await requireRole([UserRole.ADMIN]);

  return (
    <DashboardShell role={session.role} userName={session.name} title="Settings" subtitle="System configuration and workflow controls">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">Settings</h3>
        <p className="mt-2 text-sm text-slate-600">
          Settings page scaffold is ready. This area can later hold notification rules, workflow config, and archive policies.
        </p>
      </section>
    </DashboardShell>
  );
}
