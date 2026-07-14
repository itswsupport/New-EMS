import { z } from "zod";

/**
 * Register-map schema. This is the contract for `config/devices.yaml`. The
 * parser is DRIVEN by this data — no register address ever appears in code.
 */
const byteOrder = z.enum(["ABCD", "BADC", "CDAB", "DCBA"]);

const registerSchema = z.object({
  address: z.number().int().min(0),
  quantity: z.number().int().min(1).max(4).optional(),
  datatype: z.enum(["float32", "int16", "uint16", "int32", "uint32"]).optional(),
  scale: z.number().optional(),
  byteOrder: byteOrder.optional(),
});

const deviceSchema = z.object({
  id: z.string().min(1),
  slave: z.number().int().min(1).max(247),
  tenant: z.string().min(1).optional(),
  plant: z.string().min(1).optional(),
  registers: z.record(z.string(), registerSchema).refine(
    (r) => Object.keys(r).length > 0,
    "device must declare at least one register",
  ),
});

export const deviceConfigSchema = z.object({
  version: z.number().int().default(1),
  defaults: z
    .object({
      functionCode: z.literal(3).default(3),
      datatype: z.enum(["float32", "int16", "uint16", "int32", "uint32"]).default("float32"),
      quantity: z.number().int().min(1).max(4).default(2),
      byteOrder: byteOrder.default("ABCD"),
    })
    .default({}),
  devices: z.array(deviceSchema).min(1),
});

export type RegisterDef = z.infer<typeof registerSchema>;
export type DeviceDef = z.infer<typeof deviceSchema>;
export type DeviceConfig = z.infer<typeof deviceConfigSchema>;
