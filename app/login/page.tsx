"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    setMessage(error ? error.message : "Check your email for your sign-in link.");
  }

  return <main className="mx-auto max-w-md px-6 py-16">
    <h1 className="text-3xl font-semibold">Sign in to TaskPulse AI</h1>
    <p className="mt-2 text-slate-600">We will email you a secure sign-in link.</p>
    <form className="mt-6 space-y-3" onSubmit={(event) => void signIn(event)}>
      <input className="w-full rounded border p-3" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
      <button className="rounded bg-slate-900 px-4 py-3 text-sm font-medium text-white" type="submit">Email me a sign-in link</button>
    </form>
    {message && <p className="mt-4 text-sm text-slate-700">{message}</p>}
  </main>;
}
