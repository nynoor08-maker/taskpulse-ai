import Link from "next/link";

export default function HomePage() {
  return (
    <main className="relative isolate min-h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Full-bleed atmospheric plane */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_20%,#d7f3ee_0%,transparent_45%),radial-gradient(ellipse_at_80%_10%,#cfe0ea_0%,transparent_40%),linear-gradient(165deg,#f7fafc_0%,#eef4f7_55%,#e4eef2_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.28] [background-image:linear-gradient(to_right,#94a3b840_1px,transparent_1px),linear-gradient(to_bottom,#94a3b840_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_80%)]"
      />

      {/* Dominant visual: pulsing call rings */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[18%] mx-auto flex h-[min(52vw,420px)] w-[min(52vw,420px)] items-center justify-center sm:top-[12%]"
      >
        <span className="absolute h-full w-full rounded-full border border-pulse/25 animate-pulse-ring" />
        <span
          className="absolute h-[78%] w-[78%] rounded-full border border-pulse/35 animate-pulse-ring"
          style={{ animationDelay: "0.7s" }}
        />
        <span
          className="absolute h-[56%] w-[56%] rounded-full border border-pulse/50 animate-pulse-ring"
          style={{ animationDelay: "1.4s" }}
        />
        <span className="relative flex h-24 w-24 items-center justify-center rounded-[1.75rem] bg-ink shadow-[0_20px_50px_rgba(11,23,32,0.28)]">
          <span className="h-4 w-4 rounded-full bg-pulse" />
        </span>
      </div>

      <section className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-4xl flex-col items-center justify-end px-6 pb-16 pt-28 text-center sm:justify-center sm:pb-20 sm:pt-40">
        <h1 className="animate-fade-up font-heading text-5xl tracking-tight text-ink sm:text-7xl">
          TaskPulse <span className="text-pulse">AI</span>
        </h1>
        <p className="animate-fade-up-delay mt-5 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
          Your AI squad calls local vendors, negotiates the rate, and gets a confirmed arrival window —
          before you lift a finger.
        </p>
        <div className="animate-fade-up-delay-2 mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/login" className="tp-btn-primary px-7">
            Get started
          </Link>
          <Link href="/dashboard" className="tp-btn-secondary px-7">
            Open dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
