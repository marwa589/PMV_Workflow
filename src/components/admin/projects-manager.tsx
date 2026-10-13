"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";

type Location = { id: string; name: string; _count: { projects: number; companies: number } };
type Company = { id: string; name: string; locationId: string | null; isActive: boolean; location: { id: string; name: string } | null };
type Project = { id: string; code: string; name: string; locationId: string | null; isActive: boolean; location: { id: string; name: string } | null; _count: { documents: number } };

/** Locations (countries), companies and projects. A project's short code appears in its document numbers. */
export default function ProjectsManager() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [locationName, setLocationName] = useState("");
  const [locationEditId, setLocationEditId] = useState<string | null>(null);
  const [company, setCompany] = useState({ name: "", locationId: "" });
  const [companyEditId, setCompanyEditId] = useState<string | null>(null);
  const [project, setProject] = useState({ code: "", name: "", locationId: "" });
  const [projectEditId, setProjectEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [l, c, p] = await Promise.all([
      callApi<{ locations: Location[] }>("/api/admin/locations"),
      callApi<{ companies: Company[] }>("/api/admin/companies"),
      callApi<{ projects: Project[] }>("/api/admin/projects"),
    ]);
    if (l.ok) setLocations(l.data.locations);
    if (c.ok) setCompanies(c.data.companies);
    if (p.ok) setProjects(p.data.projects);
    const failed = [l, c, p].find((r) => !r.ok);
    if (failed && !failed.ok) setError(failed.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: Promise<{ ok: boolean; message?: string }>, done: string, after?: () => void) {
    setError(null);
    setNotice(null);
    const result = await action;
    if (!result.ok) return setError(result.message ?? "Something went wrong.");
    setNotice(done);
    after?.();
    await load();
  }

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

      <Card title="Projects" subtitle="The short code is used in document numbers, so choose it carefully.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Code"><input value={project.code} onChange={(e) => setProject({ ...project, code: e.target.value })} className={inputClass} placeholder="P1" /></Field>
          <Field label="Name"><input value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} className={inputClass} /></Field>
          <Field label="Location"><select value={project.locationId} onChange={(e) => setProject({ ...project, locationId: e.target.value })} className={inputClass}>{locationOptions}</select></Field>
          <div className="flex items-end gap-2">
            <button
              type="button"
              className={primaryButton}
              onClick={() =>
                run(
                  projectEditId ? callApi("/api/admin/projects", "PATCH", { id: projectEditId, ...project }) : callApi("/api/admin/projects", "POST", project),
                  projectEditId ? "Project updated." : "Project added.",
                  () => { setProject({ code: "", name: "", locationId: "" }); setProjectEditId(null); },
                )
              }
            >
              {projectEditId ? "Save" : "Add project"}
            </button>
            {projectEditId ? <button type="button" className={secondaryButton} onClick={() => { setProjectEditId(null); setProject({ code: "", name: "", locationId: "" }); }}>Cancel</button> : null}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {projects.length === 0 ? <Empty>No projects yet.</Empty> : null}
          {projects.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <Pill>{item.code}</Pill>
                <span className="font-medium text-slate-900">{item.name}</span>
                <span className="text-xs text-slate-500">{item.location?.name ?? "No location"} · {item._count.documents} document(s)</span>
                <Pill tone={item.isActive ? "green" : "amber"}>{item.isActive ? "Active" : "Inactive"}</Pill>
              </div>
              <div className="flex gap-2">
                <button type="button" className={secondaryButton} onClick={() => { setProjectEditId(item.id); setProject({ code: item.code, name: item.name, locationId: item.locationId ?? "" }); }}>Edit</button>
                <button type="button" className={secondaryButton} onClick={() => run(callApi("/api/admin/projects", "PATCH", { id: item.id, code: item.code, name: item.name, locationId: item.locationId ?? "", isActive: !item.isActive }), "Project updated.")}>{item.isActive ? "Deactivate" : "Activate"}</button>
                <button type="button" className={dangerButton} onClick={() => window.confirm(`Delete ${item.name}?`) && run(callApi("/api/admin/projects", "DELETE", { id: item.id }), "Project deleted.")}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Companies">
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
                <span className="text-xs text-slate-500">{item.location?.name ?? "No location"}</span>
                <Pill tone={item.isActive ? "green" : "amber"}>{item.isActive ? "Active" : "Inactive"}</Pill>
              </div>
              <div className="flex gap-2">
                <button type="button" className={secondaryButton} onClick={() => { setCompanyEditId(item.id); setCompany({ name: item.name, locationId: item.locationId ?? "" }); }}>Edit</button>
                <button type="button" className={dangerButton} onClick={() => window.confirm(`Delete ${item.name}?`) && run(callApi("/api/admin/companies", "DELETE", { id: item.id }), "Company deleted.")}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
