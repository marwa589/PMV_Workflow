"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";
import { PagedList } from "@/components/pager";
import MailFollowRulesCard from "@/components/admin/mail-follow-rules-card";
import {
  MAIL_DELIVERY_HELP,
  MAIL_DELIVERY_LABELS,
  MAIL_KINDS,
  MAIL_KIND_KEYS,
  MAIL_PERSON_GROUPS,
  RULE_KINDS,
  MAIL_KIND_GROUPS,
  type MailDelivery,
  type MailKind,
  type MailKindDefaults,
} from "@/lib/mailing-list-config";

type Person = { id: string; name: string; email: string; emailNotificationsDisabled: boolean; userType: { code: string; name: string } };
type Setting = { id: string; userId: string; kind: MailKind; delivery: MailDelivery | null; projectIds: string[]; documentTypeIds: string[]; documentSubtypeIds: string[] };
type Project = { id: string; code: string; name: string };
type DocType = { id: string; name: string; code: string; subtypes: Array<{ id: string; name: string; code: string }> };
type LoadResult = { users: Person[]; settings: Setting[]; defaults: MailKindDefaults; digestIntervalHours: number; projects: Project[]; documentTypes: DocType[] };

// "" = follow the default (involved kinds) / not on the list ("any document" kinds); "DEFAULT" = on the list, default delivery.
type Draft = { delivery: string; projectIds: string[]; documentTypeIds: string[]; documentSubtypeIds: string[] };

const DELIVERIES: MailDelivery[] = ["OFF", "DIGEST", "INSTANT"];
const settingKey = (userId: string, kind: MailKind) => `${userId}|${kind}`;

function toDraft(setting: Setting | undefined, kind: MailKind): Draft {
  if (!setting) return { delivery: "", projectIds: [], documentTypeIds: [], documentSubtypeIds: [] };
  return {
    delivery: setting.delivery ?? (MAIL_KINDS[kind].involvement ? "" : "DEFAULT"),
    projectIds: setting.projectIds,
    documentTypeIds: setting.documentTypeIds,
    documentSubtypeIds: setting.documentSubtypeIds,
  };
}

/** A tick list inside a drop-down: nothing ticked means "all". */
function PickList({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="relative">
      <summary className={`${inputClass} cursor-pointer list-none`}>{summary}</summary>
      <div className="absolute z-10 mt-1 max-h-64 w-full min-w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">{children}</div>
    </details>
  );
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export default function MailingListManager() {
  const [data, setData] = useState<LoadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [intervalDraft, setIntervalDraft] = useState("");

  const load = useCallback(async () => {
    const result = await callApi<LoadResult>("/api/admin/mailing-list");
    if (!result.ok) return setError(result.message);
    setData(result.data);
    setIntervalDraft(String(result.data.digestIntervalHours));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const settingsByKey = useMemo(() => new Map((data?.settings ?? []).map((setting) => [settingKey(setting.userId, setting.kind), setting])), [data]);
  const projectCode = useMemo(() => new Map((data?.projects ?? []).map((project) => [project.id, project.code])), [data]);
  const typeName = useMemo(() => {
    const names = new Map<string, string>();
    for (const type of data?.documentTypes ?? []) {
      names.set(type.id, type.name);
      for (const subtype of type.subtypes) names.set(subtype.id, `${type.name} / ${subtype.name}`);
    }
    return names;
  }, [data]);

  if (!data) return error ? <Banner kind="error">{error}</Banner> : <p className="text-sm text-slate-500">Loading…</p>;
  const { users, defaults, projects, documentTypes } = data;

  const scopeText = (setting: Setting) => {
    const projectsText = setting.projectIds.length ? `Projects: ${setting.projectIds.map((id) => projectCode.get(id) ?? "?").join(", ")}` : "All projects";
    const typeIds = [...setting.documentTypeIds, ...setting.documentSubtypeIds];
    const typesText = typeIds.length ? `Types: ${typeIds.map((id) => typeName.get(id) ?? "?").join(", ")}` : "All document types";
    return `${projectsText} · ${typesText}`;
  };
  const deliveryText = (setting: Setting) => MAIL_DELIVERY_LABELS[setting.delivery ?? defaults[setting.kind]] + (setting.delivery ? "" : " (default)");

  async function saveInterval() {
    setError(null);
    setNotice(null);
    const hours = Number(intervalDraft);
    const result = await callApi("/api/admin/mailing-list/digest-interval", "PUT", { hours });
    if (!result.ok) return setError(result.message);
    setNotice(`Summary emails now go out at most every ${hours} hour${hours === 1 ? "" : "s"}.`);
    await load();
  }

  async function saveDefault(kind: MailKind, delivery: MailDelivery) {
    setError(null);
    setNotice(null);
    const result = await callApi("/api/admin/mailing-list/defaults", "PUT", { kind, delivery });
    if (!result.ok) return setError(result.message);
    setNotice(`Default saved: ${MAIL_KINDS[kind].label} → ${MAIL_DELIVERY_LABELS[delivery]}.`);
    await load();
  }

  const needle = search.trim().toLowerCase();
  const visibleUsers = users.filter((user) => {
    if (needle && !`${user.name} ${user.email}`.toLowerCase().includes(needle)) return false;
    if (onlyChanged && !MAIL_KIND_KEYS.filter((kind) => !RULE_KINDS.includes(kind)).some((kind) => settingsByKey.has(settingKey(user.id, kind)))) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <Card title="Summary email frequency" subtitle="How many hours pass between two summary emails to the same person. Applies to everyone who gets the Summary email.">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-700" htmlFor="digest-interval">Send a summary at most every</label>
          <input id="digest-interval" type="number" min={1} max={168} step={1} value={intervalDraft} onChange={(event) => setIntervalDraft(event.target.value)} className={`${inputClass} !w-24`} />
          <span className="text-sm text-slate-700">hours</span>
          <button type="button" className={primaryButton} disabled={intervalDraft === String(data.digestIntervalHours)} onClick={() => void saveInterval()}>Save</button>
        </div>
        <p className="mt-2 text-xs text-slate-500">From 1 to 168 hours (one week). Emails are still never sent during quiet hours (18:00-06:00 Kuwait time); a summary that falls due then goes out from 06:00.</p>
      </Card>

      <Card title="Defaults" subtitle="How each kind of email is delivered for everyone who has no setting of their own. Changing a default applies to all of them at once.">
        <div className="space-y-5">
          {MAIL_KIND_GROUPS.map((group) => (
            <div key={group}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</h4>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {MAIL_KIND_KEYS.filter((kind) => MAIL_KINDS[kind].group === group).map((kind) => (
                  <div key={kind} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="max-w-xl">
                      <p className="text-sm font-medium text-slate-900">{MAIL_KINDS[kind].label}</p>
                      <p className="text-xs text-slate-500">{MAIL_KINDS[kind].description} {MAIL_KINDS[kind].audience}</p>
                    </div>
                    <select className={`${inputClass} !w-48`} value={defaults[kind]} onChange={(event) => void saveDefault(kind, event.target.value as MailDelivery)}>
                      {DELIVERIES.map((delivery) => <option key={delivery} value={delivery}>{MAIL_DELIVERY_LABELS[delivery]}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-500">
            {DELIVERIES.map((delivery) => `${MAIL_DELIVERY_LABELS[delivery]}: ${MAIL_DELIVERY_HELP[delivery]}`).join(" ")} People who switched all workflow emails off in their own settings never get any of these.
          </p>
        </div>
      </Card>

      <MailFollowRulesCard users={users} documentTypes={documentTypes} defaults={defaults} />

      <Card
        title={`People (${visibleUsers.length})`}
        subtitle="What each person is emailed about. Kinds without a setting follow the defaults above. Add a person to the “Following other documents” lists to email them about documents they are not involved in."
      >
        <div className="mb-4 flex flex-wrap items-end gap-4">
          <div className="min-w-64 flex-1">
            <Field label="Search people"><input className={inputClass} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or email" /></Field>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={onlyChanged} onChange={(event) => setOnlyChanged(event.target.checked)} /> Only people with their own settings
          </label>
        </div>

        {visibleUsers.length === 0 ? <Empty>No people match.</Empty> : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
          <PagedList items={visibleUsers} storageKey="mailing-list-users" noun="people">
          {(pageUsers) => (
          <div className="divide-y divide-slate-100">
            {pageUsers.map((user) => {
              const own = MAIL_KIND_KEYS.filter((kind) => !RULE_KINDS.includes(kind)).map((kind) => settingsByKey.get(settingKey(user.id, kind))).filter((setting): setting is Setting => Boolean(setting));
              return (
                <div key={user.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{user.name} <span className="ml-1 text-xs font-normal text-slate-500">{user.userType.name}</span></p>
                      <p className="text-xs text-slate-500">{user.email}</p>
                      {user.emailNotificationsDisabled ? <div className="mt-1"><Pill tone="amber">Workflow emails switched off by this person</Pill></div> : null}
                    </div>
                    <button type="button" className={secondaryButton} onClick={() => setEditing(editing === user.id ? null : user.id)}>{editing === user.id ? "Close" : "Manage"}</button>
                  </div>
                  {own.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">Everything follows the defaults.</p>
                  ) : (
                    <ul className="mt-2 space-y-1 text-sm text-slate-700">
                      {own.map((setting) => (
                        <li key={setting.id}>
                          <span className="font-medium">{MAIL_KINDS[setting.kind].label}</span> — {deliveryText(setting)} · <span className="text-slate-500">{scopeText(setting)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {editing === user.id ? (
                    <PersonEditor
                      user={user}
                      settingsByKey={settingsByKey}
                      defaults={defaults}
                      projects={projects}
                      documentTypes={documentTypes}
                      onSaved={async (message) => {
                        setNotice(message);
                        await load();
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          )}
          </PagedList>
          </div>
        )}
      </Card>
    </div>
  );
}

function PersonEditor({
  user,
  settingsByKey,
  defaults,
  projects,
  documentTypes,
  onSaved,
}: {
  user: Person;
  settingsByKey: Map<string, Setting>;
  defaults: MailKindDefaults;
  projects: Project[];
  documentTypes: DocType[];
  onSaved: (message: string) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(MAIL_KIND_KEYS.map((kind) => [kind, toDraft(settingsByKey.get(settingKey(user.id, kind)), kind)])));
  const [problem, setProblem] = useState<{ kind: MailKind; message: string } | null>(null);
  const [busy, setBusy] = useState<MailKind | null>(null);

  const patch = (kind: MailKind, change: Partial<Draft>) => setDrafts((current) => ({ ...current, [kind]: { ...current[kind], ...change } }));

  async function save(kind: MailKind) {
    const draft = drafts[kind];
    const involvement = MAIL_KINDS[kind].involvement;
    const hasLimits = draft.projectIds.length + draft.documentTypeIds.length + draft.documentSubtypeIds.length > 0;
    setProblem(null);
    setBusy(kind);
    // Nothing to keep: involved kinds fall back to the default, "any document" kinds leave the list.
    const result = draft.delivery === "" && (!involvement || !hasLimits)
      ? await callApi("/api/admin/mailing-list", "DELETE", { userId: user.id, kind })
      : await callApi("/api/admin/mailing-list", "PUT", {
          userId: user.id,
          kind,
          delivery: draft.delivery === "" || draft.delivery === "DEFAULT" ? null : draft.delivery,
          projectIds: draft.projectIds,
          documentTypeIds: draft.documentTypeIds,
          documentSubtypeIds: draft.documentSubtypeIds,
        });
    setBusy(null);
    if (!result.ok) return setProblem({ kind, message: result.message });
    await onSaved(`${user.name}: ${MAIL_KINDS[kind].label} saved.`);
  }

  return (
    <div className="mt-4 space-y-5 rounded-xl bg-slate-50 p-4">
      {MAIL_PERSON_GROUPS.map((group) => (
        <div key={group}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</h4>
          <div className="space-y-3">
            {MAIL_KIND_KEYS.filter((kind) => MAIL_KINDS[kind].group === group).map((kind) => {
              const draft = drafts[kind];
              const involvement = MAIL_KINDS[kind].involvement;
              const active = involvement || draft.delivery !== "";
              const limitedTo = kind === "AWAITING_UPLOAD" ? "the document type to upload" : "the document type";
              return (
                <div key={kind} className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-sm font-medium text-slate-900">{MAIL_KINDS[kind].label}</p>
                  <p className="mb-3 text-xs text-slate-500">{MAIL_KINDS[kind].description}</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <Field label={involvement ? "Delivery" : "On this list"}>
                      <select className={inputClass} value={draft.delivery} onChange={(event) => patch(kind, { delivery: event.target.value })}>
                        {involvement ? (
                          <option value="">Default ({MAIL_DELIVERY_LABELS[defaults[kind]]})</option>
                        ) : (
                          <>
                            <option value="">Not on this list</option>
                            <option value="DEFAULT">Yes, default delivery ({MAIL_DELIVERY_LABELS[defaults[kind]]})</option>
                          </>
                        )}
                        {DELIVERIES.filter((delivery) => involvement || delivery !== "OFF").map((delivery) => <option key={delivery} value={delivery}>{involvement ? "" : "Yes, "}{MAIL_DELIVERY_LABELS[delivery]}</option>)}
                      </select>
                    </Field>
                    <Field label="Projects" hint={draft.projectIds.length ? undefined : "Nothing ticked = all projects"}>
                      <PickList summary={draft.projectIds.length ? `${draft.projectIds.length} project(s)` : "All projects"}>
                        {projects.map((project) => (
                          <label key={project.id} className="flex items-center gap-2 px-1 py-1 text-sm">
                            <input type="checkbox" disabled={!active} checked={draft.projectIds.includes(project.id)} onChange={() => patch(kind, { projectIds: toggle(draft.projectIds, project.id) })} />
                            {project.code} - {project.name}
                          </label>
                        ))}
                      </PickList>
                    </Field>
                    <Field label="Document types" hint={draft.documentTypeIds.length + draft.documentSubtypeIds.length ? `Limited to ${limitedTo}` : "Nothing ticked = all types"}>
                      <PickList summary={draft.documentTypeIds.length + draft.documentSubtypeIds.length ? `${draft.documentTypeIds.length} type(s), ${draft.documentSubtypeIds.length} sub type(s)` : "All document types"}>
                        {documentTypes.map((type) => (
                          <div key={type.id}>
                            <label className="flex items-center gap-2 px-1 py-1 text-sm font-medium">
                              <input type="checkbox" disabled={!active} checked={draft.documentTypeIds.includes(type.id)} onChange={() => patch(kind, { documentTypeIds: toggle(draft.documentTypeIds, type.id) })} />
                              {type.name} <span className="text-xs font-normal text-slate-500">(all sub types)</span>
                            </label>
                            {type.subtypes.map((subtype) => (
                              <label key={subtype.id} className="ml-6 flex items-center gap-2 px-1 py-1 text-sm">
                                <input type="checkbox" disabled={!active} checked={draft.documentSubtypeIds.includes(subtype.id)} onChange={() => patch(kind, { documentSubtypeIds: toggle(draft.documentSubtypeIds, subtype.id) })} />
                                {subtype.name}
                              </label>
                            ))}
                          </div>
                        ))}
                      </PickList>
                    </Field>
                  </div>
                  {problem?.kind === kind ? (
                    <div className="mt-3 space-y-2">
                      <Banner kind="error">{problem.message}</Banner>
                      <Link href={`/admin/roles?userId=${user.id}`} className="text-sm font-medium text-cyan-700 underline">Open Roles &amp; Access for {user.name}</Link>
                    </div>
                  ) : null}
                  <div className="mt-3">
                    <button type="button" className={primaryButton} disabled={busy !== null} onClick={() => void save(kind)}>{busy === kind ? "Saving…" : "Save"}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
