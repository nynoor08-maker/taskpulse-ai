import type { ReactNode } from "react";

export function StatusBadge({
  status,
}: {
  status: string;
}) {
  const styles: Record<string, string> = {
    pending: "bg-mist text-ink",
    in_progress: "bg-pulse-soft text-[#0b3d36]",
    completed: "bg-emerald-50 text-emerald-800",
    failed: "bg-red-50 text-red-800",
    unpaid: "bg-amber-50 text-amber-900",
    paid: "bg-emerald-50 text-emerald-800",
  };
  const className = styles[status] ?? "bg-mist text-muted-foreground";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${className}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function Alert({
  tone = "error",
  children,
}: {
  tone?: "error" | "success" | "info";
  children: ReactNode;
}) {
  const tones = {
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    info: "border-border bg-mist text-ink",
  };
  return (
    <p className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</p>
  );
}

export function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="tp-surface px-6 py-10 text-center">
      <p className="font-heading text-xl text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-pulse">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1 font-heading text-3xl tracking-tight text-ink sm:text-4xl">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
