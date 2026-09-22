/**
 * Route-level loading UI. Every page here is a dynamic server component that
 * fetches on request (~3–4 s), and without a boundary the content area sat blank
 * on each navigation/refresh. This Suspense fallback mirrors the shared layout —
 * sticky header, a stat-tile row, a panel grid — so a switch feels instant while
 * the real data streams in. The persistent Sidebar is in the layout and stays.
 */
const Bar = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse rounded bg-black/[0.07] ${className}`} />
);

function TileSkeleton() {
  return (
    <div className="col-span-12 rounded-lg border border-border bg-card p-4 sm:col-span-6 xl:col-span-3">
      <Bar className="h-2.5 w-24" />
      <Bar className="mt-3 h-8 w-28" />
      <Bar className="mt-3 h-2 w-32" />
    </div>
  );
}

function PanelSkeleton({ span, bodyH }: { span: string; bodyH: string }) {
  return (
    <div className={`${span} rounded-lg border border-border bg-card p-4`}>
      <Bar className="h-2.5 w-40" />
      <Bar className={`mt-3 w-full ${bodyH}`} />
    </div>
  );
}

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      {/* Header — mirrors the sticky Filters bar (title + range/meter controls). */}
      <div className="sticky top-0 z-10 mb-3 border-b border-border bg-secondary pb-3 pt-4">
        <Bar className="h-4 w-44" />
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Bar className="h-7 w-56" />
          <Bar className="h-7 w-40" />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3 pb-4">
        <TileSkeleton />
        <TileSkeleton />
        <TileSkeleton />
        <TileSkeleton />
        <PanelSkeleton span="col-span-12 lg:col-span-4" bodyH="h-40" />
        <PanelSkeleton span="col-span-12 lg:col-span-8" bodyH="h-40" />
        <PanelSkeleton span="col-span-12" bodyH="h-52" />
      </div>
    </div>
  );
}
