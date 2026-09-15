import { redirect } from "next/navigation";
import Filters from "@/components/Filters";
import EmptyPlant from "@/components/EmptyPlant";
import { getTopology } from "@/lib/topology";
import { getSelectedPlant } from "@/lib/plant";
import { isRange } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * `/data` has no meter of its own — the sidebar links here for a stable href,
 * and we forward to the incomer (root) meter so the nav item always resolves.
 * A plant with no meters has nothing to forward to, so it shows the empty state.
 */
export default async function DataIndex({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const sp = await searchParams;
  const { plant, config } = await getSelectedPlant();
  const topo = await getTopology(plant);
  const first = topo.rootIds[0] ?? topo.allIds[0];

  if (!first) {
    return (
      <>
        <Filters title="Data Table" range={isRange(sp.range) ? sp.range : "24h"} />
        <EmptyPlant plantName={config?.name} />
      </>
    );
  }

  const suffix = isRange(sp.range) ? `?range=${sp.range}` : "";
  redirect(`/data/${first}${suffix}`);
}
