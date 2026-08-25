"use server";

import { q } from "./db";
import {
  ensureTopologyTable,
  loadOverlay,
  validateOverlay,
  type ActionResult,
  type TopologyOverride,
} from "./topology";

type Patch = Partial<Omit<TopologyOverride, "deviceId">> & { deviceId: string };

/** The proposed full overlay set = current overlay with one row patched. */
async function withPatch(patch: Patch): Promise<TopologyOverride[]> {
  const map = new Map((await loadOverlay()).map((o) => [o.deviceId, { ...o }]));
  const existing =
    map.get(patch.deviceId) ??
    ({ deviceId: patch.deviceId, parentId: null, displayName: null, hidden: false, isVirtual: false } satisfies TopologyOverride);
  map.set(patch.deviceId, { ...existing, ...patch });
  return [...map.values()];
}

async function upsert(o: TopologyOverride): Promise<void> {
  await ensureTopologyTable();
  await q(
    `INSERT INTO device_topology (device_id, parent_id, display_name, hidden, is_virtual, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (device_id) DO UPDATE SET
       parent_id = EXCLUDED.parent_id,
       display_name = EXCLUDED.display_name,
       hidden = EXCLUDED.hidden,
       is_virtual = EXCLUDED.is_virtual,
       updated_at = now()`,
    [o.deviceId, o.parentId, o.displayName, o.hidden, o.isVirtual],
  );
}

/** Validate the proposed overlay, then persist just the patched row. */
async function applyPatch(patch: Patch): Promise<ActionResult> {
  const proposed = await withPatch(patch);
  const v = validateOverlay(proposed);
  if (!v.ok) return v;
  const row = proposed.find((o) => o.deviceId === patch.deviceId)!;
  await upsert(row);
  return { ok: true };
}

export async function setParent(deviceId: string, parentId: string | null): Promise<ActionResult> {
  if (parentId === deviceId) return { ok: false, error: "A meter cannot be its own parent." };
  return applyPatch({ deviceId, parentId });
}

export async function renameDevice(deviceId: string, label: string): Promise<ActionResult> {
  return applyPatch({ deviceId, displayName: label.trim() || null });
}

export async function hideDevice(deviceId: string, hidden: boolean): Promise<ActionResult> {
  return applyPatch({ deviceId, hidden });
}

/** Adopt an orphan (telemetry id not in the yaml) or add a virtual grouping node. */
export async function addNode(
  deviceId: string,
  parentId: string | null,
  isVirtual: boolean,
): Promise<ActionResult> {
  const id = deviceId.trim();
  if (!id) return { ok: false, error: "A device id is required." };
  if (parentId === id) return { ok: false, error: "A node cannot be its own parent." };
  return applyPatch({ deviceId: id, parentId, isVirtual });
}

/** Delete an overlay row entirely — for virtual/adopted nodes. A yaml device
    reverts to its config; to hide a yaml device use hideDevice instead. */
export async function removeOverride(deviceId: string): Promise<ActionResult> {
  await ensureTopologyTable();
  await q(`DELETE FROM device_topology WHERE device_id = $1`, [deviceId]);
  return { ok: true };
}

export async function resetOverrides(): Promise<ActionResult> {
  await ensureTopologyTable();
  await q(`DELETE FROM device_topology`);
  return { ok: true };
}
