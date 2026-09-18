import Link from "next/link";

export default function HomePage() {
  return (
    <main className="relative isolate min-h-[calc(100vh-3.25rem)] overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#e2e8f0_0%,_#f8fafc_45%,_#f1f5f9_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_right,#94a3b833_1px,transparent_1px),linear-gradient(to_bottom,#94a3b833_1px,transparent_1px)] [background-size:48px_48px]"
      />
      <section className="relative mx-auto flex min-h-[calc(100vh-3.25rem)] max-w-4xl flex-col items-center justify-center px-6 py-20 text-center">
        <p className="text-sm font-medium uppercase tracking-[0.22em] text-slate-500">
          Voice dispatch platform
        </p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
          TaskPulse AI
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
          Autonomous vendor negotiation and backup dispatch for local service jobs —
          from inbound call to confirmed quote.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
          >
            Sign in
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-slate-300 bg-white/70 px-6 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-white"
          >
            Open dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
