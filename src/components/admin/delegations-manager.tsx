"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, dangerButton, inputClass, primaryButton } from "@/components/admin/admin-ui";

type Person = { id: string; name: string; email: string };
type Delegation = { id: string; reason: string | null; createdAt: string; delegator: Person; delegate: Person; createdBy: { id: string; name: string } };

/** Hand one user's approval tasks to another user. It stays in place until you delete it. */
export default function DelegationsManager() {
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [users, setUsers] = useState<Person[]>([]);
  const [form, setForm] = useState({ delegatorUserId: "", delegateUserId: "", reason: "" });
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
    const result = await callApi("/api/admin/delegations", "POST", form);
    if (!result.ok) return setError(result.message);
    setNotice("Delegation created.");
    setForm({ delegatorUserId: "", delegateUserId: "", reason: "" });
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

      <Card title="New delegation" subtitle="The person taking over can act on every approval level the person who is away could act on. The history records who acted for whom.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
        </div>
        <div className="mt-4">
          <button type="button" className={primaryButton} disabled={!form.delegatorUserId || !form.delegateUserId} onClick={create}>Create delegation</button>
        </div>
      </Card>

      <Card title="Active delegations">
        {delegations.length === 0 ? <Empty>No delegations.</Empty> : null}
        <div className="space-y-2">
          {delegations.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm">
              <div>
                <span className="font-medium text-slate-900">{item.delegator.name}</span> → <span className="font-medium text-slate-900">{item.delegate.name}</span>
                <span className="ml-3 text-xs text-slate-500">
                  set by {item.createdBy.name} on {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(item.createdAt))}
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
