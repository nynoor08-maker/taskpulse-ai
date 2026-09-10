"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type PromptVariant = { id: string; name: string; system_prompt: string; traffic_weight: number; is_active: boolean };

export function PromptSettings({ orgSlug }: { orgSlug: string }) {
  const [variants, setVariants] = useState<PromptVariant[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/organizations/${orgSlug}/prompt-variants`);
    const data: unknown = await response.json();
    if (!response.ok || !data || typeof data !== "object" || !Array.isArray((data as { variants?: unknown }).variants)) {
      setError("Unable to load prompt variants.");
      return;
    }
    setVariants((data as { variants: PromptVariant[] }).variants);
  }, [orgSlug]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/organizations/${orgSlug}/prompt-variants`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.get("name"), systemPrompt: form.get("systemPrompt"), trafficWeight: Number(form.get("trafficWeight")) }),
    });
    if (!response.ok) { setError("Unable to create prompt variant."); return; }
    event.currentTarget.reset();
    await load();
  }

  async function toggle(variant: PromptVariant) {
    const response = await fetch(`/api/organizations/${orgSlug}/prompt-variants`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: variant.id, isActive: !variant.is_active }),
    });
    if (!response.ok) { setError("Unable to update prompt variant."); return; }
    await load();
  }

  return <main className="mx-auto max-w-3xl px-6 py-10">
    <h1 className="text-2xl font-semibold">Prompt experiments</h1>
    <p className="mt-2 text-sm text-slate-600">Active variants are selected using their traffic weights for each new call.</p>
    <form className="mt-6 space-y-3 rounded border p-4" onSubmit={(event) => void create(event)}>
      <input className="w-full rounded border p-2" name="name" placeholder="Empathetic negotiator" required />
      <textarea className="min-h-32 w-full rounded border p-2" name="systemPrompt" placeholder="System prompt" required />
      <label className="block text-sm">Traffic weight (0–100)<input className="ml-3 w-20 rounded border p-2" defaultValue="50" max="100" min="0" name="trafficWeight" type="number" required /></label>
      <button className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white" type="submit">Create variant</button>
    </form>
    {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
    <ul className="mt-6 space-y-3">{variants.map((variant) => <li className="rounded border p-4" key={variant.id}><div className="flex items-center justify-between gap-4"><p className="font-medium">{variant.name} <span className="text-sm font-normal text-slate-600">({variant.traffic_weight}% traffic)</span></p><button className="text-sm font-medium text-slate-700" onClick={() => void toggle(variant)} type="button">{variant.is_active ? "Disable" : "Enable"}</button></div><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{variant.system_prompt}</p></li>)}</ul>
  </main>;
}
