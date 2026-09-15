import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { q } from "./db";

/**
 * The ONLY module that knows how meter topology is stored.
 *
 * The source of truth is now the Postgres `device` registry (per-plant rows:
 * parent/rename/hide/virtual + the register map), seeded from devices.yaml by
 * the edge platform's import-devices script. If the registry is empty or the DB
 * is unreachable, we fall back to parsing devices.yaml so the dashboard still
 * renders (single-plant, pre-registry behaviour).
 *
 * A meter with no `parent` is a ROOT: the utility incomer. Its reading already
 * contains everything downstream, which is why plant totals sum roots only.
 */

export type RegisterDef = { name: string; address: number; scale?: number };

export type MeterNode = {
  id: string;
  displayName: string;
  plantId: string;
  tenantId: string;
  parentId: string | null;
  /** Root-first chain including this node. */
  path: string[];
  depth: number;
  slave: number | null;
  registers: RegisterDef[];
  isVirtual: boolean;
  /** Free-text area/zone within the plant (null = unassigned). */
  area: string | null;
};

export type Topology = {
  nodes: MeterNode[];
  byId: Map<string, MeterNode>;
  roots: MeterNode[];
  rootIds: string[];
  allIds: string[];
  parentOf(id: string): MeterNode | null;
  childrenOf(id: string): MeterNode[];
  descendantsOf(id: string): MeterNode[];
  subtreeIds(id: string): string[];
  isRoot(id: string): boolean;
};

/**
 * One plant in the registry — the plant selector's source AND the carrier of
 * that plant's commercial config (tariff/contract/demand block/timezone), so
 * nothing downstream has to hardcode a rate or a single plant's numbers.
 */
export type PlantInfo = {
  id: string;
  name: string;
  tenantId: string;
  tenantName: string;
  timezone: string;
  tariffKvah: number;
  contractKva: number;
  demandBlockMin: number;
};

/** Fallback commercial config, used only when the DB value is null or we are on
    the yaml fallback. Real values live in the `plant` table, per plant. */
export const PLANT_DEFAULTS = {
  timezone: "Asia/Kolkata",
  tariffKvah: 10.5,
  contractKva: 300,
  demandBlockMin: 30,
} as const;

export type ManagedDevice = {
  id: string;
  displayName: string;
  parentId: string | null;
  hidden: boolean;
  isVirtual: boolean;
  plantId: string;
  slave: number | null;
  area: string | null;
  byteOrder: string | null;
  registers: EditableRegister[];
};

export type ActionResult = { ok: true } | { ok: false; error: string };

export class TopologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopologyError";
  }
}

/** A device before the tree is built. */
export type Entry = {
  id: string;
  parentId: string | null;
  plantId: string;
  tenantId: string;
  slave: number | null;
  registers: RegisterDef[];
  displayName: string;
  hidden: boolean;
  isVirtual: boolean;
  area: string | null;
};

/* ---- DB registry (source of truth) ---------------------------------------- */

type DeviceRow = {
  plant_id: string;
  device_id: string;
  tenant_id: string;
  slave: number | null;
  parent_id: string | null;
  display_name: string | null;
  registers: unknown;
  hidden: boolean;
  is_virtual: boolean;
  area: string | null;
  byte_order: string | null;
};

function registersFromJson(j: unknown): RegisterDef[] {
  if (!Array.isArray(j)) return [];
  return (j as Array<Record<string, unknown>>)
    .map((x) => ({
      name: String(x.metric ?? x.name ?? ""),
      address: typeof x.address === "number" ? x.address : -1,
      scale: typeof x.scale === "number" && x.scale !== 1 ? x.scale : undefined,
    }))
    .filter((r) => r.name && r.address >= 0)
    .sort((a, b) => a.address - b.address);
}

/** Full register fields (metric/address/datatype/quantity/scale) for the edit form. */
export type EditableRegister = {
  metric: string;
  address: number;
  datatype: string;
  quantity: number | null;
  scale: number;
};

function registersForEdit(j: unknown): EditableRegister[] {
  if (!Array.isArray(j)) return [];
  return (j as Array<Record<string, unknown>>)
    .map((x) => ({
      metric: String(x.metric ?? x.name ?? ""),
      address: typeof x.address === "number" ? x.address : -1,
      datatype: typeof x.datatype === "string" ? x.datatype : "float32",
      quantity: typeof x.quantity === "number" ? x.quantity : null,
      scale: typeof x.scale === "number" ? x.scale : 1,
    }))
    .filter((r) => r.metric && r.address >= 0)
    .sort((a, b) => a.address - b.address);
}

function rowToEntry(r: DeviceRow): Entry {
  return {
    id: r.device_id,
    parentId: r.parent_id,
    plantId: r.plant_id,
    tenantId: r.tenant_id,
    slave: r.slave,
    registers: registersFromJson(r.registers),
    displayName: r.display_name || r.device_id,
    hidden: r.hidden,
    isVirtual: r.is_virtual,
    area: r.area,
  };
}

/** Read device rows from the registry, optionally scoped to one plant. */
export async function deviceRows(plantId?: string): Promise<DeviceRow[]> {
  const cols =
    "plant_id, device_id, tenant_id, slave, parent_id, display_name, registers, hidden, is_virtual, area, byte_order";
  return plantId
    ? q<DeviceRow>(`SELECT ${cols} FROM device WHERE plant_id = $1 ORDER BY device_id`, [plantId])
    : q<DeviceRow>(`SELECT ${cols} FROM device ORDER BY plant_id, device_id`);
}

/* ---- Tree building + validation ------------------------------------------- */

function buildTopology(entries: Map<string, Entry>): Topology {
  if (entries.size === 0) throw new TopologyError("No devices in the topology.");

  for (const [id, e] of entries) {
    if (e.parentId !== null && !entries.has(e.parentId)) {
      throw new TopologyError(`Device "${id}" names parent "${e.parentId}", which is not defined.`);
    }
  }

  const pathOf = (id: string): string[] => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur: string | null = id;
    while (cur !== null) {
      if (seen.has(cur)) {
        throw new TopologyError(
          `Cycle in meter hierarchy: ${[...seen, cur].join(" -> ")}. A meter cannot be its own ancestor.`,
        );
      }
      seen.add(cur);
      chain.unshift(cur);
      cur = entries.get(cur)?.parentId ?? null;
    }
    return chain;
  };

  const nodes: MeterNode[] = [...entries.keys()].map((id) => {
    const path = pathOf(id);
    const e = entries.get(id)!;
    return {
      id,
      displayName: e.displayName,
      plantId: e.plantId,
      tenantId: e.tenantId,
      parentId: e.parentId,
      path,
      depth: path.length - 1,
      slave: e.slave,
      registers: e.registers,
      isVirtual: e.isVirtual,
      area: e.area,
    };
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, MeterNode[]>();
  for (const n of nodes) {
    if (n.parentId) {
      const list = children.get(n.parentId) ?? [];
      list.push(n);
      children.set(n.parentId, list);
    }
  }
  for (const list of children.values()) list.sort((a, b) => a.id.localeCompare(b.id));

  const roots = nodes.filter((n) => n.parentId === null).sort((a, b) => a.id.localeCompare(b.id));
  if (roots.length === 0) {
    throw new TopologyError("No root meter: every device names a parent, so there is no incomer.");
  }

  const childrenOf = (id: string) => children.get(id) ?? [];
  const descendantsOf = (id: string): MeterNode[] => {
    const out: MeterNode[] = [];
    const stack = [...childrenOf(id)];
    while (stack.length) {
      const n = stack.pop()!;
      out.push(n);
      stack.push(...childrenOf(n.id));
    }
    return out;
  };

  return {
    nodes,
    byId,
    roots,
    rootIds: roots.map((n) => n.id),
    allIds: nodes.map((n) => n.id),
    parentOf: (id) => (byId.get(id)?.parentId ? byId.get(byId.get(id)!.parentId!) ?? null : null),
    childrenOf,
    descendantsOf,
    subtreeIds: (id) => [id, ...descendantsOf(id).map((n) => n.id)],
    isRoot: (id) => byId.get(id)?.parentId === null,
  };
}

/** Validate a proposed entry set (used by the editor before it writes). */
export function validateEntries(entries: Map<string, Entry>): ActionResult {
  try {
    buildTopology(entries);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ---- devices.yaml fallback (pre-registry / DB down) ----------------------- */

type RawDevice = {
  id?: unknown;
  parent?: unknown;
  plant?: unknown;
  tenant?: unknown;
  slave?: unknown;
  registers?: unknown;
};

function yamlPath(): string {
  return resolve(process.env.DEVICES_YAML ?? "../ems-edge-platform/config/devices.yaml");
}

function readYamlRegisters(raw: unknown): RegisterDef[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, unknown>)
    .map(([name, def]) => {
      const d = (def ?? {}) as { address?: unknown; scale?: unknown };
      return {
        name,
        address: typeof d.address === "number" ? d.address : -1,
        scale: typeof d.scale === "number" ? d.scale : undefined,
      };
    })
    .filter((r) => r.address >= 0)
    .sort((a, b) => a.address - b.address);
}

function parseYaml(raw: unknown): Map<string, Entry> {
  const devices = (raw as { devices?: RawDevice[] } | null)?.devices;
  if (!Array.isArray(devices) || devices.length === 0) {
    throw new TopologyError(`No devices found in ${yamlPath()}.`);
  }
  const out = new Map<string, Entry>();
  for (const d of devices) {
    const id = typeof d.id === "string" ? d.id : null;
    if (!id) throw new TopologyError(`A device entry has no string "id".`);
    out.set(id, {
      id,
      parentId: typeof d.parent === "string" ? d.parent : null,
      plantId: typeof d.plant === "string" ? d.plant : (process.env.DEFAULT_PLANT_ID ?? "plant01"),
      tenantId: typeof d.tenant === "string" ? d.tenant : "unknown",
      slave: typeof d.slave === "number" ? d.slave : null,
      registers: readYamlRegisters(d.registers),
      displayName: id,
      hidden: false,
      isVirtual: false,
      area: null,
    });
  }
  return out;
}

const globalForTopology = globalThis as unknown as {
  emsYaml?: { mtimeMs: number; path: string; value: Map<string, Entry> };
};

function parseYamlCached(path: string): Map<string, Entry> {
  const mtimeMs = statSync(path).mtimeMs;
  const cached = globalForTopology.emsYaml;
  if (cached && cached.path === path && cached.mtimeMs === mtimeMs) return cached.value;
  const value = parseYaml(parse(readFileSync(path, "utf8")));
  globalForTopology.emsYaml = { mtimeMs, path, value };
  return value;
}

/* ---- Public API ----------------------------------------------------------- */

export async function getTopology(plantId?: string): Promise<Topology> {
  try {
    const rows = await deviceRows(plantId);
    if (rows.length > 0) {
      const entries = new Map<string, Entry>(
        rows.filter((r) => !r.hidden).map((r) => [r.device_id, rowToEntry(r)]),
      );
      // A parent hidden or in another plant becomes a root here.
      for (const e of entries.values()) {
        if (e.parentId && !entries.has(e.parentId)) e.parentId = null;
      }
      return buildTopology(entries);
    }
  } catch {
    /* registry empty or unreachable — fall back to yaml below */
  }

  const base = parseYamlCached(yamlPath());
  const topo = buildTopology(new Map([...base].map(([id, b]) => [id, { ...b }])));
  if (!plantId) return topo;
  const nodes = topo.nodes.filter((n) => n.plantId === plantId);
  const ids = new Set(nodes.map((n) => n.id));
  const roots = nodes.filter((n) => n.parentId === null || !ids.has(n.parentId));
  return { ...topo, nodes, roots, rootIds: roots.map((n) => n.id), allIds: nodes.map((n) => n.id) };
}

/** Plant ids that have at least one device in the registry — i.e. real, set-up
    plants. Used to choose a sensible default plant (one with data) over an empty
    placeholder, without hardcoding a specific plant id. */
export async function plantsWithDevices(): Promise<Set<string>> {
  try {
    const rows = await q<{ plant_id: string }>(`SELECT DISTINCT plant_id FROM device`);
    return new Set(rows.map((r) => r.plant_id));
  } catch {
    return new Set();
  }
}

/** Every device the editor manages for a plant — INCLUDING hidden ones. */
export async function getManagedDevices(plantId: string): Promise<ManagedDevice[]> {
  const rows = await deviceRows(plantId);
  return rows
    .map((r) => ({
      id: r.device_id,
      displayName: r.display_name || r.device_id,
      parentId: r.parent_id,
      hidden: r.hidden,
      isVirtual: r.is_virtual,
      plantId: r.plant_id,
      slave: r.slave,
      area: r.area,
      byteOrder: r.byte_order,
      registers: registersForEdit(r.registers),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

type PlantRow = {
  id: string;
  name: string;
  tenant_id: string;
  tenant_name: string | null;
  timezone: string | null;
  tariff_kvah: string | number | null;
  contract_kva: string | number | null;
  demand_block_min: number | null;
};

/** Coalesce a nullable numeric column (pg returns numeric as string) to a default. */
const numOr = (v: string | number | null, dflt: number): number => {
  const n = typeof v === "number" ? v : v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : dflt;
};

function rowToPlantInfo(r: PlantRow): PlantInfo {
  return {
    id: r.id,
    name: r.name,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name ?? r.tenant_id,
    timezone: r.timezone ?? PLANT_DEFAULTS.timezone,
    tariffKvah: numOr(r.tariff_kvah, PLANT_DEFAULTS.tariffKvah),
    contractKva: numOr(r.contract_kva, PLANT_DEFAULTS.contractKva),
    demandBlockMin: r.demand_block_min ?? PLANT_DEFAULTS.demandBlockMin,
  };
}

/** The plant registry — the plant selector's source and per-plant config (DB,
    with a yaml fallback that carries only defaults). */
export async function listPlants(): Promise<PlantInfo[]> {
  try {
    const rows = await q<PlantRow>(
      // Order by the number in the plant name (Plant 1, Plant 2, … Plant 12) so
      // the selector reads naturally; names without a number fall to the end.
      `SELECT p.id, p.name, p.tenant_id, t.name AS tenant_name,
              p.timezone, p.tariff_kvah, p.contract_kva, p.demand_block_min
         FROM plant p
         LEFT JOIN tenant t ON t.id = p.tenant_id
        ORDER BY NULLIF(regexp_replace(p.name, '[^0-9]', '', 'g'), '')::int NULLS LAST, p.name`,
    );
    if (rows.length > 0) return rows.map(rowToPlantInfo);
  } catch {
    /* no plant table — fall through */
  }
  try {
    const base = parseYamlCached(yamlPath());
    return [...new Set([...base.values()].map((e) => e.plantId))]
      .sort()
      .map((id) => ({ id, name: id, tenantId: "unknown", tenantName: "unknown", ...PLANT_DEFAULTS }));
  } catch {
    return [];
  }
}
