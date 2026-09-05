/**
 * import-devices.ts — seed / refresh the DB device registry from
 * config/devices.yaml. The DB is the source of truth going forward; this keeps
 * it reconcilable with the git-tracked yaml (and its documented register maps).
 *
 * Idempotent (upsert). Run AFTER `prisma migrate deploy` (tables must exist),
 * BEFORE the app relies on the registry:
 *   node --import tsx scripts/import-devices.ts
 *
 * It also folds any edits from the legacy `device_topology` overlay (which the UI
 * created before the registry) into device rows, then that overlay can be dropped.
 */
import { readFileSync } from "node:fs";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { Prisma, PrismaClient } from "@prisma/client";
import { loadDeviceConfig, loadEnv } from "@ems/config";

async function main(): Promise<void> {
  const env = loadEnv();
  const path = env.DEVICE_CONFIG_PATH;

  const devices = loadDeviceConfig(path, {
    tenant: env.DEFAULT_TENANT_ID,
    plant: env.DEFAULT_PLANT_ID,
    byteOrder: env.MODBUS_BYTE_ORDER,
  });

  // `parent` is topology metadata, not on ResolvedDevice — read it from the yaml.
  const raw = parseYaml(readFileSync(path, "utf8")) as {
    devices?: Array<{ id?: unknown; parent?: unknown }>;
  };
  const parentOf = new Map<string, string | null>();
  for (const d of raw.devices ?? []) {
    if (typeof d.id === "string") parentOf.set(d.id, typeof d.parent === "string" ? d.parent : null);
  }

  const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  try {
    // Tenants + plants (migration 0004 seeds plant01; this covers any others).
    for (const t of new Set(devices.map((d) => d.tenant))) {
      await db.tenant.upsert({ where: { id: t }, create: { id: t, name: t }, update: {} });
    }
    for (const p of new Set(devices.map((d) => d.plant))) {
      const tenantId = devices.find((d) => d.plant === p)!.tenant;
      await db.plant.upsert({ where: { id: p }, create: { id: p, tenantId, name: p }, update: {} });
    }

    // Devices (register map preserved exactly, as resolved by loadDeviceConfig).
    for (const d of devices) {
      const registers = [...d.registers] as unknown as Prisma.InputJsonValue;
      await db.device.upsert({
        where: { plantId_deviceId: { plantId: d.plant, deviceId: d.id } },
        create: {
          plantId: d.plant,
          deviceId: d.id,
          tenantId: d.tenant,
          slave: d.slave,
          parentId: parentOf.get(d.id) ?? null,
          registers,
        },
        update: {
          tenantId: d.tenant,
          slave: d.slave,
          parentId: parentOf.get(d.id) ?? null,
          registers,
        },
      });
    }

    // Fold the legacy device_topology overlay (plant01-scoped) into device rows.
    try {
      const overrides = await db.$queryRawUnsafe<
        Array<{
          device_id: string;
          parent_id: string | null;
          display_name: string | null;
          hidden: boolean;
          is_virtual: boolean;
        }>
      >(`SELECT device_id, parent_id, display_name, hidden, is_virtual FROM device_topology`);
      for (const o of overrides) {
        await db.device.upsert({
          where: { plantId_deviceId: { plantId: env.DEFAULT_PLANT_ID, deviceId: o.device_id } },
          create: {
            plantId: env.DEFAULT_PLANT_ID,
            deviceId: o.device_id,
            tenantId: env.DEFAULT_TENANT_ID,
            parentId: o.parent_id,
            displayName: o.display_name,
            hidden: o.hidden,
            isVirtual: o.is_virtual,
            registers: {},
          },
          update: {
            parentId: o.parent_id,
            displayName: o.display_name,
            hidden: o.hidden,
            isVirtual: o.is_virtual,
          },
        });
      }
      if (overrides.length) process.stdout.write(`folded ${overrides.length} device_topology override(s)\n`);
    } catch {
      /* no overlay table (fresh install) — nothing to fold */
    }

    const plantCount = new Set(devices.map((d) => d.plant)).size;
    process.stdout.write(`imported ${devices.length} device(s) across ${plantCount} plant(s)\n`);
  } finally {
    await db.$disconnect();
  }
}

const isEntrypoint = argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href;
if (isEntrypoint) {
  main().catch((err) => {
    process.stderr.write(`import-devices failed: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
