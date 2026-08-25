import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { q } from "./db";

/**
 * The ONLY module that knows how meter topology is stored.
 *
 * The BASE hierarchy is the edge platform's `devices.yaml` (read-only, the
 * poller's config). On top of it we merge a UI-owned OVERLAY held in Postgres
 * (`device_topology`) so the hierarchy can be edited from the dashboard —
 * re-parent, rename (display label only), hide, and add virtual/adopted nodes —
 * without ever rewriting the yaml. `parent` is rollup metadata; the poller never
 * reads it, so editing it cannot affect data collection.
 *
 * A meter with no `parent` is a ROOT: the utility incomer. Its reading already
 * contains everything downstream of it, which is why plant totals sum roots only.
 */

export type RegisterDef = { name: string; address: number; scale?: number };

export type MeterNode = {
  id: string;
  /** Display label — defaults to `id`; never used as a key. */
  displayName: string;
  plantId: string;
  tenantId: string;
  parentId: string | null;
  /** Root-first chain including this node, e.g. ["meter11", "meter07"]. */
  path: string[];
  depth: number;
  slave: number | null;
  registers: RegisterDef[];
  /** True for UI-created grouping nodes with no telemetry of their own. */
  isVirtual: boolean;
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

type RawDevice = {
  id?: unknown;
  parent?: unknown;
  plant?: unknown;
  tenant?: unknown;
  slave?: unknown;
  registers?: unknown;
};

/** A device before the tree is built (yaml row or overlay-created node). */
type Entry = {
  id: string;
  parentId: string | null;
  plantId: string;
  tenantId: string;
  slave: number | null;
  registers: RegisterDef[];
  displayName: string;
  hidden: boolean;
  isVirtual: boolean;
};

export class TopologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopologyError";
  }
}

function yamlPath(): string {
  return resolve(process.env.DEVICES_YAML ?? "../ems-edge-platform/config/devices.yaml");
}

const readRegisters = (raw: unknown): RegisterDef[] => {
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
};

/** Parse the yaml device list into base entries (no overlay applied yet). */
function parseYaml(raw: unknown): Map<string, Entry> {
  const devices = (raw as { devices?: RawDevice[] } | null)?.devices;
  if (!Array.isArray(devices) || devices.length === 0) {
    throw new TopologyError(
      `No devices found in ${yamlPath()} — expected a top-level "devices:" list.`,
    );
  }
  const out = new Map<string, Entry>();
  for (const d of devices) {
    const id = typeof d.id === "string" ? d.id : null;
    if (!id) throw new TopologyError(`A device entry has no string "id".`);
    if (out.has(id)) throw new TopologyError(`Duplicate device id "${id}".`);
    out.set(id, {
      id,
      parentId: typeof d.parent === "string" ? d.parent : null,
      plantId: typeof d.plant === "string" ? d.plant : "plant01",
      tenantId: typeof d.tenant === "string" ? d.tenant : "unknown",
      slave: typeof d.slave === "number" ? d.slave : null,
      registers: readRegisters(d.registers),
      displayName: id,
      hidden: false,
      isVirtual: false,
    });
  }
  return out;
}

/** Cache the yaml PARSE by mtime; the overlay is merged fresh on every call. */
const globalForTopology = globalThis as unknown as {
  emsYaml?: { mtimeMs: number; path: string; value: Map<string, Entry> };
};

function parseYamlCached(path: string): Map<string, Entry> {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    throw new TopologyError(
      `Cannot read the register map at ${path}. Set DEVICES_YAML to point at it (in the container it is mounted at /app/config/devices.yaml).`,
    );
  }
  const cached = globalForTopology.emsYaml;
  if (cached && cached.path === path && cached.mtimeMs === mtimeMs) return cached.value;
  const value = parseYaml(parse(readFileSync(path, "utf8")));
  globalForTopology.emsYaml = { mtimeMs, path, value };
  return value;
}

/** Build the tree + run structural validation. Throws on cycle / dangling parent / no root. */
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
    throw new TopologyError(
      `No root meter: every device names a parent, so there is no incomer to total from.`,
    );
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

/* ---- Overlay (UI-owned, in Postgres) -------------------------------------- */

export type TopologyOverride = {
  deviceId: string;
  parentId: string | null;
  displayName: string | null;
  hidden: boolean;
  isVirtual: boolean;
};

/** Result of a topology mutation action (kept here, not in the "use server"
    module, whose exports must all be async functions). */
export type ActionResult = { ok: true } | { ok: false; error: string };

let tableEnsured = false;

/** Idempotently create the overlay table (the `ems` user owns the schema). */
export async function ensureTopologyTable(): Promise<void> {
  if (tableEnsured) return;
  await q(
    `CREATE TABLE IF NOT EXISTS device_topology (
       device_id    text PRIMARY KEY,
       parent_id    text,
       display_name text,
       hidden       boolean NOT NULL DEFAULT false,
       is_virtual   boolean NOT NULL DEFAULT false,
       updated_at   timestamptz NOT NULL DEFAULT now()
     )`,
  );
  tableEnsured = true;
}

/** Read all overrides. Resilient: if the DB is unreachable, returns none so the
    dashboard still renders the yaml hierarchy. */
export async function loadOverlay(): Promise<TopologyOverride[]> {
  try {
    await ensureTopologyTable();
    const rows = await q<{
      device_id: string;
      parent_id: string | null;
      display_name: string | null;
      hidden: boolean;
      is_virtual: boolean;
    }>(`SELECT device_id, parent_id, display_name, hidden, is_virtual FROM device_topology`);
    return rows.map((r) => ({
      deviceId: r.device_id,
      parentId: r.parent_id,
      displayName: r.display_name,
      hidden: r.hidden,
      isVirtual: r.is_virtual,
    }));
  } catch {
    return [];
  }
}

function mergeOverlay(base: Map<string, Entry>, overrides: TopologyOverride[]): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  for (const [id, b] of base) entries.set(id, { ...b, registers: [...b.registers] });

  const ovById = new Map(overrides.map((o) => [o.deviceId, o]));

  // Overlay-only devices (adopted orphans / virtual grouping nodes).
  for (const o of overrides) {
    if (!entries.has(o.deviceId)) {
      entries.set(o.deviceId, {
        id: o.deviceId,
        parentId: null,
        plantId: "plant01",
        tenantId: "unknown",
        slave: null,
        registers: [],
        displayName: o.deviceId,
        hidden: false,
        isVirtual: o.isVirtual,
      });
    }
  }

  // Apply overrides.
  for (const e of entries.values()) {
    const o = ovById.get(e.id);
    if (!o) continue;
    e.parentId = o.parentId;
    if (o.displayName) e.displayName = o.displayName;
    e.hidden = o.hidden;
    e.isVirtual = e.isVirtual || o.isVirtual;
  }

  // Drop hidden devices; a child pointing at a now-missing parent becomes a root.
  const visible = new Map([...entries].filter(([, e]) => !e.hidden));
  for (const e of visible.values()) {
    if (e.parentId && !visible.has(e.parentId)) e.parentId = null;
  }
  return visible;
}

/** Would this full overlay set produce a valid tree (no cycle, a root exists,
    every parent defined)? Used by the mutation actions before persisting. */
export function validateOverlay(
  overrides: TopologyOverride[],
): { ok: true } | { ok: false; error: string } {
  try {
    buildTopology(mergeOverlay(parseYamlCached(yamlPath()), overrides));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getTopology(plantId?: string): Promise<Topology> {
  const base = parseYamlCached(yamlPath());
  const overrides = await loadOverlay();

  let topo: Topology;
  try {
    topo = buildTopology(mergeOverlay(base, overrides));
  } catch {
    // A corrupt overlay must never brick the dashboard — fall back to the yaml base.
    topo = buildTopology(new Map([...base].map(([id, b]) => [id, { ...b }])));
  }

  if (!plantId) return topo;

  // Plant scoping is a filter over the same shape, so multi-plant needs no new code.
  const nodes = topo.nodes.filter((n) => n.plantId === plantId);
  const ids = new Set(nodes.map((n) => n.id));
  const roots = nodes.filter((n) => n.parentId === null || !ids.has(n.parentId));
  return {
    ...topo,
    nodes,
    roots,
    rootIds: roots.map((n) => n.id),
    allIds: nodes.map((n) => n.id),
  };
}

export type ManagedDevice = {
  id: string;
  displayName: string;
  parentId: string | null;
  hidden: boolean;
  isVirtual: boolean;
  /** Present in devices.yaml (vs a UI-only virtual/adopted node). */
  inYaml: boolean;
};

/**
 * Every device the editor manages — yaml devices plus overlay rows, INCLUDING
 * hidden ones (so they can be un-hidden). `getTopology` drops hidden; this does
 * not.
 */
export async function getManagedDevices(): Promise<ManagedDevice[]> {
  const base = parseYamlCached(yamlPath());
  const overrides = await loadOverlay();
  const ovById = new Map(overrides.map((o) => [o.deviceId, o]));
  const ids = new Set<string>([...base.keys(), ...overrides.map((o) => o.deviceId)]);
  return [...ids]
    .map((id) => {
      const b = base.get(id);
      const o = ovById.get(id);
      return {
        id,
        displayName: o?.displayName || id,
        parentId: o ? o.parentId : (b?.parentId ?? null),
        hidden: o?.hidden ?? false,
        isVirtual: (o?.isVirtual ?? false) || !b,
        inYaml: !!b,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Distinct plants present in the register map — the plant selector's source. */
export async function listPlants(): Promise<string[]> {
  const t = await getTopology();
  return [...new Set(t.nodes.map((n) => n.plantId))].sort();
}
