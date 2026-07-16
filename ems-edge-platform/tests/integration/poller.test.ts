import { describe, it, expect } from "vitest";
import { DevicePoller } from "@ems/gateway-listener";
import type { PipelineHooks, Transactor } from "@ems/gateway-listener";
import type { ResolvedDevice } from "@ems/config";
import type { TelemetryRecord } from "@ems/telemetry";
import { createLogger } from "@ems/logger";
import { createModbusCodec } from "@ems/modbus";
import { buildFloatResponse } from "../helpers/modbus-frame.js";

const log = createLogger({ level: "silent", service: "test" });

const noopHooks: PipelineHooks = {
  onFrameDecoded: () => {}, onCrcError: () => {}, onModbusException: () => {},
  onDecodeError: () => {}, onRecordProduced: () => {}, onPollCycle: () => {},
};

const device: ResolvedDevice = {
  id: "meter07", slave: 7, tenant: "rucha", plant: "plant01", functionCode: 3,
  registers: [
    { metric: "voltage", address: 0, quantity: 2, datatype: "float32", byteOrder: "ABCD", scale: 1 },
    { metric: "current", address: 6, quantity: 2, datatype: "float32", byteOrder: "ABCD", scale: 1 },
  ],
};

/** Fake Modbus slave: answers each request with a preset value per address. */
class FakeTransactor implements Transactor {
  readonly connectionId = "conn_test";
  readonly remoteAddress = "127.0.0.1:0";
  constructor(private readonly byAddress: Record<number, number>) {}
  async transact(request: Uint8Array): Promise<Uint8Array> {
    const address = (request[2]! << 8) | request[3]!;
    return buildFloatResponse(7, this.byAddress[address] ?? 0);
  }
}

describe("DevicePoller (transport-isolated end-to-end decode)", () => {
  it("produces a validated GOOD record from Modbus responses", async () => {
    const produced: TelemetryRecord[] = [];
    const transactor = new FakeTransactor({ 0: 230.5, 6: 4.2 });
    const poller = new DevicePoller(
      transactor, createModbusCodec("rtu"), [device],
      async (r: TelemetryRecord) => void produced.push(r),
      noopHooks, log,
      { intervalMs: 10_000, timeoutMs: 500, maxRetries: 1 },
    );

    // start() fires an immediate tick; wait for the async cycle to complete.
    poller.start();
    await new Promise((r) => setTimeout(r, 50));
    poller.stop();

    expect(produced.length).toBeGreaterThanOrEqual(1);
    const rec = produced[0]!;
    expect(rec.deviceId).toBe("meter07");
    expect(rec.quality).toBe("GOOD");
    expect(rec.voltage).toBeCloseTo(230.5, 2);
    expect(rec.current).toBeCloseTo(4.2, 2);
  });
});
