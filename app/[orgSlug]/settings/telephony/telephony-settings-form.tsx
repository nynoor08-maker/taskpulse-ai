"use client";

import { FormEvent, useState } from "react";

export function TelephonySettingsForm({ orgSlug }: { orgSlug: string }) {
  const [vapiApiKey, setVapiApiKey] = useState("");
  const [vapiPhoneNumberId, setVapiPhoneNumberId] = useState("");
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/organizations/${orgSlug}/telephony`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vapiApiKey,
          vapiPhoneNumberId,
          twilioPhoneNumber: twilioPhoneNumber || null,
        }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof data === "object" &&
            data !== null &&
            typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Unable to save telephony settings.",
        );
      }
      setVapiApiKey("");
      setVapiPhoneNumberId("");
      setTwilioPhoneNumber("");
      setMessage("Telephony credentials securely saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save telephony settings.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Telephony settings</h1>
      <p className="mt-2 text-sm text-slate-600">
        Credentials are stored in Supabase Vault and are never displayed after saving.
      </p>
      <form className="mt-6 space-y-4" onSubmit={saveSettings}>
        <label className="block text-sm font-medium">
          Vapi API key
          <input className="mt-1 w-full rounded border p-2" required type="password" value={vapiApiKey} onChange={(event) => setVapiApiKey(event.target.value)} />
        </label>
        <label className="block text-sm font-medium">
          Vapi phone number ID
          <input className="mt-1 w-full rounded border p-2" required value={vapiPhoneNumberId} onChange={(event) => setVapiPhoneNumberId(event.target.value)} />
        </label>
        <label className="block text-sm font-medium">
          Twilio sender phone number
          <input className="mt-1 w-full rounded border p-2" placeholder="+15551234567" type="tel" value={twilioPhoneNumber} onChange={(event) => setTwilioPhoneNumber(event.target.value)} />
        </label>
        <button className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={isSaving} type="submit">
          {isSaving ? "Saving..." : "Save telephony settings"}
        </button>
      </form>
      {message && <p className="mt-4 text-sm" role="status">{message}</p>}
    </main>
  );
}
