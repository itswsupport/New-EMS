"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, BadgeIndianRupee, Bell, Building2, Gauge, LayoutGrid, Network, Table, Zap } from "lucide-react";
import MeterTree, { type TreeNode } from "./MeterTree";
import PlantSelect from "./PlantSelect";
import type { PlantInfo } from "@/lib/topology";

const LINKS = [
  { href: "/", label: "Plant Rollup", Icon: Activity },
  { href: "/alarms", label: "Alarms", Icon: Bell },
  { href: "/cost", label: "Cost & Demand", Icon: BadgeIndianRupee },
  { href: "/power-quality", label: "Power Quality", Icon: Gauge },
  { href: "/overview", label: "Overview", Icon: LayoutGrid },
  { href: "/topology", label: "Device Tree", Icon: Network },
  { href: "/data", label: "Data Table", Icon: Table },
  { href: "/group", label: "All Plants", Icon: Building2 },
];

export default function Sidebar({
  tree = [],
  live = {},
  plants = [],
  selectedPlant = "",
  tenantName = "Rucha Engineers",
}: {
  tree?: TreeNode[];
  live?: Record<string, number | null>;
  plants?: PlantInfo[];
  selectedPlant?: string;
  tenantName?: string;
}) {
  const path = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const qs = params.toString();
  const selected = params.get("meter") ?? undefined;

  const selectMeter = (id: string) => {
    const p = new URLSearchParams(qs);
    p.set("meter", id);
    router.push(`${path}?${p.toString()}`);
  };

  return (
    <aside
      data-slot="sidebar"
      className="flex w-[190px] shrink-0 flex-col overflow-y-auto bg-sidebar text-sidebar-foreground"
    >
      <div className="border-b border-white/20 px-4 py-4">
        <div className="flex items-center gap-2">
          <Zap size={16} strokeWidth={2.2} />
          <span className="text-[13px] font-medium tracking-wide">EMS</span>
        </div>
        <p className="mt-1 mb-1.5 text-[10px] leading-tight text-white/75">{tenantName}</p>
        <PlantSelect plants={plants} selected={selectedPlant} />
      </div>

      <nav className="py-2">
        {LINKS.map(({ href, label, Icon }) => {
          const active =
            href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={qs ? `${href}?${qs}` : href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 border-l-[3px] py-2.5 pl-[13px] pr-4 text-[12px] font-normal transition-colors ${
                active ? "border-white bg-white/20" : "border-transparent hover:bg-white/10"
              }`}
            >
              <Icon size={14} strokeWidth={2} className="shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {tree.length > 0 && (
        <MeterTree nodes={tree} values={live} selected={selected} onSelect={selectMeter} />
      )}

      <div className="mt-auto border-t border-white/20 px-4 py-3 text-[10px] leading-relaxed text-white/70">
        Modbus via X5050
      </div>
    </aside>
  );
}
