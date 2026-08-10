import { redirect } from "next/navigation";
import LoginForm from "@/components/login-form";
import { getDefaultRouteForRole } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect(getDefaultRouteForRole(session.role));
  }

  return (
    <div
      className="flex min-h-screen bg-slate-100 text-slate-900"
      style={{ fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" }}
    >
      {/* Left branding panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-slate-200 bg-white p-10 lg:flex lg:w-[52%]">
        {/* Subtle top gradient accent */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-slate-900" />

        {/* Logo + company */}
        <div className="flex items-center gap-3">
          <img src="/ahmadiah-a.svg" alt="Ahmadiah" className="h-11 w-11 rounded-lg" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Ahmadiah</p>
            <p className="text-[11px] font-medium uppercase tracking-widest text-slate-400">Contracting &amp; Trading</p>
          </div>
        </div>

        {/* Main headline */}
        <div className="max-w-sm">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-slate-900">
            PMV Document<br />Workflow System
          </h1>
          <p className="mt-4 text-sm leading-7 text-slate-500">
            Manage procurement documents, approval stages, and compliance records — across all projects and departments.
          </p>

          {/* Stat boxes */}
          <div className="mt-8 flex gap-3">
            <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-2xl font-bold text-slate-900">3</p>
              <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Approval Stages</p>
            </div>
            <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-lg font-bold text-slate-900">MR &amp; CS</p>
              <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Document Types</p>
            </div>
            <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-2xl font-bold text-slate-900">5</p>
              <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">User Roles</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-xs text-slate-400">KCSC — شركة أحمدية للمقاولات والتجارة</p>
      </div>

      {/* Right login panel */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          {/* Mobile-only logo */}
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <img src="/ahmadiah-a.svg" alt="Ahmadiah" className="h-8 w-8 rounded" />
            <p className="text-sm font-semibold text-slate-900">Ahmadiah PMV</p>
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Sign in to continue to the PMV dashboard.</p>
          <div className="mt-6">
            <LoginForm />
          </div>
        </div>
      </div>
    </div>
  );
}
