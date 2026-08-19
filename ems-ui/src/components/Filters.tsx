"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";

const RANGE_KEYS = ["1h", "6h", "24h", "today", "7d", "30d"] as const;
const RANGE_LABEL: Record<string, string> = {
  "1h": "1H",
  "6h": "6H",
  "24h": "24H",
  today: "Today",
  "7d": "7D",
  "30d": "30D",
};

const seg = (active: boolean) =>
  `px-2.5 py-1.5 text-[11px] border-r border-border last:border-r-0 transition-colors ${
    active
      ? "bg-brand text-white"
      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
  }`;

/**
 * Page header plus the single filter row that sits above every chart.
 * State lives in the URL, so a view is linkable and the server component
 * re-runs real SQL instead of the client filtering an oversized payload.
 */
export default function Filters({
  title,
  range,
  meters,
  meter,
  warnings = [],
  refreshSeconds = 30,
}: {
  title: string;
  range: string;
  meters?: string[];
  meter?: string;
  /** Requests that were ignored, e.g. ?range=bogus — never fail silently. */
  warnings?: string[];
  refreshSeconds?: number;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [now, setNow] = useState("");
  const [busy, setBusy] = useState(false);

  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) p.set(k, v);
    return `${path}?${p.toString()}`;
  };

  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour12: false,
        }),
      );
    tick();
    const clock = setInterval(tick, 1000);
    // Refresh the server component: one pass re-runs every query on the page.
    const refresh = setInterval(() => {
      setBusy(true);
      router.refresh();
      setTimeout(() => setBusy(false), 900);
    }, refreshSeconds * 1000);
    return () => {
      clearInterval(clock);
      clearInterval(refresh);
    };
  }, [router, refreshSeconds]);

  return (
    <div className="sticky top-0 z-10 bg-secondary pt-4 pb-3 mb-3 border-b border-border">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-[16px] font-medium tracking-wide">{title}</h1>
        <span className="text-[10.5px] text-muted-foreground tnum inline-flex items-center gap-1.5">
          <RefreshCw
            size={11}
            strokeWidth={2}
            className={busy ? "animate-spin" : ""}
            style={{ color: busy ? "var(--brand)" : "var(--good)" }}
          />
          {now} IST · auto {refreshSeconds}s
        </span>
      </div>

      <div className="mt-2.5 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Range</span>
          <div className="flex border border-border rounded-sm overflow-hidden bg-card">
            {RANGE_KEYS.map((k) => (
              <a key={k} href={href({ range: k })} className={seg(range === k)}>
                {RANGE_LABEL[k]}
              </a>
            ))}
          </div>
        </div>

        {meters && meters.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Meter</span>
            <div className="flex border border-border rounded-sm overflow-hidden bg-card">
              {meters.map((m) => (
                <a key={m} href={href({ meter: m })} className={seg(meter === m)}>
                  {m}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {warnings.length > 0 && (
        <p className="mt-2 text-[10.5px] text-bad" role="status">
          {warnings.join(" · ")}
        </p>
      )}
    </div>
  );
}
