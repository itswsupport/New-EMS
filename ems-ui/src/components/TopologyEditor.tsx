"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addNode,
  hideDevice,
  removeOverride,
  renameDevice,
  resetOverrides,
  setParent,
} from "@/lib/topology-actions";
import type { ActionResult, ManagedDevice } from "@/lib/topology";

/**
 * Edits the meter hierarchy (parent/child, rename→label, hide, add virtual /
 * adopt orphan). Every change calls a server action that validates against the
 * whole tree (no cycles) before writing the Postgres overlay; on success the
 * page refreshes so the rollups + sidebar reflect the new hierarchy.
 */
export default function TopologyEditor({
  devices,
  orphans,
}: {
  devices: ManagedDevice[];
  orphans: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [newId, setNewId] = useState("");
  const [newParent, setNewParent] = useState("");
  const [adoptId, setAdoptId] = useState("");
  const [adoptParent, setAdoptParent] = useState("");

  // Cycle-safe parent options: exclude self and its descendants.
  const childrenOf = new Map<string, string[]>();
  for (const d of devices) {
    if (!d.parentId) continue;
    const list = childrenOf.get(d.parentId) ?? [];
    list.push(d.id);
    childrenOf.set(d.parentId, list);
  }
  const descendants = (id: string): Set<string> => {
    const out = new Set<string>();
    const stack = [...(childrenOf.get(id) ?? [])];
    while (stack.length) {
      const x = stack.pop()!;
      if (out.has(x)) continue;
      out.add(x);
      stack.push(...(childrenOf.get(x) ?? []));
    }
    return out;
  };
  const parentOptions = (self: string) => {
    const banned = descendants(self);
    banned.add(self);
    return devices.filter((d) => !banned.has(d.id));
  };

  const run = (fn: () => Promise<ActionResult>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <div>
      {error && (
        <div className="mb-2 rounded-sm border border-border px-2 py-1 text-[11px] text-bad normal-case">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="table table-bordered table-striped text-[11px]">
          <thead>
            <tr>
              <th className="text-left">Device</th>
              <th className="text-left">Display name</th>
              <th className="text-left">Parent</th>
              <th className="text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id} className={d.hidden ? "opacity-50" : ""}>
                <td className="normal-case">
                  {d.id}
                  {!d.inYaml && (
                    <span className="ml-1 text-[9px] text-muted-foreground">
                      {d.isVirtual ? "VIRTUAL" : "ADOPTED"}
                    </span>
                  )}
                  {d.hidden && <span className="ml-1 text-[9px] text-bad">HIDDEN</span>}
                </td>
                <td className="normal-case">
                  <input
                    defaultValue={d.displayName}
                    onBlur={(e) => {
                      if (e.target.value !== d.displayName) run(() => renameDevice(d.id, e.target.value));
                    }}
                    className="w-full border border-border rounded-sm bg-card px-1.5 py-0.5 text-[11px] normal-case"
                  />
                </td>
                <td>
                  <select
                    value={d.parentId ?? ""}
                    onChange={(e) => run(() => setParent(d.id, e.target.value || null))}
                    className="border border-border rounded-sm bg-card px-1.5 py-0.5 text-[11px]"
                  >
                    <option value="">— none (root) —</option>
                    {parentOptions(d.id).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="normal-case">
                  <button
                    type="button"
                    onClick={() => run(() => hideDevice(d.id, !d.hidden))}
                    className="mr-2 rounded-sm border border-border px-1.5 py-0.5 hover:bg-secondary"
                  >
                    {d.hidden ? "Unhide" : "Hide"}
                  </button>
                  {!d.inYaml && (
                    <button
                      type="button"
                      onClick={() => run(() => removeOverride(d.id))}
                      className="rounded-sm border border-border px-1.5 py-0.5 text-bad hover:bg-secondary"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-5 text-[11px]">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground">Add virtual group</span>
          <div className="flex items-center gap-1.5">
            <input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="name"
              className="border border-border rounded-sm bg-card px-1.5 py-1 text-[11px] normal-case"
            />
            <select
              value={newParent}
              onChange={(e) => setNewParent(e.target.value)}
              className="border border-border rounded-sm bg-card px-1.5 py-1 text-[11px]"
            >
              <option value="">— root —</option>
              {devices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!newId.trim() || pending}
              onClick={() => {
                run(() => addNode(newId, newParent || null, true));
                setNewId("");
              }}
              className="rounded-sm bg-brand px-2.5 py-1 text-white hover:opacity-90 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>

        {orphans.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground">Adopt reporting-but-undeclared meter</span>
            <div className="flex items-center gap-1.5">
              <select
                value={adoptId}
                onChange={(e) => setAdoptId(e.target.value)}
                className="border border-border rounded-sm bg-card px-1.5 py-1 text-[11px]"
              >
                <option value="">— meter —</option>
                {orphans.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <select
                value={adoptParent}
                onChange={(e) => setAdoptParent(e.target.value)}
                className="border border-border rounded-sm bg-card px-1.5 py-1 text-[11px]"
              >
                <option value="">— root —</option>
                {devices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!adoptId || pending}
                onClick={() => {
                  run(() => addNode(adoptId, adoptParent || null, false));
                  setAdoptId("");
                }}
                className="rounded-sm bg-brand px-2.5 py-1 text-white hover:opacity-90 disabled:opacity-40"
              >
                Adopt
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            if (window.confirm("Clear all topology overrides and revert to devices.yaml?")) {
              run(() => resetOverrides());
            }
          }}
          className="ml-auto rounded-sm border border-border px-2.5 py-1 hover:bg-secondary"
        >
          Reset to config
        </button>
      </div>

      {pending && <p className="mt-1 text-[10px] text-muted-foreground">Saving…</p>}
    </div>
  );
}
