import Image from "next/image";

const sidebarItems = [
  { label: "Agents", active: true },
  { label: "Tasks", active: false },
  { label: "Docs", active: false },
];

export default function Home() {
  return (
    <main className="flex min-h-screen bg-slate-100 text-slate-900">
      <aside className="flex w-24 flex-col items-center border-r border-slate-800/60 bg-[#1c1d22] px-3 py-5 text-slate-300 shadow-[inset_-1px_0_0_rgba(255,255,255,0.04)]">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-lg shadow-black/20">
          <Image src="/cline-icon.svg" alt="Cline" width={32} height={32} />
        </div>

        <nav className="flex w-full flex-col items-center gap-3">
          {sidebarItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className={[
                "flex h-11 w-11 items-center justify-center rounded-xl border text-xs font-medium tracking-[0.12em] uppercase transition-all",
                item.active
                  ? "border-amber-400/40 bg-amber-500/10 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.18)]"
                  : "border-transparent bg-transparent text-slate-400 hover:border-white/10 hover:bg-white/5 hover:text-slate-200",
              ].join(" ")}
              aria-label={item.label}
            >
              {item.label.slice(0, 1)}
            </button>
          ))}
        </nav>
      </aside>

      <section className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-xl rounded-[28px] border border-slate-200 bg-white/80 p-7 shadow-[0_20px_60px_rgba(15,23,42,0.12)] backdrop-blur-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 p-2.5 shadow-sm ring-1 ring-slate-200">
              <Image
                src="/cline-icon.svg"
                alt="Cline icon"
                width={28}
                height={28}
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Extension
              </p>
              <h1 className="text-2xl font-semibold text-slate-900">
                Cline is installed
              </h1>
            </div>
          </div>

          <p className="mb-6 text-base leading-7 text-slate-600">
            The Cline icon is now pinned to the left sidebar, matching the
            extension-style activity rail used in VS Code.
          </p>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center justify-between text-sm text-slate-500">
              <span>Sidebar status</span>
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Active
              </span>
            </div>
            <p className="text-sm text-slate-700">
              Use the left rail to launch the agent, review tasks, and access your
              project context from one place.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
