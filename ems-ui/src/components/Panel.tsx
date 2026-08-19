import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

/** Card shell — white surface, hairline border, radius from the shared token. */
export function Panel({
  title,
  note,
  span = "col-span-12 lg:col-span-6",
  children,
}: {
  title: string;
  note?: string;
  span?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`${span} bg-card border border-border rounded-lg p-4 min-w-0`}
    >
      <h2 className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground tracking-wide mb-3">
        {title}
        {note && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-normal text-bad normal-case">
            <TriangleAlert size={11} strokeWidth={2} />
            {note}
          </span>
        )}
      </h2>
      {children}
    </section>
  );
}

export function Notice({
  children,
  kind = "warn",
}: {
  children: ReactNode;
  kind?: "warn" | "error";
}) {
  const accent = kind === "error" ? "var(--bad)" : "var(--warn)";
  return (
    <div
      className="flex items-start gap-2.5 bg-card border border-border rounded-lg px-4 py-3 mb-3 text-[11.5px] leading-relaxed text-muted-foreground"
      style={{ borderLeft: `3px solid ${accent}` }}
      role={kind === "error" ? "alert" : undefined}
    >
      <TriangleAlert size={14} strokeWidth={2} style={{ color: accent, flex: "none", marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}
