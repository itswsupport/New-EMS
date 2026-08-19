"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, BadgeIndianRupee, Gauge, LayoutGrid, Network, Zap } from "lucide-react";
import MeterTree, { type TreeNode } from "./MeterTree";

const LINKS = [
  { href: "/", label: "Plant Rollup", Icon: Activity },
  { href: "/cost", label: "Cost & Demand", Icon: BadgeIndianRupee },
  { href: "/power-quality", label: "Power Quality", Icon: Gauge },
  { href: "/overview", label: "Overview", Icon: LayoutGrid },
  { href: "/topology", label: "Topology", Icon: Network },
];

export default function Sidebar({
  tree = [],
  live = {},
  plant,
}: {
  tree?: TreeNode[];
  live?: Record<string, number | null>;
  plant?: string;
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
        <p className="mt-1 text-[10px] leading-tight text-white/75">
          Rucha Engineers
          <br />
          {plant ?? "plant01"}
        </p>
      </div>

      <nav className="py-2">
        {LINKS.map(({ href, label, Icon }) => {
          const active = path === href;
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
