"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/**
 * Minimal page header for live (non-range) views like Alarms: title, IST clock
 * and the same auto-refresh cadence as the charts, but no range/meter filters —
 * those would imply this data is windowed when it is a current-state snapshot.
 */
export default function LiveHeader({
  title,
  refreshSeconds = 30,
}: {
  title: string;
  refreshSeconds?: number;
}) {
  const router = useRouter();
  const [now, setNow] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const tick = () =>
      setNow(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }));
    tick();
    const clock = setInterval(tick, 1000);
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
    <div className="sticky top-0 z-10 mb-3 border-b border-border bg-secondary pb-3 pt-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-[16px] font-medium tracking-wide">{title}</h1>
        <span className="inline-flex items-center gap-1.5 text-[10.5px] tnum text-muted-foreground">
          <RefreshCw
            size={11}
            strokeWidth={2}
            className={busy ? "animate-spin" : ""}
            style={{ color: busy ? "var(--brand)" : "var(--good)" }}
          />
          {now} IST · auto {refreshSeconds}s
        </span>
      </div>
    </div>
  );
}
