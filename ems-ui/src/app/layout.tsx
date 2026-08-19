import { Suspense } from "react";
import type { Metadata } from "next";
import { Exo } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import type { TreeNode } from "@/components/MeterTree";
import { getTopology } from "@/lib/topology";
import { q, num } from "@/lib/db";
import "./globals.css";

// Same face, weights and variable name as payroll-ui.
const exo = Exo({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-exo",
});

export const metadata: Metadata = {
  title: "EMS — Rucha Engineers, plant01",
  description: "Energy monitoring for RISH LM1360 meters",
};

/**
 * The sidebar tree is best-effort. If the register map or the database is
 * unreachable the shell must still render, so the page's own error panel can
 * explain what is wrong rather than the whole layout throwing.
 */
async function loadTree(): Promise<{
  tree: TreeNode[];
  live: Record<string, number | null>;
  plant?: string;
}> {
  try {
    const topo = await getTopology();
    const tree: TreeNode[] = topo.nodes.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      depth: n.depth,
    }));
    let live: Record<string, number | null> = {};
    try {
      const rows = await q(
        `SELECT DISTINCT ON (device_id) device_id, active_power/1000.0 AS kw
           FROM energy_telemetry
          WHERE "timestamp" > now() - interval '60 seconds'
          ORDER BY device_id, "timestamp" DESC`,
      );
      live = Object.fromEntries(rows.map((r) => [String(r.device_id), num(r.kw)]));
    } catch {
      /* a tree without live values is still useful */
    }
    return { tree, live, plant: topo.nodes[0]?.plantId };
  } catch {
    return { tree: [], live: {} };
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { tree, live, plant } = await loadTree();

  return (
    <html lang="en" className={exo.variable}>
      <body className={`${exo.className} antialiased flex h-screen overflow-hidden`}>
        <Suspense fallback={<aside className="w-[190px] shrink-0 bg-sidebar" />}>
          <Sidebar tree={tree} live={live} plant={plant} />
        </Suspense>
        <main className="flex-1 overflow-y-auto bg-secondary">
          <div className="mx-auto max-w-[1680px] px-5 pb-14">{children}</div>
        </main>
      </body>
    </html>
  );
}
