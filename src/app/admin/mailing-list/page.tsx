// src/app/admin/mailing-list/page.tsx
import Link from "next/link";
import DashboardShell from "@/components/dashboard-shell";
import { requirePermission } from "@/lib/auth/guards";
import { MAIL_EVENTS, MAIL_EVENT_KEYS, MAIL_PERMISSION_CODES } from "@/lib/mailing-list-config";
import { prisma } from "@/lib/prisma";
import { getMailingListRecipients } from "@/lib/workflow/mailing-list";

export const dynamic = "force-dynamic";

const named = (items: Array<string | null | undefined>) => items.filter((item): item is string => Boolean(item));

export default async function MailingListPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission("assignments.manage");
  const params = (await searchParams) ?? {};
  const pick = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const typeId = pick("type");
  const subtypeId = pick("subtype");
  const projectId = pick("project");

  const [assignments, documentTypes, projects] = await Promise.all([
    prisma.userAssignment.findMany({
      where: { role: { permissions: { some: { permission: { code: { in: MAIL_PERMISSION_CODES } } } } } },
      orderBy: [{ user: { name: "asc" } }, { createdAt: "asc" }],
      select: {
        id: true,
        user: { select: { id: true, name: true, email: true, isActive: true } },
        role: { select: { name: true, permissions: { select: { permission: { select: { code: true } } } } } },
        company: { select: { name: true } },
        project: { select: { code: true } },
        projectScopes: { select: { project: { select: { code: true } } } },
        location: { select: { name: true } },
        documentType: { select: { name: true } },
        documentSubtype: { select: { name: true } },
        documentTypeScopes: { select: { allSubtypes: true, documentType: { select: { name: true } }, subtypes: { select: { documentSubtype: { select: { name: true } } } } } },
        processDefinition: { select: { name: true } },
        processScopes: { select: { processDefinition: { select: { name: true } } } },
      },
    }),
    prisma.documentType.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, subtypes: { where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } } } }),
    prisma.project.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, locationId: true } }),
  ]);

  const describeScope = (a: (typeof assignments)[number]) => {
    const parts = [
      a.company ? `Company: ${a.company.name} (never matches documents)` : null,
      named([a.project?.code, ...a.projectScopes.map((s) => s.project.code)]).length ? `Projects: ${[...new Set(named([a.project?.code, ...a.projectScopes.map((s) => s.project.code)]))].join(", ")}` : null,
      a.location ? `Location: ${a.location.name}` : null,
      a.documentType ? `Type: ${a.documentType.name}${a.documentSubtype ? ` / ${a.documentSubtype.name}` : ""}` : null,
      ...a.documentTypeScopes.map((s) => `Type: ${s.documentType.name}${s.allSubtypes ? " (all sub types)" : ` / ${s.subtypes.map((x) => x.documentSubtype.name).join(", ")}`}`),
      named([a.processDefinition?.name, ...a.processScopes.map((s) => s.processDefinition.name)]).length ? `Process: ${[...new Set(named([a.processDefinition?.name, ...a.processScopes.map((s) => s.processDefinition.name)]))].join(", ")}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Every document";
  };

  const previewing = Boolean(typeId);
  const selectedProject = projects.find((project) => project.id === projectId);
  const preview = previewing
    ? await Promise.all(
        MAIL_EVENT_KEYS.map(async (event) => ({
          event,
          members: await getMailingListRecipients(prisma, event, {
            projectId: selectedProject?.id ?? null,
            locationId: selectedProject?.locationId ?? null,
            documentTypeId: typeId,
            documentSubtypeId: subtypeId || null,
          }),
        })),
      )
    : [];
  const subtypes = documentTypes.find((type) => type.id === typeId)?.subtypes ?? [];

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Mailing List" subtitle="Who is emailed when a document is approved, rejected or sent back for revision">
      <div className="space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">How it works</h2>
          <p className="mt-1 text-sm text-slate-600">
            Being on the list means holding a <strong>Receive mail</strong> permission through a role assignment. Scope the assignment (project, location, document type, sub type) to limit which documents the person hears about.
            Give the role <code>documents.view</code> too, so the link in the email opens. The creator and approvers keep getting their normal emails; the list is in addition. Admin users are only on the list when explicitly assigned.
          </p>
          <p className="mt-2 text-sm"><Link href="/admin/roles" className="font-medium text-cyan-700 underline">Add or change members in Roles &amp; Access</Link></p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Who would be emailed for a document?</h2>
          <form method="get" className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-700">Document type
              <select name="type" defaultValue={typeId} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Choose…</option>{documentTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select>
            </label>
            <label className="text-sm text-slate-700">Sub type
              <select name="subtype" defaultValue={subtypeId} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Any</option>{subtypes.map((subtype) => <option key={subtype.id} value={subtype.id}>{subtype.name}</option>)}</select>
            </label>
            <label className="text-sm text-slate-700">Project
              <select name="project" defaultValue={projectId} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">None</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code} - {project.name}</option>)}</select>
            </label>
            <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Preview</button>
          </form>
          <p className="mt-2 text-xs text-slate-500">Pick the type first and press Preview to load its sub types.</p>
          {previewing ? (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {preview.map(({ event, members }) => (
                <div key={event} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-sm font-semibold text-slate-900">{MAIL_EVENTS[event].label}</p>
                  <p className="text-xs text-slate-500">{MAIL_EVENTS[event].description}</p>
                  {members.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nobody on the list.</p> : (
                    <ul className="mt-2 space-y-1 text-sm text-slate-700">{members.map((member) => <li key={member.id}>{member.name} <span className="text-xs text-slate-500">{member.email}</span></li>)}</ul>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-3"><h2 className="text-base font-semibold text-slate-900">Members ({assignments.length})</h2></div>
          {assignments.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">Nobody is on the mailing list yet. Assign a role that holds a Receive mail permission (for example “Mailing List (all events)”).</p> : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Person</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Emailed when</th><th className="px-5 py-3">Documents covered</th><th className="px-5 py-3" /></tr></thead>
                <tbody>
                  {assignments.map((assignment) => {
                    const codes = new Set(assignment.role.permissions.map((entry) => entry.permission.code));
                    return (
                      <tr key={assignment.id} className="border-t border-slate-100 align-top">
                        <td className="px-5 py-3"><p className="font-medium text-slate-900">{assignment.user.name}</p><p className="text-xs text-slate-500">{assignment.user.email}{assignment.user.isActive ? "" : " · inactive, not emailed"}</p></td>
                        <td className="px-5 py-3 text-slate-700">{assignment.role.name}</td>
                        <td className="px-5 py-3 text-slate-700">{MAIL_EVENT_KEYS.filter((event) => codes.has(MAIL_EVENTS[event].permission)).map((event) => MAIL_EVENTS[event].label).join(", ")}</td>
                        <td className="px-5 py-3 text-slate-700">{describeScope(assignment)}</td>
                        <td className="px-5 py-3"><Link href={`/admin/roles?userId=${assignment.user.id}`} className="text-cyan-700 underline">Edit</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
