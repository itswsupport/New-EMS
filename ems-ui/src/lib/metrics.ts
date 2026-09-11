/**
 * Register-map vocabulary — pure, no server imports, so BOTH the client editor
 * and the server actions can use it. The DB `device.registers` jsonb is a
 * fully-resolved ResolvedRegister[] read straight by the edge poller, so a meter
 * added from the UI must emit exactly this shape.
 *
 * `metric` names are NOT free-form: each maps to a fixed column in
 * energy_telemetry. Different meter brands share the same metrics but at
 * different Modbus addresses / datatypes / scales — which is exactly what this
 * editor lets you set per meter.
 */

export const DATATYPES = ["float32", "int16", "uint16", "int32", "uint32"] as const;
export type DataType = (typeof DATATYPES)[number];

export const BYTE_ORDERS = ["ABCD", "BADC", "CDAB", "DCBA"] as const;
export type ByteOrder = (typeof BYTE_ORDERS)[number];

/** One fully-resolved register read plan (matches the edge ResolvedRegister). */
export type ResolvedRegister = {
  metric: string;
  address: number;
  quantity: number;
  datatype: DataType;
  byteOrder: ByteOrder;
  scale: number;
};

/** Metrics that map to energy_telemetry columns (the dashboards read these). */
export const METRICS = [
  "voltage", "current", "active_power", "apparent_power", "reactive_power",
  "power_factor", "frequency", "active_energy", "reactive_energy",
  "voltage_l1", "voltage_l2", "voltage_l3",
  "current_l1", "current_l2", "current_l3",
  "active_power_l1", "active_power_l2", "active_power_l3",
  "power_factor_l1", "power_factor_l2", "power_factor_l3",
  "voltage_thd", "current_thd", "maximum_demand",
] as const;

/** The subset the dashboards actually chart — seeded by "Load standard metrics". */
export const STANDARD_METRICS = [
  "voltage", "current", "active_power", "apparent_power", "reactive_power",
  "power_factor", "frequency", "active_energy", "reactive_energy",
  "voltage_thd", "current_thd",
] as const;

export const isDataType = (v: string): v is DataType => (DATATYPES as readonly string[]).includes(v);
export const isByteOrder = (v: string): v is ByteOrder => (BYTE_ORDERS as readonly string[]).includes(v);

/** float32/int32/uint32 span two 16-bit words; int16/uint16 span one. */
export function defaultQuantity(dt: DataType): number {
  return dt === "int16" || dt === "uint16" ? 1 : 2;
}

/** Loose register as it arrives from the form (numbers may be strings). */
export type RegisterInput = {
  metric?: unknown;
  address?: unknown;
  datatype?: unknown;
  quantity?: unknown;
  scale?: unknown;
};

/**
 * Validate + coerce form register rows into the poller's ResolvedRegister[].
 * Rejects empties, bad addresses/types, and duplicate metrics; fills defaults.
 */
export function buildRegisters(
  rows: RegisterInput[],
  deviceByteOrder: ByteOrder,
): { ok: true; registers: ResolvedRegister[] } | { ok: false; error: string } {
  const out: ResolvedRegister[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const metric = String(r.metric ?? "").trim();
    if (!metric) continue; // blank row — skip
    if (seen.has(metric)) return { ok: false, error: `Duplicate metric "${metric}".` };

    const address = Number(r.address);
    if (!Number.isInteger(address) || address < 0) {
      return { ok: false, error: `Register "${metric}" needs a whole address ≥ 0.` };
    }
    const datatype = String(r.datatype ?? "float32");
    if (!isDataType(datatype)) return { ok: false, error: `Register "${metric}" has an unknown datatype.` };

    const quantity = r.quantity == null || r.quantity === "" ? defaultQuantity(datatype) : Number(r.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 4) {
      return { ok: false, error: `Register "${metric}" quantity must be 1–4.` };
    }
    const scale = r.scale == null || r.scale === "" ? 1 : Number(r.scale);
    if (!Number.isFinite(scale) || scale === 0) {
      return { ok: false, error: `Register "${metric}" scale must be a non-zero number.` };
    }

    seen.add(metric);
    out.push({ metric, address, quantity, datatype, byteOrder: deviceByteOrder, scale });
  }
  if (out.length === 0) return { ok: false, error: "Add at least one register." };
  return { ok: true, registers: out };
}
