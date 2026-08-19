import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

/**
 * The ONLY module that knows how meter topology is stored.
 *
 * Today it parses the edge platform's `devices.yaml`. When the device registry
 * lands (see ems-edge-platform/docs/arch.md §3) this queries the `devices` table
 * instead and nothing else in the UI changes — every caller depends on the shape
 * returned here, not on where it came from.
 *
 * A meter with no `parent` is a ROOT: the utility incomer. Its reading already
 * contains everything downstream of it, which is why plant totals sum roots only.
 */

export type RegisterDef = { name: string; address: number; scale?: number };

export type MeterNode = {
  id: string;
  plantId: string;
  tenantId: string;
  parentId: string | null;
  /** Root-first chain including this node, e.g. ["meter11", "meter07"]. */
  path: string[];
  depth: number;
  /** Modbus slave address, straight from the register map. */
  slave: number | null;
  /** What this device is actually configured to poll. */
  registers: RegisterDef[];
};

export type Topology = {
  nodes: MeterNode[];
  byId: Map<string, MeterNode>;
  roots: MeterNode[];
  rootIds: string[];
  /** All device ids, for panels that are genuinely per-device. */
  allIds: string[];
  parentOf(id: string): MeterNode | null;
  childrenOf(id: string): MeterNode[];
  /** Descendants, excluding the node itself. */
  descendantsOf(id: string): MeterNode[];
  /** The node and everything under it — the id set for a subtree rollup. */
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

export class TopologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopologyError";
  }
}

function yamlPath(): string {
  return resolve(
    process.env.DEVICES_YAML ?? "../ems-edge-platform/config/devices.yaml",
  );
}

/** Cached per process, invalidated on file mtime so dev picks up edits. */
const globalForTopology = globalThis as unknown as {
  emsTopology?: { mtimeMs: number; path: string; value: Topology };
};

function build(raw: unknown): Topology {
  const devices = (raw as { devices?: RawDevice[] } | null)?.devices;
  if (!Array.isArray(devices) || devices.length === 0) {
    throw new TopologyError(
      `No devices found in ${yamlPath()} — expected a top-level "devices:" list.`,
    );
  }

  const parents = new Map<string, string | null>();
  const meta = new Map<
    string,
    { plantId: string; tenantId: string; slave: number | null; registers: RegisterDef[] }
  >();

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

  for (const d of devices) {
    const id = typeof d.id === "string" ? d.id : null;
    if (!id) throw new TopologyError(`A device entry has no string "id".`);
    if (parents.has(id)) throw new TopologyError(`Duplicate device id "${id}".`);
    parents.set(id, typeof d.parent === "string" ? d.parent : null);
    meta.set(id, {
      plantId: typeof d.plant === "string" ? d.plant : "plant01",
      tenantId: typeof d.tenant === "string" ? d.tenant : "unknown",
      slave: typeof d.slave === "number" ? d.slave : null,
      registers: readRegisters(d.registers),
    });
  }

  // Every named parent must exist, or a whole subtree silently vanishes.
  for (const [id, parentId] of parents) {
    if (parentId !== null && !parents.has(parentId)) {
      throw new TopologyError(
        `Device "${id}" names parent "${parentId}", which is not defined in ${yamlPath()}.`,
      );
    }
  }

  // Walk to the root from each node. A cycle would otherwise hang the request.
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
      cur = parents.get(cur) ?? null;
    }
    return chain;
  };

  const nodes: MeterNode[] = [...parents.keys()].map((id) => {
    const path = pathOf(id);
    const m = meta.get(id)!;
    return {
      id,
      plantId: m.plantId,
      tenantId: m.tenantId,
      parentId: parents.get(id) ?? null,
      path,
      depth: path.length - 1,
      slave: m.slave,
      registers: m.registers,
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

export async function getTopology(plantId?: string): Promise<Topology> {
  const path = yamlPath();
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    throw new TopologyError(
      `Cannot read the register map at ${path}. Set DEVICES_YAML to point at it (in the container it is mounted at /app/config/devices.yaml).`,
    );
  }

  const cached = globalForTopology.emsTopology;
  let topo: Topology;
  if (cached && cached.path === path && cached.mtimeMs === mtimeMs) {
    topo = cached.value;
  } else {
    topo = build(parse(readFileSync(path, "utf8")));
    globalForTopology.emsTopology = { mtimeMs, path, value: topo };
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

/** Distinct plants present in the register map — the plant selector's source. */
export async function listPlants(): Promise<string[]> {
  const t = await getTopology();
  return [...new Set(t.nodes.map((n) => n.plantId))].sort();
}
