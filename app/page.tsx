import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-3xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
        TaskPulse AI
      </h1>
      <p className="max-w-xl text-lg text-slate-600">
        Autonomous voice negotiation and dispatch for your service business.
        Sign in to manage tasks, monitor live calls, or check on vendor jobs.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/login"
          className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700"
        >
          Sign in
        </Link>
        <Link
          href="/dashboard"
          className="rounded-full border border-slate-300 px-6 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
