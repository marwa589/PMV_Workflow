"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callApi, callApiWithDeactivationConfirmation } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";
import UserPicker, { type PickableUser } from "@/components/admin/user-picker";

type Location = { id: string; name: string; _count: { projects: number; companies: number } };
type Company = { id: string; name: string; locationId: string | null; isActive: boolean; location: { id: string; name: string } | null; _count?: { projects: number } };
type Project = {
  id: string;
  code: string;
  name: string;
  locationId: string | null;
  directorId: string | null;
  managerId: string | null;
  companyId: string | null;
  isActive: boolean;
  location: { id: string; name: string } | null;
  company: { id: string; name: string; isActive: boolean } | null;
  director: { id: string; name: string; email: string; isActive: boolean } | null;
  manager: { id: string; name: string; email: string; isActive: boolean } | null;
  _count: { documents: number };
};

const blankProject = { code: "", name: "", locationId: "", companyId: "", directorId: "", managerId: "" };

/** Locations (countries), companies and projects. A project's short code appears in its document numbers. */
export default function ProjectsManager() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<PickableUser[]>([]);
  const [projectQuery, setProjectQuery] = useState("");
  const projectFormRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [locationName, setLocationName] = useState("");
  const [locationEditId, setLocationEditId] = useState<string | null>(null);
  const [company, setCompany] = useState({ name: "", locationId: "" });
  const [companyEditId, setCompanyEditId] = useState<string | null>(null);
  const [project, setProject] = useState(blankProject);
  const [projectEditId, setProjectEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [l, c, p] = await Promise.all([
      callApi<{ locations: Location[] }>("/api/admin/locations"),
      callApi<{ companies: Company[] }>("/api/admin/companies"),
      callApi<{ projects: Project[]; users: PickableUser[] }>("/api/admin/projects"),
    ]);
    if (l.ok) setLocations(l.data.locations);
    if (c.ok) setCompanies(c.data.companies);
    if (p.ok) {
      setProjects(p.data.projects);
      setUsers(p.data.users ?? []);
    }
    const failed = [l, c, p].find((r) => !r.ok);
    if (failed && !failed.ok) setError(failed.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: Promise<{ ok: boolean; message?: string; data?: unknown }>, done: string, after?: () => void) {
    setError(null);
    setNotice(null);
    const result = await action;
    if ("cancelled" in result && result.cancelled) return;
    if (!result.ok) return setError(result.message ?? "Something went wrong.");
    const moved = (result.data as { movedLevels?: number } | undefined)?.movedLevels ?? 0;
    setNotice(moved > 0 ? `${done} ${moved} waiting approval level(s) moved to the new project director / manager.` : done);
    after?.();
    await load();
  }

  const visibleProjects = useMemo(() => {
    const terms = projectQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return projects;
    return projects.filter((item) => {
      const text = [item.code, item.name, item.location?.name, item.company?.name, item.director?.name, item.director?.email, item.manager?.name, item.manager?.email].filter(Boolean).join(" ").toLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [projects, projectQuery]);
  const projectsWithoutDirector = projects.filter((item) => item.isActive && !item.director?.isActive).length;
  const projectsWithoutManager = projects.filter((item) => item.isActive && !item.manager?.isActive).length;

  const locationOptions = (
    <>
      <option value="">No location</option>
      {locations.map((item) => (
        <option key={item.id} value={item.id}>{item.name}</option>
      ))}
    </>
  );

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <Card title="Locations" subtitle="Generally countries. Projects and companies are attached to a location.">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-60 flex-1">
            <Field label={locationEditId ? "Rename location" : "New location"}>
              <input value={locationName} onChange={(e) => setLocationName(e.target.value)} className={inputClass} placeholder="e.g. Kuwait" />
            </Field>
          </div>
          <button
            type="button"
            className={primaryButton}
            onClick={() =>
              run(
                locationEditId ? callApi("/api/admin/locations", "PATCH", { id: locationEditId, name: locationName }) : callApi("/api/admin/locations", "POST", { name: locationName }),
                locationEditId ? "Location updated." : "Location added.",
                () => { setLocationName(""); setLocationEditId(null); },
              )
            }
          >
            {locationEditId ? "Save" : "Add location"}
          </button>
          {locationEditId ? <button type="button" className={secondaryButton} onClick={() => { setLocationEditId(null); setLocationName(""); }}>Cancel</button> : null}
        </div>
        <div className="mt-4 space-y-2">
          {locations.length === 0 ? <Empty>No locations yet.</Empty> : null}
          {locations.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm">
              <div>
                <span className="font-medium text-slate-900">{item.name}</span>
                <span className="ml-3 text-xs text-slate-500">{item._count.projects} project(s), {item._count.companies} company(ies)</span>
              </div>
              <div className="flex gap-2">
                <button type="button" className={secondaryButton} onClick={() => { setLocationEditId(item.id); setLocationName(item.name); }}>Rename</button>
                <button type="button" className={dangerButton} onClick={() => window.confirm(`Delete ${item.name}?`) && run(callApi("/api/admin/locations", "DELETE", { id: item.id }), "Location deleted.")}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Projects" subtitle="The short code is used in document numbers, so choose it carefully. The project director and manager receive flow levels set to &quot;Project Director&quot; / &quot;Project Manager&quot;.">
        <div ref={projectFormRef} className="grid scroll-mt-6 grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-4">
          <Field label="Code"><input value={project.code} onChange={(e) => setProject({ ...project, code: e.target.value })} className={inputClass} placeholder="P1" /></Field>
          <Field label="Name"><input value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} className={inputClass} /></Field>
          <Field label="Location"><select value={project.locationId} onChange={(e) => setProject({ ...project, locationId: e.target.value })} className={inputClass}>{locationOptions}</select></Field>
          <Field label="Company (optional)">
            <select value={project.companyId} onChange={(e) => setProject({ ...project, companyId: e.target.value })} className={inputClass}>
              <option value="">No company</option>
              {companies.filter((item) => item.isActive || item.id === project.companyId).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </Field>
          <div className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Project director</span>
            <UserPicker
              value={project.directorId}
              users={users}
              onChange={(directorId) => setProject({ ...project, directorId })}
              placeholder="No director"
              emptyLabel="No director"
              ariaLabel="Project director"
            />
          </div>
          <div className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Project manager</span>
            <UserPicker
              value={project.managerId}
              users={users}
              onChange={(managerId) => setProject({ ...project, managerId })}
              placeholder="No manager"
              emptyLabel="No manager"
              ariaLabel="Project manager"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              className={primaryButton}
              onClick={() =>
                run(
                  projectEditId ? callApi("/api/admin/projects", "PATCH", { id: projectEditId, ...project }) : callApi("/api/admin/projects", "POST", project),
                  projectEditId ? "Project updated." : "Project added.",
                  () => { setProject(blankProject); setProjectEditId(null); },
                )
              }
            >
              {projectEditId ? "Save" : "Add project"}
            </button>
            {projectEditId ? <button type="button" className={secondaryButton} onClick={() => { setProjectEditId(null); setProject(blankProject); }}>Cancel</button> : null}
          </div>
        </div>
        {projects.length > 0 ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <input
              type="search"
              value={projectQuery}
              onChange={(e) => setProjectQuery(e.target.value)}
              placeholder="Search by code, name, location, company, director or manager"
              aria-label="Search projects"
              className={`${inputClass} max-w-sm`}
            />
            <span className="text-xs text-slate-500">
              {visibleProjects.length === projects.length ? `${projects.length} project(s)` : `${visibleProjects.length} of ${projects.length} project(s)`}
              {projectsWithoutDirector > 0 ? ` · ${projectsWithoutDirector} without a director` : ""}
              {projectsWithoutManager > 0 ? ` · ${projectsWithoutManager} without a manager` : ""}
            </span>
          </div>
        ) : null}
        <div className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
          {projects.length === 0 ? <Empty>No projects yet.</Empty> : null}
          {projects.length > 0 && visibleProjects.length === 0 ? <Empty>No projects match &quot;{projectQuery}&quot;.</Empty> : null}
          {visibleProjects.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <Pill>{item.code}</Pill>
                <span className="font-medium text-slate-900">{item.name}</span>
                <span className="text-xs text-slate-500">{item.location?.name ?? "No location"}{item.company ? ` · ${item.company.name}` : ""} · {item._count.documents} document(s)</span>
                <Pill tone={item.isActive ? "green" : "amber"}>{item.isActive ? "Active" : "Inactive"}</Pill>
                {item.director ? (
                  <span className={`text-xs ${item.director.isActive ? "text-slate-700" : "text-amber-700"}`}>
                    Director: <span className="font-medium">{item.director.name}</span>{item.director.isActive ? "" : " (inactive)"}
                  </span>
                ) : (
                  <span className="text-xs text-amber-700">No project director</span>
                )}
                {item.manager ? (
                  <span className={`text-xs ${item.manager.isActive ? "text-slate-700" : "text-amber-700"}`}>
                    Manager: <span className="font-medium">{item.manager.name}</span>{item.manager.isActive ? "" : " (inactive)"}
                  </span>
                ) : (
                  <span className="text-xs text-amber-700">No project manager</span>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" className={secondaryButton} onClick={() => { setProjectEditId(item.id); setProject({ code: item.code, name: item.name, locationId: item.locationId ?? "", companyId: item.companyId ?? "", directorId: item.directorId ?? "", managerId: item.managerId ?? "" }); projectFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Edit</button>
                <button type="button" className={secondaryButton} onClick={() => run(item.isActive
                  ? callApiWithDeactivationConfirmation("/api/admin/projects", { id: item.id, code: item.code, name: item.name, locationId: item.locationId ?? "", isActive: false })
                  : callApi("/api/admin/projects", "PATCH", { id: item.id, code: item.code, name: item.name, locationId: item.locationId ?? "", isActive: true }), "Project updated.")}>{item.isActive ? "Deactivate" : "Activate"}</button>
                <button type="button" className={dangerButton} onClick={() => window.confirm(`Delete ${item.name}?`) && run(callApi("/api/admin/projects", "DELETE", { id: item.id }), "Project deleted.")}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Companies" subtitle="Link projects to a company on each project (optional). A role given for a company in Roles & Access covers all of its projects.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Name"><input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} className={inputClass} /></Field>
          <Field label="Location"><select value={company.locationId} onChange={(e) => setCompany({ ...company, locationId: e.target.value })} className={inputClass}>{locationOptions}</select></Field>
          <div className="flex items-end gap-2">
            <button
              type="button"
              className={primaryButton}
              onClick={() =>
                run(
                  companyEditId ? callApi("/api/admin/companies", "PATCH", { id: companyEditId, ...company }) : callApi("/api/admin/companies", "POST", company),
                  companyEditId ? "Company updated." : "Company added.",
                  () => { setCompany({ name: "", locationId: "" }); setCompanyEditId(null); },
                )
              }
            >
              {companyEditId ? "Save" : "Add company"}
            </button>
            {companyEditId ? <button type="button" className={secondaryButton} onClick={() => { setCompanyEditId(null); setCompany({ name: "", locationId: "" }); }}>Cancel</button> : null}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {companies.length === 0 ? <Empty>No companies yet.</Empty> : null}
          {companies.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium text-slate-900">{item.name}</span>
                <span className="text-xs text-slate-500">{item.location?.name ?? "No location"} · {item._count?.projects ?? 0} project(s)</span>
                <Pill tone={item.isActive ? "green" : "amber"}>{item.isActive ? "Active" : "Inactive"}</Pill>
              </div>
              <div className="flex gap-2">
                <button type="button" className={secondaryButton} onClick={() => { setCompanyEditId(item.id); setCompany({ name: item.name, locationId: item.locationId ?? "" }); }}>Edit</button>
                <button type="button" className={secondaryButton} onClick={() => run(item.isActive
                  ? callApiWithDeactivationConfirmation("/api/admin/companies", { id: item.id, name: item.name, locationId: item.locationId ?? "", isActive: false })
                  : callApi("/api/admin/companies", "PATCH", { id: item.id, name: item.name, locationId: item.locationId ?? "", isActive: true }), "Company updated.")}>{item.isActive ? "Deactivate" : "Activate"}</button>
                <button type="button" className={dangerButton} onClick={() => window.confirm(`Delete ${item.name}?`) && run(callApi("/api/admin/companies", "DELETE", { id: item.id }), "Company deleted.")}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
