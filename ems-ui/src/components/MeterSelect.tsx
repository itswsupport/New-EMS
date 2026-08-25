"use client";

import { useRouter } from "next/navigation";

/**
 * Meter dropdown that navigates by PATH (e.g. /data/meter07). Used where the
 * meter lives in the route rather than a query param; `range` is preserved.
 */
export default function MeterSelect({
  meters,
  value,
  basePath,
  query,
}: {
  meters: string[];
  value: string;
  basePath: string;
  /** URL query string (window params) to carry across the meter switch. */
  query: string;
}) {
  const router = useRouter();
  return (
    <select
      value={value}
      onChange={(e) => router.push(`${basePath}/${e.target.value}${query ? `?${query}` : ""}`)}
      className="border border-border rounded-sm bg-card px-2 py-1 text-[11px]"
      aria-label="Meter"
    >
      {meters.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}
