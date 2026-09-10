"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type ApiKey = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
};

export function DeveloperSettings({ orgSlug }: { orgSlug: string }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [error, setError] = useState("");

  const loadKeys = useCallback(async () => {
    const response = await fetch(`/api/organizations/${orgSlug}/api-keys`);
    const data: unknown = await response.json();
    if (!response.ok || !data || typeof data !== "object" || !Array.isArray((data as { keys?: unknown }).keys)) {
      setError("Unable to load API keys.");
      return;
    }
    setKeys((data as { keys: ApiKey[] }).keys);
  }, [orgSlug]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadKeys();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadKeys]);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNewSecret("");
    const response = await fetch(`/api/organizations/${orgSlug}/api-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data: unknown = await response.json();
    if (!response.ok || !data || typeof data !== "object" || !("key" in data)) {
      setError("Unable to create API key.");
      return;
    }
    const key = (data as { key: ApiKey & { secret: string } }).key;
    setNewSecret(key.secret);
    setName("");
    await loadKeys();
  }

  async function revokeKey(keyId: string) {
    setError("");
    const response = await fetch(
      `/api/organizations/${orgSlug}/api-keys?keyId=${encodeURIComponent(keyId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      setError("Unable to revoke API key.");
      return;
    }
    await loadKeys();
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Developer API keys</h1>
      <p className="mt-2 text-sm text-slate-600">Create keys for programmatic task dispatch.</p>
      <form className="mt-6 flex gap-3" onSubmit={(event) => void createKey(event)}>
        <input className="flex-1 rounded border p-2" onChange={(event) => setName(event.target.value)} placeholder="Production integration" required value={name} />
        <button className="rounded bg-slate-900 px-4 text-sm font-medium text-white" type="submit">Create key</button>
      </form>
      {newSecret && <p className="mt-4 break-all rounded border border-amber-300 bg-amber-50 p-3 text-sm">Copy now; this API key will not be shown again: <code>{newSecret}</code></p>}
      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      <ul className="mt-6 divide-y rounded border">
        {keys.map((key) => (
          <li className="flex items-center justify-between gap-4 p-4" key={key.id}>
            <div><p className="font-medium">{key.name}</p><p className="text-xs text-slate-600">Last used: {key.last_used_at ?? "Never"}</p></div>
            <button className="text-sm font-medium text-red-700" onClick={() => void revokeKey(key.id)} type="button">Revoke</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
