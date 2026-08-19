/** Display helpers. Every number on screen goes through one of these. */

const IST = "Asia/Kolkata";

export function fmt(n: number | null, decimals = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** kW that becomes MW past 1000, the way the Grafana kwatt unit behaves. */
export function power(kw: number | null): { value: string; unit: string } {
  if (kw === null || !Number.isFinite(kw)) return { value: "—", unit: "kW" };
  return Math.abs(kw) >= 1000
    ? { value: fmt(kw / 1000, 2), unit: "MW" }
    : { value: fmt(kw, 1), unit: "kW" };
}

export function energy(kwh: number | null): { value: string; unit: string } {
  if (kwh === null || !Number.isFinite(kwh)) return { value: "—", unit: "kWh" };
  return Math.abs(kwh) >= 1000
    ? { value: fmt(kwh / 1000, 2), unit: "MWh" }
    : { value: fmt(kwh, 0), unit: "kWh" };
}

/** Indian grouping, no decimals — 1,23,456 not 123,456. */
export function rupees(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return "₹" + Math.round(v).toLocaleString("en-IN");
}

export function istTime(d: Date | string): string {
  return new Date(d).toLocaleTimeString("en-IN", {
    timeZone: IST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function istDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-IN", {
    timeZone: IST,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Three meters, three fixed slots. Colour follows the meter, never its rank. */
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500"] as const;

export function seriesColor(name: string, allNames: string[]): string {
  const i = allNames.indexOf(name);
  return SERIES[(i < 0 ? 0 : i) % SERIES.length];
}

export const SERIES_SLOTS = SERIES;
