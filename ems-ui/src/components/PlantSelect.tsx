"use client";

import { useRouter } from "next/navigation";
import type { PlantInfo } from "@/lib/topology";

// Kept in sync with PLANT_COOKIE in @/lib/plant (that file imports next/headers,
// so a client component can't import it).
const PLANT_COOKIE = "ems_plant";

/**
 * Plant switcher for the sidebar. Selection lives in a cookie (read server-side
 * by every page + the layout); changing it refreshes all server components so
 * the whole dashboard — tree, rollups, tables — re-scopes to the plant. With a
 * single plant it just shows the name.
 */
export default function PlantSelect({ plants, selected }: { plants: PlantInfo[]; selected: string }) {
  const router = useRouter();

  if (plants.length <= 1) {
    return <span className="text-[10px] leading-tight text-white/75">{plants[0]?.name ?? selected}</span>;
  }

  return (
    <select
      value={selected}
      aria-label="Plant"
      onChange={(e) => {
        document.cookie = `${PLANT_COOKIE}=${encodeURIComponent(e.target.value)};path=/;max-age=31536000`;
        router.refresh();
      }}
      className="w-full rounded-sm border border-white/25 bg-white/10 px-1.5 py-1 text-[11px] text-white"
    >
      {plants.map((p) => (
        <option key={p.id} value={p.id} className="text-foreground">
          {p.name}
        </option>
      ))}
    </select>
  );
}
