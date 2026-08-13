import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getDefaultRouteForRole } from "@/lib/auth/roles";

export default async function UnauthorizedPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-8 shadow-sm">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-600">Access denied</p>
        <h1 className="text-2xl font-bold text-slate-900">You are not authorized to view this page.</h1>
        <p className="mt-3 text-sm text-slate-600">
          Your current role does not have permission for this section.
        </p>
        <a
          href={getDefaultRouteForRole(session.role)}
          className="mt-6 inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          Return to dashboard
        </a>
      </div>
    </main>
  );
}
