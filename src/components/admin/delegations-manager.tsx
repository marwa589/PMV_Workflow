"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, dangerButton, inputClass, primaryButton } from "@/components/admin/admin-ui";

type Person = { id: string; name: string; email: string };
type Delegation = { id: string; reason: string | null; createdAt: string; expiresAt: string | null; delegator: Person; delegate: Person; createdBy: { id: string; name: string } };

/** Hand one user's approval tasks to another user, with an optional end time. */
export default function DelegationsManager() {
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [users, setUsers] = useState<Person[]>([]);
  const [form, setForm] = useState({ delegatorUserId: "", delegateUserId: "", reason: "", expiresAt: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await callApi<{ delegations: Delegation[]; users: Person[] }>("/api/admin/delegations");
    if (!result.ok) return setError(result.message);
    setDelegations(result.data.delegations);
    setUsers(result.data.users);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setError(null);
    setNotice(null);
    const result = await callApi("/api/admin/delegations", "POST", {
      ...form,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    });
    if (!result.ok) return setError(result.message);
    setNotice("Delegation created.");
    setForm({ delegatorUserId: "", delegateUserId: "", reason: "", expiresAt: "" });
    await load();
  }

  async function remove(item: Delegation) {
    setError(null);
    setNotice(null);
    const result = await callApi("/api/admin/delegations", "DELETE", { id: item.id });
    if (!result.ok) return setError(result.message);
    setNotice("Delegation removed.");
    await load();
  }

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <Card title="New delegation" subtitle="The person taking over can act on every approval level the person who is away could act on. The history records who acted for whom. Leave the end time blank for an ongoing delegation.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Person who is away">
            <select value={form.delegatorUserId} onChange={(e) => setForm({ ...form, delegatorUserId: e.target.value })} className={inputClass}>
              <option value="">Select a user</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          </Field>
          <Field label="Takes over">
            <select value={form.delegateUserId} onChange={(e) => setForm({ ...form, delegateUserId: e.target.value })} className={inputClass}>
              <option value="">Select a user</option>
              {users.filter((user) => user.id !== form.delegatorUserId).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          </Field>
          <Field label="Reason (optional)"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputClass} /></Field>
          <Field label="Ends at (optional)" hint="After this time, unfinished approval tasks return to the person who is away.">
            <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className={inputClass} />
          </Field>
        </div>
        <div className="mt-4">
          <button type="button" className={primaryButton} disabled={!form.delegatorUserId || !form.delegateUserId} onClick={create}>Create delegation</button>
        </div>
      </Card>

      <Card title="Delegations">
        {delegations.length === 0 ? <Empty>No delegations.</Empty> : null}
        <div className="space-y-2">
          {delegations.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm">
              <div>
                <span className="font-medium text-slate-900">{item.delegator.name}</span> → <span className="font-medium text-slate-900">{item.delegate.name}</span>
                <span className="ml-3 text-xs text-slate-500">
                  set by {item.createdBy.name} on {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(item.createdAt))}
                  {item.expiresAt
                    ? ` · ${new Date(item.expiresAt) <= new Date() ? "Expired" : `ends ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.expiresAt))}`}`
                    : " · No end time"}
                  {item.reason ? ` · ${item.reason}` : ""}
                </span>
              </div>
              <button type="button" className={dangerButton} onClick={() => remove(item)}>Remove</button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
