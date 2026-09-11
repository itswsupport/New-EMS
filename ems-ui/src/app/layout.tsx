import { Suspense } from "react";
import type { Metadata } from "next";
import { Exo } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import MuiProvider from "@/components/MuiProvider";
import type { TreeNode } from "@/components/MeterTree";
import { getTopology } from "@/lib/topology";
import { getSelectedPlant } from "@/lib/plant";
import { q, num } from "@/lib/db";
import "./globals.css";

// Same face, weights and variable name as payroll-ui.
const exo = Exo({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-exo",
});

/** Title follows the selected plant, so it is never pinned to one plant's name. */
export async function generateMetadata(): Promise<Metadata> {
  const { config } = await getSelectedPlant();
  const tenant = config?.tenantName ?? "Rucha Engineers";
  const title = config?.name ? `EMS — ${tenant}, ${config.name}` : `EMS — ${tenant}`;
  return { title, description: "Energy monitoring for RISH LM1360 meters" };
}

/**
 * The sidebar tree is best-effort. If the register map or the database is
 * unreachable the shell must still render, so the page's own error panel can
 * explain what is wrong rather than the whole layout throwing.
 */
async function loadTree(
  plant: string,
): Promise<{ tree: TreeNode[]; live: Record<string, number | null> }> {
  try {
    const topo = await getTopology(plant);
    const tree: TreeNode[] = topo.nodes.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      depth: n.depth,
      label: n.displayName,
    }));
    let live: Record<string, number | null> = {};
    try {
      const rows = await q(
        `SELECT DISTINCT ON (device_id) device_id, active_power/1000.0 AS kw
           FROM energy_telemetry
          WHERE "timestamp" > now() - interval '60 seconds' AND plant_id = $1
          ORDER BY device_id, "timestamp" DESC`,
        [plant],
      );
      live = Object.fromEntries(rows.map((r) => [String(r.device_id), num(r.kw)]));
    } catch {
      /* a tree without live values is still useful */
    }
    return { tree, live };
  } catch {
    return { tree: [], live: {} };
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { plant, plants, config } = await getSelectedPlant();
  const { tree, live } = await loadTree(plant);
  const tenantName = config?.tenantName ?? "Rucha Engineers";

  return (
    <html lang="en" className={exo.variable}>
      <body className={`${exo.className} antialiased flex h-screen overflow-hidden`}>
        <MuiProvider>
          <Suspense fallback={<aside className="w-[190px] shrink-0 bg-sidebar" />}>
            <Sidebar
              tree={tree}
              live={live}
              plants={plants}
              selectedPlant={plant}
              tenantName={tenantName}
            />
          </Suspense>
          <main className="flex-1 overflow-y-auto bg-secondary">
            <div className="mx-auto max-w-[1680px] px-5 pb-14">{children}</div>
          </main>
        </MuiProvider>
      </body>
    </html>
  );
}
