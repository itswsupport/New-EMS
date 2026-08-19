"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Series } from "@/lib/queries";

type Threshold = { value: number; label: string; tone?: "warn" | "crit" | "good" };

/* payroll-ui's chart-1 and chart-2, plus a violet third slot. Its own chart-3
   reads gray on white and chart-4 sits at 1.68:1, so neither can carry a line.
   Assigned in fixed order — colour follows the series, never its rank. */
const SLOTS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];

const PAD = { top: 10, right: 14, bottom: 22, left: 46 };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min || 0];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const first = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = first; v <= max + step * 0.001; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const IST = "Asia/Kolkata";

/** Axis labels carry a date once the window is longer than a day. */
function axisFormatter(times: string[]) {
  if (times.length < 2) return (iso: string) => tOnly(iso);
  const spanH =
    (new Date(times[times.length - 1]).getTime() - new Date(times[0]).getTime()) / 3600_000;
  if (spanH > 168) return (iso: string) => dOnly(iso);
  if (spanH > 24) return (iso: string) => `${dOnly(iso)} ${tOnly(iso)}`;
  return (iso: string) => tOnly(iso);
}

const tOnly = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: IST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const dOnly = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: IST, day: "2-digit", month: "short" });

/** Sub-minute buckets need seconds, or rows look like duplicates. */
function stampFormatter(times: string[]) {
  const stepS =
    times.length > 1
      ? (new Date(times[1]).getTime() - new Date(times[0]).getTime()) / 1000
      : 60;
  return (iso: string) =>
    new Date(iso).toLocaleString("en-IN", {
      timeZone: IST,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      ...(stepS < 60 ? { second: "2-digit" as const } : {}),
      hour12: false,
    });
}

export default function TimeSeries({
  series,
  unit,
  decimals = 1,
  height = 200,
  threshold,
  zeroBased = false,
  statLabel,
  showBand = true,
  id,
}: {
  series: Series[];
  unit: string;
  decimals?: number;
  height?: number;
  threshold?: Threshold;
  zeroBased?: boolean;
  /** e.g. "10-min mean" — says which statistic the line is. */
  statLabel?: string;
  showBand?: boolean;
  id: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(760);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const times = useMemo(() => {
    const longest = series.reduce<Series | null>(
      (a, s) => (!a || s.points.length > a.points.length ? s : a),
      null,
    );
    return longest?.points.map((p) => p.t) ?? [];
  }, [series]);

  const fmtAxis = useMemo(() => axisFormatter(times), [times]);
  const fmtStamp = useMemo(() => stampFormatter(times), [times]);
  const band = showBand && series.length <= 2;

  const { lo, hi } = useMemo(() => {
    const vals: number[] = [];
    for (const s of series)
      for (const p of s.points) {
        for (const c of band ? [p.lo, p.hi, p.v] : [p.v])
          if (c !== null && Number.isFinite(c)) vals.push(c);
      }
    if (threshold) vals.push(threshold.value);
    if (!vals.length) return { lo: 0, hi: 1 };
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (zeroBased) min = Math.min(0, min);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.08;
    return { lo: min - pad, hi: max + pad };
  }, [series, threshold, zeroBased, band]);

  const plotW = Math.max(10, w - PAD.left - PAD.right);
  const plotH = Math.max(10, height - PAD.top - PAD.bottom);
  const x = (i: number) =>
    PAD.left + (times.length <= 1 ? plotW / 2 : (i / (times.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  const ticks = niceTicks(lo, hi, 4);
  const xLabelIdx = times.length
    ? [0, Math.floor(times.length / 3), Math.floor((2 * times.length) / 3), times.length - 1]
        .filter((v, i, a) => a.indexOf(v) === i)
    : [];

  /** Break the path at nulls so a gap reads as missing, not interpolated. */
  const pathFor = (s: Series, key: "v" | "lo" | "hi"): string => {
    let d = "";
    let pen = false;
    s.points.forEach((p, i) => {
      const val = p[key];
      if (val === null || !Number.isFinite(val)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(2)},${y(val).toFixed(2)} `;
      pen = true;
    });
    return d.trim();
  };

  /** Closed polygon between the per-bucket min and max. */
  const bandFor = (s: Series): string => {
    const up: string[] = [];
    const down: string[] = [];
    s.points.forEach((p, i) => {
      if (p.hi === null || p.lo === null) return;
      up.push(`${x(i).toFixed(2)},${y(p.hi).toFixed(2)}`);
      down.unshift(`${x(i).toFixed(2)},${y(p.lo).toFixed(2)}`);
    });
    return up.length ? `M${up.join("L")}L${down.join("L")}Z` : "";
  };

  const fmtV = (v: number | null) =>
    v === null || !Number.isFinite(v)
      ? "—"
      : v.toLocaleString("en-IN", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!times.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - PAD.left) / plotW;
    const i = Math.round(ratio * (times.length - 1));
    setHover(Math.min(times.length - 1, Math.max(0, i)));
  };

  const tone =
    threshold?.tone === "crit"
      ? "var(--bad)"
      : threshold?.tone === "good"
        ? "var(--good)"
        : "var(--warn)";

  const hasData = series.some((s) => s.points.some((p) => p.v !== null));
  const unitSuffix = unit ? ` ${unit}` : "";

  return (
    <>
      <div className="relative w-full" ref={wrap}>
        {!hasData ? (
          <div
            className="grid place-items-center text-[11px] text-muted-foreground"
            style={{ height }}
          >
            No data in range
          </div>
        ) : (
          <svg
            width="100%"
            height={height}
            viewBox={`0 0 ${w} ${height}`}
            role="img"
            aria-labelledby={`${id}-desc`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            className="block touch-none"
          >
            <desc id={`${id}-desc`}>
              {series.map((s) => s.name).join(", ")} over time
              {unit ? `, in ${unit}` : ""}
              {statLabel ? `, shown as ${statLabel} with the min-max range shaded` : ""}
            </desc>

            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={w - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--grid)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={y(t)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill="var(--muted-foreground)"
                  fontSize={10}
                >
                  {fmtV(t)}
                </text>
              </g>
            ))}

            {xLabelIdx.map((i) => (
              <text
                key={i}
                x={x(i)}
                y={height - 6}
                textAnchor={i === 0 ? "start" : i === times.length - 1 ? "end" : "middle"}
                fill="var(--muted-foreground)"
                fontSize={10}
              >
                {fmtAxis(times[i])}
              </text>
            ))}

            {threshold && (
              <>
                <line
                  x1={PAD.left}
                  x2={w - PAD.right}
                  y1={y(threshold.value)}
                  y2={y(threshold.value)}
                  stroke={tone}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                />
                <text
                  x={w - PAD.right}
                  y={y(threshold.value) - 5}
                  textAnchor="end"
                  fill={tone}
                  fontSize={9.5}
                >
                  {threshold.label}
                </text>
              </>
            )}

            {/* Shaded min-max range, so a wide bucket cannot hide its peak. */}
            {band &&
              series.map((s, si) => (
                <path
                  key={`band-${s.name}`}
                  d={bandFor(s)}
                  fill={SLOTS[si % SLOTS.length]}
                  opacity={0.16}
                  stroke="none"
                />
              ))}

            {series.map((s, si) => (
              <path
                key={s.name}
                d={pathFor(s, "v")}
                fill="none"
                stroke={SLOTS[si % SLOTS.length]}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {hover !== null && (
              <>
                <line
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                  stroke="var(--axis)"
                  strokeWidth={1}
                />
                {series.map((s, si) => {
                  const p = s.points[hover];
                  if (!p || p.v === null || !Number.isFinite(p.v)) return null;
                  return (
                    <circle
                      key={s.name}
                      cx={x(hover)}
                      cy={y(p.v)}
                      r={4}
                      fill={SLOTS[si % SLOTS.length]}
                      stroke="var(--card)"
                      strokeWidth={2}
                    />
                  );
                })}
              </>
            )}
          </svg>
        )}

        {hover !== null && hasData && times[hover] && (
          <div
            className="pointer-events-none absolute z-20 rounded-sm border border-border bg-card px-2.5 py-2 text-[11px] tnum shadow-md whitespace-nowrap"
            style={{
              left: Math.min(Math.max(x(hover) + 12, 8), Math.max(8, w - 200)),
              top: 4,
            }}
          >
            <div className="mb-1.5 text-muted-foreground">{fmtStamp(times[hover])} IST</div>
            {series.map((s, si) => {
              const p = s.points[hover];
              return (
                <div className="flex items-center gap-2 text-muted-foreground" key={s.name}>
                  <span
                    className="inline-block h-0.5 w-2.5 rounded-full"
                    style={{ background: SLOTS[si % SLOTS.length] }}
                  />
                  {s.name}
                  <b className="ml-auto pl-3.5 font-medium text-foreground">
                    {fmtV(p?.v ?? null)}
                    {unitSuffix}
                    {band && p?.lo !== null && p?.hi !== null && (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        ({fmtV(p.lo)}–{fmtV(p.hi)})
                      </span>
                    )}
                  </b>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend always present for >= 2 series, with direct values, so identity
          and magnitude never depend on colour alone. `max` is the true peak
          across per-bucket maxima, not the largest bucket mean. */}
      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border pt-2.5">
        {series.map((s, si) => {
          const means = s.points.map((p) => p.v).filter((v): v is number => v !== null);
          const highs = s.points.map((p) => p.hi ?? p.v).filter((v): v is number => v !== null);
          const last = means.length ? means[means.length - 1] : null;
          const peak = highs.length ? Math.max(...highs) : null;
          return (
            <span className="flex items-baseline gap-1.5 text-[11px] tnum" key={s.name}>
              <span
                className="inline-block h-0.5 w-2.5 -translate-y-0.75 rounded-full"
                style={{ background: SLOTS[si % SLOTS.length] }}
              />
              <span className="text-muted-foreground">{s.name}</span>
              <span className="font-medium text-foreground">
                {fmtV(last)}
                {unitSuffix}
              </span>
              <span className="text-muted-foreground">peak {fmtV(peak)}</span>
            </span>
          );
        })}
        {statLabel && (
          <span className="text-[10px] text-muted-foreground">
            {statLabel}
            {band ? " · band = min–max" : ""}
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
          className="ml-auto rounded-sm border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary"
        >
          {showTable ? "Hide table" : "Table"}
        </button>
      </div>

      {showTable && (
        <div className="mt-2.5 max-h-80 overflow-auto">
          <table className="table table-bordered table-striped text-[11px] tnum">
            <thead>
              <tr>
                <th scope="col" className="text-left">
                  Time (IST)
                </th>
                {series.map((s) => (
                  <th scope="col" className="text-right" key={s.name}>
                    {unit ? `${s.name} (${unit})` : s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {times.map((t, i) => (
                <tr key={t}>
                  <td>{fmtStamp(t)}</td>
                  {series.map((s) => (
                    <td className="text-right" key={s.name}>
                      {fmtV(s.points[i]?.v ?? null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
