"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

export type TreeNode = {
  id: string;
  parentId: string | null;
  depth: number;
};

/**
 * Meter hierarchy for the sidebar.
 *
 * Built for 500 nodes even though it renders three today: only roots are expanded
 * by default, expansion is per-node, and the filter narrows to matches plus the
 * ancestors needed to reach them rather than flattening the tree.
 */
export default function MeterTree({
  nodes,
  values,
  unit = "kW",
  selected,
  onSelect,
}: {
  nodes: TreeNode[];
  values?: Record<string, number | null>;
  unit?: string;
  selected?: string;
  onSelect?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const childrenOf = useMemo(() => {
    const m = new Map<string, TreeNode[]>();
    for (const n of nodes) {
      if (!n.parentId) continue;
      const list = m.get(n.parentId) ?? [];
      list.push(n);
      m.set(n.parentId, list);
    }
    return m;
  }, [nodes]);

  const roots = useMemo(() => nodes.filter((n) => !n.parentId), [nodes]);

  // A node survives the filter if it matches, or if one of its descendants does.
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return null;
    const keep = new Set<string>();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const n of nodes) {
      if (!n.id.toLowerCase().includes(term)) continue;
      let cur: TreeNode | undefined = n;
      while (cur) {
        keep.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
    return keep;
  }, [query, nodes]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const render = (node: TreeNode): React.ReactNode => {
    if (visible && !visible.has(node.id)) return null;
    const kids = childrenOf.get(node.id) ?? [];
    // While filtering, force everything on the matching path open.
    const isCollapsed = !visible && collapsed.has(node.id);
    const v = values?.[node.id];

    return (
      <li key={node.id}>
        <div
          className={`flex items-center gap-1 rounded-sm py-1 pr-1 text-[11px] ${
            selected === node.id ? "bg-white/20" : "hover:bg-white/10"
          }`}
          style={{ paddingLeft: 4 + node.depth * 11 }}
        >
          {kids.length > 0 ? (
            <button
              type="button"
              onClick={() => toggle(node.id)}
              aria-label={isCollapsed ? `Expand ${node.id}` : `Collapse ${node.id}`}
              aria-expanded={!isCollapsed}
              className="shrink-0 text-white/70 hover:text-white"
            >
              {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
            </button>
          ) : (
            <span className="w-[11px] shrink-0" />
          )}

          <button
            type="button"
            onClick={() => onSelect?.(node.id)}
            className="flex-1 truncate text-left"
            title={node.parentId ? `Sub-meter of ${node.parentId}` : "Incomer (root)"}
          >
            {node.id}
            {!node.parentId && <span className="ml-1 text-[9px] text-white/60">MAIN</span>}
          </button>

          {v !== undefined && v !== null && (
            <span className="shrink-0 tnum text-[10px] text-white/75">
              {Math.round(v)} {unit}
            </span>
          )}
        </div>

        {kids.length > 0 && !isCollapsed && <ul>{kids.map(render)}</ul>}
      </li>
    );
  };

  return (
    <div className="border-t border-white/20 px-2 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 px-1.5">
        <Search size={11} className="shrink-0 text-white/60" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter meters"
          aria-label="Filter meters"
          className="w-full bg-transparent text-[11px] text-white placeholder:text-white/50 focus:outline-none"
        />
      </div>
      <ul>{roots.map(render)}</ul>
      {visible?.size === 0 && (
        <p className="px-2 py-1 text-[10px] text-white/60">No meter matches.</p>
      )}
    </div>
  );
}
