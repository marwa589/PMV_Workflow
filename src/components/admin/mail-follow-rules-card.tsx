"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";
import {
  MAIL_DELIVERY_LABELS,
  MAIL_FOLLOW_EVENT_LABELS,
  MAIL_FOLLOW_SCOPE_LABELS,
  type MailDelivery,
  type MailFollowEventValue,
  type MailFollowScopeValue,
  type MailKindDefaults,
} from "@/lib/mailing-list-config";

type Rule = {
  id: string;
  userId: string;
  scope: MailFollowScopeValue;
  documentTypeId: string;
  events: MailFollowEventValue[];
  delivery: MailDelivery | null;
  user: { name: string; email: string };
  documentType: { name: string };
};
type Draft = { id: string | null; userId: string; scope: MailFollowScopeValue; documentTypeId: string; events: MailFollowEventValue[]; delivery: string };

const blank = (): Draft => ({ id: null, userId: "", scope: "OWN_UPLOADS", documentTypeId: "", events: ["UPLOADED", "APPROVED"], delivery: "" });
const EVENTS: MailFollowEventValue[] = ["UPLOADED", "APPROVED"];

/**
 * Follow-up rules: email a person when a document of a chosen type is uploaded or approved in the same process run as a
 * document they uploaded (or can open). Set by an admin. People never get an email for a document they cannot open.
 */
export default function MailFollowRulesCard({
  users,
  documentTypes,
  defaults,
}: {
  users: Array<{ id: string; name: string; email: string }>;
  documentTypes: Array<{ id: string; name: string }>;
  defaults: MailKindDefaults;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Draft>(blank());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problemUserId, setProblemUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await callApi<{ rules: Rule[] }>("/api/admin/mailing-list/follow-rules");
    if (!result.ok) return setError(result.message);
    setRules(result.data.rules);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setError(null);
    setNotice(null);
    setProblemUserId(null);
    const result = await callApi("/api/admin/mailing-list/follow-rules", "PUT", {
      id: draft.id,
      userId: draft.userId,
      scope: draft.scope,
      documentTypeId: draft.documentTypeId,
      events: draft.events,
      delivery: draft.delivery === "" ? null : draft.delivery,
    });
    if (!result.ok) {
      setProblemUserId(draft.userId);
      return setError(result.message);
    }
    setNotice(draft.id ? "Rule updated." : "Rule added.");
    setDraft(blank());
    await load();
  }

  async function remove(rule: Rule) {
    setError(null);
    setNotice(null);
    const result = await callApi("/api/admin/mailing-list/follow-rules", "DELETE", { id: rule.id });
    if (!result.ok) return setError(result.message);
    if (draft.id === rule.id) setDraft(blank());
    setNotice("Rule removed.");
    await load();
  }

  const toggleEvent = (event: MailFollowEventValue) =>
    setDraft((current) => ({ ...current, events: current.events.includes(event) ? current.events.filter((value) => value !== event) : [...current.events, event] }));

  return (
    <Card
      title="Follow-up rules (same process)"
      subtitle="Email a person when a document of a chosen type is uploaded or approved in the same process as a document they uploaded, or as any document they can open. One rule per document type. Documents the person cannot open are never emailed."
    >
      {error ? <div className="mb-3 space-y-2"><Banner kind="error">{error}</Banner>{problemUserId ? <Link href={`/admin/roles?userId=${problemUserId}`} className="text-sm font-medium text-cyan-700 underline">Open Roles &amp; Access for this person</Link> : null}</div> : null}
      {notice ? <div className="mb-3"><Banner kind="success">{notice}</Banner></div> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="Person">
          <select className={inputClass} value={draft.userId} onChange={(event) => setDraft({ ...draft, userId: event.target.value })}>
            <option value="">Select a person</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
        </Field>
        <Field label="Follow processes that contain…">
          <select className={inputClass} value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value as MailFollowScopeValue })}>
            {(Object.keys(MAIL_FOLLOW_SCOPE_LABELS) as MailFollowScopeValue[]).map((scope) => <option key={scope} value={scope}>{MAIL_FOLLOW_SCOPE_LABELS[scope]}</option>)}
          </select>
        </Field>
        <Field label="Email about documents of type">
          <select className={inputClass} value={draft.documentTypeId} onChange={(event) => setDraft({ ...draft, documentTypeId: event.target.value })}>
            <option value="">Select a document type</option>
            {documentTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>
        </Field>
        <Field label="When it is">
          <div className="flex flex-wrap gap-4 pt-2">
            {EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={draft.events.includes(event)} onChange={() => toggleEvent(event)} /> {MAIL_FOLLOW_EVENT_LABELS[event]}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Delivery">
          <select className={inputClass} value={draft.delivery} onChange={(event) => setDraft({ ...draft, delivery: event.target.value })}>
            <option value="">Default (Uploaded: {MAIL_DELIVERY_LABELS[defaults.PROCESS_UPLOADED]}, Approved: {MAIL_DELIVERY_LABELS[defaults.PROCESS_APPROVED]})</option>
            {(["DIGEST", "INSTANT", "OFF"] as MailDelivery[]).map((delivery) => <option key={delivery} value={delivery}>{MAIL_DELIVERY_LABELS[delivery]}</option>)}
          </select>
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={primaryButton} disabled={!draft.userId || !draft.documentTypeId || draft.events.length === 0} onClick={() => void save()}>{draft.id ? "Save changes" : "Add rule"}</button>
        {draft.id ? <button type="button" className={secondaryButton} onClick={() => setDraft(blank())}>Cancel</button> : null}
      </div>

      <div className="mt-6">
        {rules.length === 0 ? <Empty>No follow-up rules yet.</Empty> : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {rules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="space-y-1">
                  <p className="font-medium text-slate-900">{rule.user.name} <span className="font-normal text-slate-500">· {rule.documentType.name}</span></p>
                  <div className="flex flex-wrap gap-2">
                    <Pill tone="green">{MAIL_FOLLOW_SCOPE_LABELS[rule.scope]}</Pill>
                    {rule.events.map((event) => <Pill key={event}>{MAIL_FOLLOW_EVENT_LABELS[event]}</Pill>)}
                    <span className="text-xs text-slate-500">{rule.delivery ? MAIL_DELIVERY_LABELS[rule.delivery] : "Default delivery"}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={secondaryButton} onClick={() => { setError(null); setNotice(null); setDraft({ id: rule.id, userId: rule.userId, scope: rule.scope, documentTypeId: rule.documentTypeId, events: rule.events, delivery: rule.delivery ?? "" }); }}>Edit</button>
                  <button type="button" className={dangerButton} onClick={() => void remove(rule)}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
