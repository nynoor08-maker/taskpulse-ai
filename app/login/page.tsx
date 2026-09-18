"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { Alert } from "@/components/ui-kit";
import { createClient } from "@/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError("");
    setMessage("");
    try {
      const next = new URLSearchParams(window.location.search).get("next");
      const redirectTo = `${window.location.origin}${next && next.startsWith("/") ? next : "/dashboard"}`;
      const { error: authError } = await createClient().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (authError) {
        setError(authError.message);
        return;
      }
      setMessage("Check your email for your secure sign-in link.");
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : "Unable to send sign-in link. Check Supabase configuration.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col justify-center px-6 py-16">
      <div className="tp-surface animate-fade-up p-7 sm:p-8">
        <Link className="inline-flex items-center gap-2 text-ink" href="/">
          <BrandMark className="h-8 w-8" />
          <span className="font-heading text-xl">
            TaskPulse <span className="text-pulse">AI</span>
          </span>
        </Link>
        <h1 className="mt-8 font-heading text-3xl tracking-tight text-ink">Sign in</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Passwordless magic link — no password to remember.
        </p>
        <form className="mt-7 space-y-4" onSubmit={(event) => void signIn(event)}>
          <label className="tp-label">
            Work email
            <input
              className="tp-input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
            />
          </label>
          <button className="tp-btn-primary w-full" disabled={sending} type="submit">
            {sending ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
        {error ? (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        ) : null}
        {message ? (
          <div className="mt-4">
            <Alert tone="success">{message}</Alert>
          </div>
        ) : null}
      </div>
    </main>
  );
}
