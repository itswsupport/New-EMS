"use server";

import { q } from "./db";
import { deviceRows, validateEntries, type ActionResult, type Entry } from "./topology";
import { buildRegisters, isByteOrder, type RegisterInput } from "./metrics";

/**
 * Topology mutations write directly to the plant-scoped `device` registry
 * (parent/rename/hide/virtual). Every change is validated against the plant's
 * whole tree (no cycles / a root exists) before it is persisted.
 */

type Patch = {
  parentId?: string | null;
  displayName?: string | null;
  hidden?: boolean;
  isVirtual?: boolean;
};

/** The plant's devices as an Entry map with one row patched — for validation. */
async function entriesWithPatch(
  plantId: string,
  deviceId: string,
  patch: Patch,
  tenantId = "unknown",
): Promise<Map<string, Entry>> {
  const rows = await deviceRows(plantId);
  const m = new Map<string, Entry>();
  for (const r of rows) {
    m.set(r.device_id, {
      id: r.device_id,
      parentId: r.parent_id,
      plantId: r.plant_id,
      tenantId: r.tenant_id,
      slave: r.slave,
      registers: [],
      displayName: r.display_name || r.device_id,
      hidden: r.hidden,
      isVirtual: r.is_virtual,
      area: r.area,
    });
  }
  const cur = m.get(deviceId);
  m.set(deviceId, {
    id: deviceId,
    plantId,
    tenantId: cur?.tenantId ?? tenantId,
    slave: cur?.slave ?? null,
    registers: [],
    parentId: "parentId" in patch ? (patch.parentId ?? null) : (cur?.parentId ?? null),
    displayName: "displayName" in patch ? (patch.displayName ?? deviceId) : (cur?.displayName ?? deviceId),
    hidden: "hidden" in patch ? !!patch.hidden : (cur?.hidden ?? false),
    isVirtual: "isVirtual" in patch ? !!patch.isVirtual : (cur?.isVirtual ?? false),
    area: cur?.area ?? null,
  });
  // A parent that no longer resolves (hidden/missing) becomes a root, so only
  // genuine cycles / no-root fail validation.
  const visible = new Map([...m].filter(([, e]) => !e.hidden));
  for (const e of visible.values()) if (e.parentId && !visible.has(e.parentId)) e.parentId = null;
  return visible;
}

export async function setParent(
  plantId: string,
  deviceId: string,
  parentId: string | null,
): Promise<ActionResult> {
  if (parentId === deviceId) return { ok: false, error: "A meter cannot be its own parent." };
  const v = validateEntries(await entriesWithPatch(plantId, deviceId, { parentId }));
  if (!v.ok) return v;
  await q(`UPDATE device SET parent_id = $3, updated_at = now() WHERE plant_id = $1 AND device_id = $2`, [
    plantId,
    deviceId,
    parentId,
  ]);
  return { ok: true };
}

export async function renameDevice(
  plantId: string,
  deviceId: string,
  label: string,
): Promise<ActionResult> {
  await q(`UPDATE device SET display_name = $3, updated_at = now() WHERE plant_id = $1 AND device_id = $2`, [
    plantId,
    deviceId,
    label.trim() || null,
  ]);
  return { ok: true };
}

export async function hideDevice(
  plantId: string,
  deviceId: string,
  hidden: boolean,
): Promise<ActionResult> {
  await q(`UPDATE device SET hidden = $3, updated_at = now() WHERE plant_id = $1 AND device_id = $2`, [
    plantId,
    deviceId,
    hidden,
  ]);
  return { ok: true };
}

/** Adopt an orphan (telemetry id not yet in the registry) or add a virtual node. */
export async function addNode(
  plantId: string,
  deviceId: string,
  parentId: string | null,
  isVirtual: boolean,
): Promise<ActionResult> {
  const id = deviceId.trim();
  if (!id) return { ok: false, error: "A device id is required." };
  if (parentId === id) return { ok: false, error: "A node cannot be its own parent." };

  const [p] = await q<{ tenant_id: string }>(`SELECT tenant_id FROM plant WHERE id = $1`, [plantId]);
  const tenantId = p?.tenant_id ?? "unknown";

  const v = validateEntries(await entriesWithPatch(plantId, id, { parentId, isVirtual }, tenantId));
  if (!v.ok) return v;

  await q(
    `INSERT INTO device (plant_id, device_id, tenant_id, parent_id, is_virtual, registers, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, now(), now())
     ON CONFLICT (plant_id, device_id) DO UPDATE SET
       parent_id = EXCLUDED.parent_id, is_virtual = EXCLUDED.is_virtual, updated_at = now()`,
    [plantId, id, tenantId, parentId, isVirtual],
  );
  return { ok: true };
}

/** Set (or clear) a device's area/zone label. */
export async function setArea(
  plantId: string,
  deviceId: string,
  area: string | null,
): Promise<ActionResult> {
  await q(`UPDATE device SET area = $3, updated_at = now() WHERE plant_id = $1 AND device_id = $2`, [
    plantId,
    deviceId,
    area?.trim() || null,
  ]);
  return { ok: true };
}

/**
 * Add a real, pollable meter: a full registry row with a slave address + a
 * resolved register map (ResolvedRegister[]) the edge poller reads directly.
 * Validates the hierarchy (no cycles) and the register map before writing.
 *
 * NOTE: the plant's edge poller resolves its device set at startup, so a newly
 * added meter is polled only after that plant's poller restarts.
 */
export async function addDevice(
  plantId: string,
  input: {
    deviceId: string;
    displayName?: string;
    slave: number;
    parentId: string | null;
    area?: string | null;
    byteOrder: string;
    registers: RegisterInput[];
  },
): Promise<ActionResult> {
  const id = input.deviceId.trim();
  if (!id) return { ok: false, error: "A device id is required." };
  if (input.parentId === id) return { ok: false, error: "A meter cannot be its own parent." };
  if (!Number.isInteger(input.slave) || input.slave < 1 || input.slave > 247) {
    return { ok: false, error: "Slave address must be a whole number 1–247." };
  }
  const byteOrder = isByteOrder(input.byteOrder) ? input.byteOrder : "ABCD";

  const built = buildRegisters(input.registers, byteOrder);
  if (!built.ok) return built;

  // Reject a slave already used by another device in this plant.
  const clash = await q<{ device_id: string }>(
    `SELECT device_id FROM device WHERE plant_id = $1 AND slave = $2 AND device_id <> $3 LIMIT 1`,
    [plantId, input.slave, id],
  );
  if (clash.length > 0) {
    return { ok: false, error: `Slave ${input.slave} is already used by ${clash[0].device_id}.` };
  }

  const [p] = await q<{ tenant_id: string }>(`SELECT tenant_id FROM plant WHERE id = $1`, [plantId]);
  const tenantId = p?.tenant_id ?? "unknown";

  const v = validateEntries(await entriesWithPatch(plantId, id, { parentId: input.parentId }, tenantId));
  if (!v.ok) return v;

  await q(
    `INSERT INTO device
       (plant_id, device_id, tenant_id, slave, parent_id, display_name, registers, byte_order, area, is_virtual, hidden, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, false, false, now(), now())
     ON CONFLICT (plant_id, device_id) DO UPDATE SET
       slave = EXCLUDED.slave, parent_id = EXCLUDED.parent_id, display_name = EXCLUDED.display_name,
       registers = EXCLUDED.registers, byte_order = EXCLUDED.byte_order, area = EXCLUDED.area,
       is_virtual = false, updated_at = now()`,
    [
      plantId,
      id,
      tenantId,
      input.slave,
      input.parentId,
      input.displayName?.trim() || null,
      JSON.stringify(built.registers),
      byteOrder,
      input.area?.trim() || null,
    ],
  );
  return { ok: true };
}

/** Delete a UI-created virtual node. Real meters are hidden, never deleted
    (a re-import would restore them anyway). */
export async function removeDevice(plantId: string, deviceId: string): Promise<ActionResult> {
  await q(`DELETE FROM device WHERE plant_id = $1 AND device_id = $2 AND is_virtual = true`, [
    plantId,
    deviceId,
  ]);
  return { ok: true };
}
