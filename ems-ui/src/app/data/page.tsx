import { redirect } from "next/navigation";
import { getTopology } from "@/lib/topology";
import { isRange } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * `/data` has no meter of its own — the sidebar links here for a stable href,
 * and we forward to the incomer (root) meter so the nav item always resolves.
 */
export default async function DataIndex({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const sp = await searchParams;
  const topo = await getTopology();
  const first = topo.rootIds[0] ?? topo.allIds[0];
  const suffix = isRange(sp.range) ? `?range=${sp.range}` : "";
  redirect(`/data/${first}${suffix}`);
}
