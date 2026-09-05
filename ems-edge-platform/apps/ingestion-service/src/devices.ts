import type { AppEnv, ResolvedDevice, ResolvedRegister } from "@ems/config";
import { loadDeviceConfig } from "@ems/config";
import type { Database } from "@ems/database";
import type { Logger } from "@ems/logger";

/**
 * Resolve the device set this process polls.
 *
 * The DB `device` table (registry) is the source of truth. If it is empty for
 * this plant, or unreachable, we fall back to `devices.yaml` — so the poller
 * keeps working during (and before) the registry rollout, and the yaml stays a
 * usable escape hatch. Only real, pollable meters are returned: virtual/hidden
 * topology nodes and rows without a slave or registers are skipped.
 */
export async function resolveDevices(
  env: AppEnv,
  db: Database,
  logger: Logger,
): Promise<readonly ResolvedDevice[]> {
  try {
    const rows = await db.device.findMany({
      where: { plantId: env.DEFAULT_PLANT_ID, hidden: false },
      orderBy: { deviceId: "asc" },
    });

    const pollable = rows
      .filter(
        (r) =>
          r.slave !== null &&
          !r.isVirtual &&
          Array.isArray(r.registers) &&
          (r.registers as unknown[]).length > 0,
      )
      .map(
        (r) =>
          ({
            id: r.deviceId,
            slave: r.slave as number,
            tenant: r.tenantId,
            plant: r.plantId,
            functionCode: 3,
            batch: true,
            registers: r.registers as unknown as ResolvedRegister[],
          }) satisfies ResolvedDevice,
      );

    if (pollable.length > 0) {
      logger.info(
        { devices: pollable.length, plant: env.DEFAULT_PLANT_ID, source: "db" },
        "device registry loaded from DB",
      );
      return pollable;
    }
    logger.warn(
      { plant: env.DEFAULT_PLANT_ID },
      "device registry empty for this plant — falling back to devices.yaml",
    );
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "device registry DB read failed — falling back to devices.yaml",
    );
  }

  const devices = loadDeviceConfig(env.DEVICE_CONFIG_PATH, {
    tenant: env.DEFAULT_TENANT_ID,
    plant: env.DEFAULT_PLANT_ID,
    byteOrder: env.MODBUS_BYTE_ORDER,
  });
  logger.info(
    { devices: devices.length, source: "yaml" },
    "device register map loaded from devices.yaml (fallback)",
  );
  return devices;
}
