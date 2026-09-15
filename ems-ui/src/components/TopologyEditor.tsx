"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addDevice,
  addNode,
  hideDevice,
  removeDevice,
  renameDevice,
  setArea,
  setParent,
} from "@/lib/topology-actions";
import type { ActionResult, ManagedDevice } from "@/lib/topology";
import { BYTE_ORDERS, DATATYPES, METRICS, STANDARD_METRICS } from "@/lib/metrics";

/**
 * Edits one plant's meter hierarchy in the DB `device` registry: re-parent,
 * rename, hide, set area, add a virtual group, adopt an orphan, and add a REAL
 * pollable meter (slave + register map). Every change validates the plant's
 * whole tree before writing; on success the page refreshes.
 */

type RegRow = { metric: string; address: string; datatype: string; quantity: string; scale: string };

const blankRow = (metric = ""): RegRow => ({
  metric,
  address: "",
  datatype: "float32",
  quantity: "",
  scale: "",
});

export default function TopologyEditor({
  plant,
  devices,
  orphans,
}: {
  plant: string;
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

  // Add/Edit-meter form. editingId != null means we're editing that meter
  // (device id locked, saved via the same upsert).
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mId, setMId] = useState("");
  const [mName, setMName] = useState("");
  const [mSlave, setMSlave] = useState("");
  const [mArea, setMArea] = useState("");
  const [mParent, setMParent] = useState("");
  const [mByteOrder, setMByteOrder] = useState<string>("ABCD");
  const [regs, setRegs] = useState<RegRow[]>([]);

  const areas = useMemo(
    () => [...new Set(devices.map((d) => d.area).filter((a): a is string => !!a))].sort(),
    [devices],
  );

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

  const run = (fn: () => Promise<ActionResult>, after?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else {
        after?.();
        router.refresh();
      }
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setMId("");
    setMName("");
    setMSlave("");
    setMArea("");
    setMParent("");
    setMByteOrder("ABCD");
    setRegs([]);
  };

  const submitMeter = () => {
    run(
      () =>
        addDevice(plant, {
          deviceId: mId,
          displayName: mName,
          slave: Number(mSlave),
          parentId: mParent || null,
          area: mArea || null,
          byteOrder: mByteOrder,
          registers: regs,
        }),
      () => {
        resetForm();
        setShowAdd(false);
      },
    );
  };

  /** Load an existing meter into the form for editing (saved via the upsert). */
  const startEdit = (d: ManagedDevice) => {
    setError(null);
    setEditingId(d.id);
    setMId(d.id);
    setMName(d.displayName === d.id ? "" : d.displayName);
    setMSlave(d.slave != null ? String(d.slave) : "");
    setMArea(d.area ?? "");
    setMParent(d.parentId ?? "");
    setMByteOrder(d.byteOrder ?? "ABCD");
    setRegs(
      d.registers.map((r) => ({
        metric: r.metric,
        address: String(r.address),
        datatype: r.datatype,
        quantity: r.quantity != null ? String(r.quantity) : "",
        scale: String(r.scale),
      })),
    );
    setShowAdd(true);
  };

  const updateRow = (i: number, field: keyof RegRow, val: string) =>
    setRegs((rs) => rs.map((r, k) => (k === i ? { ...r, [field]: val } : r)));

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
              <th className="text-left">Area</th>
              <th className="text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id} className={d.hidden ? "opacity-50" : ""}>
                <td className="normal-case">
                  {d.id}
                  {d.slave !== null && (
                    <span className="ml-1 text-[9px] text-muted-foreground">s{d.slave}</span>
                  )}
                  {d.isVirtual && <span className="ml-1 text-[9px] text-muted-foreground">VIRTUAL</span>}
                  {d.hidden && <span className="ml-1 text-[9px] text-bad">HIDDEN</span>}
                </td>
                <td className="normal-case">
                  <input
                    defaultValue={d.displayName}
                    onBlur={(e) => {
                      if (e.target.value !== d.displayName)
                        run(() => renameDevice(plant, d.id, e.target.value));
                    }}
                    className="w-full border border-border rounded-sm bg-card px-1.5 py-0.5 text-[11px] normal-case"
                  />
                </td>
                <td>
                  <select
                    value={d.parentId ?? ""}
                    onChange={(e) => run(() => setParent(plant, d.id, e.target.value || null))}
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
                  <input
                    defaultValue={d.area ?? ""}
                    list="ems-areas"
                    placeholder="—"
                    onBlur={(e) => {
                      if ((e.target.value || null) !== (d.area ?? null))
                        run(() => setArea(plant, d.id, e.target.value || null));
                    }}
                    className="w-[110px] border border-border rounded-sm bg-card px-1.5 py-0.5 text-[11px] normal-case"
                  />
                </td>
                <td className="normal-case">
                  {!d.isVirtual && d.slave !== null && (
                    <button
                      type="button"
                      onClick={() => startEdit(d)}
                      className="mr-2 rounded-sm border border-border px-1.5 py-0.5 hover:bg-secondary"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => run(() => hideDevice(plant, d.id, !d.hidden))}
                    className="mr-2 rounded-sm border border-border px-1.5 py-0.5 hover:bg-secondary"
                  >
                    {d.hidden ? "Unhide" : "Hide"}
                  </button>
                  {d.isVirtual && (
                    <button
                      type="button"
                      onClick={() => run(() => removeDevice(plant, d.id))}
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

      {/* Shared area suggestions for every area input on the page. */}
      <datalist id="ems-areas">
        {areas.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>

      {/* ---- Add a real meter ------------------------------------------------ */}
      <div className="mt-4 rounded-sm border border-border">
        <button
          type="button"
          onClick={() => {
            setShowAdd((s) => !s);
            setError(null);
          }}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-[12px] font-medium hover:bg-secondary"
        >
          <span>
            {editingId
              ? `Editing meter: ${editingId}`
              : "+ Add meter (physical device with a register map)"}
          </span>
          <span className="text-muted-foreground">{showAdd ? "▲" : "▼"}</span>
        </button>

        {showAdd && (
          <div className="border-t border-border p-3">
            <div className="flex flex-wrap items-end gap-3 text-[11px]">
              <Field label={editingId ? "Device id (locked)" : "Device id (unique)"}>
                <input
                  value={mId}
                  onChange={(e) => setMId(e.target.value)}
                  readOnly={!!editingId}
                  placeholder="e.g. meter12"
                  className={`w-[120px] rounded-sm border border-border px-1.5 py-1 text-[11px] normal-case ${
                    editingId ? "bg-secondary text-muted-foreground" : "bg-card"
                  }`}
                />
              </Field>
              <Field label="Display name">
                <input
                  value={mName}
                  onChange={(e) => setMName(e.target.value)}
                  placeholder="optional"
                  className="w-[140px] border border-border rounded-sm bg-card px-1.5 py-1 text-[11px] normal-case"
                />
              </Field>
              <Field label="Slave (1–247)">
                <input
                  value={mSlave}
                  onChange={(e) => setMSlave(e.target.value)}
                  inputMode="numeric"
                  placeholder="e.g. 12"
                  className="w-[80px] border border-border rounded-sm bg-card px-1.5 py-1 text-[11px]"
                />
              </Field>
              <Field label="Parent">
                <select
                  value={mParent}
                  onChange={(e) => setMParent(e.target.value)}
                  className="border border-border rounded-sm bg-card px-1.5 py-1 text-[11px]"
                >
                  <option value="">— root (incomer) —</option>
                  {devices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Area">
                <input
                  value={mArea}
                  onChange={(e) => setMArea(e.target.value)}
                  list="ems-areas"
                  placeholder="e.g. Utility"
                  className="w-[120px] border border-border rounded-sm bg-card px-1.5 py-1 text-[11px] normal-case"
                />
              </Field>
              <Field label="Byte order">
                <select
                  value={mByteOrder}
                  onChange={(e) => setMByteOrder(e.target.value)}
                  className="border border-border rounded-sm bg-card px-1.5 py-1 text-[11px]"
                >
                  {BYTE_ORDERS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                  Register map — metric → Modbus address (differs per meter brand)
                </span>
                <button
                  type="button"
                  onClick={() => setRegs(STANDARD_METRICS.map((m) => blankRow(m)))}
                  className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] hover:bg-secondary"
                >
                  Load standard metrics
                </button>
                <button
                  type="button"
                  onClick={() => setRegs((rs) => [...rs, blankRow()])}
                  className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] hover:bg-secondary"
                >
                  + Row
                </button>
              </div>

              {regs.length === 0 ? (
                <p className="text-[10.5px] text-muted-foreground">
                  No registers yet — “Load standard metrics” for the common set, or “+ Row”.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-bordered text-[11px]">
                    <thead>
                      <tr>
                        <th className="text-left">Metric</th>
                        <th className="text-left">Address</th>
                        <th className="text-left">Datatype</th>
                        <th className="text-left">Qty</th>
                        <th className="text-left">Scale</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {regs.map((r, i) => (
                        <tr key={i}>
                          <td className="normal-case">
                            <input
                              value={r.metric}
                              list="ems-metrics"
                              onChange={(e) => updateRow(i, "metric", e.target.value)}
                              className="w-[150px] border border-border rounded-sm bg-card px-1.5 py-0.5 text-[11px] normal-case"
                            />
                          </td>
                          <td>
                            <input
                              value={r.address}
                              inputMode="numeric"
                              onChange={(e) => updateRow(i, "address", e.target.value)}
                              className="w-[70px] border border-border rounded-sm bg-card px-1.5 py-0.5 text-[11px]"
                            />
                          </td>
                          <td>
                            <select
                              value={r.datatype}
                              onChange={(e) => updateRow(i, "datatype", e.target.value)}
                              className="border border-border rounded-sm bg-card px-1 py-0.5 text-[11px]"
                            >
                              {DATATYPES.map((d) => (
                                <option key={d} value={d}>
                                  {d}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              value={r.quantity}
                              inputMode="numeric"
                              placeholder="auto"
                              onChange={(e) => updateRow(i, "quantity", e.target.value)}
                              className="w-[52px] border border-border rounded-sm bg-card px-1.5 py-0.5 text-[11px]"
                            />
                          </td>
                          <td>
                            <input
                              value={r.scale}
                              inputMode="decimal"
                              placeholder="1"
                              onChange={(e) => updateRow(i, "scale", e.target.value)}
                              className="w-[64px] border border-border rounded-sm bg-card px-1.5 py-0.5 text-[11px]"
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => setRegs((rs) => rs.filter((_, k) => k !== i))}
                              className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-bad hover:bg-secondary"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={!mId.trim() || !mSlave.trim() || regs.length === 0 || pending}
                onClick={submitMeter}
                className="rounded-sm bg-brand px-3 py-1 text-[11px] text-white hover:opacity-90 disabled:opacity-40"
              >
                {editingId ? "Save changes" : "Add meter"}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    resetForm();
                    setShowAdd(false);
                  }}
                  className="rounded-sm border border-border px-3 py-1 text-[11px] hover:bg-secondary"
                >
                  Cancel
                </button>
              )}
              <span className="text-[10px] text-muted-foreground">
                {editingId
                  ? "Changes to slave / registers take effect after the plant's edge poller restarts."
                  : "Polled after this plant's edge poller restarts."}
              </span>
            </div>
          </div>
        )}
      </div>

      <datalist id="ems-metrics">
        {METRICS.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      {/* ---- Grouping + adopt ------------------------------------------------ */}
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
                run(() => addNode(plant, newId, newParent || null, true));
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
                  run(() => addNode(plant, adoptId, adoptParent || null, false));
                  setAdoptId("");
                }}
                className="rounded-sm bg-brand px-2.5 py-1 text-white hover:opacity-90 disabled:opacity-40"
              >
                Adopt
              </button>
            </div>
          </div>
        )}
      </div>

      {pending && <p className="mt-1 text-[10px] text-muted-foreground">Saving…</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
