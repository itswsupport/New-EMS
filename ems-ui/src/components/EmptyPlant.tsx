import Link from "next/link";
import { Panel } from "@/components/Panel";

/**
 * Shown on a per-plant page when the selected plant has no meters in the
 * registry yet (every placeholder plant, until its meters are added). Keeps the
 * page clean instead of interpolating a missing incomer id into the copy.
 */
export default function EmptyPlant({ plantName }: { plantName?: string }) {
  const who = plantName ? plantName : "This plant";
  return (
    <div className="grid grid-cols-12 gap-3 pb-4">
      <Panel title="No meters configured yet" span="col-span-12">
        <div className="py-8 text-center">
          <p className="text-[13px] text-foreground">
            {who} has no meters in its registry yet.
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-[11.5px] leading-relaxed text-muted-foreground">
            Add meters to this plant in the{" "}
            <Link href="/topology" className="text-brand underline">
              Device Tree
            </Link>
            . Once a meter is added and this plant&apos;s edge poller is polling it, its
            readings appear here.
          </p>
        </div>
      </Panel>
    </div>
  );
}
