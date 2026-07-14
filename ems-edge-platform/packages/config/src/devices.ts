import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { DomainError, type ByteOrder } from "@ems/common";
import { deviceConfigSchema } from "./devices.schema.js";

/** A single register read plan, fully resolved (no optionals left). */
export interface ResolvedRegister {
  readonly metric: string;
  readonly address: number;
  readonly quantity: number;
  readonly datatype: "float32" | "int16" | "uint16" | "int32" | "uint32";
  readonly byteOrder: ByteOrder;
  readonly scale: number;
}

/** A device with tenancy + a flat, ordered list of register read plans. */
export interface ResolvedDevice {
  readonly id: string;
  readonly slave: number;
  readonly tenant: string;
  readonly plant: string;
  readonly functionCode: 3;
  readonly registers: readonly ResolvedRegister[];
}

export interface DeviceResolutionDefaults {
  readonly tenant: string;
  readonly plant: string;
  readonly byteOrder: ByteOrder;
}

/**
 * Load + validate the YAML register map, then resolve every optional against the
 * file defaults and process-level defaults (env). The returned model is what the
 * Modbus poller iterates — it contains no ambiguity, so the hot path stays branch-light.
 */
export function loadDeviceConfig(
  path: string,
  defaults: DeviceResolutionDefaults,
): readonly ResolvedDevice[] {
  let rawText: string;
  try {
    rawText = readFileSync(path, "utf8");
  } catch (cause) {
    throw new DomainError("CONFIG_ERROR", `Cannot read device config at ${path}`, {
      reason: (cause as Error).message,
    });
  }

  const parsed = deviceConfigSchema.safeParse(parseYaml(rawText));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new DomainError("CONFIG_ERROR", `Invalid device config: ${issues}`);
  }

  const cfg = parsed.data;
  const seenIds = new Set<string>();

  return cfg.devices.map((d) => {
    if (seenIds.has(d.id)) {
      throw new DomainError("CONFIG_ERROR", `Duplicate device id: ${d.id}`);
    }
    seenIds.add(d.id);

    const registers: ResolvedRegister[] = Object.entries(d.registers).map(
      ([metric, reg]) => ({
        metric,
        address: reg.address,
        quantity: reg.quantity ?? cfg.defaults.quantity,
        datatype: reg.datatype ?? cfg.defaults.datatype,
        // Precedence: per-register > device-file default > process (env) default.
        byteOrder: reg.byteOrder ?? cfg.defaults.byteOrder ?? defaults.byteOrder,
        scale: reg.scale ?? 1,
      }),
    );

    return {
      id: d.id,
      slave: d.slave,
      tenant: d.tenant ?? defaults.tenant,
      plant: d.plant ?? defaults.plant,
      functionCode: 3,
      registers,
    } satisfies ResolvedDevice;
  });
}
